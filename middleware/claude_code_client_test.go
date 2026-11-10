package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Shape of a request sent by the interactive Claude Code 2.1.301 CLI (captured
// against a local stub; device and session ids replaced, prompt shortened).
const claudeCodeCLIUserAgent = "claude-cli/2.1.301 (external, cli)"

var claudeCodeCLIHeaders = map[string]string{
	"User-Agent":        claudeCodeCLIUserAgent,
	"X-App":             "cli",
	"anthropic-beta":    "claude-code-20250219,interleaved-thinking-2025-05-14,context-management-2025-06-27",
	"anthropic-version": "2023-06-01",
}

const claudeCodeCLIBody = `{
  "model": "claude-sonnet-5-5",
  "max_tokens": 128000,
  "stream": true,
  "metadata": {"user_id": "{\"device_id\":\"5b2c0a8e4f1d6b3a9c7e0d2f4a6b8c1e3d5f7a9b0c2e4d6f8a1b3c5d7e9f0a2b\",\"account_uuid\":\"\",\"session_id\":\"0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d\"}"},
  "system": [
    {"type": "text", "text": "x-anthropic-billing-header: cc_version=2.1.301.b14; cc_entrypoint=cli;"},
    {"type": "text", "text": "You are Claude Code, Anthropic's official CLI for Claude.", "cache_control": {"type": "ephemeral"}},
    {"type": "text", "text": "\nYou are an agent working with the user toward their goals, using your own judgment along the way.\n"}
  ],
  "messages": [{"role": "user", "content": "say ok"}]
}`

const legacyClaudeCodeUserID = "user_5b2c0a8e4f1d6b3a9c7e0d2f4a6b8c1e3d5f7a9b0c2e4d6f8a1b3c5d7e9f0a2b_account__session_0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d"

func setClaudeCodeClientSetting(t *testing.T, value operation_setting.ClaudeCodeClientSetting) {
	t.Helper()
	setting := operation_setting.GetClaudeCodeClientSetting()
	previous := *setting
	*setting = value
	t.Cleanup(func() { *setting = previous })
}

func runClaudeCodeGate(t *testing.T, group string, autoGroups []string, path string, headers map[string]string, body string) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	// A request without a body is a GET, as model lists are.
	method := http.MethodPost
	if body == "" {
		method = http.MethodGet
	}
	return runClaudeCodeGateWithBody(t, group, autoGroups, method, path, headers, strings.NewReader(body))
}

func runClaudeCodeGateWithBody(t *testing.T, group string, autoGroups []string, method, path string, headers map[string]string, body io.Reader) (*httptest.ResponseRecorder, bool) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(method, path, body)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("Accept-Language", "en")
	for name, value := range headers {
		c.Request.Header.Set(name, value)
	}
	common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
	if autoGroups != nil {
		common.SetContextKey(c, constant.ContextKeyTokenAutoGroups, autoGroups)
	}
	return recorder, enforceClientOnlyGroups(c, "default")
}

func withHeader(name, value string) map[string]string {
	headers := make(map[string]string, len(claudeCodeCLIHeaders))
	for key, existing := range claudeCodeCLIHeaders {
		headers[key] = existing
	}
	if value == "" {
		delete(headers, name)
	} else {
		headers[name] = value
	}
	return headers
}

func TestClaudeCodeOnlyGroupGate(t *testing.T) {
	require.NoError(t, i18n.Init())
	setClaudeCodeClientSetting(t, operation_setting.ClaudeCodeClientSetting{Groups: []string{"cc"}})
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","cc":"Claude Code"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"cc":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})

	sdkBody := strings.NewReplacer(
		"cc_entrypoint=cli", "cc_entrypoint=sdk-cli",
		"You are Claude Code, Anthropic's official CLI for Claude.", "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
	).Replace(claudeCodeCLIBody)
	withoutBillingBlock := strings.Replace(claudeCodeCLIBody,
		`{"type": "text", "text": "x-anthropic-billing-header: cc_version=2.1.301.b14; cc_entrypoint=cli;"},`, "", 1)
	foreignPrompt := `{"model":"claude-sonnet-5-5","max_tokens":1024,"metadata":{"user_id":"` + legacyClaudeCodeUserID + `"},` +
		`"system":[{"type":"text","text":"You are a helpful translation assistant for a mobile app."}],"messages":[{"role":"user","content":"hi"}]}`
	stringSystem := `{"model":"claude-sonnet-5-5","max_tokens":1024,"metadata":{"user_id":"` + legacyClaudeCodeUserID + `"},` +
		`"system":"You are Claude Code, Anthropic's official CLI for Claude.","messages":[{"role":"user","content":"hi"}]}`
	legacyUserID := strings.Replace(claudeCodeCLIBody, `"metadata": {"user_id": "{\"device_id\":\"5b2c0a8e4f1d6b3a9c7e0d2f4a6b8c1e3d5f7a9b0c2e4d6f8a1b3c5d7e9f0a2b\",\"account_uuid\":\"\",\"session_id\":\"0f6b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d\"}"}`,
		`"metadata": {"user_id": "`+legacyClaudeCodeUserID+`"}`, 1)
	endUserID := strings.Replace(legacyUserID, legacyClaudeCodeUserID, "customer-42", 1)
	probe := `{"model":"claude-sonnet-5-5","max_tokens":1,"messages":[{"role":"user","content":"count"}]}`
	// The gateway check Claude Desktop sends, byte for byte apart from the model.
	desktopProbe := `{"max_tokens":16,"messages":[{"role":"user","content":"."}],"model":"claude-haiku-5-5"}`
	// The Messages request of Magpie's "Detect APIs", from its binary's template.
	magpieCheck := `{"model":"claude-haiku-5-5","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`
	desktopHeaders := map[string]string{"User-Agent": "Claude/1.0 (desktop)", "anthropic-version": "2023-06-01"}
	desktopProbeWith := func(old, replacement string) string {
		return strings.Replace(desktopProbe, old, replacement, 1)
	}

	tests := []struct {
		name       string
		group      string
		autoGroups []string
		path       string
		headers    map[string]string
		body       string
		allowed    bool
	}{
		{"interactive Claude Code", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, claudeCodeCLIBody, true},
		{"claude -p through the Agent SDK prompt", "cc", nil, "/v1/messages", withHeader("User-Agent", "claude-cli/2.1.301 (external, sdk-cli)"), sdkBody, true},
		{"identity sentence without the billing block", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, withoutBillingBlock, true},
		{"legacy metadata.user_id", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, legacyUserID, true},
		{"max_tokens=1 probe without a prompt", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, probe, true},
		{"model list from Claude Code", "cc", nil, "/v1/models", claudeCodeCLIHeaders, "", true},
		{"Claude Desktop probe", "cc", nil, "/v1/messages", desktopHeaders, desktopProbe, true},
		{"Claude Desktop probe on an auto token", "auto", []string{"cc"}, "/v1/messages", desktopHeaders, desktopProbe, true},
		{"desktop probe with a system prompt", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`"model"`, `"system":"Translate to French.","model"`), false},
		{"desktop probe with tools", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`"model"`, `"tools":[{"name":"x","input_schema":{"type":"object"}}],"model"`), false},
		{"desktop probe asking for more tokens", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`"max_tokens":16`, `"max_tokens":17`), false},
		{"Magpie's Messages API check", "cc", nil, "/v1/messages", map[string]string{"User-Agent": "magpie/0.1.2343"}, magpieCheck, true},
		{"desktop probe with another message", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`"content":"."`, `"content":"hello"`), false},
		{"Magpie's check with a longer prompt", "cc", nil, "/v1/messages", desktopHeaders, strings.Replace(magpieCheck, `"hi"`, `"hi, summarize this"`, 1), false},
		{"Magpie's check with a system prompt", "cc", nil, "/v1/messages", desktopHeaders, strings.Replace(magpieCheck, `"max_tokens"`, `"system":"Translate to French.","max_tokens"`, 1), false},
		{"Magpie's Chat Completions check", "cc", nil, "/v1/chat/completions", desktopHeaders, `{"model":"claude-haiku-5-5","messages":[{"role":"user","content":"hi"}],"max_tokens":16}`, false},
		{"Magpie's Responses check", "cc", nil, "/v1/responses", desktopHeaders, `{"model":"claude-haiku-5-5","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}],"max_output_tokens":16}`, false},
		{"desktop probe with content blocks", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`"content":"."`, `"content":[{"type":"text","text":"."}]`), false},
		{"desktop probe with a second turn", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`]`, `,{"role":"assistant","content":"ok"},{"role":"user","content":"."}]`), false},
		{"desktop probe as an assistant turn", "cc", nil, "/v1/messages", desktopHeaders, desktopProbeWith(`"role":"user"`, `"role":"assistant"`), false},
		{"desktop probe body on a Gemini path", "cc", nil, "/v1beta/models/claude-haiku-5-5:generateContent", desktopHeaders, desktopProbe, false},
		{"group without the restriction", "default", nil, "/v1/messages", map[string]string{"User-Agent": "curl/8.7.1"}, foreignPrompt, true},
		{"same body from another client", "cc", nil, "/v1/messages", withHeader("User-Agent", "Anthropic/Python 0.70.0"), claudeCodeCLIBody, false},
		{"model list from another client", "cc", nil, "/v1/models", map[string]string{"User-Agent": "curl/8.7.1"}, "", true},
		{"single model from another client", "cc", nil, "/v1/models/claude-sonnet-5-5", map[string]string{"User-Agent": "curl/8.7.1"}, "", true},
		{"auto token listing models from another client", "auto", []string{"default", "cc"}, "/v1/models", map[string]string{"User-Agent": "curl/8.7.1"}, "", true},
		{"Gemini model path from another client", "cc", nil, "/v1beta/models/claude-sonnet-5-5:generateContent", map[string]string{"User-Agent": "curl/8.7.1"}, foreignPrompt, false},
		{"Claude Code User-Agent with a foreign prompt", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, foreignPrompt, false},
		{"system prompt as a plain string", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, stringSystem, false},
		{"missing X-App", "cc", nil, "/v1/messages", withHeader("X-App", ""), claudeCodeCLIBody, false},
		{"missing anthropic-beta", "cc", nil, "/v1/messages", withHeader("anthropic-beta", ""), claudeCodeCLIBody, false},
		{"end-user metadata.user_id", "cc", nil, "/v1/messages", claudeCodeCLIHeaders, endUserID, false},
		{"auto token that can land elsewhere", "auto", []string{"default", "cc"}, "/v1/messages", map[string]string{"User-Agent": "curl/8.7.1"}, foreignPrompt, true},
		{"auto token whose only candidate is the group", "auto", []string{"cc"}, "/v1/messages", map[string]string{"User-Agent": "curl/8.7.1"}, foreignPrompt, false},
		{"auto token outside the group", "auto", []string{"default"}, "/v1/messages", map[string]string{"User-Agent": "curl/8.7.1"}, foreignPrompt, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder, allowed := runClaudeCodeGate(t, test.group, test.autoGroups, test.path, test.headers, test.body)
			require.Equal(t, test.allowed, allowed)
			if test.allowed {
				return
			}
			assert.Equal(t, http.StatusForbidden, recorder.Code)
			assert.Contains(t, recorder.Body.String(), "Group cc only accepts requests from Claude Code")
			assert.Contains(t, recorder.Body.String(), `"code":"access_denied"`)
		})
	}
}

// An auto token keeps the Claude Code only candidates for Claude Code and drops
// them for any other client, so channel selection picks among the rest.
func TestClaudeCodeOnlyGroupAutoCandidates(t *testing.T) {
	require.NoError(t, i18n.Init())
	setClaudeCodeClientSetting(t, operation_setting.ClaudeCodeClientSetting{Groups: []string{"cc"}})
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","cc":"Claude Code","gpt":"GPT"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"cc":1,"gpt":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})

	candidates := func(headers map[string]string, body string) []string {
		gin.SetMode(gin.TestMode)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		for name, value := range headers {
			c.Request.Header.Set(name, value)
		}
		common.SetContextKey(c, constant.ContextKeyUsingGroup, "auto")
		common.SetContextKey(c, constant.ContextKeyTokenAutoGroups, []string{"cc", "default", "gpt"})
		require.True(t, enforceClientOnlyGroups(c, "default"))
		return service.GetRequestAutoGroups(c, "default")
	}

	assert.Equal(t, []string{"cc", "default", "gpt"}, candidates(claudeCodeCLIHeaders, claudeCodeCLIBody))
	assert.Equal(t, []string{"default", "gpt"}, candidates(withHeader("User-Agent", "curl/8.7.1"), claudeCodeCLIBody))
}

// A body the gate cannot read or parse was never judged, so it is refused the
// way Distribute refuses it (400, or 413 past MAX_REQUEST_BODY_MB) instead of
// as a foreign client. The User-Agent check still runs first.
func TestClaudeCodeOnlyGroupUnreadableBody(t *testing.T) {
	require.NoError(t, i18n.Init())
	setClaudeCodeClientSetting(t, operation_setting.ClaudeCodeClientSetting{Groups: []string{"cc"}})
	originalMaxMB := constant.MaxRequestBodyMB
	constant.MaxRequestBodyMB = 1
	t.Cleanup(func() { constant.MaxRequestBodyMB = originalMaxMB })

	abortedUpload := func() io.Reader {
		return io.MultiReader(strings.NewReader(claudeCodeCLIBody[:200]), iotest.ErrReader(io.ErrUnexpectedEOF))
	}
	oversized := `{"model":"claude-sonnet-5-5","padding":"` + strings.Repeat("x", 1<<20) + `"}`

	tests := []struct {
		name    string
		headers map[string]string
		body    io.Reader
		status  int
		message string
	}{
		{"aborted upload from Claude Code", claudeCodeCLIHeaders, abortedUpload(), http.StatusBadRequest, "Invalid request: unexpected EOF"},
		{"oversized body from Claude Code", claudeCodeCLIHeaders, strings.NewReader(oversized), http.StatusRequestEntityTooLarge, "Invalid request: request body exceeds 1 MB"},
		{"malformed JSON from Claude Code", claudeCodeCLIHeaders, strings.NewReader(`{"model":"claude-sonnet-5-5",`), http.StatusBadRequest, "Invalid request: "},
		{"aborted upload from another client", withHeader("User-Agent", "curl/8.7.1"), abortedUpload(), http.StatusForbidden, "Group cc only accepts requests from Claude Code"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder, allowed := runClaudeCodeGateWithBody(t, "cc", nil, http.MethodPost, "/v1/messages", test.headers, test.body)
			require.False(t, allowed)
			assert.Equal(t, test.status, recorder.Code)
			assert.Contains(t, recorder.Body.String(), test.message)
			if test.status != http.StatusForbidden {
				assert.NotContains(t, recorder.Body.String(), "only accepts requests from Claude Code")
				assert.NotContains(t, recorder.Body.String(), `"code":"access_denied"`)
			}
		})
	}
}

func TestClaudeCodeOnlyGroupVersionBounds(t *testing.T) {
	require.NoError(t, i18n.Init())

	tests := []struct {
		name       string
		minVersion string
		maxVersion string
		message    string
	}{
		{"inside the bounds", "2.1.78", "2.1.301", ""},
		{"older than the minimum", "2.1.302", "", "Claude Code 2.1.301 is older than 2.1.302, the oldest version group cc accepts. Run claude update"},
		{"minimum compared numerically", "2.1.1000", "", "Claude Code 2.1.301 is older than 2.1.1000"},
		{"newer than the maximum", "", "2.1.300", "Claude Code 2.1.301 is newer than 2.1.300, the newest version group cc accepts. Install Claude Code 2.1.300"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setClaudeCodeClientSetting(t, operation_setting.ClaudeCodeClientSetting{
				Groups: []string{"cc"}, MinVersion: test.minVersion, MaxVersion: test.maxVersion,
			})
			recorder, allowed := runClaudeCodeGate(t, "cc", nil, "/v1/messages", claudeCodeCLIHeaders, claudeCodeCLIBody)
			if test.message == "" {
				assert.True(t, allowed)
				return
			}
			require.False(t, allowed)
			assert.Equal(t, http.StatusForbidden, recorder.Code)
			assert.Contains(t, recorder.Body.String(), test.message)
		})
	}
}

func TestClaudeCodeClientSettingValidation(t *testing.T) {
	for _, value := range []string{"", "2.1.78", "10.0.123"} {
		assert.NoError(t, operation_setting.ValidateClaudeCodeVersion(value), value)
	}
	for _, value := range []string{"2.1", "v2.1.78", "2.1.78-beta", " 2.1.78"} {
		assert.Error(t, operation_setting.ValidateClaudeCodeVersion(value), value)
	}
	for _, value := range []string{`[]`, `["cc","vip"]`} {
		assert.NoError(t, operation_setting.ValidateClaudeCodeClientGroups(value), value)
	}
	for _, value := range []string{`cc`, `{"cc":true}`, `[""]`, `[" cc"]`} {
		assert.Error(t, operation_setting.ValidateClaudeCodeClientGroups(value), value)
	}
}

// The Claude Desktop probe carries no claude-cli version, so version bounds,
// which would refuse every CLI below, do not apply to it.
func TestClaudeDesktopProbeIgnoresVersionBounds(t *testing.T) {
	require.NoError(t, i18n.Init())
	setClaudeCodeClientSetting(t, operation_setting.ClaudeCodeClientSetting{
		Groups: []string{"cc"}, MinVersion: "9.0.0", MaxVersion: "9.0.1",
	})
	desktopProbe := `{"max_tokens":16,"messages":[{"role":"user","content":"."}],"model":"claude-haiku-5-5"}`

	_, allowed := runClaudeCodeGate(t, "cc", nil, "/v1/messages", map[string]string{"User-Agent": "Claude/1.0 (desktop)"}, desktopProbe)
	assert.True(t, allowed)
	_, allowed = runClaudeCodeGate(t, "cc", nil, "/v1/messages", claudeCodeCLIHeaders, claudeCodeCLIBody)
	assert.False(t, allowed)
}

// A refusal logs the body's shape, never its text.
func TestRequestShape(t *testing.T) {
	shape := func(contentType, body string) string {
		gin.SetMode(gin.TestMode)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
		c.Request.Header.Set("Content-Type", contentType)
		return requestShape(c)
	}
	const json = "application/json"

	tests := []struct {
		name, contentType, body, want string
	}{
		{"Magpie's Messages check", json, `{"model":"claude-opus-5-5","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`,
			`fields=["max_tokens" "messages" "model"] max_tokens=16 messages=1 last_content=string(2)`},
		{"a conversation ending in blocks", json, `{"model":"m","system":"secret system","messages":[{"role":"user","content":"secret one"},{"role":"assistant","content":"ok"},{"role":"user","content":[{"type":"text","text":"secret two"},{"type":"image"}]}]}`,
			`fields=["messages" "model" "system"] messages=3 last_content=blocks(2)`},
		{"multibyte content counted in characters", json, `{"messages":[{"role":"user","content":"你好"}]}`,
			`fields=["messages"] messages=1 last_content=string(2)`},
		{"max_tokens that is not a number", json, `{"max_tokens":"16"}`, `fields=["max_tokens"] max_tokens=invalid`},
		{"Responses body", json, `{"model":"m","input":[{"type":"message"}],"max_output_tokens":16}`, `fields=["input" "max_output_tokens" "model"]`},
		{"long field name", json, `{"` + strings.Repeat("a", 60) + `":1}`, `fields=["` + strings.Repeat("a", 40) + `…"]`},
		{"malformed JSON", json, `{"model":`, "body=unparsed"},
		{"form body", "application/x-www-form-urlencoded", "model=m", `fields=["model"]`},
		{"empty object", json, `{}`, "body=unparsed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := shape(test.contentType, test.body)
			assert.Equal(t, test.want, got)
			assert.NotContains(t, got, "secret")
		})
	}
}

func TestClipKeepsValidUTF8(t *testing.T) {
	assert.Equal(t, "claude-cli/2.1.316", clip("claude-cli/2.1.316", 120))
	assert.Equal(t, "ab…", clip("abcdef", 2))
	assert.Equal(t, "a…", clip("a你", 2))
}
