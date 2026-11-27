package sessioncapture

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

const (
	envBucket        = "SESSION_CAPTURE_BUCKET"
	envTopic         = "SESSION_CAPTURE_TOPIC"
	envEnvironment   = "SESSION_CAPTURE_ENVIRONMENT"
	envBudgetMB      = "SESSION_CAPTURE_BUDGET_MB"
	envMaxRequestMB  = "SESSION_CAPTURE_MAX_REQUEST_MB"
	envWorkers       = "SESSION_CAPTURE_WORKERS"
	defaultEnvName   = "prod"
	defaultBudgetMB  = 256
	defaultMaxReqMB  = 32
	defaultEnvWorker = 4
)

// environmentPattern is the ingest's environment rule; an event naming
// another one is rejected.
var environmentPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// NewFromEnv builds the process-wide pipeline from the SESSION_CAPTURE_*
// variables, which the deployment sets. Without both a bucket and a topic it
// returns nil and opens no client. A malformed value is an error so the start
// up log names it; the caller keeps the process running without capture.
func NewFromEnv() (*Pipeline, error) {
	return newFromEnv(os.Getenv)
}

func newFromEnv(lookup func(string) string) (*Pipeline, error) {
	bucket := strings.TrimSpace(lookup(envBucket))
	topic := strings.TrimSpace(lookup(envTopic))
	if bucket == "" || topic == "" {
		return nil, nil
	}
	environment := strings.TrimSpace(lookup(envEnvironment))
	if environment == "" {
		environment = defaultEnvName
	}
	if !environmentPattern.MatchString(environment) {
		return nil, fmt.Errorf("%s %q must match %s", envEnvironment, environment, environmentPattern)
	}
	budgetMB, err := envInt(lookup, envBudgetMB, defaultBudgetMB)
	if err != nil {
		return nil, err
	}
	maxRequestMB, err := envInt(lookup, envMaxRequestMB, defaultMaxReqMB)
	if err != nil {
		return nil, err
	}
	workers, err := envInt(lookup, envWorkers, defaultEnvWorker)
	if err != nil {
		return nil, err
	}
	client := NewGoogleClient(workers)
	return NewPipeline(Config{
		Environment:     environment,
		BudgetBytes:     int64(budgetMB) << 20,
		MaxRequestBytes: int64(maxRequestMB) << 20,
		Workers:         workers,
		Store:           client.Bucket(bucket),
		Publisher:       client.Topic(topic),
	})
}

func envInt(lookup func(string) string, name string, fallback int) (int, error) {
	raw := strings.TrimSpace(lookup(name))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer, got %q", name, raw)
	}
	return value, nil
}
