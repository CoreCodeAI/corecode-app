package service

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// Claude Code replays a message thread only when a 404 carries the
// thread_not_found code; a bare 404 reads to it as a missing model.
func TestRelayErrorHandlerForwardsClaudeThreadCode(t *testing.T) {
	for _, test := range []struct {
		name, details, want string
	}{
		{name: "thread code", details: `,"details":{"error_code":"thread_not_found"}`, want: "thread_not_found"},
		{name: "other code", details: `,"details":{"error_code":"rate_limited"}`},
		{name: "no details"},
	} {
		t.Run(test.name, func(t *testing.T) {
			body := `{"type":"error","error":{"type":"not_found_error","message":"No thread state was found"` + test.details + `}}`
			resp := &http.Response{StatusCode: http.StatusNotFound, Body: io.NopCloser(strings.NewReader(body))}

			out, err := json.Marshal(RelayErrorHandler(context.Background(), resp, false).ToClaudeError())
			require.NoError(t, err)

			var payload struct {
				Message string `json:"message"`
				Details *struct {
					ErrorCode string `json:"error_code"`
				} `json:"details"`
			}
			require.NoError(t, json.Unmarshal(out, &payload))
			require.Equal(t, "No thread state was found", payload.Message)
			got := ""
			if payload.Details != nil {
				got = payload.Details.ErrorCode
			}
			require.Equal(t, test.want, got, string(out))
		})
	}
}
