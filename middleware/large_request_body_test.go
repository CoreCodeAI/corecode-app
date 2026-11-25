package middleware

import (
	"bytes"
	"compress/gzip"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// largeBodyServer runs gate in front of a handler that reports each admitted
// request on admitted and holds it until release is closed or receives.
func largeBodyServer(t *testing.T, gate *largeRequestBodyGate, admitted chan<- int64, release <-chan struct{}) *gin.Engine {
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(DecompressRequestMiddleware(), gate.admit)
	engine.POST("/v1/responses", func(c *gin.Context) {
		waited, _ := c.Get(common.KeyRequestBodyQueueMs)
		ms, _ := waited.(int64)
		admitted <- ms
		<-release
		c.Status(http.StatusOK)
	})
	return engine
}

func largeBodyRequest(ctx context.Context, size int) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(make([]byte, size)))
	req.Header.Set("Content-Type", "application/json")
	return req.WithContext(ctx)
}

func serveAsync(engine *gin.Engine, req *http.Request) <-chan *httptest.ResponseRecorder {
	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, req)
		done <- recorder
	}()
	return done
}

func requireAdmitted(t *testing.T, admitted <-chan int64) int64 {
	t.Helper()
	select {
	case ms := <-admitted:
		return ms
	case <-time.After(5 * time.Second):
		t.Fatal("request was not admitted")
		return 0
	}
}

func requireNotAdmitted(t *testing.T, admitted <-chan int64) {
	t.Helper()
	select {
	case <-admitted:
		t.Fatal("request was admitted while the budget was full")
	case <-time.After(200 * time.Millisecond):
	}
}

// requireQueued waits until a request is queued on the gate. The semaphore
// admits in order, so taking one byte fails while a request waits even with
// room left. A wait measured before this can start before the request reaches
// the gate on a loaded machine.
func requireQueued(t *testing.T, gate *largeRequestBodyGate) {
	t.Helper()
	require.Eventually(t, func() bool {
		if gate.held.TryAcquire(1) {
			gate.held.Release(1)
			return false
		}
		return true
	}, 5*time.Second, time.Millisecond, "request was not queued")
}

func TestLargeBodyWaitsUntilAnEarlierOneFinishes(t *testing.T) {
	gate := newLargeRequestBodyGate(40<<20, 5*time.Second)
	admitted := make(chan int64, 4)
	release := make(chan struct{})
	engine := largeBodyServer(t, gate, admitted, release)

	first := serveAsync(engine, largeBodyRequest(context.Background(), 24<<20))
	requireAdmitted(t, admitted)

	// 24 + 24 MiB exceeds the 40 MiB budget, so the second waits.
	second := serveAsync(engine, largeBodyRequest(context.Background(), 24<<20))
	requireQueued(t, gate)
	requireNotAdmitted(t, admitted)

	release <- struct{}{}
	require.Equal(t, http.StatusOK, (<-first).Code)
	waited := requireAdmitted(t, admitted)
	require.GreaterOrEqual(t, waited, int64(200), "the wait is recorded for the request log")
	close(release)
	require.Equal(t, http.StatusOK, (<-second).Code)
}

func TestBodiesBelowTheThresholdTakeNoShare(t *testing.T) {
	gate := newLargeRequestBodyGate(40<<20, 5*time.Second)
	admitted := make(chan int64, 4)
	release := make(chan struct{})
	engine := largeBodyServer(t, gate, admitted, release)

	held := serveAsync(engine, largeBodyRequest(context.Background(), 40<<20))
	requireAdmitted(t, admitted)

	// The budget is full, yet a 15 MiB body is admitted at once.
	small := serveAsync(engine, largeBodyRequest(context.Background(), 15<<20))
	requireAdmitted(t, admitted)
	close(release)
	require.Equal(t, http.StatusOK, (<-held).Code)
	require.Equal(t, http.StatusOK, (<-small).Code)
}

func TestLargeBodyGets503AfterTheMaxWait(t *testing.T) {
	gate := newLargeRequestBodyGate(40<<20, 300*time.Millisecond)
	admitted := make(chan int64, 4)
	release := make(chan struct{})
	engine := largeBodyServer(t, gate, admitted, release)

	held := serveAsync(engine, largeBodyRequest(context.Background(), 30<<20))
	requireAdmitted(t, admitted)

	recorder := <-serveAsync(engine, largeBodyRequest(context.Background(), 30<<20))
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	require.NotEmpty(t, recorder.Header().Get("Retry-After"))
	require.Contains(t, recorder.Body.String(), "30 MB")
	requireNotAdmitted(t, admitted)

	close(release)
	require.Equal(t, http.StatusOK, (<-held).Code)
}

func TestCompressedBodyIsMeasuredAfterDecompression(t *testing.T) {
	gate := newLargeRequestBodyGate(40<<20, 300*time.Millisecond)
	admitted := make(chan int64, 4)
	release := make(chan struct{})
	engine := largeBodyServer(t, gate, admitted, release)

	held := serveAsync(engine, largeBodyRequest(context.Background(), 30<<20))
	requireAdmitted(t, admitted)

	// 30 MiB of zeros is a few KiB on the wire; its Content-Length alone
	// would let it past the gate.
	var wire bytes.Buffer
	writer := gzip.NewWriter(&wire)
	_, err := writer.Write(make([]byte, 30<<20))
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	require.Less(t, wire.Len(), largeRequestBodyBytes)
	req := httptest.NewRequest(http.MethodPost, "/v1/responses", bytes.NewReader(wire.Bytes()))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Encoding", "gzip")

	recorder := <-serveAsync(engine, req)
	require.Equal(t, http.StatusServiceUnavailable, recorder.Code)
	requireNotAdmitted(t, admitted)

	close(release)
	require.Equal(t, http.StatusOK, (<-held).Code)
}

func TestBodyLargerThanTheBudgetRunsAlone(t *testing.T) {
	gate := newLargeRequestBodyGate(40<<20, 5*time.Second)
	admitted := make(chan int64, 4)
	release := make(chan struct{})
	engine := largeBodyServer(t, gate, admitted, release)

	huge := serveAsync(engine, largeBodyRequest(context.Background(), 64<<20))
	requireAdmitted(t, admitted)
	other := serveAsync(engine, largeBodyRequest(context.Background(), 16<<20))
	requireNotAdmitted(t, admitted)

	release <- struct{}{}
	require.Equal(t, http.StatusOK, (<-huge).Code)
	requireAdmitted(t, admitted)
	close(release)
	require.Equal(t, http.StatusOK, (<-other).Code)
}

func TestClientLeavingWhileQueuedReleasesNothing(t *testing.T) {
	gate := newLargeRequestBodyGate(40<<20, 5*time.Second)
	admitted := make(chan int64, 4)
	release := make(chan struct{})
	engine := largeBodyServer(t, gate, admitted, release)

	held := serveAsync(engine, largeBodyRequest(context.Background(), 30<<20))
	requireAdmitted(t, admitted)

	ctx, cancel := context.WithCancel(context.Background())
	left := serveAsync(engine, largeBodyRequest(ctx, 30<<20))
	requireNotAdmitted(t, admitted)
	cancel()
	<-left
	requireNotAdmitted(t, admitted)

	close(release)
	require.Equal(t, http.StatusOK, (<-held).Code)
	// The whole budget is free again.
	require.True(t, gate.held.TryAcquire(40<<20))
}
