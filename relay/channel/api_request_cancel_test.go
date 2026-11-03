package channel

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestUpstreamRequestStopsWhenClientDisconnects(t *testing.T) {
	service.InitHttpClient()
	gin.SetMode(gin.TestMode)

	upstreamCanceled := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The server watches for a closed connection only once the body is read.
		_, _ = io.ReadAll(r.Body)
		select {
		case <-r.Context().Done():
			close(upstreamCanceled)
		case <-time.After(10 * time.Second):
			w.WriteHeader(http.StatusOK)
		}
	}))
	defer upstream.Close()

	clientCtx, disconnect := context.WithCancel(context.Background())
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil).WithContext(clientCtx)

	req, err := newUpstreamRequest(c, upstream.URL, strings.NewReader(`{"stream":false}`))
	require.NoError(t, err)
	time.AfterFunc(50*time.Millisecond, disconnect)

	_, err = doRequest(c, req, &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{}})
	require.Error(t, err)
	var apiErr *types.NewAPIError
	require.ErrorAs(t, err, &apiErr)
	require.True(t, types.IsSkipRetryError(apiErr), "a disconnected client must not trigger a retry")
	require.False(t, types.IsRecordErrorLog(apiErr), "a disconnected client is not a channel error")
	select {
	case <-upstreamCanceled:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream request kept running after the client disconnected")
	}
}
