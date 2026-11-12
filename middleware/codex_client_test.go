package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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

const codexResponsesBody = `{"model":"gpt-6.1-sol","instructions":"You are Codex.","input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"say ok"}]}],"stream":true,"store":false}`

func setCodexClientSetting(t *testing.T, value operation_setting.CodexClientSetting) {
	t.Helper()
	setting := operation_setting.GetCodexClientSetting()
	previous := *setting
	*setting = value
	t.Cleanup(func() { *setting = previous })
}

func codexHeaders(userAgent, originator string) map[string]string {
	headers := map[string]string{}
	if userAgent != "" {
		headers["User-Agent"] = userAgent
	}
	if originator != "" {
		headers["Originator"] = originator
	}
	return headers
}

func setupClientGroups(t *testing.T) {
	t.Helper()
	require.NoError(t, i18n.Init())
	setClaudeCodeClientSetting(t, operation_setting.ClaudeCodeClientSetting{Groups: []string{"cc"}})
	setCodexClientSetting(t, operation_setting.CodexClientSetting{Groups: []string{"codex"}})
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","cc":"Claude Code","codex":"Codex","gpt":"GPT"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"cc":1,"codex":1,"gpt":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})
}

// The User-Agent and Originator pairs are the ones Codex clients sent to the
// relay in November 2026.
func TestCodexOnlyGroupGate(t *testing.T) {
	setupClientGroups(t)

	tests := []struct {
		name    string
		group   string
		path    string
		headers map[string]string
		body    string
		allowed bool
	}{
		{"Codex CLI before 0.150", "codex", "/v1/responses", codexHeaders("codex_cli_rs/0.80.0 (Windows 15.7.2; x86_64) Terminal", "codex_cli_rs"), codexResponsesBody, true},
		{"Codex CLI", "codex", "/v1/responses", codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64) iTerm.app/3.6.11 (codex-tui; 0.167.0)", "codex-tui"), codexResponsesBody, true},
		{"codex exec", "codex", "/v1/responses", codexHeaders("codex_exec/0.167.0-alpha.3.2 (Mac OS 27.0.1; arm64) dumb (codex_exec; 0.167.0-alpha.3.2)", "codex_exec"), codexResponsesBody, true},
		{"IDE extension", "codex", "/v1/responses", codexHeaders("codex_vscode/0.164.0-alpha.11.1 (Ubuntu 22.4.0; x86_64) unknown (VS Code; 26.1021.22027)", "codex_vscode"), codexResponsesBody, true},
		{"desktop app", "codex", "/v1/responses", codexHeaders("Codex Desktop/0.167.0-alpha.3.2 (Mac OS 27.2.0; arm64) unknown (Codex Desktop; 26.1103.60933)", "Codex Desktop"), codexResponsesBody, true},
		{"desktop app work mode", "codex", "/v1/responses", codexHeaders("Codex Desktop/0.167.0-alpha.3.2 (Windows 10.0.22631; x86_64) unknown (Codex Desktop; 26.1103.60933)", "codex_work_desktop"), codexResponsesBody, true},
		{"compaction", "codex", "/v1/responses/compact", codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64)", "codex-tui"), codexResponsesBody, true},
		{"model list from another client", "codex", "/v1/models", codexHeaders("curl/8.7.1", ""), "", true},
		{"group without the restriction", "gpt", "/v1/responses", codexHeaders("OpenAI/Python 2.3.0", ""), codexResponsesBody, true},
		{"gateway forwarding Codex", "codex", "/v1/responses", codexHeaders("axonhub/1.0", "Codex Desktop"), codexResponsesBody, false},
		{"Codex User-Agent without Originator", "codex", "/v1/responses", codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64)", ""), codexResponsesBody, false},
		{"Codex User-Agent with a foreign Originator", "codex", "/v1/responses", codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64)", "cherry-studio"), codexResponsesBody, false},
		{"Codex name without a version", "codex", "/v1/responses", codexHeaders("codex-tui", "codex-tui"), codexResponsesBody, false},
		{"OpenAI SDK", "codex", "/v1/responses", codexHeaders("OpenAI/Python 2.3.0", ""), codexResponsesBody, false},
		{"Claude Code in a Codex group", "codex", "/v1/messages", claudeCodeCLIHeaders, claudeCodeCLIBody, false},
		{"Codex headers on Chat Completions", "codex", "/v1/chat/completions", codexHeaders("Codex Desktop/0.167.0-alpha.3.2 (Mac OS 27.2.0; arm64)", "Codex Desktop"), `{"model":"gpt-6.1-sol","messages":[]}`, false},
		{"Codex headers on a lookalike path", "codex", "/v1/responsesx", codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64)", "codex-tui"), codexResponsesBody, false},
		{"Codex in a Claude Code group", "cc", "/v1/responses", codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64)", "codex-tui"), codexResponsesBody, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder, allowed := runClaudeCodeGate(t, test.group, nil, test.path, test.headers, test.body)
			require.Equal(t, test.allowed, allowed)
			if test.allowed {
				return
			}
			assert.Equal(t, http.StatusForbidden, recorder.Code)
			if test.group == "codex" && test.headers["Originator"] != "" && codexUserAgentPattern.MatchString(test.headers["User-Agent"]) && codexOriginators[test.headers["Originator"]] {
				assert.Contains(t, recorder.Body.String(), "Group codex only accepts Codex requests to /v1/responses")
			} else {
				client := map[string]string{"codex": "Codex", "cc": "Claude Code"}[test.group]
				assert.Contains(t, recorder.Body.String(), "Group "+test.group+" only accepts requests from "+client)
			}
			assert.Contains(t, recorder.Body.String(), `"code":"access_denied"`)
		})
	}
}

// An auto token keeps each restricted candidate only for its own client.
func TestClientOnlyGroupsAutoCandidates(t *testing.T) {
	setupClientGroups(t)
	codex := codexHeaders("codex-tui/0.167.0 (Mac OS 26.5.2; arm64)", "codex-tui")
	sdk := codexHeaders("OpenAI/Python 2.3.0", "")

	tests := []struct {
		name       string
		candidates []string
		path       string
		headers    map[string]string
		body       string
		kept       []string // nil when the request is refused
	}{
		{"Codex keeps the Codex group", []string{"codex", "gpt"}, "/v1/responses", codex, codexResponsesBody, []string{"codex", "gpt"}},
		{"Codex drops the Claude Code group", []string{"cc", "codex", "gpt"}, "/v1/responses", codex, codexResponsesBody, []string{"codex", "gpt"}},
		{"SDK drops the Codex group", []string{"codex", "gpt"}, "/v1/responses", sdk, codexResponsesBody, []string{"gpt"}},
		{"Claude Code drops the Codex group", []string{"cc", "codex"}, "/v1/messages", claudeCodeCLIHeaders, claudeCodeCLIBody, []string{"cc"}},
		{"Codex on Chat Completions drops the Codex group", []string{"codex", "gpt"}, "/v1/chat/completions", codex, `{"model":"gpt-6.1-sol","messages":[]}`, []string{"gpt"}},
		{"SDK with only restricted groups", []string{"cc", "codex"}, "/v1/responses", sdk, codexResponsesBody, nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gin.SetMode(gin.TestMode)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("Accept-Language", "en")
			for name, value := range test.headers {
				c.Request.Header.Set(name, value)
			}
			common.SetContextKey(c, constant.ContextKeyUsingGroup, "auto")
			common.SetContextKey(c, constant.ContextKeyTokenAutoGroups, test.candidates)
			allowed := enforceClientOnlyGroups(c, "default")
			if test.kept == nil {
				require.False(t, allowed)
				assert.Equal(t, http.StatusForbidden, recorder.Code)
				assert.Contains(t, recorder.Body.String(), "Group cc only accepts requests from Claude Code")
				return
			}
			require.True(t, allowed, recorder.Body.String())
			assert.Equal(t, test.kept, service.GetRequestAutoGroups(c, "default"))
		})
	}
}
