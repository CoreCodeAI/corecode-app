package gcsupload

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testEmail = "relay@project.iam.gserviceaccount.com"

var testNow = time.Date(2026, 11, 11, 7, 5, 9, 0, time.UTC)

// The canonical request and string to sign follow
// https://cloud.google.com/storage/docs/authentication/canonical-requests and
// https://cloud.google.com/storage/docs/authentication/signatures; the signer
// here returns a fixed blob, so only their layout is under test.
func TestSignedURLBuildsTheV4CanonicalRequest(t *testing.T) {
	store := &Store{Bucket: "task-files", TTL: 24 * time.Hour}
	var signed string
	got, err := store.SignedURL("task-files/20261111/abc.png", testEmail, testNow, func(payload []byte) ([]byte, error) {
		signed = string(payload)
		return []byte{0xde, 0xad, 0xbe, 0xef}, nil
	})
	require.NoError(t, err)

	query := "X-Goog-Algorithm=GOOG4-RSA-SHA256" +
		"&X-Goog-Credential=relay%40project.iam.gserviceaccount.com%2F20261111%2Fauto%2Fstorage%2Fgoog4_request" +
		"&X-Goog-Date=20261111T070509Z&X-Goog-Expires=86400&X-Goog-SignedHeaders=host"
	canonical := "GET\n/task-files/task-files/20261111/abc.png\n" + query + "\nhost:storage.googleapis.com\n\nhost\nUNSIGNED-PAYLOAD"
	digest := sha256.Sum256([]byte(canonical))
	assert.Equal(t, "GOOG4-RSA-SHA256\n20261111T070509Z\n20261111/auto/storage/goog4_request\n"+hex.EncodeToString(digest[:]), signed)
	assert.Equal(t, "https://storage.googleapis.com/task-files/task-files/20261111/abc.png?"+query+"&X-Goog-Signature=deadbeef", got)
}

func TestNewClampsTheURLLifetime(t *testing.T) {
	assert.Equal(t, time.Minute, New("b", time.Second).TTL)
	assert.Equal(t, 7*24*time.Hour, New("b", 30*24*time.Hour).TTL)
	assert.Equal(t, 24*time.Hour, New("b", 24*time.Hour).TTL)
}

type fakeGoogle struct {
	server        *httptest.Server
	tokenRequests atomic.Int32
	uploads       []upload
	uploadStatus  int
}

type upload struct {
	path, object, contentType, auth string
	body                            []byte
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	fake := &fakeGoogle{uploadStatus: http.StatusOK}
	fake.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/meta/token":
			assert.Equal(t, "Google", r.Header.Get("Metadata-Flavor"))
			fake.tokenRequests.Add(1)
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600,"token_type":"Bearer"}`))
		case r.URL.Path == "/meta/email":
			_, _ = w.Write([]byte(testEmail))
		case strings.HasPrefix(r.URL.Path, "/upload/storage/v1/b/"):
			body, _ := io.ReadAll(r.Body)
			fake.uploads = append(fake.uploads, upload{path: r.URL.Path, object: r.URL.Query().Get("name"),
				contentType: r.Header.Get("Content-Type"), auth: r.Header.Get("Authorization"), body: body})
			w.WriteHeader(fake.uploadStatus)
			_, _ = w.Write([]byte(`{"name":"x"}`))
		case r.URL.Path == "/v1/projects/-/serviceAccounts/"+testEmail+":signBlob":
			assert.Equal(t, "Bearer tok", r.Header.Get("Authorization"))
			var request struct{ Payload string }
			require.NoError(t, json.NewDecoder(r.Body).Decode(&request))
			payload, err := base64.StdEncoding.DecodeString(request.Payload)
			require.NoError(t, err)
			assert.True(t, strings.HasPrefix(string(payload), "GOOG4-RSA-SHA256\n"))
			_ = json.NewEncoder(w).Encode(map[string]string{"keyId": "k", "signedBlob": base64.StdEncoding.EncodeToString([]byte("signature"))})
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(fake.server.Close)
	return fake
}

func (f *fakeGoogle) store() *Store {
	return &Store{Bucket: "task-files", TTL: time.Hour, Client: f.server.Client(),
		MetadataURL: f.server.URL + "/meta/", StorageURL: f.server.URL, IAMURL: f.server.URL,
		Now: func() time.Time { return testNow }}
}

func TestPutUploadsAndReturnsASignedURL(t *testing.T) {
	fake := newFakeGoogle(t)
	store := fake.store()

	got, err := store.Put(context.Background(), []byte("frame"), "image/png")
	require.NoError(t, err)
	require.Len(t, fake.uploads, 1)
	sent := fake.uploads[0]
	assert.Equal(t, "/upload/storage/v1/b/task-files/o", sent.path)
	assert.Regexp(t, `^task-files/20261111/[0-9a-f]{32}\.png$`, sent.object)
	assert.Equal(t, "image/png", sent.contentType)
	assert.Equal(t, "Bearer tok", sent.auth)
	assert.Equal(t, "frame", string(sent.body))

	parsed, err := url.Parse(got)
	require.NoError(t, err)
	assert.Equal(t, "storage.googleapis.com", parsed.Host)
	assert.Equal(t, "/task-files/"+sent.object, parsed.Path)
	assert.Equal(t, hex.EncodeToString([]byte("signature")), parsed.Query().Get("X-Goog-Signature"))
	assert.Equal(t, "3600", parsed.Query().Get("X-Goog-Expires"))

	// The token is cached until shortly before it expires.
	_, err = store.Put(context.Background(), []byte("clip"), "video/mp4; codecs=avc1")
	require.NoError(t, err)
	assert.Equal(t, int32(1), fake.tokenRequests.Load())
	assert.Regexp(t, `\.mp4$`, fake.uploads[1].object)
}

func TestPutReportsARefusedUpload(t *testing.T) {
	fake := newFakeGoogle(t)
	fake.uploadStatus = http.StatusForbidden
	_, err := fake.store().Put(context.Background(), []byte("x"), "audio/mpeg")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "403")
}

func TestExtensionFollowsTheMediaType(t *testing.T) {
	assert.Equal(t, ".jpg", extension("image/jpeg"))
	assert.Equal(t, ".mp3", extension(" Audio/MPEG ; q=1"))
	assert.Equal(t, "", extension("application/octet-stream"))
}
