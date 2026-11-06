package relay

import (
	"net/http"
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestClaudeThreadContinuationIsEstimatedWithTheKeptContext(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
	service.RememberClaudeThreadContext(52, "msg_billing_prev", 150_000)
	kept := func(userID int, thread string) int {
		return claudeThreadKeptTokens(c, &relaycommon.RelayInfo{UserId: userID, Request: &dto.ClaudeRequest{Thread: []byte(thread)}})
	}

	assert.Equal(t, 150_000, kept(52, `{"type":"continue","previous_message_id":"msg_billing_prev"}`))
	assert.Zero(t, kept(53, `{"type":"continue","previous_message_id":"msg_billing_prev"}`), "another user's thread")
	assert.Zero(t, kept(52, `{"type":"continue","previous_message_id":"msg_unknown"}`))
	assert.Zero(t, kept(52, `{"type":"create"}`), "a create request sends the whole conversation")
	assert.Zero(t, claudeThreadKeptTokens(c, &relaycommon.RelayInfo{UserId: 52, Request: &dto.GeneralOpenAIRequest{}}))
}
