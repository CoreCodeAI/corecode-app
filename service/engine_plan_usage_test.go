package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func stubUsageCredentials(t *testing.T, status int, body string) (*string, string) {
	t.Helper()
	var query string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/usage/credentials" || r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		query = r.URL.RawQuery
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})
	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL+"/", "secret"
	return &query, server.URL
}

func TestFetchEngineCredentialUsage(t *testing.T) {
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})
	operation_setting.EngineControlURL, operation_setting.EngineControlKey = "", ""
	assert.Equal(t, EngineCredentialUsage{}, FetchEngineCredentialUsage(0, 86400000))

	query, _ := stubUsageCredentials(t, http.StatusOK, `{"code":0,"data":{"from_ms":1761408000000,"to_ms":1761494400000,"observed_at_ms":1,"credentials":[
		{"credential_id":7,"group_id":2,"created_at_ms":1761000000000,"subscription_created_at_ms":1760000000000,"request_count":3,"success_count":2,"failure_count":1,"estimated_cost_nano_usd":"1500000000"},
		{"credential_id":7,"group_id":3,"created_at_ms":1761000000000,"subscription_created_at_ms":null,"request_count":2,"success_count":2,"failure_count":0,"estimated_cost_nano_usd":"9007199254740993000"},
		{"credential_id":0,"group_id":2,"created_at_ms":null,"subscription_created_at_ms":null,"request_count":1,"success_count":1,"failure_count":0,"estimated_cost_nano_usd":"0"}]}}`)
	usage := FetchEngineCredentialUsage(1761408000000, 1761494400000)
	assert.Equal(t, "from_ms=1761408000000&to_ms=1761494400000", *query)
	require.True(t, usage.Configured)
	assert.False(t, usage.Unsupported)
	assert.Empty(t, usage.Error)
	require.Len(t, usage.Credentials, 3)
	first := usage.Credentials[0]
	assert.Equal(t, int64(7), first.CredentialID)
	assert.Equal(t, int64(2), first.GroupID)
	assert.Equal(t, int64(3), first.Requests)
	assert.Equal(t, int64(1), first.Failures)
	assert.InDelta(t, 1.5, first.CostUSD, 1e-9)
	require.NotNil(t, first.CreatedAtMS)
	assert.Equal(t, int64(1761000000000), *first.CreatedAtMS)
	require.NotNil(t, first.SubscriptionCreatedAtMS)
	assert.Equal(t, int64(1760000000000), *first.SubscriptionCreatedAtMS)
	second := usage.Credentials[1]
	assert.Nil(t, second.SubscriptionCreatedAtMS)
	assert.InDelta(t, 9007199254.740993, second.CostUSD, 1e-3, "nano dollars past 2^53 still convert")
	assert.Equal(t, int64(0), usage.Credentials[2].CredentialID)
}

func TestFetchEngineCredentialUsageOlderEngine(t *testing.T) {
	stubUsageCredentials(t, http.StatusNotFound, `{"code":404}`)
	usage := FetchEngineCredentialUsage(0, 86400000)
	assert.True(t, usage.Configured)
	assert.True(t, usage.Unsupported, "a 404 is an engine without the endpoint, not an error")
	assert.Empty(t, usage.Error)
	assert.Empty(t, usage.Credentials)
}

func TestFetchEngineCredentialUsageReportsErrors(t *testing.T) {
	stubUsageCredentials(t, http.StatusInternalServerError, `{"code":500}`)
	usage := FetchEngineCredentialUsage(0, 86400000)
	assert.True(t, usage.Configured)
	assert.False(t, usage.Unsupported)
	assert.Contains(t, usage.Error, "HTTP 500")

	stubUsageCredentials(t, http.StatusOK, `{"code":0,"data":{"credentials":[{"credential_id":1,"group_id":1,"estimated_cost_nano_usd":"-1"}]}}`)
	usage = FetchEngineCredentialUsage(0, 86400000)
	assert.Contains(t, usage.Error, "invalid cost")
}

func TestEnginePlanUsageByCredential(t *testing.T) {
	const start = int64(1761408000000)
	accounts := []EngineAccount{
		{CredentialID: 7, GroupID: 2, Plan: "Max", Tier: "default_claude_max_5x"},
		{CredentialID: 7, GroupID: 3, Plan: "Max", Tier: "default_claude_max_5x"},
		{CredentialID: 8, GroupID: 2, Plan: "Team", Tier: "team_standard"},
		{CredentialID: 9, GroupID: 2, Plan: "Pro", Tier: "default_claude_pro"},
	}
	created := func(ms int64) *int64 { return &ms }
	usage := EngineCredentialUsage{Configured: true, Credentials: []EngineCredentialRow{
		{CredentialID: 7, GroupID: 2, CreatedAtMS: created(start - 1000), Requests: 10, Failures: 1, CostUSD: 4},
		{CredentialID: 7, GroupID: 3, CreatedAtMS: created(start - 1000), Requests: 5, Failures: 0, CostUSD: 2.5},
		{CredentialID: 8, GroupID: 2, CreatedAtMS: created(start + 1000), Requests: 3, Failures: 2, CostUSD: 0.5},
		{CredentialID: 42, GroupID: 2, CreatedAtMS: nil, Requests: 4, Failures: 1, CostUSD: 1},
		{CredentialID: 0, GroupID: 2, CreatedAtMS: nil, Requests: 2, Failures: 0, CostUSD: 0.25},
	}}

	plan := EnginePlanUsageByCredential(accounts, usage, start)

	require.Len(t, plan.Plans, 3)
	assert.Equal(t, EnginePlanUsageRow{
		Plan: "Max", Tier: "default_claude_max_5x",
		EngineUsageTotal: EngineUsageTotal{Accounts: 1, Requests: 15, Failures: 1, ServedUSD: 6.5},
	}, plan.Plans[0], "one credential in two groups counts once and sums both groups")
	assert.Equal(t, "Pro", plan.Plans[1].Plan)
	assert.Equal(t, EngineUsageTotal{}, plan.Plans[1].EngineUsageTotal, "a pool account with no usage is listed with zeros")
	assert.Equal(t, "Team", plan.Plans[2].Plan)
	assert.Equal(t, 1, plan.Plans[2].AddedInRange, "created after the range's start")
	assert.Equal(t, 0, plan.Plans[0].AddedInRange)
	assert.Equal(t, EngineUsageTotal{Accounts: 1, Requests: 4, Failures: 1, ServedUSD: 1}, plan.Removed)
	assert.Equal(t, EngineUsageTotal{Requests: 2, ServedUSD: 0.25}, plan.Unattributed)
	total := 0.0
	for _, row := range plan.Plans {
		total += row.ServedUSD
	}
	total += plan.Removed.ServedUSD + plan.Unattributed.ServedUSD
	assert.InDelta(t, 4+2.5+0.5+1+0.25, total, 1e-9, "rows add up to the engine's total")
}
