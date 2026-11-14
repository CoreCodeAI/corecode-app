package relay

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/model_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// Each attempt builds its outbound body from a copy, so a retry still sees the
// client's request. Pass-through sends the received bytes and skips the deep
// copy; both record the build time once.
func TestClaudeHelperKeepsTheClientRequestAcrossAttempts(t *testing.T) {
	service.InitHttpClient()
	const body = `{"model":"client-model","max_tokens":16,"system":"be brief","messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`
	for _, passThrough := range []bool{false, true} {
		name := "converted"
		if passThrough {
			name = "pass-through"
		}
		t.Run(name, func(t *testing.T) {
			received := make(chan []byte, 2)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				payload, err := io.ReadAll(r.Body)
				if err == nil {
					received <- payload
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"fixture upstream failure"}}`)
			}))
			t.Cleanup(upstream.Close)

			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAnthropic)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			common.SetContextKey(c, constant.ContextKeyChannelSetting, dto.ChannelSettings{
				PassThroughBodyEnabled: passThrough,
				SystemPrompt:           "channel prompt",
				SystemPromptOverride:   true,
			})
			c.Set("model_mapping", `{"client-model":"upstream-model"}`)
			request, err := helper.GetAndValidateClaudeRequest(c)
			require.NoError(t, err)
			info := relaycommon.GenRelayInfoClaude(c, request)
			info.OriginModelName = "client-model"

			for attempt := 0; attempt < 2; attempt++ {
				apiErr := ClaudeHelper(c, info)
				require.NotNil(t, apiErr)
				require.Len(t, received, 1)
				sent := <-received
				if passThrough {
					assert.JSONEq(t, body, string(sent))
				} else {
					assert.Equal(t, "upstream-model", gjson.GetBytes(sent, "model").String())
					assert.Equal(t, "channel prompt\nbe brief", gjson.GetBytes(sent, "system").String())
				}
				assert.Equal(t, "be brief", request.System, "attempt %d left the client's system prompt", attempt)
				assert.Len(t, request.Messages, 1)
			}

			other := service.GenerateTextOtherInfo(c, info, 1, 1, 1, 0, 0, 0, 1)
			adminInfo, ok := other.Snapshot()["admin_info"].(map[string]any)
			require.True(t, ok)
			assert.Contains(t, adminInfo, "outbound_build_ms")
		})
	}
}

// A streamed Claude Code request on an Anthropic channel whose estimated
// prompt reaches the threshold leaves with 1-hour breakpoints and the extended
// cache ttl beta. A shorter prompt, a non-stream request (an auto mode check)
// and a request whose client chose a ttl leave as sent.
func TestClaudeHelperDefaultsStreamedBreakpointsToOneHour(t *testing.T) {
	service.InitHttpClient()
	const withoutTTL = `{"model":"claude-opus-5-5","max_tokens":16,"stream":%s,` +
		`"system":[{"type":"text","text":"You are Claude Code.","cache_control":{"type":"ephemeral"%s}}],` +
		`"messages":[{"role":"user","content":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"%s}}]}]}`
	cases := []struct {
		name      string
		stream    string
		clientTTL string
		estimate  int
		wantTTL   string
		wantBeta  bool
	}{
		{name: "streamed at the threshold", stream: "true", estimate: 200000, wantTTL: "1h", wantBeta: true},
		{name: "streamed below the threshold", stream: "true", estimate: 199999},
		{name: "non-stream", stream: "false", estimate: 300000},
		{name: "client chose 5m", stream: "true", estimate: 300000, clientTTL: `,"ttl":"5m"`, wantTTL: "5m"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			type outbound struct {
				body []byte
				beta string
			}
			received := make(chan outbound, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				payload, err := io.ReadAll(r.Body)
				if err == nil {
					received <- outbound{body: payload, beta: r.Header.Get("anthropic-beta")}
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusBadGateway)
				_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"fixture upstream failure"}}`)
			}))
			t.Cleanup(upstream.Close)

			body := fmt.Sprintf(withoutTTL, tc.stream, tc.clientTTL, "")
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("anthropic-beta", "claude-code-20250219")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAnthropic)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			request, err := helper.GetAndValidateClaudeRequest(c)
			require.NoError(t, err)
			info := relaycommon.GenRelayInfoClaude(c, request)
			info.SetEstimatePromptTokens(tc.estimate)

			require.NotNil(t, ClaudeHelper(c, info))
			sent := <-received
			assert.Equal(t, tc.wantTTL, gjson.GetBytes(sent.body, "system.0.cache_control.ttl").String())
			if tc.clientTTL == "" {
				assert.Equal(t, tc.wantTTL, gjson.GetBytes(sent.body, "messages.0.content.0.cache_control.ttl").String())
			} else {
				assert.False(t, gjson.GetBytes(sent.body, "messages.0.content.0.cache_control.ttl").Exists())
			}
			if tc.wantBeta {
				assert.Equal(t, "claude-code-20250219,"+relaycommon.ExtendedCacheTTLBeta, sent.beta)
			} else {
				assert.Equal(t, "claude-code-20250219", sent.beta)
			}
		})
	}
}

// A retry on the same request context decides the beta afresh, and the two
// options switch the rule: "off" sends the body as the client did, and a 0
// threshold covers every streamed request, even one with no estimate.
func TestClaudeHelperDefaultCacheTTLFollowsEachAttemptAndTheOptions(t *testing.T) {
	service.InitHttpClient()
	settings := model_setting.GetClaudeSettings()
	savedTTL, savedMin := settings.DefaultPromptCacheTTL, settings.DefaultPromptCacheTTLMinTokens
	t.Cleanup(func() {
		settings.DefaultPromptCacheTTL, settings.DefaultPromptCacheTTLMinTokens = savedTTL, savedMin
	})

	type outbound struct {
		ttl  string
		beta string
	}
	received := make(chan outbound, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, err := io.ReadAll(r.Body)
		if err == nil {
			received <- outbound{ttl: gjson.GetBytes(payload, "system.0.cache_control.ttl").String(), beta: r.Header.Get("anthropic-beta")}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"fixture upstream failure"}}`)
	}))
	t.Cleanup(upstream.Close)

	const body = `{"model":"claude-opus-5-5","max_tokens":16,"stream":true,` +
		`"system":[{"type":"text","text":"You are Claude Code.","cache_control":{"type":"ephemeral"}}],` +
		`"messages":[{"role":"user","content":"hi"}]}`
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAnthropic)
	common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
	request, err := helper.GetAndValidateClaudeRequest(c)
	require.NoError(t, err)
	info := relaycommon.GenRelayInfoClaude(c, request)

	attempts := []struct {
		name     string
		ttl      string
		min      int
		estimate int
		wantTTL  string
	}{
		{name: "rewritten", ttl: "1h", min: 200000, estimate: 250000, wantTTL: "1h"},
		{name: "retry below the threshold", ttl: "1h", min: 200000, estimate: 1000},
		{name: "option off", ttl: "off", min: 0, estimate: 250000},
		{name: "threshold 0 without an estimate", ttl: "1h", min: 0, estimate: 0, wantTTL: "1h"},
	}
	for _, attempt := range attempts {
		settings.DefaultPromptCacheTTL, settings.DefaultPromptCacheTTLMinTokens = attempt.ttl, attempt.min
		info.SetEstimatePromptTokens(attempt.estimate)
		require.NotNil(t, ClaudeHelper(c, info), attempt.name)
		sent := <-received
		assert.Equal(t, attempt.wantTTL, sent.ttl, attempt.name)
		assert.Equal(t, attempt.wantTTL != "", strings.Contains(sent.beta, relaycommon.ExtendedCacheTTLBeta), attempt.name)
	}
}

// When the upstream answers a rewritten request with a 400 about
// cache_control, the client's own body goes out once more without the beta,
// and the log records the rejection. Any other 400 is returned as it came,
// after one upstream call.
func TestClaudeHelperResendsTheClientBodyWhenTheDefaultTTLIsRejected(t *testing.T) {
	service.InitHttpClient()
	const rejection = `{"type":"error","error":{"type":"invalid_request_error","message":"Claude upstream request failed with status 400: system.0.cache_control.ttl: Input should be '5m' or '1h'"}}`
	const unrelated = `{"type":"error","error":{"type":"invalid_request_error","message":"messages.1.content.0: Invalid signature in thinking block"}}`
	for _, tc := range []struct {
		name       string
		firstReply string
		wantCalls  int
		wantLog    string
		wantError  string
	}{
		{name: "cache ttl rejected", firstReply: rejection, wantCalls: 2, wantLog: "rejected", wantError: "fixture upstream failure"},
		{name: "unrelated 400", firstReply: unrelated, wantCalls: 1, wantLog: "1h", wantError: "Invalid signature"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			type outbound struct {
				ttl  string
				beta string
			}
			received := make(chan outbound, 3)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				payload, _ := io.ReadAll(r.Body)
				received <- outbound{ttl: gjson.GetBytes(payload, "system.0.cache_control.ttl").String(), beta: r.Header.Get("anthropic-beta")}
				w.Header().Set("Content-Type", "application/json")
				if len(received) == 1 {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = io.WriteString(w, tc.firstReply)
					return
				}
				w.WriteHeader(http.StatusBadGateway)
				_, _ = io.WriteString(w, `{"type":"error","error":{"type":"api_error","message":"fixture upstream failure"}}`)
			}))
			t.Cleanup(upstream.Close)

			const body = `{"model":"claude-opus-5-5","max_tokens":16,"stream":true,` +
				`"system":[{"type":"text","text":"You are Claude Code.","cache_control":{"type":"ephemeral"}}],` +
				`"messages":[{"role":"user","content":"hi"}]}`
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", strings.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("anthropic-beta", "claude-code-20250219")
			common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeAnthropic)
			common.SetContextKey(c, constant.ContextKeyChannelBaseUrl, upstream.URL)
			request, err := helper.GetAndValidateClaudeRequest(c)
			require.NoError(t, err)
			info := relaycommon.GenRelayInfoClaude(c, request)
			info.SetEstimatePromptTokens(250000)

			apiErr := ClaudeHelper(c, info)
			require.NotNil(t, apiErr)
			assert.Contains(t, apiErr.Error(), tc.wantError)
			require.Len(t, received, tc.wantCalls)
			first := <-received
			assert.Equal(t, "1h", first.ttl)
			assert.Contains(t, first.beta, relaycommon.ExtendedCacheTTLBeta)
			if tc.wantCalls == 2 {
				second := <-received
				assert.Empty(t, second.ttl, "the resend carries the client's breakpoints")
				assert.Equal(t, "claude-code-20250219", second.beta)
			}
			assert.Equal(t, tc.wantLog, c.GetString(service.DefaultCacheTTLLogKey))
		})
	}
}
