package service

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
)

func CloseResponseBodyGracefully(httpResponse *http.Response) {
	if httpResponse == nil || httpResponse.Body == nil {
		return
	}
	err := httpResponse.Body.Close()
	if err != nil {
		common.SysError(common.LogText("failed to close response body: %s", err.Error()))
	}
}

// upstreamHostHeaders describe the upstream's own host, not the API response:
// its cookies, its browser reporting endpoints and its transport. A client must
// see the relay's, so none of them is copied. Neither is any Access-Control-*
// header (see isUpstreamHostHeader).
var upstreamHostHeaders = []string{"Set-Cookie", "Alt-Svc", "NEL", "Report-To"}

// isUpstreamHostHeader reports whether k belongs to the upstream's host rather
// than to the response. CORS is the relay's own policy: an upstream that
// answers Access-Control-Allow-Origin with its own site would replace the
// relay's "*", and a browser app on any other origin could not read a response
// the user was already charged for. Cf-* headers are the upstream CDN's
// identifiers. Copying either would also name the upstream to every client.
func isUpstreamHostHeader(k string) bool {
	for _, prefix := range []string{"Access-Control-", "Cf-"} {
		if len(k) >= len(prefix) && strings.EqualFold(k[:len(prefix)], prefix) {
			return true
		}
	}
	return slices.ContainsFunc(upstreamHostHeaders, func(name string) bool { return strings.EqualFold(name, k) })
}

// ShouldCopyUpstreamHeader checks whether a given upstream response header
// should be copied to the client response. It returns false for Content-Length
// (managed separately), X-Oneapi-Request-Id (to preserve the local instance
// ID) and the upstream host's own headers (isUpstreamHostHeader). The upstream
// request IDs (X-Oneapi-Request-Id and X-GPTLoad-Request-ID) are captured into
// the Gin context for later logging.
func ShouldCopyUpstreamHeader(c *gin.Context, k string, v []string) bool {
	if strings.EqualFold(k, "Content-Length") || isUpstreamHostHeader(k) {
		return false
	}
	if strings.EqualFold(k, common.RequestIdKey) {
		if c != nil && len(v) > 0 {
			c.Set(common.UpstreamRequestIdKey, v[0])
		}
		return false
	}
	if strings.EqualFold(k, common.GPTLoadRequestIdKey) {
		if c != nil && len(v) > 0 {
			c.Set(common.UpstreamGPTLoadRequestIdKey, v[0])
		}
	}
	return true
}

func IOCopyBytesGracefully(c *gin.Context, src *http.Response, data []byte) {
	if c.Writer == nil {
		return
	}

	body := io.NopCloser(bytes.NewBuffer(data))

	// We shouldn't set the header before we parse the response body, because the parse part may fail.
	// And then we will have to send an error response, but in this case, the header has already been set.
	// So the httpClient will be confused by the response.
	// For example, Postman will report error, and we cannot check the response at all.
	if src != nil {
		for k, v := range src.Header {
			if !ShouldCopyUpstreamHeader(c, k, v) {
				continue
			}
			c.Writer.Header().Set(k, v[0])
		}
	}

	// set Content-Length header manually BEFORE calling WriteHeader
	c.Writer.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))

	// Write header with status code (this sends the headers)
	if src != nil {
		c.Writer.WriteHeader(src.StatusCode)
	} else {
		c.Writer.WriteHeader(http.StatusOK)
	}

	_, err := io.Copy(c.Writer, body)
	if err != nil {
		logger.LogError(c, common.LogText("failed to copy response body: %s", err.Error()))
	}
	c.Writer.Flush()
}
