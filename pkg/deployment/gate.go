// Package deployment controls admission while an instance waits for handlers to finish.
//
// A release that runs the new version beside the old one cordons the old
// instance: it keeps serving every request that reaches it, but its readiness
// check fails, so the proxy sends new requests to the other instance. Draining
// then rejects whatever still arrives, and the active count shows when the
// admitted requests have finished.
package deployment

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
)

const (
	controlPath = "/_internal/deployment"
	// readyPath is polled by the proxy, which reaches the instance from another
	// container, so it answers any peer. It reports readiness only; every state
	// change stays loopback-only. The public proxy refuses the whole prefix.
	readyPath = controlPath + "/ready"
)

// Gate wraps the entire HTTP handler, including its deferred cleanup. It must be
// installed outside normal middleware and must not be copied after first use.
type Gate struct {
	// BodyDrainLimit caps how much of an unread request body is read before a
	// response goes out (see bodyDrainingWriter); 0 means defaultBodyDrainLimit.
	// Set it before the first request.
	BodyDrainLimit int64

	next     http.Handler
	mu       sync.Mutex
	cordoned bool
	draining bool
	terminal bool
	active   int
}

func New(next http.Handler) *Gate {
	return &Gate{next: next}
}

// BeginShutdown permanently closes admission without canceling admitted requests.
// A deployment resume cannot reopen admission after process shutdown begins.
func (g *Gate) BeginShutdown() {
	g.mu.Lock()
	g.terminal = true
	g.draining = true
	g.mu.Unlock()
}

func (g *Gate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == readyPath {
		g.serveReady(w, r)
		return
	}
	if r.URL.Path == controlPath || strings.HasPrefix(r.URL.Path, controlPath+"/") {
		g.serveControl(w, r)
		return
	}
	limit := g.BodyDrainLimit
	if limit <= 0 {
		limit = defaultBodyDrainLimit
	}
	w = &bodyDrainingWriter{ResponseWriter: w, body: r.Body, limit: limit}
	if r.Method == http.MethodGet && r.URL.Path == "/api/status" {
		g.next.ServeHTTP(w, r)
		return
	}

	// Admission and drain share a lock: zero while draining proves that no
	// admitted handler (including deferred cleanup) is still running.
	g.mu.Lock()
	if g.draining {
		g.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Retry-After", "5")
		w.WriteHeader(http.StatusServiceUnavailable)
		_, _ = io.WriteString(w, `{"error":{"type":"deployment_draining","message":"Service is draining for deployment; retry shortly."}}`+"\n")
		return
	}
	g.active++
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		g.active--
		g.mu.Unlock()
	}()

	// bodyDrainingWriter keeps the original writer's Flusher, Hijacker and
	// other interfaces.
	g.next.ServeHTTP(w, r)
}

func (g *Gate) serveReady(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	g.mu.Lock()
	ready := !g.cordoned && !g.draining
	g.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if !ready {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	_, _ = fmt.Fprintf(w, "{\"ready\":%t}\n", ready)
}

func (g *Gate) serveControl(w http.ResponseWriter, r *http.Request) {
	// Never use Gin's ClientIP or forwarded headers for deployment authority.
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil || !net.ParseIP(host).IsLoopback() {
		http.NotFound(w, r)
		return
	}

	var method string
	switch r.URL.Path {
	case controlPath:
		method = http.MethodGet
	case controlPath + "/drain", controlPath + "/resume", controlPath + "/cordon", controlPath + "/uncordon":
		method = http.MethodPost
	default:
		http.NotFound(w, r)
		return
	}
	if r.Method != method {
		w.Header().Set("Allow", method)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	g.mu.Lock()
	switch r.URL.Path {
	case controlPath + "/drain":
		g.draining = true
	case controlPath + "/resume":
		if !g.terminal {
			g.draining = false
		}
	case controlPath + "/cordon":
		g.cordoned = true
	case controlPath + "/uncordon":
		g.cordoned = false
	}
	cordoned, draining, active := g.cordoned, g.draining, g.active
	g.mu.Unlock()

	// Mutations do not wait for handlers or depend on the caller's context.
	// A canceled deployment can inspect state and resume with a fresh request.
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = fmt.Fprintf(w, "{\"cordoned\":%t,\"draining\":%t,\"active\":%d}\n", cordoned, draining, active)
}
