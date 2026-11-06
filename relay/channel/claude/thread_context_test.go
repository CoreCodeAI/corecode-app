package claude

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestClaudeHandlersRememberAThreadedResponsesContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	// 10 input, 1,000 cache reads, 50 cache writes and 20 output: 1,080 tokens
	// of conversation for the next turn to continue.
	usage := `{"input_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":50,"output_tokens":20}`
	body := func(id string) string {
		return `{"id":"` + id + `","type":"message","role":"assistant","model":"claude-opus-5-5","content":[{"type":"text","text":"hi"}],` +
			`"stop_reason":"end_turn","usage":` + usage + `}`
	}
	stream := func(id string) string {
		return "data: " + `{"type":"message_start","message":{"id":"` + id + `","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"usage":{"input_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":50,"output_tokens":1}}}` +
			"\n\ndata: " + `{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}` +
			"\n\ndata: " + `{"type":"message_stop"}` + "\n\n"
	}
	for _, tc := range []struct {
		name   string
		id     string
		thread string
		stream bool
		want   int
	}{
		{"created", "msg_thread_create", `{"type":"create"}`, false, 1080},
		{"continued, streamed", "msg_thread_stream", `{"type":"continue","previous_message_id":"msg_x"}`, true, 1080},
		{"without a thread", "msg_thread_none", "", false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
			request := &dto.ClaudeRequest{Model: "claude-opus-5-5"}
			if tc.thread != "" {
				request.Thread = []byte(tc.thread)
			}
			info := &relaycommon.RelayInfo{
				UserId: 41, Request: request, RelayFormat: types.RelayFormatClaude, IsStream: tc.stream,
				DisablePing: true, StartTime: time.Now(),
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-opus-5-5"},
			}
			response := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header)}
			var apiErr *types.NewAPIError
			if tc.stream {
				response.Body = io.NopCloser(strings.NewReader(stream(tc.id)))
				_, apiErr = ClaudeStreamHandler(c, response, info)
			} else {
				response.Body = io.NopCloser(strings.NewReader(body(tc.id)))
				_, apiErr = ClaudeHandler(c, response, info)
			}
			require.Nil(t, apiErr)
			tokens, found := service.ClaudeThreadContextTokens(41, tc.id)
			assert.Equal(t, tc.want > 0, found)
			assert.Equal(t, tc.want, tokens)
		})
	}
}
