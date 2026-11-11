package service

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The headers an image upstream sent on 2026-11-11. Its Access-Control-Allow-Origin
// named its own canvas site and replaced the relay's "*", so the browser on
// canvas.corecode.live could not read a 200 the user had paid for.
func upstreamImageResponse() *http.Response {
	header := http.Header{}
	header.Set("Content-Type", "application/json; charset=utf-8")
	header.Set("Content-Length", "143")
	header.Set("X-Request-Id", "0741d72a")
	header.Set("Access-Control-Allow-Origin", "https://canvas.upstream.example")
	header.Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	header.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	header.Set("Set-Cookie", "server_session=abc; Max-Age=864000; HttpOnly; path=/; Secure")
	header.Set("NEL", `{"report_to":"cf-nel","max_age":604800}`)
	header.Set("Report-To", `{"group":"cf-nel","endpoints":[{"url":"https://a.nel.cloudflare.com/report/v4"}]}`)
	header.Set("Alt-Svc", `h3=":443"; ma=86400`)
	header.Set("Cf-Ray", "a58b2a88584581a1-SIN")
	header.Set("Cf-Cache-Status", "DYNAMIC")
	return &http.Response{StatusCode: http.StatusOK, Header: header}
}

func TestIOCopyBytesGracefullyKeepsTheRelaysCORSAndDropsTheUpstreamHost(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	// What the CORS middleware set before the handler ran.
	c.Writer.Header().Set("Access-Control-Allow-Origin", "*")

	body := []byte(`{"data":[{"url":"https://example.com/a.png"}]}`)
	IOCopyBytesGracefully(c, upstreamImageResponse(), body)

	got := recorder.Result().Header
	require.Equal(t, http.StatusOK, recorder.Code)
	assert.Equal(t, "*", got.Get("Access-Control-Allow-Origin"))
	for _, name := range []string{"Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Set-Cookie", "NEL", "Report-To", "Alt-Svc", "Cf-Ray", "Cf-Cache-Status"} {
		assert.Empty(t, got.Values(name), name)
	}
	assert.Equal(t, "application/json; charset=utf-8", got.Get("Content-Type"))
	assert.Equal(t, "0741d72a", got.Get("X-Request-Id"))
	assert.Equal(t, strconv.Itoa(len(body)), got.Get("Content-Length"))
	assert.Equal(t, string(body), recorder.Body.String())
}

func TestShouldCopyUpstreamHeaderMatchesNamesInAnyCase(t *testing.T) {
	for _, name := range []string{"access-control-allow-origin", "ACCESS-CONTROL-EXPOSE-HEADERS", "set-cookie", "nel", "report-to", "alt-svc", "cf-ray", "CF-Connecting-IP"} {
		assert.False(t, ShouldCopyUpstreamHeader(nil, name, []string{"x"}), name)
	}
	for _, name := range []string{"Content-Type", "Cache-Control", "X-Ratelimit-Remaining-Requests", "Openai-Processing-Ms", "Access-Control"} {
		assert.True(t, ShouldCopyUpstreamHeader(nil, name, []string{"x"}), name)
	}
}
