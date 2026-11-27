package channel

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/sessioncapture"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	captureChannelID   = 7
	captureFailoverID  = 13
	captureUpstreamID  = "upstream-request-1"
	captureEnvironment = "test"
)

type fakeObjectStore struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func (store *fakeObjectStore) Put(_ context.Context, name string, data []byte, _ uint32) (string, error) {
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.objects == nil {
		store.objects = make(map[string][]byte)
	}
	store.objects[name] = append([]byte(nil), data...)
	return "gs://test-bucket/" + name, nil
}

func (store *fakeObjectStore) get(name string) ([]byte, bool) {
	store.mu.Lock()
	defer store.mu.Unlock()
	data, ok := store.objects[name]
	return data, ok
}

func (store *fakeObjectStore) names() []string {
	store.mu.Lock()
	defer store.mu.Unlock()
	names := make([]string, 0, len(store.objects))
	for name := range store.objects {
		names = append(names, name)
	}
	return names
}

type fakePublisher struct {
	mu       sync.Mutex
	messages [][]byte
}

func (publisher *fakePublisher) Publish(_ context.Context, data []byte) error {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	publisher.messages = append(publisher.messages, append([]byte(nil), data...))
	return nil
}

func (publisher *fakePublisher) published() [][]byte {
	publisher.mu.Lock()
	defer publisher.mu.Unlock()
	return append([][]byte(nil), publisher.messages...)
}

type captureFixture struct {
	store     *fakeObjectStore
	publisher *fakePublisher
	pipeline  *sessioncapture.Pipeline
	setting   *operation_setting.SessionCaptureSetting
	saved     operation_setting.SessionCaptureSetting
}

var initCaptureHTTPClient sync.Once

func newCaptureFixture(t *testing.T, config sessioncapture.Config) *captureFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	initCaptureHTTPClient.Do(service.InitHttpClient)
	fixture := &captureFixture{
		store:     &fakeObjectStore{},
		publisher: &fakePublisher{},
		setting:   operation_setting.GetSessionCaptureSetting(),
	}
	fixture.saved = *fixture.setting
	fixture.setting.Enabled = true
	fixture.setting.SamplePercent = 100
	fixture.setting.ChannelIDs = []int{captureChannelID}

	config.Environment = captureEnvironment
	config.Store = fixture.store
	config.Publisher = fixture.publisher
	config.Workers = 1
	config.StatsEvery = time.Hour
	if config.BudgetBytes == 0 {
		config.BudgetBytes = 8 << 20
	}
	if config.MaxRequestBytes == 0 {
		config.MaxRequestBytes = 4 << 20
	}
	pipeline, err := sessioncapture.NewPipeline(config)
	require.NoError(t, err)
	fixture.pipeline = pipeline
	sessioncapture.Install(pipeline)
	t.Cleanup(func() {
		sessioncapture.Install(nil)
		pipeline.Close(5 * time.Second)
		*fixture.setting = fixture.saved
	})
	return fixture
}

// drain waits for the workers, so the assertions see every upload and publish.
func (fixture *captureFixture) drain() {
	fixture.pipeline.Close(5 * time.Second)
}

func newCaptureContext(t *testing.T, body []byte, requestID string) *gin.Context {
	t.Helper()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set(common.RequestIdKey, requestID)
	// The relay reads the body into its storage before the first attempt; the
	// capture reads it back from there when the request completes.
	storage, err := common.GetBodyStorage(c)
	require.NoError(t, err)
	c.Request.Body = io.NopCloser(storage)
	return c
}

// newCaptureUpstream answers every request with payload and the capture
// upstream request id header.
func newCaptureUpstream(t *testing.T, status int, payload []byte) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(common.RequestIdKey, captureUpstreamID)
		w.WriteHeader(status)
		_, _ = w.Write(payload)
	}))
	t.Cleanup(server.Close)
	return server
}

// runCaptureAttempt drives one relay attempt exactly as the controller does:
// open the attempt, send through doRequest, read the response the client would
// get, then close the attempt with its outcome.
func runCaptureAttempt(t *testing.T, c *gin.Context, upstreamURL string, channelID, channelType int, modelName, upstreamModel string, status int, failureCategory string) []byte {
	t.Helper()
	service.BeginSessionCaptureAttempt(c, &model.Channel{Id: channelID, Type: channelType})
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, upstreamURL, nil)
	require.NoError(t, err)
	info := &relaycommon.RelayInfo{OriginModelName: modelName, ChannelMeta: &relaycommon.ChannelMeta{}}
	resp, err := doRequest(c, request, info)
	require.NoError(t, err)
	payload, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	service.EndSessionCaptureAttempt(c, upstreamModel, status, failureCategory)
	return payload
}

func completeCapture(c *gin.Context, request *sessioncapture.Request, format types.RelayFormat, status int, stream bool) {
	info := &relaycommon.RelayInfo{OriginModelName: "gpt-client", IsStream: stream, StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{}}
	service.CompleteSessionCapture(c, request, info, format, status)
}

func gunzip(t *testing.T, data []byte) []byte {
	t.Helper()
	reader, err := gzip.NewReader(bytes.NewReader(data))
	require.NoError(t, err)
	raw, err := io.ReadAll(reader)
	require.NoError(t, err)
	require.NoError(t, reader.Close())
	return raw
}

func sha256Hex(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

// TestSessionCaptureStoresListedChatRequestAndResponse covers the v1 event for
// a streamed and a unary chat request: the client body and the upstream bytes
// are stored byte-identical, the event names them, and no credential header
// leaves the process.
func TestSessionCaptureStoresListedChatRequestAndResponse(t *testing.T) {
	for _, streamed := range []bool{false, true} {
		name := "unary"
		if streamed {
			name = "streamed"
		}
		t.Run(name, func(t *testing.T) {
			fixture := newCaptureFixture(t, sessioncapture.Config{})
			marker := "capture-marker-" + name
			body := []byte(fmt.Sprintf(`{"model":"gpt-test","stream":%t,"messages":[{"role":"user","content":%q}]}`, streamed, marker))
			upstreamPayload := []byte(`{"id":"chatcmpl-1","choices":[{"delta":{"content":"hi"}}]}`)
			if streamed {
				upstreamPayload = []byte("data: {\"id\":\"chatcmpl-1\",\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n")
			}

			upstream := newCaptureUpstream(t, http.StatusOK, upstreamPayload)
			c := newCaptureContext(t, body, "req-capture-"+name)
			c.Request.Header.Set("Authorization", "Bearer client-secret")
			c.Request.Header.Set("X-Api-Key", "client-secret")
			c.Request.Header.Set("Cookie", "session=client-secret")
			c.Request.Header.Set("User-Agent", "capture-test-agent")
			c.Request.Header.Set("OpenAI-Beta", "responses=v1")
			c.Request.Header.Set("Originator", "codex_cli")
			c.Request.Header.Set("session_id", "sess-1")
			other := model.NewLogOther()
			other.SetPublic("cache_tokens", 40)
			other.SetPublic("cache_write_tokens", 5)
			common.SetContextKey(c, constant.ContextKeyConsumeLog, &model.RecordConsumeLogParams{
				PromptTokens:        100,
				CompletionTokens:    10,
				PromptIncludesCache: true,
				Other:               other,
			})

			request := service.StartSessionCapture(c)
			require.NotNil(t, request)
			served := runCaptureAttempt(t, c, upstream.URL, captureChannelID, constant.ChannelTypeOpenAI, "gpt-client", "gpt-upstream", http.StatusOK, "ok")
			require.Equal(t, upstreamPayload, served)
			completeCapture(c, request, types.RelayFormatOpenAI, http.StatusOK, streamed)
			fixture.drain()

			published := fixture.publisher.published()
			require.Len(t, published, 1)
			var event sessioncapture.Envelope
			require.NoError(t, json.Unmarshal(published[0], &event))

			assert.Equal(t, 1, event.Version)
			assert.Equal(t, "new-api", event.Producer)
			assert.Equal(t, "req-capture-"+name, event.RequestID)
			assert.Equal(t, "openai-completions", event.Protocol)
			assert.Equal(t, "none", event.Session.Source)
			assert.Empty(t, event.Session.Key)
			assert.Equal(t, uint(0), event.AccessKeyID)
			assert.Equal(t, "gpt-client", event.Model.Client)
			assert.Equal(t, http.StatusOK, event.Status)
			assert.Equal(t, streamed, event.Stream)
			assert.Equal(t, "identity", event.RequestEncoding)
			assert.Equal(t, sessioncapture.Usage{InputTokens: 55, CacheReadTokens: 40, CacheWriteTokens: 5, OutputTokens: 10}, event.Usage)
			assert.NotZero(t, event.CompletedAt)

			assert.Equal(t, map[string]string{
				"content-type": "application/json",
				"user-agent":   "capture-test-agent",
				"openai-beta":  "responses=v1",
				"originator":   "codex_cli",
				"session_id":   "sess-1",
			}, event.RequestHeaders)
			for _, secret := range []string{"authorization", "x-api-key", "cookie"} {
				_, leaked := event.RequestHeaders[secret]
				assert.False(t, leaked, "header %s must not be captured", secret)
			}

			prefix := fmt.Sprintf("%s/%s/%s", captureEnvironment, event.CompletedAt.UTC().Format("2006/01/02"), event.RequestID)
			assert.Equal(t, "gs://test-bucket/"+prefix+"/request.json.gz", event.Request.URI)
			requestObject, ok := fixture.store.get(prefix + "/request.json.gz")
			require.True(t, ok)
			assert.Equal(t, body, gunzip(t, requestObject), "the stored request must be the client body")
			assert.Equal(t, sha256Hex(requestObject), event.Request.SHA256)
			assert.Equal(t, sha256Hex(body), event.Request.RawSHA256)
			require.NotNil(t, event.Request.RawBytes)
			require.NotNil(t, event.Request.ObjectBytes)
			assert.Equal(t, int64(len(body)), *event.Request.RawBytes)
			assert.Equal(t, int64(len(requestObject)), *event.Request.ObjectBytes)

			require.Len(t, event.Attempts, 1)
			attempt := event.Attempts[0]
			assert.Equal(t, 1, attempt.Sequence)
			assert.Equal(t, uint(captureChannelID), attempt.CredentialID)
			assert.Equal(t, "new-api", attempt.RouteMode)
			assert.Equal(t, constant.GetChannelTypeName(constant.ChannelTypeOpenAI), attempt.UpstreamProtocol)
			assert.Equal(t, "gpt-upstream", attempt.UpstreamModel)
			assert.Equal(t, captureUpstreamID, attempt.UpstreamRequestID)
			assert.Equal(t, http.StatusOK, attempt.Status)
			assert.Equal(t, "ok", attempt.FailureCategory)
			assert.True(t, attempt.ResponseStarted)
			assert.True(t, attempt.Served)
			responseName := fmt.Sprintf("%s/response-1.json.gz", prefix)
			assert.Equal(t, "gs://test-bucket/"+responseName, attempt.Response.URI)
			responseObject, ok := fixture.store.get(responseName)
			require.True(t, ok)
			assert.Equal(t, upstreamPayload, gunzip(t, responseObject), "the stored response must be the upstream bytes")
			assert.Equal(t, sha256Hex(responseObject), attempt.Response.SHA256)
			assert.Equal(t, sha256Hex(upstreamPayload), attempt.Response.RawSHA256)
			assert.Equal(t, int64(len(upstreamPayload)), *attempt.Response.RawBytes)
			assert.Equal(t, int64(len(responseObject)), *attempt.Response.ObjectBytes)

			storedEvent, ok := fixture.store.get(prefix + "/event.json")
			require.True(t, ok)
			assert.Equal(t, published[0], storedEvent, "the stored event must be the published bytes")
		})
	}
}

// TestSessionCaptureFailoverKeepsEveryAttemptInOrder covers a retry across two
// listed channels: the first attempt is recorded as not served, the last as
// served, and each keeps its own response object.
func TestSessionCaptureFailoverKeepsEveryAttemptInOrder(t *testing.T) {
	fixture := newCaptureFixture(t, sessioncapture.Config{})
	fixture.setting.ChannelIDs = []int{captureChannelID, captureFailoverID}

	body := []byte(`{"model":"gpt-test","messages":[{"role":"user","content":"failover-marker"}]}`)
	firstPayload := []byte(`{"error":{"message":"first channel failed"}}`)
	secondPayload := []byte(`{"id":"chatcmpl-2","choices":[{"message":{"content":"ok"}}]}`)
	first := newCaptureUpstream(t, http.StatusInternalServerError, firstPayload)
	second := newCaptureUpstream(t, http.StatusOK, secondPayload)

	c := newCaptureContext(t, body, "req-capture-failover")
	request := service.StartSessionCapture(c)
	require.NotNil(t, request)

	gotFirst := runCaptureAttempt(t, c, first.URL, captureChannelID, constant.ChannelTypeOpenAI, "gpt-client", "gpt-first", http.StatusInternalServerError, "upstream_error")
	require.Equal(t, firstPayload, gotFirst)
	gotSecond := runCaptureAttempt(t, c, second.URL, captureFailoverID, constant.ChannelTypeOpenAI, "gpt-client", "gpt-second", http.StatusOK, "ok")
	require.Equal(t, secondPayload, gotSecond)
	completeCapture(c, request, types.RelayFormatOpenAI, http.StatusOK, false)
	fixture.drain()

	published := fixture.publisher.published()
	require.Len(t, published, 1)
	var event sessioncapture.Envelope
	require.NoError(t, json.Unmarshal(published[0], &event))
	assert.Equal(t, http.StatusOK, event.Status)
	require.Len(t, event.Attempts, 2)
	assert.Equal(t, []int{1, 2}, []int{event.Attempts[0].Sequence, event.Attempts[1].Sequence})
	assert.Equal(t, []uint{captureChannelID, captureFailoverID}, []uint{event.Attempts[0].CredentialID, event.Attempts[1].CredentialID})
	assert.False(t, event.Attempts[0].Served)
	assert.True(t, event.Attempts[1].Served)
	assert.Equal(t, http.StatusInternalServerError, event.Attempts[0].Status)
	assert.Equal(t, "upstream_error", event.Attempts[0].FailureCategory)
	assert.Equal(t, "gpt-first", event.Attempts[0].UpstreamModel)
	assert.Equal(t, "gpt-second", event.Attempts[1].UpstreamModel)

	prefix := fmt.Sprintf("%s/%s/%s", captureEnvironment, event.CompletedAt.UTC().Format("2006/01/02"), event.RequestID)
	for index, want := range [][]byte{firstPayload, secondPayload} {
		name := fmt.Sprintf("%s/response-%d.json.gz", prefix, index+1)
		stored, ok := fixture.store.get(name)
		require.True(t, ok, name)
		assert.Equal(t, want, gunzip(t, stored))
	}
}

// TestSessionCaptureCopiesNothingWhenNotSelected covers the four ways a
// request must leave no object and no message: an unlisted channel, the
// switch off, an unsampled customer, and no pipeline.
func TestSessionCaptureCopiesNothingWhenNotSelected(t *testing.T) {
	upstreamPayload := []byte(`{"id":"chatcmpl-3"}`)
	body := []byte(`{"model":"gpt-test","messages":[{"role":"user","content":"not-selected"}]}`)

	t.Run("unlisted channel", func(t *testing.T) {
		fixture := newCaptureFixture(t, sessioncapture.Config{})
		upstream := newCaptureUpstream(t, http.StatusOK, upstreamPayload)
		c := newCaptureContext(t, body, "req-capture-unlisted")
		request := service.StartSessionCapture(c)
		require.NotNil(t, request)
		served := runCaptureAttempt(t, c, upstream.URL, 999, constant.ChannelTypeOpenAI, "gpt-client", "gpt-upstream", http.StatusOK, "ok")
		require.Equal(t, upstreamPayload, served)
		completeCapture(c, request, types.RelayFormatOpenAI, http.StatusOK, false)
		fixture.drain()
		assert.Empty(t, fixture.store.names())
		assert.Empty(t, fixture.publisher.published())
	})

	t.Run("switch off", func(t *testing.T) {
		fixture := newCaptureFixture(t, sessioncapture.Config{})
		fixture.setting.Enabled = false
		c := newCaptureContext(t, body, "req-capture-off")
		assert.Nil(t, service.StartSessionCapture(c))
		completeCapture(c, nil, types.RelayFormatOpenAI, http.StatusOK, false)
		fixture.drain()
		assert.Empty(t, fixture.store.names())
		assert.Empty(t, fixture.publisher.published())
	})

	t.Run("unsampled customer", func(t *testing.T) {
		fixture := newCaptureFixture(t, sessioncapture.Config{})
		fixture.setting.SamplePercent = 0
		c := newCaptureContext(t, body, "req-capture-unsampled")
		assert.Nil(t, service.StartSessionCapture(c))
		completeCapture(c, nil, types.RelayFormatOpenAI, http.StatusOK, false)
		fixture.drain()
		assert.Empty(t, fixture.store.names())
		assert.Empty(t, fixture.publisher.published())
	})

	t.Run("no pipeline", func(t *testing.T) {
		setting := operation_setting.GetSessionCaptureSetting()
		saved := *setting
		t.Cleanup(func() { *setting = saved })
		setting.Enabled = true
		setting.SamplePercent = 100
		setting.ChannelIDs = []int{captureChannelID}
		sessioncapture.Install(nil)
		c := newCaptureContext(t, body, "req-capture-no-pipeline")
		assert.Nil(t, service.StartSessionCapture(c))
		completeCapture(c, nil, types.RelayFormatOpenAI, http.StatusOK, false)
	})
}

// TestSessionCaptureDropsOverBudgetStreamAndServesTheClient covers an exhausted
// budget mid-stream: the capture is dropped and counted, and the client still
// reads every upstream byte.
func TestSessionCaptureDropsOverBudgetStreamAndServesTheClient(t *testing.T) {
	fixture := newCaptureFixture(t, sessioncapture.Config{BudgetBytes: 128, MaxRequestBytes: 1 << 20})
	body := []byte(`{"model":"gpt-test","messages":[{"role":"user","content":"budget-marker"}]}`)
	upstreamPayload := bytes.Repeat([]byte("s"), 1024)
	upstream := newCaptureUpstream(t, http.StatusOK, upstreamPayload)

	c := newCaptureContext(t, body, "req-capture-budget")
	request := service.StartSessionCapture(c)
	require.NotNil(t, request)
	served := runCaptureAttempt(t, c, upstream.URL, captureChannelID, constant.ChannelTypeOpenAI, "gpt-client", "gpt-upstream", http.StatusOK, "ok")
	require.Equal(t, upstreamPayload, served)
	completeCapture(c, request, types.RelayFormatOpenAI, http.StatusOK, true)
	fixture.drain()

	stats := fixture.pipeline.Stats()
	assert.Equal(t, int64(1), stats.BudgetDrops)
	assert.Empty(t, fixture.store.names())
	assert.Empty(t, fixture.publisher.published())
}

// TestSessionCaptureDropsOverSizeRequest covers the per-request cap: a body
// past it drops the whole capture and stores nothing.
func TestSessionCaptureDropsOverSizeRequest(t *testing.T) {
	fixture := newCaptureFixture(t, sessioncapture.Config{MaxRequestBytes: 64})
	body := []byte(`{"model":"gpt-test","messages":[{"role":"user","content":"` + string(bytes.Repeat([]byte("x"), 128)) + `"}]}`)
	upstreamPayload := []byte(`{"id":"chatcmpl-4"}`)
	upstream := newCaptureUpstream(t, http.StatusOK, upstreamPayload)

	c := newCaptureContext(t, body, "req-capture-oversize")
	request := service.StartSessionCapture(c)
	require.NotNil(t, request)
	runCaptureAttempt(t, c, upstream.URL, captureChannelID, constant.ChannelTypeOpenAI, "gpt-client", "gpt-upstream", http.StatusOK, "ok")
	completeCapture(c, request, types.RelayFormatOpenAI, http.StatusOK, false)
	fixture.drain()

	stats := fixture.pipeline.Stats()
	assert.Equal(t, int64(1), stats.OversizeDrops)
	assert.Empty(t, fixture.store.names())
	assert.Empty(t, fixture.publisher.published())
}

// TestSessionCaptureStoresMultipartBodyAsItsRawBytes covers an image edit or a
// video submit: the multipart bytes are stored exactly as the client sent
// them, under request.json.gz.
func TestSessionCaptureStoresMultipartBodyAsItsRawBytes(t *testing.T) {
	fixture := newCaptureFixture(t, sessioncapture.Config{})
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("image", "pixel.png")
	require.NoError(t, err)
	_, err = part.Write([]byte{0x89, 'P', 'N', 'G', 0x00, 0xff, '\r', '\n', 0x00, 0x01})
	require.NoError(t, err)
	require.NoError(t, writer.WriteField("prompt", "multipart-marker"))
	require.NoError(t, writer.Close())
	rawBody := body.Bytes()

	upstreamPayload := []byte(`{"id":"image-edit-1"}`)
	upstream := newCaptureUpstream(t, http.StatusOK, upstreamPayload)
	c := newCaptureContext(t, rawBody, "req-capture-multipart")
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())

	request := service.StartSessionCapture(c)
	require.NotNil(t, request)
	runCaptureAttempt(t, c, upstream.URL, captureChannelID, constant.ChannelTypeOpenAI, "gpt-client", "gpt-upstream", http.StatusOK, "ok")
	completeCapture(c, request, types.RelayFormatOpenAIImage, http.StatusOK, false)
	fixture.drain()

	published := fixture.publisher.published()
	require.Len(t, published, 1)
	var event sessioncapture.Envelope
	require.NoError(t, json.Unmarshal(published[0], &event))
	assert.Equal(t, "openai-images", event.Protocol)
	prefix := fmt.Sprintf("%s/%s/%s", captureEnvironment, event.CompletedAt.UTC().Format("2006/01/02"), event.RequestID)
	stored, ok := fixture.store.get(prefix + "/request.json.gz")
	require.True(t, ok)
	assert.Equal(t, rawBody, gunzip(t, stored))
	assert.Equal(t, sha256Hex(rawBody), event.Request.RawSHA256)
}
