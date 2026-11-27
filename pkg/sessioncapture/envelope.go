package sessioncapture

import "time"

const (
	envelopeVersion = 1
	producerNewAPI  = "new-api"
	routeModeNewAPI = "new-api"

	requestEncodingIdentity = "identity"
	// RequestObjectName is the fixed name of the stored client body, whatever
	// its content type.
	RequestObjectName = "request.json.gz"
	// EventObjectName is the uploaded event's name beside the objects it names.
	EventObjectName = "event.json"
)

// Session key sources the ingest accepts. new-api has no session key to offer.
const (
	SessionSourceClaudeCode = "claude_code_session"
	SessionSourceAffinity   = "affinity_log_id"
	SessionSourceNone       = "none"
)

// OmittedNotObserved marks an attempt whose upstream body never passed a tap.
const OmittedNotObserved = "not_observed"

// Envelope is the version-1 Pub/Sub event. It carries pointers and metadata,
// never a body, credential, token or client IP.
type Envelope struct {
	Version         int               `json:"v"`
	RequestID       string            `json:"request_id"`
	Session         Session           `json:"session"`
	Protocol        string            `json:"protocol"`
	AccessKeyID     uint              `json:"access_key_id"`
	Model           Model             `json:"model"`
	Status          int               `json:"status"`
	Stream          bool              `json:"stream"`
	CompletedAt     time.Time         `json:"completed_at"`
	DurationMs      int64             `json:"duration_ms"`
	Usage           Usage             `json:"usage"`
	RequestEncoding string            `json:"request_encoding"`
	RequestHeaders  map[string]string `json:"request_headers"`
	Request         Object            `json:"request"`
	Attempts        []AttemptRecord   `json:"attempts"`
	Producer        string            `json:"producer"`
}

type Session struct {
	Key    string `json:"key,omitempty"`
	Source string `json:"source"`
}

type Model struct {
	Client string `json:"client"`
}

type Usage struct {
	InputTokens      int64 `json:"input_tokens"`
	CacheReadTokens  int64 `json:"cache_read_input_tokens"`
	CacheWriteTokens int64 `json:"cache_creation_input_tokens"`
	OutputTokens     int64 `json:"output_tokens"`
}

// Object names one stored gzip object. SHA256 covers the stored bytes and is
// what ingest verifies; RawSHA256 covers the uncompressed payload and is what
// an audit compares.
type Object struct {
	URI         string `json:"uri,omitempty"`
	SHA256      string `json:"sha256,omitempty"`
	RawSHA256   string `json:"raw_sha256,omitempty"`
	RawBytes    *int64 `json:"raw_bytes,omitempty"`
	ObjectBytes *int64 `json:"object_bytes,omitempty"`
}

type Response struct {
	Object
	// Encoding is the upstream Content-Encoding of the stored bytes, which are
	// the bytes as read from the wire.
	Encoding string `json:"encoding,omitempty"`
	Bodies   int    `json:"bodies,omitempty"`
	Omitted  string `json:"omitted,omitempty"`
}

type AttemptRecord struct {
	Sequence          int    `json:"sequence"`
	GroupID           uint   `json:"group_id"`
	CredentialID      uint   `json:"credential_id"`
	RouteMode         string `json:"route_mode"`
	UpstreamProtocol  string `json:"upstream_protocol"`
	UpstreamModel     string `json:"upstream_model"`
	UpstreamRequestID string `json:"upstream_request_id"`
	Status            int    `json:"status"`
	FailureCategory   string `json:"failure_category"`
	ResponseStarted   bool   `json:"response_started"`
	// Served marks the attempt whose response the client received: the last
	// attempt of a request that succeeded.
	Served   bool     `json:"served"`
	Response Response `json:"response"`
}
