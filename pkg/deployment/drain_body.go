package deployment

import (
	"bufio"
	"io"
	"net"
	"net/http"
)

// defaultBodyDrainLimit caps how much of an unread request body is read before
// a response, when Gate.BodyDrainLimit is not set.
const defaultBodyDrainLimit = 128 << 20

// bodyDrainingWriter reads what is left of the request body before the first
// byte of the response goes out.
//
// A handler that answers before reading the body, such as the drain 503, an
// authentication failure or a rate limit, leaves the rest of the body on the
// connection. The relay's Caddy then keeps its keep-alive connection from the
// regional edge open with those bytes unread, and parses them as the next
// request on that connection: a body with no newline in its first megabyte
// becomes 431 Request Header Fields Too Large for an unrelated request, a
// larger one a reset connection. Reading the body first lets the proxy forward
// all of it, so the connection stays in step.
//
// A body larger than the limit is not read to the end; the response then
// closes the connection instead.
type bodyDrainingWriter struct {
	http.ResponseWriter
	body    io.ReadCloser
	limit   int64
	drained bool
}

func (w *bodyDrainingWriter) drain() {
	if w.drained {
		return
	}
	w.drained = true
	if w.body == nil || w.body == http.NoBody {
		return
	}
	// A body the handler already read or closed returns at once.
	if n, _ := io.CopyN(io.Discard, w.body, w.limit+1); n > w.limit {
		w.ResponseWriter.Header().Set("Connection", "close")
	}
}

func (w *bodyDrainingWriter) WriteHeader(statusCode int) {
	w.drain()
	w.ResponseWriter.WriteHeader(statusCode)
}

func (w *bodyDrainingWriter) Write(data []byte) (int, error) {
	w.drain()
	return w.ResponseWriter.Write(data)
}

// ReadFrom keeps the sendfile path of static files served through io.Copy.
func (w *bodyDrainingWriter) ReadFrom(src io.Reader) (int64, error) {
	w.drain()
	if readerFrom, ok := w.ResponseWriter.(io.ReaderFrom); ok {
		return readerFrom.ReadFrom(src)
	}
	return io.Copy(struct{ io.Writer }{w.ResponseWriter}, src)
}

// Flush, Hijack and CloseNotify keep the interfaces that Gin asserts on the
// writer it wraps: SSE flushes each event, and WebSocket upgrades hijack.

func (w *bodyDrainingWriter) Flush() {
	w.drain()
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *bodyDrainingWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	// The connection now belongs to the handler, body and all.
	w.drained = true
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func (w *bodyDrainingWriter) CloseNotify() <-chan bool {
	//nolint:staticcheck // Gin's CloseNotify asserts this deprecated interface.
	if notifier, ok := w.ResponseWriter.(http.CloseNotifier); ok {
		return notifier.CloseNotify()
	}
	return make(chan bool)
}

// Unwrap lets http.ResponseController reach the server's writer.
func (w *bodyDrainingWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}
