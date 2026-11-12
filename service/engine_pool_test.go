package service

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchEnginePool(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/api/group-concurrency":
			_, _ = w.Write([]byte(`{"code":0,"data":{"observed_at_ms":1000,"credential_limit":5,
				"default_quota_budget":{"enabled":true,"five_hour_percent":90,"seven_day_percent":95},
				"groups":[
					{"id":1,"name":"us-01","channel_id":"claude","enabled":true,"current":2,"override_limit":null,"effective_limit":0,"quota_supported":true,
					 "quota_effective":{"enabled":true,"five_hour_percent":90,"seven_day_percent":95},"counts":{"total":1,"available":1},
					 "credentials":[{"id":6,"name":"#6","status":"available","five_hour":{"utilization":0.05,"reset_at_ms":7},"seven_day":{"utilization":0.36,"reset_at_ms":8},
					   "active":2,"sessions":3,"cooldown_until_ms":null,
					   "activity":{"last_used_at_ms":9,"last_failure_summary":"rate limited","last_failure_at_ms":10,"success_count":40,"failure_count":1},
					   "account":{"state":"fresh","observed_at_ms":11,"email":"bob@x.com","plan":"Max","tier":"default_claude_max_5x",
					     "organization":"bob@x.com's Organization","organization_uuid":"0f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b","subscription_status":"active","subscription_state":"estimated","subscription_period_end_ms":1795000000000}}]},
					{"id":7,"name":"team-01","channel_id":"claude","enabled":true,"current":0,"override_limit":8,"effective_limit":8,"credential_limit":3,"quota_supported":true,
					 "quota_effective":{"enabled":true,"five_hour_percent":90,"seven_day_percent":95},"counts":{"total":3,"available":2,"cooldown":1},
					 "credentials":[
					   {"id":8,"name":"a@y.com","status":"available","five_hour":{"utilization":0.1},"seven_day":{"utilization":0.2},"active":0,"sessions":0,"activity":null,"account":null},
					   {"id":9,"name":"c@y.com","status":"available","five_hour":{"utilization":null},"seven_day":{"utilization":null},"active":0,"sessions":0,"activity":null,"account":null},
					   {"id":10,"name":"d@y.com","status":"cooldown","five_hour":{},"seven_day":{},"active":0,"sessions":0,"cooldown_until_ms":123,"activity":null,"account":null}]},
					{"id":9,"name":"off","enabled":false,"current":0,"effective_limit":0,"quota_supported":true,"quota_effective":{"enabled":false},
					 "counts":{"total":1,"available":1},
					 "credentials":[{"id":12,"name":"e@z.com","status":"available","five_hour":{},"seven_day":{},"active":0,"sessions":0}]}
				]}}`))
		case "/api/group-concurrency/pool-estimate":
			_, _ = w.Write([]byte(`{"code":0,"data":{
				"five_hour":{"remaining_usd":400,"remaining_low_usd":380,"remaining_high_usd":420,"capacity_usd":600,"counted":4,"unknown":1},
				"week":{"remaining_usd":2500,"remaining_low_usd":2400,"remaining_high_usd":2600,"capacity_usd":4000,"counted":4,"unknown":1},
				"refills":[{"credential_id":6,"name":"bob@x.com","at_ms":99,"adds_usd":20}],
				"week_unused":{"usd":120.5,"counted":1},
				"accounts":[{"credential_id":6,"five_hour":{"remaining_usd":150},"seven_day":{"remaining_usd":800,"capacity_usd":1250,"source":"measured"},"burn_usd_per_hour":9.5,"week_unused_usd":120.5}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = "", ""
	assert.False(t, FetchEnginePool().Configured)

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL+"/", "secret"
	pool := FetchEnginePool()
	require.Empty(t, pool.Error)
	assert.Equal(t, 5, pool.CredentialConcurrency)
	assert.Equal(t, 2, pool.InFlight)
	require.Len(t, pool.Accounts, 5, "every account of every group, not just the home page's")
	assert.Equal(t, 3, pool.EligibleAccounts, "the cooling account and the disabled group's account are not eligible")
	assert.Equal(t, 5+6, pool.EffectiveSlots, "us-01 reports no limit of its own and takes the default of five; team-01's two accounts take its own three each")
	require.Len(t, pool.Groups, 3)
	assert.Zero(t, pool.Groups[0].CredentialLimit)
	assert.Equal(t, EngineGroup{ID: 7, Name: "team-01", Channel: "claude", Provider: "claude", Enabled: true, EffectiveLimit: 8, OverrideLimit: pool.Groups[1].OverrideLimit,
		CredentialLimit: 3, Accounts: 3, Eligible: 2, Slots: 6, Counts: map[string]int{"total": 3, "available": 2, "cooldown": 1},
		QuotaBudget: true, FiveHourBudget: 90, SevenDayBudget: 95}, pool.Groups[1])
	assert.Equal(t, 8, *pool.Groups[1].OverrideLimit)
	assert.Zero(t, pool.Groups[2].Slots, "a disabled group serves nothing")

	first := pool.Accounts[0]
	assert.Equal(t, "b***@x.com", first.EmailMask, "the email is masked before it reaches the console")
	assert.Equal(t, 5.0, first.FiveHour)
	assert.Equal(t, 36.0, first.SevenDay)
	assert.Equal(t, int64(8), first.SevenDayReset)
	assert.Equal(t, 3, first.Sessions)
	assert.Equal(t, int64(40), first.Successes)
	assert.Equal(t, "rate limited", first.LastFailure)
	assert.Equal(t, "Max", first.Plan)
	assert.Equal(t, "b***@x.com's Organization", first.Organization, "an email in the organization is masked too")
	assert.Equal(t, "estimated", first.SubscriptionState)
	assert.Equal(t, "0f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", first.OrganizationUUID)
	assert.Equal(t, "active", first.SubscriptionStatus)
	assert.Equal(t, int64(1795000000000), first.SubscriptionPeriodEnd)
	assert.Zero(t, pool.Accounts[1].SubscriptionPeriodEnd, "an account without an observation has no renewal")
	assert.Equal(t, 150.0, *first.FiveHourRemainingUSD)
	assert.Equal(t, 9.5, *first.BurnUSDPerHour)
	require.NotNil(t, first.SevenDayUnusedUSD)
	assert.Equal(t, 120.5, *first.SevenDayUnusedUSD, "the projected waste reaches the console per account")
	assert.Nil(t, pool.Accounts[1].SevenDayUnusedUSD, "an account the estimate has no projection for shows none")
	require.NotNil(t, pool.WeekUnused)
	assert.Equal(t, EngineUnused{USD: 120.5, Counted: 1}, *pool.WeekUnused)
	assert.Equal(t, 1250.0, *first.SevenDayCapacityUSD)
	assert.Equal(t, "measured", first.SevenDayCapacitySource)
	assert.Nil(t, pool.Accounts[1].SevenDayCapacityUSD)
	assert.Nil(t, pool.Accounts[1].FiveHourRemainingUSD)
	assert.Equal(t, "a***@y.com", pool.Accounts[1].EmailMask)
	assert.Equal(t, int64(123), pool.Accounts[3].CooldownUntil)
	require.NotNil(t, pool.FiveHour)
	assert.Equal(t, 400.0, pool.FiveHour.RemainingUSD)
	assert.Equal(t, []EngineRefill{{CredentialID: 6, At: 99, AddsUSD: 20}}, pool.Refills)
	require.NotNil(t, pool.Runway)
	assert.Equal(t, "claude", pool.Runway.Channel)
	assert.Equal(t, 1, pool.Runway.Counted)
	assert.Equal(t, 3, pool.Runway.Unknown, "the Claude accounts the estimate has no reading for")
	assert.Equal(t, 1250*0.95, pool.Runway.WeekCapacityUSD)
	assert.Equal(t, 9.5, pool.Runway.BurnUSDPerHour)

	before := requests.Load()
	assert.Equal(t, pool, FetchEnginePool(), "a complete read is reused within the TTL")
	assert.Equal(t, before, requests.Load(), "the reuse does not ask the engine")

	operation_setting.EngineControlKey = "wrong"
	assert.Contains(t, FetchEnginePool().Error, "HTTP 401")
}

func TestRecentEnginePoolServesTheLastReadWhileRefreshing(t *testing.T) {
	var reads atomic.Int32
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/group-concurrency":
			n := reads.Add(1)
			if n > 1 {
				<-release // the background read stays in flight until released
			}
			_, _ = w.Write([]byte(`{"code":0,"data":{"observed_at_ms":` + strconv.Itoa(int(n)) + `,"credential_limit":1,"groups":[]}}`))
		case "/api/group-concurrency/pool-estimate":
			_, _ = w.Write([]byte(`{"code":0,"data":{"five_hour":{},"week":{},"accounts":[]}}`))
		}
	}))
	defer server.Close()
	defer close(release)
	previousURL, previousKey, previousTTL := operation_setting.EngineControlURL, operation_setting.EngineControlKey, enginePoolTTL
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey, enginePoolTTL = previousURL, previousKey, previousTTL
	})
	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "recent"

	first := RecentEnginePool(time.Minute)
	require.Empty(t, first.Error)
	assert.EqualValues(t, 1, first.ObservedAt, "without a read it waits for one")

	enginePoolTTL = 0
	stale := RecentEnginePool(time.Minute)
	assert.EqualValues(t, 1, stale.ObservedAt, "an older read is returned without waiting for the engine")
	assert.Eventually(t, func() bool { return reads.Load() == 2 }, time.Second, 10*time.Millisecond,
		"the older read starts a new one in the background")
}

func TestEnginePoolListsClaudeFirst(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/group-concurrency":
			_, _ = w.Write([]byte(`{"code":0,"data":{"credential_limit":1,"groups":[
				{"id":1,"name":"Codex","channel_id":"codex","enabled":true,"credentials":[{"id":11,"name":"a@x.com","status":"available"}]},
				{"id":2,"name":"Team","channel_id":"claude","enabled":true,"credentials":[{"id":21,"name":"b@x.com","status":"available"},{"id":22,"name":"c@x.com","status":"available"}]},
				{"id":3,"name":"Grok","channel_id":"grok","enabled":true,"credentials":[{"id":31,"name":"d@x.com","status":"available"}]},
				{"id":4,"name":"Own IP","channel_id":"claude","enabled":true,"credentials":[{"id":41,"name":"e@x.com","status":"available"}]}
			]}}`))
		case "/api/group-concurrency/pool-estimate":
			_, _ = w.Write([]byte(`{"code":0,"data":{"five_hour":{},"week":{}}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})
	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "claude-first"

	pool := FetchEnginePool()
	require.Empty(t, pool.Error)
	var groups, accounts []int
	for _, group := range pool.Groups {
		groups = append(groups, group.ID)
	}
	for _, account := range pool.Accounts {
		accounts = append(accounts, account.CredentialID)
	}
	assert.Equal(t, []int{2, 4, 1, 3}, groups, "Claude groups first, each side in the engine's order")
	assert.Equal(t, []int{21, 22, 41, 11, 31}, accounts, "accounts follow their groups")
}

func TestEnginePoolKeepsProviderQuotaWindowsWithoutDollarEstimate(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/group-concurrency" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"groups":[
			{"id":11,"channel_id":"codex","enabled":true,"quota_supported":false,"credentials":[
				{"id":5012,"status":"available","account":{"state":"fresh","windows":[
					{"id":"primary","label":"7d","scope":"account","utilization":0.02,"reset_at_ms":1794378753000,"observed_at_ms":1793775167746,"state":"available"},
					{"id":"spark-primary","label":"5h","scope":"Spark","utilization":0,"state":"available"},
					{"id":"review","label":"Code review","scope":"account","utilization":null,"reset_at_ms":1794378753000,"state":"unavailable"},
					{"id":"secondary","label":"7d","scope":"Spark","utilization":1,"state":"exhausted"}
				]}},
				{"id":5013,"status":"available","account":null}
			]}
		]}}`))
	}))
	defer server.Close()

	pool := readEnginePool(server.URL, "quota-windows")
	require.Empty(t, pool.Error)
	require.NotEmpty(t, pool.EstimateError)
	encoded, err := common.Marshal(pool)
	require.NoError(t, err)
	var payload struct {
		Accounts []struct {
			QuotaWindows []struct {
				ID, Label, Scope, State string
				Utilization             *float64
				ResetAtMS               *int64 `json:"reset_at_ms"`
				ObservedAtMS            *int64 `json:"observed_at_ms"`
			} `json:"quota_windows"`
		} `json:"accounts"`
	}
	require.NoError(t, common.Unmarshal(encoded, &payload))
	require.Len(t, payload.Accounts, 2)
	windows := payload.Accounts[0].QuotaWindows
	require.Len(t, windows, 4, "provider quotas are independent of Claude's budget and dollar estimate")
	assert.Equal(t, "primary", windows[0].ID)
	assert.Equal(t, "7d", windows[0].Label, "a Codex primary window is not necessarily five hours")
	assert.Equal(t, "account", windows[0].Scope)
	require.NotNil(t, windows[0].Utilization)
	assert.Equal(t, 0.02, *windows[0].Utilization)
	require.NotNil(t, windows[0].ResetAtMS)
	assert.EqualValues(t, 1794378753000, *windows[0].ResetAtMS)
	require.NotNil(t, windows[0].ObservedAtMS)
	assert.EqualValues(t, 1793775167746, *windows[0].ObservedAtMS)
	require.NotNil(t, windows[1].Utilization)
	assert.Zero(t, *windows[1].Utilization)
	assert.Equal(t, "Spark", windows[1].Scope)
	assert.Nil(t, windows[2].Utilization, "missing usage must not become zero usage")
	assert.Equal(t, "exhausted", windows[3].State)
	assert.Empty(t, payload.Accounts[1].QuotaWindows)
}

func TestSetEngineSubscriptionRenewal(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	var gotBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		require.NoError(t, common.DecodeJson(r.Body, &gotBody))
		_, _ = w.Write([]byte(`{"code":0,"data":[]}`))
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = "", ""
	assert.Error(t, SetEngineSubscriptionRenewal(t.Context(), "org", "2026-11-09", "Max"))

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "secret"
	enginePoolCache.mu.Lock()
	enginePoolCache.readAt = time.Now()
	enginePoolCache.mu.Unlock()
	require.NoError(t, SetEngineSubscriptionRenewal(t.Context(), "0f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", "2026-11-09", "Max"))
	assert.Equal(t, http.MethodPut, gotMethod)
	assert.Equal(t, "/api/subscription-renewals/0f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b", gotPath)
	assert.Equal(t, "Bearer secret", gotAuth)
	assert.Equal(t, map[string]string{"renews_on": "2026-11-09", "organization_name": "Max"}, gotBody)
	enginePoolCache.mu.Lock()
	assert.True(t, enginePoolCache.readAt.IsZero(), "the next pool read asks the engine again")
	enginePoolCache.mu.Unlock()
}

func TestEnginePoolCarriesResetCredits(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/group-concurrency" {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"groups":[
			{"id":7,"channel_id":"claude","enabled":true,"credentials":[
				{"id":21,"status":"available","account":{"state":"fresh","windows":[],"reset_credits":[
					{"expires_at_ms":1796940000000,"kind":"full"},{"expires_at_ms":1804579140000,"kind":"partial"}
				]}},
				{"id":22,"status":"available","account":{"state":"fresh","windows":[]}},
				{"id":23,"status":"available","account":null}
			]}
		]}}`))
	}))
	defer server.Close()

	pool := readEnginePool(server.URL, "reset-credits")
	require.Empty(t, pool.Error)
	require.Len(t, pool.Accounts, 3)
	credits := pool.Accounts[0].ResetCredits
	require.Len(t, credits, 2)
	assert.Equal(t, "full", credits[0].Kind)
	assert.Equal(t, "partial", credits[1].Kind)
	require.NotNil(t, credits[1].ExpiresAtMS)
	assert.EqualValues(t, 1804579140000, *credits[1].ExpiresAtMS)
	for _, account := range pool.Accounts[1:] {
		assert.NotNil(t, account.ResetCredits, "an engine without reset credits still sends an empty list")
		assert.Empty(t, account.ResetCredits)
	}
}

func TestConsumeEngineResetCredit(t *testing.T) {
	const key = "9f0f4c32-89d2-4bcb-9e19-052940dc2f17"
	var gotMethod, gotPath, gotAuth, gotKey string
	var gotBody map[string]string
	status, answer := http.StatusOK, `{"code":0,"data":{"status":"succeeded","windows_reset":2,"replayed":false}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth, gotKey = r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Idempotency-Key")
		gotBody = nil
		require.NoError(t, common.DecodeJson(r.Body, &gotBody))
		w.WriteHeader(status)
		_, _ = w.Write([]byte(answer))
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = "", ""
	_, err := ConsumeEngineResetCredit(t.Context(), 7, 21, "full", key)
	assert.ErrorIs(t, err, ErrEngineControlNotConfigured)

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "secret"
	enginePoolCache.mu.Lock()
	enginePoolCache.readAt = time.Now()
	enginePoolCache.mu.Unlock()
	result, err := ConsumeEngineResetCredit(t.Context(), 7, 21, "partial", key)
	require.NoError(t, err)
	assert.Equal(t, "succeeded", result.Status)
	assert.Equal(t, 2, result.WindowsReset)
	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/api/groups/7/credentials/21/reset-credits/consume", gotPath)
	assert.Equal(t, "Bearer secret", gotAuth)
	assert.Equal(t, key, gotKey)
	assert.Equal(t, map[string]string{"kind": "partial"}, gotBody)
	enginePoolCache.mu.Lock()
	assert.True(t, enginePoolCache.readAt.IsZero(), "the next pool read shows the credits left")
	enginePoolCache.mu.Unlock()

	_, err = ConsumeEngineResetCredit(t.Context(), 7, 21, "", key)
	require.NoError(t, err)
	assert.Empty(t, gotBody, "without a kind the provider picks the credit")

	status, answer = http.StatusConflict, `{"code":"RESET_CREDIT_UNAVAILABLE","message":"No reset credit is currently available"}`
	_, err = ConsumeEngineResetCredit(t.Context(), 7, 21, "full", key)
	var engineErr *EngineHTTPError
	require.ErrorAs(t, err, &engineErr)
	assert.Equal(t, http.StatusConflict, engineErr.Status)
	assert.Equal(t, "RESET_CREDIT_UNAVAILABLE", engineErr.Code)
	assert.Equal(t, "engine /groups/7/credentials/21/reset-credits/consume returned HTTP 409", err.Error())
}
