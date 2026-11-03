package middleware

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/internal/claudebody"

	"github.com/gin-gonic/gin"
)

func benchRelayContext(body []byte) *gin.Context {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	req := httptest.NewRequest(http.MethodPost, "/v1/messages", io.NopCloser(bytes.NewReader(body)))
	req.ContentLength = int64(len(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "claude-cli/2.1.301 (external, cli)")
	req.Header.Set("X-App", "cli")
	req.Header.Set("anthropic-beta", "claude-code-20250219")
	req.Header.Set("anthropic-version", "2023-06-01")
	c.Request = req
	return c
}

// BenchmarkRelayBodyChecks measures the body reads that run before the relay
// handler on a Claude Code request: the Claude Code client check of a
// restricted group (clientCheck, detectClaudeCodeClient) and the model lookup
// in Distribute (getModelFromJSONBody).
func BenchmarkRelayBodyChecks(b *testing.B) {
	gin.SetMode(gin.TestMode)
	checks := map[string]func(c *gin.Context){
		"client_check":     func(c *gin.Context) { clientCheck(c) },
		"detect_client":    func(c *gin.Context) { detectClaudeCodeClient(c) },
		"distribute_model": func(c *gin.Context) { _, _ = getModelFromJSONBody(c) },
	}
	for _, size := range []int{500_000, 4_000_000, 12_000_000, 25_000_000} {
		body := claudebody.Claude(claudebody.Options{TargetBytes: size})
		for name, check := range checks {
			b.Run(fmt.Sprintf("%.1fMB/%s", float64(len(body))/1e6, name), func(b *testing.B) {
				b.ReportAllocs()
				for range b.N {
					c := benchRelayContext(body)
					check(c)
				}
			})
		}
	}
}
