// Package gcsupload stores request files in a Google Cloud Storage bucket and
// returns V4 signed URLs for them, for upstreams that read media only from an
// HTTPS URL. It authenticates as the GCE instance's service account through the
// metadata server and signs through the IAM Credentials signBlob API, so the
// host holds no key file. The service account needs, on the bucket, object
// create (to upload) and object get (a signed URL acts with the signer's
// permissions), and Service Account Token Creator on itself (signBlob). The
// bucket's own lifecycle rule deletes the files; nothing here does.
package gcsupload

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultMetadataURL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/"
	defaultStorageURL  = "https://storage.googleapis.com"
	defaultIAMURL      = "https://iamcredentials.googleapis.com"
	signedHost         = "storage.googleapis.com"
	// A V4 signed URL is valid for at most seven days.
	maxTTL = 7 * 24 * time.Hour
	// Refresh a cached token this long before the metadata server says it expires.
	tokenSlack = time.Minute
)

// Store uploads files to Bucket. The zero value of every other field selects
// the production endpoint; tests point them at fakes.
type Store struct {
	Bucket string
	// TTL is how long a returned URL stays valid. It must cover the upstream's
	// queue, its download of the file and its generation time.
	TTL time.Duration

	Client      *http.Client
	MetadataURL string
	StorageURL  string
	IAMURL      string
	Now         func() time.Time

	mu          sync.Mutex
	token       string
	tokenExpiry time.Time
	email       string
}

// New returns a store for bucket whose URLs stay valid for ttl, clamped to
// one minute through seven days.
func New(bucket string, ttl time.Duration) *Store {
	if ttl < time.Minute {
		ttl = time.Minute
	}
	if ttl > maxTTL {
		ttl = maxTTL
	}
	return &Store{Bucket: bucket, TTL: ttl, Client: &http.Client{Timeout: 60 * time.Second}}
}

// Put uploads data under a random object name and returns a signed GET URL for
// it. The name keeps an extension derived from mimeType, because some
// upstreams infer the media type from the URL.
func (s *Store) Put(ctx context.Context, data []byte, mimeType string) (string, error) {
	token, err := s.accessToken(ctx)
	if err != nil {
		return "", err
	}
	object, err := s.objectName(mimeType)
	if err != nil {
		return "", err
	}
	if err := s.upload(ctx, token, object, data, mimeType); err != nil {
		return "", err
	}
	email, err := s.serviceAccount(ctx)
	if err != nil {
		return "", err
	}
	return s.SignedURL(object, email, s.now(), func(payload []byte) ([]byte, error) {
		return s.signBlob(ctx, token, email, payload)
	})
}

// SignedURL builds the V4 signed GET URL for object, signing the string to
// sign with sign (GOOG4-RSA-SHA256).
func (s *Store) SignedURL(object, email string, now time.Time, sign func([]byte) ([]byte, error)) (string, error) {
	datetime := now.UTC().Format("20060102T150405Z")
	scope := datetime[:8] + "/auto/storage/goog4_request"
	query := url.Values{
		"X-Goog-Algorithm":     {"GOOG4-RSA-SHA256"},
		"X-Goog-Credential":    {email + "/" + scope},
		"X-Goog-Date":          {datetime},
		"X-Goog-Expires":       {strconv.Itoa(int(s.TTL / time.Second))},
		"X-Goog-SignedHeaders": {"host"},
	}
	// url.Values.Encode sorts by key and escapes every reserved character,
	// which is the canonical query string V4 signing expects for these values.
	canonicalQuery := strings.ReplaceAll(query.Encode(), "+", "%20")
	canonicalURI := "/" + s.Bucket + "/" + escapePath(object)
	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		canonicalURI,
		canonicalQuery,
		"host:" + signedHost + "\n",
		"host",
		"UNSIGNED-PAYLOAD",
	}, "\n")
	digest := sha256.Sum256([]byte(canonicalRequest))
	stringToSign := "GOOG4-RSA-SHA256\n" + datetime + "\n" + scope + "\n" + hex.EncodeToString(digest[:])
	signature, err := sign([]byte(stringToSign))
	if err != nil {
		return "", fmt.Errorf("sign file URL: %w", err)
	}
	return "https://" + signedHost + canonicalURI + "?" + canonicalQuery + "&X-Goog-Signature=" + hex.EncodeToString(signature), nil
}

func (s *Store) objectName(mimeType string) (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return "task-files/" + s.now().UTC().Format("20060102") + "/" + hex.EncodeToString(random) + extension(mimeType), nil
}

func (s *Store) upload(ctx context.Context, token, object string, data []byte, mimeType string) error {
	endpoint := s.storageURL() + "/upload/storage/v1/b/" + url.PathEscape(s.Bucket) + "/o?uploadType=media&name=" + url.QueryEscape(object)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	request.Header.Set("Content-Type", mimeType)
	response, err := s.client().Do(request)
	if err != nil {
		return fmt.Errorf("upload file to storage: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("upload file to storage: %s: %s", response.Status, readSnippet(response.Body))
	}
	return nil
}

func (s *Store) signBlob(ctx context.Context, token, email string, payload []byte) ([]byte, error) {
	body, err := json.Marshal(map[string]string{"payload": base64.StdEncoding.EncodeToString(payload)})
	if err != nil {
		return nil, err
	}
	endpoint := s.iamURL() + "/v1/projects/-/serviceAccounts/" + url.PathEscape(email) + ":signBlob"
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response, err := s.client().Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", response.Status, readSnippet(response.Body))
	}
	var reply struct {
		SignedBlob string `json:"signedBlob"`
	}
	if err := json.NewDecoder(response.Body).Decode(&reply); err != nil {
		return nil, err
	}
	return base64.StdEncoding.DecodeString(reply.SignedBlob)
}

func (s *Store) accessToken(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && s.now().Before(s.tokenExpiry) {
		return s.token, nil
	}
	raw, err := s.metadata(ctx, "token")
	if err != nil {
		return "", err
	}
	var reply struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil || reply.AccessToken == "" {
		return "", fmt.Errorf("read instance token: unexpected reply")
	}
	s.token = reply.AccessToken
	s.tokenExpiry = s.now().Add(time.Duration(reply.ExpiresIn)*time.Second - tokenSlack)
	return s.token, nil
}

func (s *Store) serviceAccount(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.email != "" {
		return s.email, nil
	}
	raw, err := s.metadata(ctx, "email")
	if err != nil {
		return "", err
	}
	s.email = strings.TrimSpace(string(raw))
	return s.email, nil
}

func (s *Store) metadata(ctx context.Context, path string) ([]byte, error) {
	base := s.MetadataURL
	if base == "" {
		base = defaultMetadataURL
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Metadata-Flavor", "Google")
	response, err := s.client().Do(request)
	if err != nil {
		return nil, fmt.Errorf("read instance %s: %w", path, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("read instance %s: %s", path, response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 64<<10))
}

func (s *Store) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return http.DefaultClient
}

func (s *Store) storageURL() string {
	if s.StorageURL != "" {
		return s.StorageURL
	}
	return defaultStorageURL
}

func (s *Store) iamURL() string {
	if s.IAMURL != "" {
		return s.IAMURL
	}
	return defaultIAMURL
}

func (s *Store) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// escapePath escapes each segment of an object name and keeps the slashes.
func escapePath(object string) string {
	segments := strings.Split(object, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}

var extensions = map[string]string{
	"image/png":       ".png",
	"image/jpeg":      ".jpg",
	"image/webp":      ".webp",
	"image/gif":       ".gif",
	"video/mp4":       ".mp4",
	"video/quicktime": ".mov",
	"video/webm":      ".webm",
	"audio/mpeg":      ".mp3",
	"audio/mp3":       ".mp3",
	"audio/wav":       ".wav",
	"audio/x-wav":     ".wav",
	"audio/mp4":       ".m4a",
	"audio/aac":       ".aac",
	"audio/ogg":       ".ogg",
}

func extension(mimeType string) string {
	base, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(mimeType)), ";")
	return extensions[strings.TrimSpace(base)]
}

func readSnippet(body io.Reader) string {
	raw, _ := io.ReadAll(io.LimitReader(body, 512))
	return strings.TrimSpace(string(raw))
}
