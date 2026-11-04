package service

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/riskpolicy"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service/riskgate"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"golang.org/x/sync/singleflight"
)

const (
	// riskGateEventRetentionDays is how long intercept events are kept.
	riskGateEventRetentionDays = 30
	// riskGateDecisionCacheTTL reuses a verdict on the same conversation text.
	// Claude Code resends the conversation on every tool step, while the human
	// messages stay the same, so one turn costs one model call.
	riskGateDecisionCacheTTL      = time.Hour
	riskGateDecisionCacheCapacity = 20000
	// riskGateRefusalReload reloads refused messages, so a refusal recorded by
	// the other server during a release is seen.
	riskGateRefusalReload   = 10 * time.Minute
	riskGateRefusalCapacity = 2000
	riskGateCountFlush      = 30 * time.Second
)

// CheckRiskGate runs a relay request through the risk gate before billing
// and channel selection: distillation, hard regex, refusal cache and decision
// model, in that order, stopping at the first stage that hits. In observe mode
// a hit is recorded and the request passes. With the gate off only the
// violation guard runs, as before.
func CheckRiskGate(c *gin.Context, info *relaycommon.RelayInfo) *types.NewAPIError {
	gate := *operation_setting.GetRiskGateSetting()
	if !gate.Enabled || info == nil {
		return CheckViolationGuard(c, info)
	}
	countRiskGate(1, 0, 0)
	messages := humanMessages(info.Request)
	latest := ""
	if len(messages) > 0 {
		latest = strings.TrimSuffix(messages[len(messages)-1], "\n")
	}
	hit := riskGateHit{c: c, info: info, gate: gate, messages: messages, latest: latest}

	// The structured policy and the counters read the body of these request
	// types only.
	var request riskGateRequest
	var readErr error
	readable := false
	switch info.Request.(type) {
	case *dto.ClaudeRequest, *dto.GeneralOpenAIRequest, *dto.OpenAIResponsesRequest, *dto.OpenAIResponsesCompactionRequest:
		readable = true
		request, readErr = readRiskGateRequest(c, gate.DistillRules)
		// Only the Claude pool is counted: its accounts are the ones a
		// harvesting customer puts at risk, and client recognition is for
		// Claude Code.
		if readErr == nil && strings.HasPrefix(info.OriginModelName, "claude") {
			countRiskGateCustomer(info.UserId, request)
		}
	}

	if strings.HasPrefix(strings.TrimSpace(gate.DistillRules), "{") {
		if readable {
			// A fault in the gate itself never rejects the request: it is
			// recorded and the later stages still run.
			var verdict riskpolicy.Hit
			err := readErr
			if err == nil {
				input := riskpolicy.Input{
					Inbound: request.body, Body: request.body,
					Official:   request.official,
					ZeroInject: gjson.Get(gate.DistillRules, "zero_inject").Bool(),
				}
				verdict, err = riskpolicy.Evaluate(gate.DistillRules, gate.HardRegexRules, input, gate.DistillEnabled, gate.HardRegexEnabled)
			}
			if err != nil {
				stage := model.RiskGateStageDistill
				if stageErr := (*riskpolicy.StageError)(nil); errors.As(err, &stageErr) {
					stage = stageErr.Stage
				}
				hit.record(stage, "unavailable", err.Error(), model.RiskGateActionFailOpen)
			} else if verdict.Stage != "" {
				if hit.latest == "" {
					hit.latest = verdict.Excerpt
				}
				strike := gate.HardRegexStrike
				if verdict.Stage == model.RiskGateStageDistill {
					strike = gate.DistillStrike
				}
				return hit.apply(verdict.Stage, verdict.Rule, verdict.Detail, strike)
			}
		}
	} else {
		if gate.DistillEnabled {
			if rule := riskgate.CompileRules(gate.DistillRules).Match(systemText(info.Request), latest); rule != "" {
				return hit.apply(model.RiskGateStageDistill, rule, "", gate.DistillStrike)
			}
		}
		if gate.HardRegexEnabled {
			if rule := riskgate.CompileRules(gate.HardRegexRules).Match(messages...); rule != "" {
				return hit.apply(model.RiskGateStageHardRegex, rule, "", gate.HardRegexStrike)
			}
		}
	}

	// The refusal cache: the violation guard's suspensions and refused
	// conversations follow the guard's own mode.
	if verdict, apiErr := violationGuardVerdict(c, info); verdict != "" {
		action := model.RiskGateActionObserved
		if apiErr != nil {
			action = model.RiskGateActionBlocked
		}
		hit.record(model.RiskGateStageRefusalCache, verdict, "", action)
		return apiErr
	}
	if gate.SimilarityEnabled {
		if score := similarRefusal(latest); score >= gate.SimilarityThreshold {
			return hit.apply(model.RiskGateStageRefusalCache, "similar", fmt.Sprintf("similarity %.2f", score), false)
		}
	}

	if gate.DecisionEnabled && gate.DecisionBaseURL != "" && len(messages) > 0 {
		// The decision model is asked about the traffic the cheaper stages
		// cannot vouch for: an unrecognized client, or a customer with a
		// refused conversation in the strike window.
		if gate.DecisionSkipOfficial && request.official && !violationRefusedRecently(info.UserId) {
			return nil
		}
		return checkRiskGateDecision(hit)
	}
	return nil
}

type riskGateHit struct {
	c        *gin.Context
	info     *relaycommon.RelayInfo
	gate     operation_setting.RiskGateSetting
	messages []string
	latest   string
}

// apply records a stage hit and, in enforce mode, rejects the request and,
// when strike is set, records a violation against the customer.
func (h riskGateHit) apply(stage, rule, detail string, strike bool) *types.NewAPIError {
	if h.gate.Mode != operation_setting.RiskGateModeEnforce {
		h.record(stage, rule, detail, model.RiskGateActionObserved)
		logger.LogInfo(h.c, common.LogText("risk gate (observe): %s rule %s would reject this request of user %d", stage, rule, h.info.UserId))
		return nil
	}
	h.record(stage, rule, detail, model.RiskGateActionBlocked)
	if strike {
		h.strike(stage, rule)
	}
	RequestPolicy(h.c).AddEvent(PolicyEvent{ErrorCode: string(types.ErrorCodeRiskGateBlocked), ErrorSource: "local", Decision: PolicyDecision{Action: "stop", Reason: "local_rejection", Source: "global"}, Health: "unchanged"})
	return types.NewErrorWithStatusCode(errors.New(i18n.T(h.c, i18n.MsgRiskGateBlocked)),
		types.ErrorCodeRiskGateBlocked, http.StatusForbidden, types.ErrOptionWithSkipRetry())
}

func (h riskGateHit) record(stage, rule, detail, action string) {
	event := model.RiskGateEvent{
		CreatedAt: common.GetTimestamp(),
		Stage:     stage,
		Rule:      rule[:min(len(rule), 64)],
		Action:    action,
		Detail:    detail[:min(len(detail), 255)],
		UserId:    h.info.UserId,
		TokenId:   h.info.TokenId,
		ModelName: h.info.OriginModelName,
		RequestId: h.info.RequestId,
		Excerpt:   strings.ToValidUTF8(h.latest[:min(len(h.latest), maxViolationExcerptBytes)], ""),
	}
	gopool.Go(func() {
		if err := model.CreateRiskGateEvent(&event); err != nil {
			common.SysError(common.LogText("risk gate: failed to record an event: %s", err.Error()))
		}
	})
}

// strike records the hit as a violation through the violation guard, which
// applies its own mode and strike policy. Nothing is recorded while the guard
// is off.
func (h riskGateHit) strike(stage, rule string) {
	setting := *operation_setting.GetViolationGuardSetting()
	if !setting.Enabled || len(h.messages) == 0 {
		return
	}
	category := model.RiskGateCategoryPrefix + stage + ":" + rule
	keys := violationConversationKeys(h.messages)
	record := model.ViolationRecord{
		UserId:          h.info.UserId,
		TokenId:         h.info.TokenId,
		ModelName:       h.info.OriginModelName,
		RequestId:       h.info.RequestId,
		Category:        category[:min(len(category), 64)],
		ConversationKey: keys[len(keys)-1],
		Excerpt:         strings.ToValidUTF8(h.latest[:min(len(h.latest), maxViolationExcerptBytes)], ""),
	}
	gopool.Go(func() {
		if err := applyViolationStrike(setting, record, common.GetTimestamp()); err != nil {
			common.SysError(common.LogText("risk gate: failed to record a violation for user %d: %s", record.UserId, err.Error()))
		}
	})
}

type riskGateVerdict struct {
	scores  map[string]float64
	expires time.Time
}

var riskGateDecisions = struct {
	sync.Mutex
	verdicts map[[32]byte]riskGateVerdict
	calls    singleflight.Group
}{verdicts: map[[32]byte]riskGateVerdict{}}

// checkRiskGateDecision asks the decision model about the conversation's
// human messages and blocks on the question with the highest probability at
// or above the threshold. Parallel requests with the same text share one call.
func checkRiskGateDecision(hit riskGateHit) *types.NewAPIError {
	gate := hit.gate
	questions, _ := operation_setting.ParseRiskGateLines(gate.DecisionQuestions, false)
	if len(questions) == 0 {
		return nil
	}
	state := riskgate.DecisionState(hit.messages)
	key := sha256.Sum256([]byte(gate.DecisionBaseURL + "\x00" + gate.DecisionModel + "\x00" + gate.DecisionQuestions + "\x00" + state))

	now := time.Now()
	riskGateDecisions.Lock()
	cached, found := riskGateDecisions.verdicts[key]
	riskGateDecisions.Unlock()
	scores := cached.scores
	if !found || now.After(cached.expires) {
		result, err, _ := riskGateDecisions.calls.Do(string(key[:]), func() (any, error) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Duration(gate.DecisionTimeoutMs)*time.Millisecond)
			defer cancel()
			scores, err := riskgate.Decide(ctx, gate.DecisionBaseURL, gate.DecisionAPIKey, gate.DecisionModel, state, questions)
			if err != nil {
				countRiskGate(0, 1, 1)
				return nil, err
			}
			countRiskGate(0, 1, 0)
			riskGateDecisions.Lock()
			if len(riskGateDecisions.verdicts) >= riskGateDecisionCacheCapacity {
				clear(riskGateDecisions.verdicts)
			}
			riskGateDecisions.verdicts[key] = riskGateVerdict{scores: scores, expires: time.Now().Add(riskGateDecisionCacheTTL)}
			riskGateDecisions.Unlock()
			return scores, nil
		})
		if err != nil {
			detail := err.Error()
			if errors.Is(err, context.DeadlineExceeded) {
				detail = "timeout"
			}
			if gate.DecisionFailOpen {
				hit.record(model.RiskGateStageDecision, "unavailable", detail, model.RiskGateActionFailOpen)
				return nil
			}
			// The model did not judge the customer; block this request only.
			return hit.apply(model.RiskGateStageDecision, "unavailable", detail, false)
		}
		scores = result.(map[string]float64)
	}

	worst, worstScore := "", 0.0
	for _, question := range questions {
		if score := scores[question.Name]; score >= gate.DecisionThreshold && score > worstScore {
			worst, worstScore = question.Name, score
		}
	}
	if worst == "" {
		return nil
	}
	return hit.apply(model.RiskGateStageDecision, worst, fmt.Sprintf("score %.2f", worstScore), gate.DecisionStrike)
}

var riskGateRefusals = struct {
	sync.Mutex
	loadedAt     time.Time
	fingerprints []riskgate.Fingerprint
	// loading is set while a load runs outside the lock; remembered collects
	// the refusals recorded meanwhile, which the loaded set may predate.
	loading    bool
	remembered []riskgate.Fingerprint
	// scores caches the result per latest message: Claude Code resends the
	// same one on every tool step. It is cleared whenever fingerprints change.
	scores map[[32]byte]float64
	// generation changes with fingerprints, so a score computed against an
	// older set is not cached.
	generation int
}{scores: map[[32]byte]float64{}}

// riskGateFirstRefusalLoad joins the checks that arrive before the first load.
var riskGateFirstRefusalLoad singleflight.Group

// similarRefusal returns the highest similarity between text and a message
// the upstream refused within the violation guard's window.
//
// The first check after a start waits for the refused messages, so it is
// compared like every later one. After that, a check that finds the set older
// than riskGateRefusalReload starts a reload in the background and compares
// against the set it has: the query and the fingerprinting never run under
// the lock every check takes.
func similarRefusal(text string) float64 {
	fingerprint := riskgate.NewFingerprint(text)
	if fingerprint == nil {
		return 0
	}
	key := sha256.Sum256([]byte(text[:min(len(text), riskgate.MaxFingerprintBytes)]))
	riskGateRefusals.Lock()
	if riskGateRefusals.loadedAt.IsZero() {
		riskGateRefusals.Unlock()
		_, _, _ = riskGateFirstRefusalLoad.Do("refusals", func() (any, error) {
			riskGateRefusals.Lock()
			if !riskGateRefusals.loadedAt.IsZero() || riskGateRefusals.loading {
				riskGateRefusals.Unlock()
				return nil, nil
			}
			riskGateRefusals.loading = true
			riskGateRefusals.remembered = nil
			riskGateRefusals.Unlock()
			loadRefusedMessages()
			return nil, nil
		})
		riskGateRefusals.Lock()
	} else if !riskGateRefusals.loading && time.Since(riskGateRefusals.loadedAt) > riskGateRefusalReload {
		riskGateRefusals.loading = true
		riskGateRefusals.remembered = nil
		gopool.Go(loadRefusedMessages)
	}
	if best, ok := riskGateRefusals.scores[key]; ok {
		riskGateRefusals.Unlock()
		return best
	}
	refused, generation := riskGateRefusals.fingerprints, riskGateRefusals.generation
	riskGateRefusals.Unlock()

	best := 0.0
	for _, candidate := range refused {
		best = max(best, riskgate.Similarity(fingerprint, candidate))
	}
	riskGateRefusals.Lock()
	if riskGateRefusals.generation == generation {
		if len(riskGateRefusals.scores) >= riskGateDecisionCacheCapacity {
			clear(riskGateRefusals.scores)
		}
		riskGateRefusals.scores[key] = best
	}
	riskGateRefusals.Unlock()
	return best
}

// loadRefusedMessages replaces the similarity set with the messages refused
// within the violation guard's window, keeping the ones remembered while it
// ran. The caller sets loading. A failed load keeps the current set and is
// retried at the next interval, not on every request.
func loadRefusedMessages() {
	windowDays := operation_setting.GetViolationGuardSetting().StrikeWindowDays
	excerpts, err := model.GetRecentRefusedExcerpts(common.GetTimestamp()-int64(windowDays)*86400, riskGateRefusalCapacity)
	var fingerprints []riskgate.Fingerprint
	if err != nil {
		common.SysError(common.LogText("risk gate: failed to load refused messages: %s", err.Error()))
	} else {
		fingerprints = make([]riskgate.Fingerprint, 0, len(excerpts))
		for _, excerpt := range excerpts {
			if riskgate.ClientTemplate(excerpt) {
				continue
			}
			if refused := riskgate.NewFingerprint(excerpt); refused != nil {
				fingerprints = append(fingerprints, refused)
			}
		}
	}

	riskGateRefusals.Lock()
	defer riskGateRefusals.Unlock()
	riskGateRefusals.loading = false
	riskGateRefusals.loadedAt = time.Now()
	remembered := riskGateRefusals.remembered
	riskGateRefusals.remembered = nil
	if err != nil {
		return
	}
	// A new slice: readers iterate the old one outside the lock.
	merged := make([]riskgate.Fingerprint, 0, min(len(remembered)+len(fingerprints), riskGateRefusalCapacity))
	merged = append(merged, remembered[:min(len(remembered), riskGateRefusalCapacity)]...)
	merged = append(merged, fingerprints[:min(len(fingerprints), riskGateRefusalCapacity-len(merged))]...)
	riskGateRefusals.fingerprints = merged
	riskGateRefusals.generation++
	clear(riskGateRefusals.scores)
}

// rememberRefusedMessage adds a newly refused message to the similarity set,
// unless it is a client template.
func rememberRefusedMessage(excerpt string) {
	if riskgate.ClientTemplate(excerpt) {
		return
	}
	fingerprint := riskgate.NewFingerprint(excerpt)
	if fingerprint == nil {
		return
	}
	riskGateRefusals.Lock()
	defer riskGateRefusals.Unlock()
	if riskGateRefusals.loading {
		riskGateRefusals.remembered = append([]riskgate.Fingerprint{fingerprint}, riskGateRefusals.remembered...)
	}
	if riskGateRefusals.loadedAt.IsZero() {
		return
	}
	// Copy, so a reader holding the old slice never sees it change.
	fingerprints := make([]riskgate.Fingerprint, 0, len(riskGateRefusals.fingerprints)+1)
	fingerprints = append(fingerprints, fingerprint)
	fingerprints = append(fingerprints, riskGateRefusals.fingerprints[:min(len(riskGateRefusals.fingerprints), riskGateRefusalCapacity-1)]...)
	riskGateRefusals.fingerprints = fingerprints
	riskGateRefusals.generation++
	clear(riskGateRefusals.scores)
}

// systemText is the system prompt of a request, where distillation harvest
// templates usually sit.
func systemText(request dto.Request) string {
	var builder strings.Builder
	switch request := request.(type) {
	case *dto.ClaudeRequest:
		if request.System == nil {
			return ""
		}
		if request.IsStringSystem() {
			return request.GetStringSystem()
		}
		for _, part := range request.ParseSystem() {
			if part.Type == "text" {
				builder.WriteString(part.GetText())
				builder.WriteByte('\n')
			}
		}
	case *dto.GeneralOpenAIRequest:
		for i := range request.Messages {
			message := &request.Messages[i]
			if message.Role != "system" && message.Role != "developer" {
				continue
			}
			for _, part := range message.ParseContent() {
				if part.Type == dto.ContentTypeText {
					builder.WriteString(part.Text)
					builder.WriteByte('\n')
				}
			}
		}
	}
	return builder.String()
}

var riskGateCounts = struct {
	sync.Mutex
	pending map[int64][3]int64
	// customers holds each customer's hourly counts, in the order of
	// model.RiskCustomerHourlyCount's counters.
	customers map[riskGateCustomerHour][4]int64
}{pending: map[int64][3]int64{}, customers: map[riskGateCustomerHour][4]int64{}}

type riskGateCustomerHour struct {
	userId int
	hour   int64
}

// countRiskGateCustomer counts one Claude request of a customer by client and
// shape. Harvesting shows as many bare requests from an unrecognized client,
// which no single request reveals.
func countRiskGateCustomer(userId int, request riskGateRequest) {
	key := riskGateCustomerHour{userId: userId, hour: time.Now().Unix() / 3600 * 3600}
	riskGateCounts.Lock()
	counts := riskGateCounts.customers[key]
	counts[0]++
	if !request.official {
		counts[1]++
	}
	if request.bare {
		counts[2]++
		if !request.official {
			counts[3]++
		}
	}
	riskGateCounts.customers[key] = counts
	riskGateCounts.Unlock()
}

func countRiskGate(inbound, decisionCalls, decisionFailures int64) {
	hour := time.Now().Unix() / 3600 * 3600
	riskGateCounts.Lock()
	counts := riskGateCounts.pending[hour]
	counts[0] += inbound
	counts[1] += decisionCalls
	counts[2] += decisionFailures
	riskGateCounts.pending[hour] = counts
	riskGateCounts.Unlock()
}

// StartRiskGateTasks flushes the gate's counters and removes old events.
func StartRiskGateTasks() {
	gopool.Go(func() {
		ticker := time.NewTicker(riskGateCountFlush)
		defer ticker.Stop()
		lastPrune := time.Time{}
		for range ticker.C {
			FlushRiskGateCounts()
			if time.Since(lastPrune) > time.Hour {
				lastPrune = time.Now()
				if err := model.DeleteRiskGateEventsBefore(common.GetTimestamp() - riskGateEventRetentionDays*86400); err != nil {
					common.SysError(common.LogText("risk gate: failed to remove old events: %s", err.Error()))
				}
				if err := model.DeleteRiskCustomerCountsBefore(common.GetTimestamp() - riskGateEventRetentionDays*86400); err != nil {
					common.SysError(common.LogText("risk gate: failed to remove old customer counters: %s", err.Error()))
				}
			}
		}
	})
}

var riskGateCountWriting sync.Mutex

// FlushRiskGateCounts writes the buffered counters. Counts that fail to write
// go back into the buffer for the next flush.
func FlushRiskGateCounts() {
	riskGateCountWriting.Lock()
	defer riskGateCountWriting.Unlock()
	riskGateCounts.Lock()
	pending, customers := riskGateCounts.pending, riskGateCounts.customers
	riskGateCounts.pending = map[int64][3]int64{}
	riskGateCounts.customers = map[riskGateCustomerHour][4]int64{}
	riskGateCounts.Unlock()
	for hour, counts := range pending {
		if err := model.AddRiskGateCounts(hour, counts[0], counts[1], counts[2]); err != nil {
			common.SysError(common.LogText("risk gate: failed to write counters: %s", err.Error()))
			riskGateCounts.Lock()
			current := riskGateCounts.pending[hour]
			for i := range current {
				current[i] += counts[i]
			}
			riskGateCounts.pending[hour] = current
			riskGateCounts.Unlock()
		}
	}
	for key, counts := range customers {
		if err := model.AddRiskCustomerCounts(key.userId, key.hour, counts); err != nil {
			common.SysError(common.LogText("risk gate: failed to write customer counters: %s", err.Error()))
			riskGateCounts.Lock()
			current := riskGateCounts.customers[key]
			for i := range current {
				current[i] += counts[i]
			}
			riskGateCounts.customers[key] = current
			riskGateCounts.Unlock()
		}
	}
}
