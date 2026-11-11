package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
)

// Claude Code client detection follows the rules claude-relay-service and
// sub2api use for their "Claude Code only" switch: the claude-cli User-Agent,
// and on /v1/messages a Claude Code system prompt, the X-App, anthropic-beta
// and anthropic-version headers, and a Claude Code metadata.user_id. Unlike
// them, a system block must start with a Claude Code sentence: their 0.5 Dice
// similarity also accepts prompts such as "You are a helpful translation
// assistant".

var claudeCliUserAgentPattern = regexp.MustCompile(`(?i)^claude-cli/(\d+)\.(\d+)\.(\d+)`)

// Sentences Claude Code starts a system block with: the main CLI, the Agent SDK
// (also used by `claude -p`), the explore subagent, compaction, and the older
// single-block CLI prompt.
var claudeCodeSystemPromptPrefixes = []string{
	"You are Claude Code, Anthropic's official CLI for Claude.",
	"You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK.",
	"You are a Claude agent, built on Anthropic's Claude Agent SDK.",
	"You are a file search specialist for Claude Code, Anthropic's official CLI for Claude.",
	"You are a helpful AI assistant tasked with summarizing conversations.",
	"You are an interactive CLI tool that helps users",
}

// The system block Claude Code prepends for billing attribution, for example
// "x-anthropic-billing-header: cc_version=2.1.301.b14; cc_entrypoint=cli;".
const (
	claudeCodeBillingBlockPrefix = "x-anthropic-billing-header"
	claudeCodeEntrypointField    = "cc_entrypoint="
)

// The auto-mode safety classifier request carries a long prompt of its own
// instead of the Claude Code identity sentence.
const (
	claudeCodeSecurityMonitorPrefix = "You are a security monitor for autonomous AI coding agents."
	claudeCodeSecurityMonitorMinLen = 10_000
)

var claudeCodeSecurityMonitorMarkers = []string{
	"## Threat Model",
	"## HARD BLOCK",
	"## SOFT BLOCK",
	"## Classification Process",
	"## Output Format",
	"<block>yes</block>",
	"<block>no</block>",
}

// Claude Code before 2.1.78: user_<64 hex>_account_<uuid or empty>_session_<uuid>.
// From 2.1.78 on it is JSON with device_id, account_uuid and session_id.
var claudeCodeLegacyUserIDPattern = regexp.MustCompile(`^user_[a-fA-F0-9]{64}_account_[a-fA-F0-9-]*_session_[a-fA-F0-9-]{36}$`)

type claudeCodeRequestProbe struct {
	MaxTokens *int            `json:"max_tokens"`
	System    json.RawMessage `json:"system"`
	Metadata  struct {
		UserID string `json:"user_id"`
	} `json:"metadata"`
}

type claudeCodeSystemBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// clientGate admits a request into a group that accepts one client only. With
// reject set a failed check aborts the request; otherwise it only returns false.
type clientGate func(c *gin.Context, group string, reject bool) bool

// clientGateFor returns the gate of a group restricted to one client, or nil.
func clientGateFor(group string) (string, clientGate) {
	switch {
	case operation_setting.IsClaudeCodeOnlyGroup(group):
		return "claude-code", admitClaudeCode
	case operation_setting.IsCodexOnlyGroup(group):
		return "codex", admitCodex
	}
	return "", nil
}

// enforceClientOnlyGroups rejects a relay request whose group accepts one
// client only (Claude Code or Codex) and that does not look like that client.
// userGroup is the user's own group, used to resolve the candidates of an
// "auto" token: such a request drops the candidates whose client it is not
// instead, and is rejected only when none remain. It returns false after
// aborting the request.
func enforceClientOnlyGroups(c *gin.Context, userGroup string) bool {
	if isModelListRequest(c) {
		return true
	}
	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup != "auto" {
		if _, gate := clientGateFor(usingGroup); gate != nil {
			return gate(c, usingGroup, true)
		}
		return true
	}

	candidates := service.GetRequestAutoGroups(c, userGroup)
	restricted := false
	for _, group := range candidates {
		if _, gate := clientGateFor(group); gate != nil {
			restricted = true
			break
		}
	}
	if !restricted {
		return true
	}
	// Judge each client once, without rejecting, and keep the candidates the
	// request may use.
	admitted := map[string]bool{}
	kept := make([]string, 0, len(candidates))
	firstRefused := ""
	for _, group := range candidates {
		name, gate := clientGateFor(group)
		if gate == nil {
			kept = append(kept, group)
			continue
		}
		ok, judged := admitted[name]
		if !judged {
			ok = gate(c, group, false)
			if c.IsAborted() {
				return false
			}
			admitted[name] = ok
		}
		if ok {
			kept = append(kept, group)
		} else if firstRefused == "" {
			firstRefused = group
		}
	}
	if len(kept) == 0 {
		// Nothing is left: refuse with the first refusing group's own answer.
		_, gate := clientGateFor(firstRefused)
		return gate(c, firstRefused, true)
	}
	if len(kept) < len(candidates) {
		// The group is chosen during channel selection, which reads this key.
		common.SetContextKey(c, constant.ContextKeyTokenAutoGroups, kept)
	}
	return true
}

// admitClaudeCode reports whether the request looks like Claude Code within the
// configured versions. A body that cannot be read is always refused. Otherwise a
// failed check aborts the request when reject is set and only returns false
// when it is not.
func admitClaudeCode(c *gin.Context, group string, reject bool) bool {
	if prompt, ok := clientCheck(c); ok {
		logger.LogInfo(c.Request.Context(), fmt.Sprintf("claude code only group %s: admitted the %q check, user-agent=%q",
			group, prompt, clip(c.GetHeader("User-Agent"), 120)))
		return true
	}
	version, failedCheck, bodyErr := detectClaudeCodeClient(c)
	if bodyErr != nil {
		// An aborted upload, an oversized body or malformed JSON says nothing
		// about the client. Answer as Distribute would, so the request is still
		// refused but not reported as a foreign client.
		logger.LogWarn(c.Request.Context(), "claude code only group %s: request body unreadable: %v", group, bodyErr)
		abortWithOpenAiMessage(c, invalidRequestStatus(bodyErr),
			i18n.T(c, i18n.MsgDistributorInvalidRequest, map[string]any{"Error": bodyErr.Error()}))
		return false
	}
	if failedCheck != "" {
		if !reject {
			// An auto token's request goes on to another group: ordinary
			// traffic, not worth a second parse of its body.
			logger.LogWarn(c.Request.Context(), "claude code only group %s: %s check failed, rejected=false", group, failedCheck)
			return false
		}
		logger.LogWarn(c.Request.Context(), "claude code only group %s: %s check failed, rejected=true, user-agent=%q, %s",
			group, failedCheck, clip(c.GetHeader("User-Agent"), 120), requestShape(c))
		abortWithOpenAiMessage(c, http.StatusForbidden,
			i18n.T(c, i18n.MsgAuthClaudeCodeOnly, map[string]any{"Group": group}), types.ErrorCodeAccessDenied)
		return false
	}

	setting := operation_setting.GetClaudeCodeClientSetting()
	if setting.MinVersion != "" && compareClaudeCodeVersions(version, setting.MinVersion) < 0 {
		if reject {
			abortWithOpenAiMessage(c, http.StatusForbidden, i18n.T(c, i18n.MsgAuthClaudeCodeVersionTooLow,
				map[string]any{"Group": group, "Version": version, "MinVersion": setting.MinVersion}), types.ErrorCodeAccessDenied)
		}
		return false
	}
	if setting.MaxVersion != "" && compareClaudeCodeVersions(version, setting.MaxVersion) > 0 {
		if reject {
			abortWithOpenAiMessage(c, http.StatusForbidden, i18n.T(c, i18n.MsgAuthClaudeCodeVersionTooHigh,
				map[string]any{"Group": group, "Version": version, "MaxVersion": setting.MaxVersion}), types.ErrorCodeAccessDenied)
		}
		return false
	}
	return true
}

// isModelListRequest reports a GET on /v1/models or /v1/models/:model. Model
// lists are open to every client so tools such as CC Switch and Magpie can
// fetch model names with the token; they cost nothing and relay no prompt.
func isModelListRequest(c *gin.Context) bool {
	path := c.Request.URL.Path
	return c.Request.Method == http.MethodGet && (path == "/v1/models" || strings.HasPrefix(path, "/v1/models/"))
}

// detectClaudeCodeClient returns the Claude Code version from the User-Agent,
// or the name of the first check the request failed. bodyErr is set instead
// when a Messages body cannot be read or parsed, so it was never judged.
func detectClaudeCodeClient(c *gin.Context) (version string, failedCheck string, bodyErr error) {
	match := claudeCliUserAgentPattern.FindStringSubmatch(c.GetHeader("User-Agent"))
	if match == nil {
		return "", "User-Agent", nil
	}
	version = match[1] + "." + match[2] + "." + match[3]

	// Only a Messages request carries a prompt. Other paths (count_tokens) are
	// judged by the User-Agent alone. Model lists never get here.
	if !strings.HasSuffix(c.Request.URL.Path, "/messages") {
		return version, "", nil
	}

	var probe claudeCodeRequestProbe
	if err := common.UnmarshalBodyReusable(c, &probe); err != nil {
		return version, "", err
	}
	// Claude Code checks connectivity and context usage with max_tokens=1
	// requests that have no system prompt; one output token is worth nothing
	// to anyone else.
	if probe.MaxTokens != nil && *probe.MaxTokens == 1 {
		return version, "", nil
	}
	if !hasClaudeCodeSystemPrompt(probe.System) {
		return version, "system prompt", nil
	}
	for _, header := range []string{"X-App", "anthropic-beta", "anthropic-version"} {
		if strings.TrimSpace(c.GetHeader(header)) == "" {
			return version, header + " header", nil
		}
	}
	if !isClaudeCodeUserID(probe.Metadata.UserID) {
		return version, "metadata.user_id", nil
	}
	return version, "", nil
}

// clientCheckFields are the only top-level fields a client check may carry.
var clientCheckFields = map[string]bool{"model": true, "max_tokens": true, "messages": true, "stream": true}

// clientCheckPrompts are the only inputs a client check may send. "." is
// Claude Desktop's connection check, which Magpie's gateway relays; "hi" is the
// Messages request of Magpie's "Detect APIs", and other clients send it too.
// The admitted log line names the prompt and the User-Agent, not a client.
var clientCheckPrompts = map[string]bool{".": true, "hi": true}

// clientCheck returns the prompt of the fixed request a client sends to check
// a gateway, such as
// {"max_tokens":16,"messages":[{"role":"user","content":"."}],"model":...},
// and whether the request is one. Such a request has no claude-cli User-Agent and no Claude
// Code prompt. With no system prompt, no tools and one short word as the only
// input, its at most 16 output tokens are worth nothing to anyone else, so it
// passes as the max_tokens=1 probe does. Any other field, message or content
// fails the match, and the request is then judged as usual. Only Messages
// requests match: a Claude-Code-only group serves no other API, so checks of
// the others are refused and the client learns which API works.
func clientCheck(c *gin.Context) (string, bool) {
	if !strings.HasSuffix(c.Request.URL.Path, "/messages") {
		return "", false
	}
	// For a Claude CLI request the ordinary detector reads and validates the
	// same body next. An extra top-level field makes the small check impossible,
	// so avoid copying every message into the probe map in that case.
	if claudeCliUserAgentPattern.MatchString(c.GetHeader("User-Agent")) &&
		strings.HasPrefix(c.Request.Header.Get("Content-Type"), "application/json") {
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			return "", false
		}
		if !storage.IsDisk() {
			body, err := storage.Bytes()
			if err == nil && hasNonClientCheckField(body) {
				return "", false
			}
		}
	}
	var fields map[string]json.RawMessage
	if common.UnmarshalBodyReusable(c, &fields) != nil {
		return "", false
	}
	for name := range fields {
		if !clientCheckFields[name] {
			return "", false
		}
	}
	var maxTokens int
	if common.Unmarshal(fields["max_tokens"], &maxTokens) != nil || maxTokens < 1 || maxTokens > 16 {
		return "", false
	}
	var messages []struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	if common.Unmarshal(fields["messages"], &messages) != nil || len(messages) != 1 || messages[0].Role != "user" {
		return "", false
	}
	prompt := messages[0].Content
	return prompt, clientCheckPrompts[prompt]
}

// hasNonClientCheckField only rejects the check; the ordinary detector remains
// responsible for validating the whole body. Stop at the first JSON value so
// text in a later value cannot change the check's result.
func hasNonClientCheckField(body []byte) bool {
	depth := 0
	expectingKey := false
	for index := 0; index < len(body); index++ {
		switch body[index] {
		case '"':
			end := jsonStringEnd(body, index+1)
			if end < 0 {
				return false
			}
			if depth == 1 && expectingKey {
				cursor := end + 1
				for cursor < len(body) && (body[cursor] == ' ' || body[cursor] == '\t' || body[cursor] == '\r' || body[cursor] == '\n') {
					cursor++
				}
				if cursor < len(body) && body[cursor] == ':' {
					var key string
					if common.Unmarshal(body[index:end+1], &key) == nil && !clientCheckFields[key] {
						return true
					}
				}
				expectingKey = false
			}
			index = end
		case '{', '[':
			depth++
			if depth == 1 && body[index] == '{' {
				expectingKey = true
			}
		case '}', ']':
			depth--
			if depth == 0 {
				return false
			}
		case ',':
			if depth == 1 {
				expectingKey = true
			}
		}
	}
	return false
}

// requestShape describes a refused request's body without any of its text:
// the top-level field names, max_tokens, the number of messages, and the kind
// and length of the last message's content. Logged with each refusal, it tells
// a client's fixed check apart from real work.
func requestShape(c *gin.Context) string {
	var fields map[string]json.RawMessage
	if common.UnmarshalBodyReusable(c, &fields) != nil || len(fields) == 0 {
		return "body=unparsed"
	}
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, clip(name, 40))
	}
	slices.Sort(names)
	if len(names) > 20 {
		names = append(names[:20], "…")
	}
	shape := fmt.Sprintf("fields=%q", names)
	if raw, ok := fields["max_tokens"]; ok {
		var maxTokens int64
		if common.Unmarshal(raw, &maxTokens) == nil {
			shape += " max_tokens=" + strconv.FormatInt(maxTokens, 10)
		} else {
			shape += " max_tokens=invalid"
		}
	}
	var messages []struct {
		Content json.RawMessage `json:"content"`
	}
	if common.Unmarshal(fields["messages"], &messages) != nil || len(messages) == 0 {
		return shape
	}
	shape += " messages=" + strconv.Itoa(len(messages))
	content := messages[len(messages)-1].Content
	var text string
	var blocks []json.RawMessage
	switch {
	case common.Unmarshal(content, &text) == nil:
		shape += fmt.Sprintf(" last_content=string(%d)", utf8.RuneCountInString(text))
	case common.Unmarshal(content, &blocks) == nil:
		shape += fmt.Sprintf(" last_content=blocks(%d)", len(blocks))
	default:
		shape += " last_content=other"
	}
	return shape
}

// clip cuts a client-supplied string to at most n bytes for a log line.
func clip(value string, n int) string {
	if len(value) <= n {
		return value
	}
	return strings.ToValidUTF8(value[:n], "") + "…"
}

func hasClaudeCodeSystemPrompt(raw json.RawMessage) bool {
	var blocks []claudeCodeSystemBlock
	if len(raw) == 0 || common.Unmarshal(raw, &blocks) != nil {
		return false
	}
	for _, block := range blocks {
		if block.Text == "" {
			continue
		}
		if strings.HasPrefix(block.Text, claudeCodeBillingBlockPrefix) && strings.Contains(block.Text, claudeCodeEntrypointField) {
			return true
		}
		if isClaudeCodeSecurityMonitorPrompt(block.Text) {
			return true
		}
		normalized := strings.Join(strings.Fields(block.Text), " ")
		for _, prefix := range claudeCodeSystemPromptPrefixes {
			if strings.HasPrefix(normalized, prefix) {
				return true
			}
		}
	}
	return false
}

func isClaudeCodeSecurityMonitorPrompt(text string) bool {
	if len(text) < claudeCodeSecurityMonitorMinLen || !strings.HasPrefix(text, claudeCodeSecurityMonitorPrefix) {
		return false
	}
	for _, marker := range claudeCodeSecurityMonitorMarkers {
		if !strings.Contains(text, marker) {
			return false
		}
	}
	return true
}

func isClaudeCodeUserID(raw string) bool {
	raw = strings.TrimSpace(raw)
	if !strings.HasPrefix(raw, "{") {
		return claudeCodeLegacyUserIDPattern.MatchString(raw)
	}
	var userID struct {
		DeviceID  string `json:"device_id"`
		SessionID string `json:"session_id"`
	}
	if common.UnmarshalJsonStr(raw, &userID) != nil {
		return false
	}
	return userID.DeviceID != "" && userID.SessionID != ""
}

// compareClaudeCodeVersions compares two validated x.y.z versions.
func compareClaudeCodeVersions(a, b string) int {
	partsA := strings.SplitN(a, ".", 3)
	partsB := strings.SplitN(b, ".", 3)
	for i := range 3 {
		numberA, _ := strconv.Atoi(partsA[i])
		numberB, _ := strconv.Atoi(partsB[i])
		if numberA != numberB {
			if numberA < numberB {
				return -1
			}
			return 1
		}
	}
	return 0
}
