package service

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/internal/claudebody"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// TestReadRiskGateRequestIgnoresPayloads checks that reading the slim body
// recognizes the client and the request shape exactly as the full body does.
func TestReadRiskGateRequestIgnoresPayloads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	payload := strings.Repeat("QUJD", 2000)
	bodies := map[string][]byte{
		"claude code session": claudebody.Claude(claudebody.Options{TargetBytes: 800_000}),
		"bare image request":  []byte(`{"model":"claude-x","messages":[{"role":"user","content":[{"type":"image","source":{"type":"base64","data":"` + payload + `"}}]}]}`),
		"tools object":        []byte(`{"model":"claude-x","tools":{"name":"x"},"messages":[{"role":"user","content":"hi"}]}`),
		"null tools":          []byte(`{"model":"claude-x","tools":null,"messages":[{"role":"user","content":"hi"}]}`),
		"responses input":     []byte(`{"model":"gpt-x","input":[{"type":"input_image","image_url":"data:image/png;base64,` + payload + `"}]}`),
		"string input":        []byte(`{"model":"gpt-x","input":"hi","tools":[]}`),
	}
	for name, raw := range bodies {
		t.Run(name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", io.NopCloser(bytes.NewReader(raw)))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("User-Agent", "claude-cli/2.1.301 (external, cli)")
			c.Request.Header.Set("anthropic-beta", "claude-code-20250219")
			got, err := readRiskGateRequest(c, "")
			require.NoError(t, err)

			full := gjson.ParseBytes(raw)
			turns := 0
			full.Get("messages").ForEach(func(_, message gjson.Result) bool {
				if role := message.Get("role").String(); role != "system" && role != "developer" {
					turns++
				}
				return true
			})
			if input := full.Get("input"); input.IsArray() {
				turns += len(input.Array())
			} else if input.Exists() {
				turns++
			}
			assert.Equal(t, riskGateOfficialClient(c.Request.Header, full, true), got.official)
			assert.Equal(t, turns == 1 && len(full.Get("tools").Array()) == 0, got.bare)
			assert.Less(t, len(got.body.Raw), len(raw)+1)
		})
	}
}
