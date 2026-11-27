package sessioncapture

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	defaultMetadataTokenURL = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token"
	defaultGCSEndpoint      = "https://storage.googleapis.com"
	defaultPubSubEndpoint   = "https://pubsub.googleapis.com"
	callTimeout             = 30 * time.Second
	callAttempts            = 3
	// Refresh a cached token this long before the metadata server says it expires.
	tokenSlack = time.Minute
)

// GoogleClient calls GCS and Pub/Sub over their REST APIs with the GCE
// instance's service-account token from the metadata server, so the host holds
// no key file. The zero value of the endpoint fields selects production.
type GoogleClient struct {
	http           *http.Client
	metadataURL    string
	gcsEndpoint    string
	pubsubEndpoint string

	mu        sync.Mutex
	token     string
	expiresAt time.Time
}

// NewGoogleClient returns a client whose transport keeps workers connections
// warm per host.
func NewGoogleClient(workers int) *GoogleClient {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxIdleConnsPerHost = max(workers, 2)
	return &GoogleClient{
		http:           &http.Client{Transport: transport, Timeout: callTimeout},
		metadataURL:    defaultMetadataTokenURL,
		gcsEndpoint:    defaultGCSEndpoint,
		pubsubEndpoint: defaultPubSubEndpoint,
	}
}

// Bucket returns an ObjectStore writing to the named bucket.
func (client *GoogleClient) Bucket(name string) ObjectStore {
	return &gcsBucket{client: client, name: name}
}

// Topic returns a Publisher for a topic named projects/<project>/topics/<topic>.
func (client *GoogleClient) Topic(name string) Publisher {
	return &pubsubTopic{client: client, name: name}
}

type gcsBucket struct {
	client *GoogleClient
	name   string
}

// Put uploads with ifGenerationMatch=0, so an object is never overwritten. A
// retry that finds the object already there treats it as written: its name is
// unique to the request and its bytes are deterministic.
func (bucket *gcsBucket) Put(ctx context.Context, name string, data []byte, crc32c uint32) (string, error) {
	target := bucket.client.gcsEndpoint + "/upload/storage/v1/b/" + url.PathEscape(bucket.name) +
		"/o?uploadType=media&ifGenerationMatch=0&name=" + url.QueryEscape(name)
	checksum := make([]byte, 4)
	binary.BigEndian.PutUint32(checksum, crc32c)
	contentType := "application/gzip"
	if strings.HasSuffix(name, ".json") {
		contentType = "application/json"
	}
	header := http.Header{
		"Content-Type": {contentType},
		"X-Goog-Hash":  {"crc32c=" + base64.StdEncoding.EncodeToString(checksum)},
	}
	status, err := bucket.client.call(ctx, http.MethodPost, target, header, data)
	if err != nil && status != http.StatusPreconditionFailed {
		return "", err
	}
	return "gs://" + bucket.name + "/" + name, nil
}

type pubsubTopic struct {
	client *GoogleClient
	name   string
}

func (topic *pubsubTopic) Publish(ctx context.Context, data []byte) error {
	body, err := json.Marshal(map[string]any{
		"messages": []map[string]any{{
			"data":       base64.StdEncoding.EncodeToString(data),
			"attributes": map[string]string{"v": fmt.Sprint(envelopeVersion)},
		}},
	})
	if err != nil {
		return err
	}
	target := topic.client.pubsubEndpoint + "/v1/" + topic.name + ":publish"
	_, err = topic.client.call(ctx, http.MethodPost, target, http.Header{"Content-Type": {"application/json"}}, body)
	return err
}

// call retries a transport error, 408, 429 and 5xx. It returns the last
// status, so a caller can accept a status it expects.
func (client *GoogleClient) call(ctx context.Context, method, target string, header http.Header, body []byte) (int, error) {
	var lastErr error
	status := 0
	for attempt := range callAttempts {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return status, errors.Join(lastErr, ctx.Err())
			case <-time.After(time.Duration(attempt*attempt) * 500 * time.Millisecond):
			}
		}
		status, lastErr = client.once(ctx, method, target, header, body)
		if lastErr == nil {
			return status, nil
		}
		if status != 0 && status != http.StatusRequestTimeout && status != http.StatusTooManyRequests && status < 500 {
			return status, lastErr
		}
	}
	return status, lastErr
}

func (client *GoogleClient) once(ctx context.Context, method, target string, header http.Header, body []byte) (int, error) {
	token, err := client.accessToken(ctx)
	if err != nil {
		return 0, fmt.Errorf("session capture credentials: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	request.Header = header.Clone()
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := client.http.Do(request)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	detail, _ := io.ReadAll(io.LimitReader(response.Body, 512))
	if response.StatusCode/100 != 2 {
		return response.StatusCode, fmt.Errorf("%s %s: %d %s", method, request.URL.Redacted(), response.StatusCode, strings.TrimSpace(string(detail)))
	}
	return response.StatusCode, nil
}

func (client *GoogleClient) accessToken(ctx context.Context) (string, error) {
	client.mu.Lock()
	defer client.mu.Unlock()
	if client.token != "" && time.Now().Before(client.expiresAt) {
		return client.token, nil
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, client.metadataURL, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("Metadata-Flavor", "Google")
	response, err := client.http.Do(request)
	if err != nil {
		return "", fmt.Errorf("read instance token: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("read instance token: %s", response.Status)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return "", fmt.Errorf("read instance token: %w", err)
	}
	var reply struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(raw, &reply); err != nil || reply.AccessToken == "" {
		return "", fmt.Errorf("read instance token: unexpected reply")
	}
	client.token = reply.AccessToken
	client.expiresAt = time.Now().Add(time.Duration(reply.ExpiresIn)*time.Second - tokenSlack)
	return client.token, nil
}
