// Package sessioncapture copies the client's request bytes and each upstream
// attempt's response bytes for internal audit, then compresses, uploads and
// publishes them off the request path. The request path only copies and
// enqueues without waiting; a budget, upload or publish failure is counted and
// the capture dropped, never surfaced to the request. It publishes the v1
// envelope the engine's ingest accepts, with producer "new-api".
package sessioncapture

import (
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

// capturedRequestHeaders is an allowlist: a header added later, such as a new
// credential header, never enters the capture until it is named here.
var capturedRequestHeaders = []string{
	"user-agent",
	"content-type",
	"openai-beta",
	"originator",
	"session_id",
}

// requestIDPattern is the ingest's request id rule. An id outside it would
// have the whole event rejected, so such a request is not captured.
var requestIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,128}$`)

// ValidRequestID reports whether id is one the ingest accepts.
func ValidRequestID(id string) bool {
	return requestIDPattern.MatchString(id)
}

const (
	requestContextKey = "session_capture_request"
	attemptContextKey = "session_capture_attempt"
)

var installed atomic.Pointer[Pipeline]

// Install makes pipeline the process-wide capture pipeline; nil disables
// capture. A relay reads the installed pipeline once per request.
func Install(pipeline *Pipeline) {
	installed.Store(pipeline)
}

// Current returns the installed pipeline, or nil when capture is off.
func Current() *Pipeline {
	return installed.Load()
}

// Shutdown detaches the installed pipeline and drains it for up to timeout.
func Shutdown(timeout time.Duration) {
	if pipeline := installed.Swap(nil); pipeline != nil {
		pipeline.Close(timeout)
	}
}

type budget struct {
	limit int64
	used  atomic.Int64
}

func (budget *budget) charge(size int64) bool {
	for {
		used := budget.used.Load()
		if used+size > budget.limit {
			return false
		}
		if budget.used.CompareAndSwap(used, used+size) {
			return true
		}
	}
}

func (budget *budget) release(size int64) {
	budget.used.Add(-size)
}

// Request holds one client request's capture from the moment its body is
// copied until a worker has uploaded it. Its bytes count against the
// pipeline's budget for that whole span, including while a response is still
// streaming.
type Request struct {
	pipeline  *Pipeline
	requestID string

	mu       sync.Mutex
	done     bool
	charged  int64
	attempts []*Attempt
}

// Attempt collects one upstream attempt's metadata and response bytes.
type Attempt struct {
	request *Request

	sequence          int
	channelID         int
	upstreamProtocol  string
	upstreamModel     string
	upstreamRequestID string
	status            int
	failureCategory   string
	responseStarted   bool
	observed          bool
	encoding          string
	body              []byte
}

// Completion is what the relay settled for the client request.
type Completion struct {
	RequestID   string
	Protocol    string
	Model       string
	Status      int
	Stream      bool
	DurationMs  int64
	Usage       Usage
	CompletedAt time.Time
}

// Begin starts a capture for a request whose id is requestID. It returns nil
// when the pipeline is nil; every Request method accepts a nil receiver.
func (pipeline *Pipeline) Begin(requestID string) *Request {
	if pipeline == nil {
		return nil
	}
	return &Request{pipeline: pipeline, requestID: requestID}
}

// StartAttempt opens the next upstream attempt. It returns nil once the
// capture completed or dropped.
func (request *Request) StartAttempt(channelID int, upstreamProtocol string) *Attempt {
	if request == nil {
		return nil
	}
	request.mu.Lock()
	defer request.mu.Unlock()
	if request.done {
		return nil
	}
	attempt := &Attempt{
		request:          request,
		sequence:         len(request.attempts) + 1,
		channelID:        channelID,
		upstreamProtocol: upstreamProtocol,
	}
	request.attempts = append(request.attempts, attempt)
	return attempt
}

// End records what the attempt returned: the upstream model it used, the
// status the client got, and "ok" or the error code. The status the upstream
// answered is kept when the tap saw a response.
func (attempt *Attempt) End(upstreamModel string, status int, failureCategory string) {
	if attempt == nil {
		return
	}
	request := attempt.request
	request.mu.Lock()
	defer request.mu.Unlock()
	if request.done {
		return
	}
	if upstreamModel != "" {
		attempt.upstreamModel = upstreamModel
	}
	if attempt.status == 0 {
		attempt.status = status
	}
	attempt.failureCategory = failureCategory
}

// Tap records the upstream response on the attempt the relay opened and wraps
// resp.Body so the bytes the handler reads are copied too. It does nothing
// without an open attempt or a response.
func Tap(c *gin.Context, resp *http.Response) {
	attempt := AttemptFrom(c)
	if attempt == nil || resp == nil || resp.Body == nil {
		return
	}
	attempt.tap(resp)
}

func (attempt *Attempt) tap(resp *http.Response) {
	request := attempt.request
	request.mu.Lock()
	if request.done {
		request.mu.Unlock()
		return
	}
	attempt.status = resp.StatusCode
	attempt.responseStarted = true
	attempt.observed = true
	if attempt.encoding == "" {
		attempt.encoding = resp.Header.Get("Content-Encoding")
	}
	if id := resp.Header.Get(common.RequestIdKey); id != "" {
		attempt.upstreamRequestID = id
	} else if id := resp.Header.Get(common.GPTLoadRequestIdKey); id != "" {
		attempt.upstreamRequestID = id
	}
	request.mu.Unlock()
	resp.Body = &teeBody{ReadCloser: resp.Body, attempt: attempt}
}

type teeBody struct {
	io.ReadCloser
	attempt *Attempt
}

func (body *teeBody) Read(buffer []byte) (int, error) {
	read, err := body.ReadCloser.Read(buffer)
	if read > 0 {
		body.attempt.append(buffer[:read])
	}
	return read, err
}

func (attempt *Attempt) append(data []byte) {
	request := attempt.request
	request.mu.Lock()
	defer request.mu.Unlock()
	if request.done {
		return
	}
	size := int64(len(data))
	if request.charged+size > request.pipeline.maxRequestBytes {
		request.pipeline.stats.oversizeDrops.Add(1)
		request.releaseLocked()
		return
	}
	if !request.pipeline.budget.charge(size) {
		request.pipeline.stats.budgetDrops.Add(1)
		request.releaseLocked()
		return
	}
	request.charged += size
	attempt.body = append(attempt.body, data...)
}

func (request *Request) releaseLocked() {
	request.done = true
	request.pipeline.budget.release(request.charged)
	request.charged = 0
	for _, attempt := range request.attempts {
		attempt.body = nil
	}
}

// abandon drops a capture that will never complete and releases its budget.
func (request *Request) abandon() {
	if request == nil {
		return
	}
	request.mu.Lock()
	defer request.mu.Unlock()
	if !request.done {
		request.releaseLocked()
	}
}

// Complete finishes the capture: it copies the client body from the request's
// body storage, charges it and hands the request to the workers. It does
// nothing when no attempt ran, when the capture already dropped, or when the
// body no longer fits.
func (request *Request) Complete(c *gin.Context, completion Completion) {
	if request == nil {
		return
	}
	request.mu.Lock()
	if request.done {
		request.mu.Unlock()
		return
	}
	if len(request.attempts) == 0 {
		request.releaseLocked()
		request.mu.Unlock()
		return
	}
	request.mu.Unlock()

	storage, err := common.GetBodyStorage(c)
	var body []byte
	if err == nil {
		body, err = storage.Bytes()
	}
	if err != nil {
		request.pipeline.stats.oversizeDrops.Add(1)
		request.abandon()
		return
	}

	request.mu.Lock()
	if request.done {
		request.mu.Unlock()
		return
	}
	size := int64(len(body))
	if size > request.pipeline.maxRequestBytes {
		request.pipeline.stats.oversizeDrops.Add(1)
		request.releaseLocked()
		request.mu.Unlock()
		return
	}
	if !request.pipeline.budget.charge(size) {
		request.pipeline.stats.budgetDrops.Add(1)
		request.releaseLocked()
		request.mu.Unlock()
		return
	}
	request.charged += size
	charged := request.charged
	envelope := request.envelope(completion, body, c.Request.Header)
	responses := make([]*Attempt, len(request.attempts))
	for index, attempt := range request.attempts {
		if attempt.observed {
			responses[index] = attempt
		}
	}
	request.done = true
	request.mu.Unlock()

	request.pipeline.enqueue(&job{envelope: envelope, body: body, charged: charged, responses: responses})
}

func (request *Request) envelope(completion Completion, body []byte, header http.Header) Envelope {
	completedAt := completion.CompletedAt
	if completedAt.IsZero() {
		completedAt = time.Now()
	}
	requestID := completion.RequestID
	if requestID == "" {
		requestID = request.requestID
	}
	succeeded := completion.Status >= 200 && completion.Status < 300
	envelope := Envelope{
		Version:         envelopeVersion,
		RequestID:       requestID,
		Session:         Session{Source: SessionSourceNone},
		Protocol:        completion.Protocol,
		AccessKeyID:     0,
		Model:           Model{Client: completion.Model},
		Status:          completion.Status,
		Stream:          completion.Stream,
		CompletedAt:     completedAt.UTC(),
		DurationMs:      completion.DurationMs,
		Usage:           completion.Usage,
		RequestEncoding: requestEncodingIdentity,
		RequestHeaders:  allowedHeaders(header),
		Producer:        producerNewAPI,
		Attempts:        make([]AttemptRecord, 0, len(request.attempts)),
	}
	for index, attempt := range request.attempts {
		failureCategory := attempt.failureCategory
		if failureCategory == "" {
			failureCategory = "ok"
			if attempt.status < 200 || attempt.status >= 300 {
				failureCategory = "unknown"
			}
		}
		envelope.Attempts = append(envelope.Attempts, AttemptRecord{
			Sequence:          attempt.sequence,
			GroupID:           0,
			CredentialID:      uint(attempt.channelID),
			RouteMode:         routeModeNewAPI,
			UpstreamProtocol:  attempt.upstreamProtocol,
			UpstreamModel:     attempt.upstreamModel,
			UpstreamRequestID: attempt.upstreamRequestID,
			Status:            attempt.status,
			FailureCategory:   failureCategory,
			ResponseStarted:   attempt.responseStarted,
			Served:            succeeded && index == len(request.attempts)-1,
			Response:          Response{Omitted: OmittedNotObserved},
		})
	}
	return envelope
}

func allowedHeaders(header http.Header) map[string]string {
	values := make(map[string]string)
	for _, name := range capturedRequestHeaders {
		if value := header.Values(name); len(value) > 0 {
			values[name] = strings.Join(value, ", ")
		}
	}
	return values
}

// AttachRequest stores request for the tap and the attempt helpers.
func AttachRequest(c *gin.Context, request *Request) {
	c.Set(requestContextKey, request)
}

// RequestFrom returns the request AttachRequest stored, or nil.
func RequestFrom(c *gin.Context) *Request {
	value, exists := c.Get(requestContextKey)
	if !exists {
		return nil
	}
	request, _ := value.(*Request)
	return request
}

// AttachAttempt makes attempt the one Tap wraps the upstream response for.
func AttachAttempt(c *gin.Context, attempt *Attempt) {
	c.Set(attemptContextKey, attempt)
}

// AttemptFrom returns the attempt AttachAttempt stored, or nil.
func AttemptFrom(c *gin.Context) *Attempt {
	value, exists := c.Get(attemptContextKey)
	if !exists {
		return nil
	}
	attempt, _ := value.(*Attempt)
	return attempt
}

// TakeAttempt detaches and returns the open attempt, or nil.
func TakeAttempt(c *gin.Context) *Attempt {
	attempt := AttemptFrom(c)
	c.Set(attemptContextKey, nil)
	return attempt
}
