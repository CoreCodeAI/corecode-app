package middleware

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"

	"github.com/gin-gonic/gin"
	"golang.org/x/sync/semaphore"
)

const (
	// largeRequestBodyBytes is the size from which a body takes a share of
	// the budget. Screenshot turns stay below it; on 2026-11-21 Codex sent
	// 94 MB bodies, and four or five of those at once pushed the heap into
	// the overload guard, which then rejected every user's requests.
	largeRequestBodyBytes = 16 << 20
	// largeRequestBodyBudgetDivisor sets the budget to 1/8 of the container's
	// memory limit, 320 MiB at 2560 MiB. A body is held about three times
	// while its response streams (the raw body, the decoded request and the
	// outbound body), so a full budget is about 1 GiB of heap and leaves the
	// rest of the traffic below GOMEMLIMIT, which corecode-infra sets at 70%.
	largeRequestBodyBudgetDivisor = 8
	// largeRequestBodyMaxWait bounds how long a large body waits for room.
	largeRequestBodyMaxWait = 60 * time.Second
	// contextKeyRequestBodyDecompressed marks a body DecompressRequestMiddleware
	// unpacks, whose Content-Length is the size on the wire, not in memory.
	contextKeyRequestBodyDecompressed = "request_body_decompressed"
)

// largeRequestBodyGate admits large request bodies only while the bytes held
// by admitted ones fit its budget. A body's share is its size; the share is
// held until the handler returns, after a streamed response ends.
type largeRequestBodyGate struct {
	budget  int64
	maxWait time.Duration
	held    *semaphore.Weighted
}

func newLargeRequestBodyGate(budget int64, maxWait time.Duration) *largeRequestBodyGate {
	return &largeRequestBodyGate{budget: budget, maxWait: maxWait, held: semaphore.NewWeighted(budget)}
}

var processLargeRequestBodyGate = sync.OnceValue(func() *largeRequestBodyGate {
	limit, ok := common.ContainerMemoryLimitBytes()
	if !ok {
		common.SysLog(common.LogText("large request body gate off: no container memory limit"))
		return nil
	}
	budget := int64(limit / largeRequestBodyBudgetDivisor)
	common.SysLog(common.LogText("large request body gate: %d MiB budget for bodies from %d MiB",
		budget>>20, largeRequestBodyBytes>>20))
	return newLargeRequestBodyGate(budget, largeRequestBodyMaxWait)
})

// LargeRequestBodyLimit queues a request whose body is at least 16 MiB until
// the large bodies already admitted leave room for it, and answers 503 after
// a minute. It must run before anything reads the body. Without a container
// memory limit it admits everything.
func LargeRequestBodyLimit() gin.HandlerFunc {
	return processLargeRequestBodyGate().admit
}

func (g *largeRequestBodyGate) admit(c *gin.Context) {
	if g == nil || c.Request.Body == nil || c.Request.Body == http.NoBody {
		c.Next()
		return
	}
	size := c.Request.ContentLength
	if size < 0 || c.GetBool(contextKeyRequestBodyDecompressed) {
		// The size in memory is unknown until the body is read, so read it
		// first. Its later copies still wait for room.
		storage, err := common.GetBodyStorage(c)
		if err != nil {
			// The handler that reads the body reports the error.
			c.Next()
			return
		}
		size = storage.Size()
	}
	if size < largeRequestBodyBytes {
		c.Next()
		return
	}
	// A single body may exceed the budget; it then waits to run alone.
	share := min(size, g.budget)

	started := time.Now()
	ctx, cancel := context.WithTimeout(c.Request.Context(), g.maxWait)
	err := g.held.Acquire(ctx, share)
	cancel()
	waited := time.Since(started)
	if err != nil {
		if c.Request.Context().Err() != nil {
			// The client left while waiting; there is no one to answer.
			c.Abort()
			return
		}
		c.Header("Retry-After", strconv.Itoa(int(g.maxWait/time.Second)))
		abortWithOpenAiMessage(c, http.StatusServiceUnavailable,
			i18n.T(c, i18n.MsgLargeRequestBodyBusy, map[string]any{"SizeMB": size >> 20}))
		return
	}
	defer g.held.Release(share)
	c.Set(common.KeyRequestBodyQueueMs, waited.Milliseconds())
	if waited >= time.Second {
		logger.LogInfo(c.Request.Context(), common.LogText("request body of %d MiB waited %d ms for room among large bodies",
			size>>20, waited.Milliseconds()))
	}
	c.Next()
}
