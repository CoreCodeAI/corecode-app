package service

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// maxViolationExcerptBytes caps the refused message kept for review.
const maxViolationExcerptBytes = 4096

// refusedMessagePreviewRunes caps how much of the refused message a blocked
// request quotes back to the customer.
const refusedMessagePreviewRunes = 40

// refusedMessagePreview is the start of a refused message on one line, for
// the customer to find the message in the conversation.
func refusedMessagePreview(message string) string {
	runes := []rune(strings.Join(strings.Fields(message), " "))
	if len(runes) <= refusedMessagePreviewRunes {
		return string(runes)
	}
	return string(runes[:refusedMessagePreviewRunes]) + "…"
}

// minViolationMergeSeconds groups refusals into one strike when suspension is
// off, so the parallel requests of one incident still count once.
const minViolationMergeSeconds = 10 * 60

// violationGuardState is what the relay checks on every request: suspended
// users, the refused conversations of each user, and when each user's client
// checks were refused within ClientCheckWindowSeconds, oldest first. It lives
// in process memory because one new-api instance serves the relay. It loads from the database on first use, and every strike or lift
// writes the database first and then this copy.
var violationGuardState = struct {
	sync.RWMutex
	loaded         bool
	suspendedUntil map[int]int64
	conversations  map[int]map[string]model.RefusedConversation
	clientChecks   map[int][]int64
}{}

func loadViolationGuardState(setting *operation_setting.ViolationGuardSetting, now, windowStart int64) bool {
	violationGuardState.RLock()
	loaded := violationGuardState.loaded
	violationGuardState.RUnlock()
	if loaded {
		return true
	}
	suspended, err := model.GetActiveViolationSuspensions(now)
	var conversations map[int]map[string]model.RefusedConversation
	if err == nil {
		conversations, err = model.GetRefusedViolationConversations(windowStart, setting.LenientCategory)
	}
	var clientChecks map[int][]int64
	if err == nil {
		clientChecks, err = model.GetRecentClientChecks(now - operation_setting.ClientCheckWindowSeconds)
	}
	if err != nil {
		common.SysError(common.LogText("violation guard: failed to load suspensions, refused conversations and client checks: %s", err.Error()))
		return false
	}
	violationGuardState.Lock()
	defer violationGuardState.Unlock()
	if !violationGuardState.loaded {
		violationGuardState.suspendedUntil = suspended
		violationGuardState.conversations = conversations
		violationGuardState.clientChecks = clientChecks
		violationGuardState.loaded = true
	}
	return true
}

// Violation guard verdicts on a request.
const (
	violationVerdictSuspended    = "suspended"
	violationVerdictConversation = "conversation"
	violationVerdictClientCheck  = "client_check"
)

// violationRefusedRecently reports whether the upstream refused one of the
// user's conversations within the strike window. It reads the guard's loaded
// state, so it is false while the guard is off.
func violationRefusedRecently(userId int) bool {
	setting := operation_setting.GetViolationGuardSetting()
	windowStart := common.GetTimestamp() - int64(setting.StrikeWindowDays)*86400
	violationGuardState.RLock()
	defer violationGuardState.RUnlock()
	for _, conversation := range violationGuardState.conversations[userId] {
		if conversation.RefusedAt > windowStart {
			return true
		}
	}
	return false
}

// CheckViolationGuard rejects, before any channel is used, a request from an
// account suspended for a violation, a client check from an account whose
// client checks the upstream keeps refusing, or a request that resends a
// conversation the upstream refused. In observe mode it only logs what it would reject. When
// the state cannot be loaded the request passes.
func CheckViolationGuard(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	_, apiErr := violationGuardVerdict(c, info)
	return apiErr
}

// violationGuardVerdict is CheckViolationGuard that also reports what it
// found, violationVerdictSuspended, violationVerdictClientCheck or
// violationVerdictConversation, in either mode.
func violationGuardVerdict(c *gin.Context, info *relaycommon.RelayInfo) (string, *types.NewAPIError) {
	setting := operation_setting.GetViolationGuardSetting()
	if !setting.Enabled || info == nil {
		return "", nil
	}
	now := common.GetTimestamp()
	windowStart := now - int64(setting.StrikeWindowDays)*86400
	if !loadViolationGuardState(setting, now, windowStart) {
		return "", nil
	}
	enforce := setting.Mode == operation_setting.ViolationGuardModeEnforce

	violationGuardState.RLock()
	suspendedUntil := violationGuardState.suspendedUntil[info.UserId]
	hasRefusedConversations := len(violationGuardState.conversations[info.UserId]) > 0
	violationGuardState.RUnlock()

	if suspendedUntil > now {
		if enforce {
			until := time.Unix(suspendedUntil, 0).UTC().Format("2006-01-02 15:04 UTC")
			return violationVerdictSuspended, types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgViolationSuspended, map[string]any{"Until": until})),
				types.ErrorCodeViolationSuspended, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
		logger.LogInfo(c, common.LogText("violation guard (observe): user %d is suspended; enforce mode would reject this request", info.UserId))
		return violationVerdictSuspended, nil
	}
	if limit := setting.ClientCheckLimit; limit > 0 && clientCheckRequest(info.Request) {
		if refused := recentClientChecks(info.UserId, now); refused >= limit {
			if !enforce {
				logger.LogInfo(c, common.LogText("violation guard (observe): user %d sent a client check after %d were refused; enforce mode would reject this request", info.UserId, refused))
				return violationVerdictClientCheck, nil
			}
			RequestPolicy(c).AddEvent(PolicyEvent{ErrorCode: string(types.ErrorCodeViolationClientCheckBlocked), ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
			return violationVerdictClientCheck, types.NewErrorWithStatusCode(errors.New(i18n.T(c, i18n.MsgViolationClientCheckBlocked, map[string]any{"Count": refused})),
				types.ErrorCodeViolationClientCheckBlocked, http.StatusForbidden, types.ErrOptionWithSkipRetry())
		}
	}
	if !hasRefusedConversations {
		return "", nil
	}

	keys := violationConversationKeys(humanMessages(info.Request))
	var blocked *model.RefusedConversation
	violationGuardState.RLock()
	for _, key := range keys {
		if conversation, ok := violationGuardState.conversations[info.UserId][key]; ok && conversation.Blocked && conversation.RefusedAt > windowStart {
			blocked = &conversation
			break
		}
	}
	violationGuardState.RUnlock()
	if blocked == nil {
		return "", nil
	}
	if !enforce {
		logger.LogInfo(c, common.LogText("violation guard (observe): user %d resent a refused conversation; enforce mode would reject this request", info.UserId))
		return violationVerdictConversation, nil
	}
	RequestPolicy(c).AddEvent(PolicyEvent{ErrorCode: string(types.ErrorCodeViolationConversationBlocked), ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	message := i18n.T(c, i18n.MsgViolationConversationBlocked)
	if preview := refusedMessagePreview(blocked.Message); preview != "" {
		message = i18n.T(c, i18n.MsgViolationConversationBlockedQuoted, map[string]any{"Message": preview})
	}
	return violationVerdictConversation, types.NewErrorWithStatusCode(errors.New(message),
		types.ErrorCodeViolationConversationBlocked, http.StatusForbidden, types.ErrOptionWithSkipRetry())
}

// RecordUpstreamRefusal turns an upstream usage-policy refusal of this request
// into a violation record and applies the strike policy. The response has
// already been sent; the database work runs off the request.
func RecordUpstreamRefusal(c *gin.Context, info *relaycommon.RelayInfo) {
	setting := *operation_setting.GetViolationGuardSetting()
	if !setting.Enabled || info == nil || !common.GetContextKeyBool(c, constant.ContextKeyUpstreamRefusal) {
		return
	}
	category := common.GetContextKeyString(c, constant.ContextKeyUpstreamRefusalCategory)
	record := model.ViolationRecord{
		UserId:    info.UserId,
		TokenId:   info.TokenId,
		ChannelId: info.ChannelId,
		ModelName: info.OriginModelName,
		RequestId: info.RequestId,
		Category:  category[:min(len(category), 64)],
	}
	if messages := humanMessages(info.Request); len(messages) > 0 {
		keys := violationConversationKeys(messages)
		record.ConversationKey = keys[len(keys)-1]
		// A lenient refusal of a conversation the upstream already refused is
		// recorded under that conversation, so it merges into the first
		// refusal and blocks the conversation.
		if setting.LenientCategory(record.Category) {
			windowStart := common.GetTimestamp() - int64(setting.StrikeWindowDays)*86400
			violationGuardState.RLock()
			for _, key := range keys {
				if conversation, ok := violationGuardState.conversations[info.UserId][key]; ok && conversation.RefusedAt > windowStart {
					record.ConversationKey = key
					break
				}
			}
			violationGuardState.RUnlock()
		}
		excerpt := strings.TrimSuffix(messages[len(messages)-1], "\n")
		record.Excerpt = strings.ToValidUTF8(excerpt[:min(len(excerpt), maxViolationExcerptBytes)], "")
	}
	gopool.Go(func() {
		if err := applyViolationStrike(setting, record, common.GetTimestamp()); err != nil {
			common.SysError(common.LogText("violation guard: failed to record a refusal for user %d: %s", record.UserId, err.Error()))
			return
		}
		if user, err := model.GetUserCache(record.UserId); err == nil && !violationExempt(user.Role) && !clientCheckRefusal(setting, record) {
			rememberRefusedMessage(record.Excerpt)
		}
	})
}

// clientCheckRefusal reports whether a refusal judged a request the client
// sent on its own rather than the customer's ask. Claude Code's side
// requests, such as auto mode's check before a tool call, send the session as
// one user turn wrapped in <transcript>; the upstream refuses many of them as
// reasoning_extraction. Only lenient categories qualify, so a client that
// copies the wrapper cannot hide a refusal of another category.
func clientCheckRefusal(setting operation_setting.ViolationGuardSetting, record model.ViolationRecord) bool {
	return setting.LenientCategory(record.Category) && strings.HasPrefix(record.Excerpt, clientCheckPrefix)
}

// clientCheckPrefix starts the latest human message of a client check.
const clientCheckPrefix = "<transcript>"

// clientCheckRequest reports whether a request has the shape of a client
// check: its latest human message, the one a refusal records as the excerpt,
// starts with clientCheckPrefix. A request carries no refusal category yet, so
// the shape alone decides; it is only stopped for a customer whose checks
// were already refused.
func clientCheckRequest(request dto.Request) bool {
	messages := humanMessages(request)
	return len(messages) > 0 && strings.HasPrefix(messages[len(messages)-1], clientCheckPrefix)
}

// recentClientChecks counts the user's client checks the upstream refused
// within ClientCheckWindowSeconds before now.
func recentClientChecks(userId int, now int64) int {
	since := now - operation_setting.ClientCheckWindowSeconds
	violationGuardState.RLock()
	defer violationGuardState.RUnlock()
	refused := 0
	for _, refusedAt := range violationGuardState.clientChecks[userId] {
		if refusedAt > since {
			refused++
		}
	}
	return refused
}

// violationExempt reports whether refusals of a user with this role are
// recorded as exempt: administrators are never struck, and their refusals do
// not feed the risk gate's similarity check.
func violationExempt(role int) bool {
	return role >= common.RoleAdminUser
}

// applyViolationStrike records one refusal. A refusal starts a new strike
// unless its conversation already has a counted strike in the window, or the
// user's last strike is recent enough to merge with: the suspension period,
// at least minViolationMergeSeconds. Strikes count only within the mode they
// were recorded in, so observe mode is a dry run and enforce mode starts from
// zero. The first new strike of a lenient category in the window is a warning
// instead: it restricts nothing and does not count. A lenient refusal only
// holds its conversation, so the customer can continue it; a second refusal
// of a held conversation merges into the first and blocks it. A refusal of
// any other category blocks its conversation at once. Administrators are
// recorded as exempt.
func applyViolationStrike(setting operation_setting.ViolationGuardSetting, record model.ViolationRecord, now int64) error {
	user, err := model.GetUserCache(record.UserId)
	if err != nil {
		return err
	}
	state, err := model.GetUserViolationState(record.UserId)
	if err != nil {
		return err
	}
	windowStart := max(now-int64(setting.StrikeWindowDays)*86400, state.ForgivenAt)
	record.CreatedAt = now
	record.Mode = setting.Mode
	if violationExempt(user.Role) {
		record.Mode = model.ViolationModeExempt
	}

	mergeSeconds := max(int64(setting.SuspendHours)*3600, minViolationMergeSeconds)
	// A refused client check is recorded and its conversation held, but it
	// neither starts nor joins an incident.
	if clientCheckRefusal(setting, record) {
		record.Action = model.ViolationActionClientCheck
	} else {
		lenient := setting.LenientCategory(record.Category)
		repeated := false
		if lenient && record.ConversationKey != "" {
			if repeated, err = model.HasViolationInConversation(record.UserId, record.ConversationKey, windowStart); err != nil {
				return err
			}
		}
		newStrike := !repeated
		if newStrike && record.ConversationKey != "" {
			counted, err := model.HasViolationStrikeInConversation(record.UserId, record.Mode, record.ConversationKey, windowStart)
			if err != nil {
				return err
			}
			newStrike = !counted
		}
		if newStrike {
			if newStrike, err = model.ClaimViolationStrike(record.UserId, record.Mode, now, now-mergeSeconds); err != nil {
				return err
			}
		}
		record.Action = model.ViolationActionMerged
		if newStrike {
			warned := true
			if lenient {
				if warned, err = model.HasViolationWarning(record.UserId, record.Mode, windowStart); err != nil {
					return err
				}
			}
			strikes, err := model.CountViolationStrikes(record.UserId, record.Mode, windowStart)
			if err != nil {
				return err
			}
			switch {
			case !warned:
				record.Action = model.ViolationActionWarn
			case setting.BanStrikes > 0 && strikes+1 >= int64(setting.BanStrikes):
				record.Action = model.ViolationActionBan
			case setting.SuspendHours > 0:
				record.Action = model.ViolationActionSuspend
			default:
				record.Action = model.ViolationActionStrike
			}
		}
	}
	if err := model.CreateViolationRecord(&record); err != nil {
		return err
	}
	if record.Action == model.ViolationActionWarn {
		// A warning suspends no one, so only the refusals of its own incident,
		// within ten minutes, merge into it; a later refusal is judged anew.
		if err := model.ShortenViolationMerge(record.UserId, now, now-mergeSeconds+minViolationMergeSeconds); err != nil {
			return err
		}
	}
	// Refused messages are kept for review only as long as strikes count.
	if err := model.ClearViolationExcerpts(now - int64(setting.StrikeWindowDays)*86400); err != nil {
		common.SysError(common.LogText("violation guard: failed to clear expired refused messages: %s", err.Error()))
	}
	common.SysLog(common.LogText("violation guard: upstream refused a request of user %d (category %q); action %s in %s mode", record.UserId, record.Category, record.Action, record.Mode))
	if record.Mode == model.ViolationModeExempt {
		return nil
	}

	violationGuardState.Lock()
	if violationGuardState.loaded && record.ConversationKey != "" {
		if violationGuardState.conversations[record.UserId] == nil {
			violationGuardState.conversations[record.UserId] = map[string]model.RefusedConversation{}
		}
		conversation, seen := violationGuardState.conversations[record.UserId][record.ConversationKey]
		conversation.RefusedAt = now
		conversation.Blocked = conversation.Blocked || seen || !setting.LenientCategory(record.Category)
		if !seen {
			conversation.Message = record.Excerpt
		}
		violationGuardState.conversations[record.UserId][record.ConversationKey] = conversation
	}
	if violationGuardState.loaded && record.Action == model.ViolationActionClientCheck {
		since := now - operation_setting.ClientCheckWindowSeconds
		checks := slices.DeleteFunc(violationGuardState.clientChecks[record.UserId], func(refusedAt int64) bool { return refusedAt <= since })
		violationGuardState.clientChecks[record.UserId] = append(checks, now)
	}
	violationGuardState.Unlock()

	if record.Mode != operation_setting.ViolationGuardModeEnforce {
		return nil
	}
	switch record.Action {
	case model.ViolationActionSuspend:
		until := now + int64(setting.SuspendHours)*3600
		if err := model.SuspendUserForViolation(record.UserId, until); err != nil {
			return err
		}
		violationGuardState.Lock()
		if violationGuardState.loaded {
			violationGuardState.suspendedUntil[record.UserId] = until
		}
		violationGuardState.Unlock()
	case model.ViolationActionBan:
		disabled := model.User{Id: record.UserId, Status: common.UserStatusDisabled}
		if err := disabled.Update(false); err != nil {
			return err
		}
		if err := model.InvalidateUserTokensCache(record.UserId); err != nil {
			common.SysError(common.LogText("violation guard: failed to invalidate tokens cache for user %d: %s", record.UserId, err.Error()))
		}
	}
	return nil
}

// ForgiveViolations lifts a user's suspension and lets the user resend
// refused conversations; earlier strikes stop counting. It does not re-enable
// an account the guard disabled.
func ForgiveViolations(userId int) error {
	if err := model.ForgiveUserViolations(userId, common.GetTimestamp()); err != nil {
		return err
	}
	violationGuardState.Lock()
	defer violationGuardState.Unlock()
	delete(violationGuardState.suspendedUntil, userId)
	delete(violationGuardState.conversations, userId)
	delete(violationGuardState.clientChecks, userId)
	return nil
}

// humanMessages returns the user messages of a request that a person wrote,
// oldest first. Tool results, and the <system-reminder> blocks clients such as
// Claude Code inject, are not human text; messages left empty are dropped.
func humanMessages(request dto.Request) []string {
	var messages []string
	switch request := request.(type) {
	case *dto.ClaudeRequest:
		for i := range request.Messages {
			message := &request.Messages[i]
			if message.Role != "user" {
				continue
			}
			if message.IsStringContent() {
				messages = append(messages, humanMessageText([]string{message.GetStringContent()}))
				continue
			}
			parts, err := message.ParseContent()
			if err != nil {
				continue
			}
			texts := make([]string, 0, len(parts))
			for _, part := range parts {
				if part.Type == "text" {
					texts = append(texts, part.GetText())
				}
			}
			messages = append(messages, humanMessageText(texts))
		}
	case *dto.GeneralOpenAIRequest:
		for i := range request.Messages {
			message := &request.Messages[i]
			if message.Role != "user" {
				continue
			}
			texts := []string{}
			for _, part := range message.ParseContent() {
				if part.Type == dto.ContentTypeText {
					texts = append(texts, part.Text)
				}
			}
			messages = append(messages, humanMessageText(texts))
		}
	}
	return slices.DeleteFunc(messages, func(message string) bool { return message == "" })
}

// violationConversationKeys fingerprints a conversation by its human
// messages. The i-th key covers the first i of them, so a later request in the
// same conversation reproduces every earlier key, while another conversation
// that happens to repeat one message does not.
func violationConversationKeys(messages []string) []string {
	hash := sha256.New()
	keys := make([]string, 0, len(messages))
	var length [8]byte
	for _, message := range messages {
		binary.LittleEndian.PutUint64(length[:], uint64(len(message)))
		hash.Write(length[:])
		hash.Write([]byte(message))
		keys = append(keys, hex.EncodeToString(hash.Sum(nil)))
	}
	return keys
}

// clientCaptions are whole text blocks that agent clients write into the
// user turn themselves. Only an exact match is skipped, so nothing a person
// writes can hide behind one.
var clientCaptions = []string{
	// The caption before images that a tool returned, sent as a user message.
	"Attached image(s) from tool result:",
}

// humanMessageText joins the text blocks of one user message that a person
// wrote, leaving out injected <system-reminder> blocks, including the ones
// hooks write with attributes, such as <system-reminder data-role="hook">,
// and client captions.
func humanMessageText(texts []string) string {
	var builder strings.Builder
	for _, text := range texts {
		trimmed := strings.TrimSpace(text)
		reminder := strings.HasPrefix(trimmed, "<system-reminder>") || strings.HasPrefix(trimmed, "<system-reminder ")
		if trimmed == "" || (reminder && strings.HasSuffix(trimmed, "</system-reminder>")) || slices.Contains(clientCaptions, trimmed) {
			continue
		}
		builder.WriteString(trimmed)
		builder.WriteByte('\n')
	}
	return builder.String()
}
