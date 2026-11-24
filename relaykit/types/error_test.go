package types

import (
	"errors"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

// A balance refusal is HTTP 402 and says so in each protocol's own words:
// Claude Code reads billing_error as a balance problem, where a 403 reads as a
// failed login. A 403 refusal with the same code (the newcomer-plan gate) and
// an error an upstream sent keep their types.
func TestBalanceRefusalErrorBodies(t *testing.T) {
	refused := NewErrorWithStatusCode(errors.New("out of balance"), ErrorCodeInsufficientUserQuota, http.StatusPaymentRequired,
		ErrOptionWithSkipRetry(), ErrOptionWithNoRecordErrorLog())
	assert.Equal(t, http.StatusPaymentRequired, refused.StatusCode)
	assert.True(t, IsSkipRetryError(refused))
	assert.False(t, IsRecordErrorLog(refused))

	openAI := refused.ToOpenAIError()
	assert.Equal(t, "insufficient_quota", openAI.Type)
	assert.Equal(t, "insufficient_quota", openAI.Code)
	assert.Equal(t, "out of balance", openAI.Message)

	claude := refused.ToClaudeError()
	assert.Equal(t, "billing_error", claude.Type)
	assert.Equal(t, "out of balance", claude.Message)

	gate := NewErrorWithStatusCode(errors.New("plan paused"), ErrorCodeInsufficientUserQuota, http.StatusForbidden)
	assert.Equal(t, OpenAIError{Message: "plan paused", Type: "new_api_error", Code: ErrorCodeInsufficientUserQuota}, gate.ToOpenAIError())
	assert.Equal(t, "new_api_error", gate.ToClaudeError().Type)

	keyLimit := NewErrorWithStatusCode(errors.New("token quota"), ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden)
	assert.Equal(t, ErrorCodePreConsumeTokenQuotaFailed, keyLimit.ToOpenAIError().Code)

	upstream := WithOpenAIError(OpenAIError{Message: "no credit", Type: "billing_hard_limit_reached", Code: "billing_hard_limit_reached"}, http.StatusPaymentRequired)
	assert.Equal(t, "billing_hard_limit_reached", upstream.ToOpenAIError().Type)
}
