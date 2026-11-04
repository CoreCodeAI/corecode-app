package relay

import (
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
