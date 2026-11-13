package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// The hint reaches the customer in both formats, and no other 400 gains it.
func TestRelayErrorHandlerHintsInvalidThinkingSignature(t *testing.T) {
	const rejected = "Claude upstream request failed with status 400: messages.17.content.0: Invalid `signature` in `thinking` block"
	for _, test := range []struct {
		name, body string
		hinted     bool
	}{
		{name: "thinking", body: `{"type":"error","error":{"type":"invalid_request_error","message":"` + rejected + `"}}`, hinted: true},
		{name: "redacted thinking", body: `{"type":"error","error":{"type":"invalid_request_error","message":"messages.3.content.0: Invalid ` + "`signature`" + ` in ` + "`redacted_thinking`" + ` block"}}`, hinted: true},
		{name: "plain message", body: `{"error":"` + rejected + `"}`, hinted: true},
		{name: "other 400", body: `{"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be at least 1"}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			resp := &http.Response{StatusCode: http.StatusBadRequest, Body: io.NopCloser(strings.NewReader(test.body))}
			apiErr := RelayErrorHandler(context.Background(), resp, false)
			for _, message := range []string{apiErr.ToClaudeError().Message, apiErr.ToOpenAIError().Message} {
				require.Equal(t, test.hinted, strings.Contains(message, thinkingSignatureHint), message)
				require.LessOrEqual(t, strings.Count(message, thinkingSignatureHint), 1, message)
			}
		})
	}
}

func TestWithThinkingSignatureHintAppendsOnce(t *testing.T) {
	message := withThinkingSignatureHint("messages.1.content.0: Invalid `signature` in `thinking` block")
	require.Equal(t, message, withThinkingSignatureHint(message))
}
