package sessioncapture

import (
	"strconv"
	"testing"
	"time"
)

func TestSampledKeepsTheSameCustomersInEveryProcess(t *testing.T) {
	if !Sampled("", 100) {
		t.Fatal("percent 100 must sample every customer")
	}
	if Sampled("42", 0) {
		t.Fatal("percent 0 must sample nobody")
	}
	first := Sampled("42", 37)
	for range 100 {
		if Sampled("42", 37) != first {
			t.Fatal("the answer must depend only on the key and the percent")
		}
	}
}

func TestSampledPercentApproximatesTheShareOfCustomers(t *testing.T) {
	const customers = 1000
	sampled := 0
	for id := range customers {
		if Sampled(strconv.Itoa(id), 50) {
			sampled++
		}
	}
	if sampled < 400 || sampled > 600 {
		t.Fatalf("50 percent sampled %d of %d customers", sampled, customers)
	}
}

func TestValidRequestIDMatchesTheIngestRule(t *testing.T) {
	for _, id := range []string{"202611271201594066564948268d9d6sL7alKMY", "a.b_c:d-1", "A1"} {
		if !ValidRequestID(id) {
			t.Fatalf("%q must be accepted", id)
		}
	}
	for _, id := range []string{"", "with space", "slash/inside", "ünïcode", string(make([]byte, 129))} {
		if ValidRequestID(id) {
			t.Fatalf("%q must be rejected", id)
		}
	}
}

func TestNewFromEnvNeedsBucketAndTopic(t *testing.T) {
	lookup := map[string]string{}
	pipeline, err := newFromEnv(func(name string) string { return lookup[name] })
	if err != nil || pipeline != nil {
		t.Fatalf("no bucket and topic must leave capture off, got %v, %v", pipeline, err)
	}
	lookup[envBucket] = "bucket"
	if pipeline, err = newFromEnv(func(name string) string { return lookup[name] }); err != nil || pipeline != nil {
		t.Fatalf("no topic must leave capture off, got %v, %v", pipeline, err)
	}
}

func TestNewFromEnvBuildsThePipelineAndValidatesTheEnvironment(t *testing.T) {
	lookup := map[string]string{
		envBucket:       "bucket",
		envTopic:        "projects/test/topics/session-capture-events",
		envBudgetMB:     "512",
		envMaxRequestMB: "16",
		envWorkers:      "2",
	}
	pipeline, err := newFromEnv(func(name string) string { return lookup[name] })
	if err != nil {
		t.Fatal(err)
	}
	if pipeline == nil {
		t.Fatal("a bucket and topic must build a pipeline")
	}
	if pipeline.environment != defaultEnvName {
		t.Fatalf("environment = %q, want %q", pipeline.environment, defaultEnvName)
	}
	if pipeline.budget.limit != 512<<20 {
		t.Fatalf("budget = %d, want %d", pipeline.budget.limit, int64(512<<20))
	}
	if pipeline.maxRequestBytes != 16<<20 {
		t.Fatalf("max request = %d, want %d", pipeline.maxRequestBytes, int64(16<<20))
	}
	pipeline.Close(time.Second)

	lookup[envEnvironment] = "Prod"
	if _, err := newFromEnv(func(name string) string { return lookup[name] }); err == nil {
		t.Fatal("an environment outside the ingest rule must be an error")
	}
}
