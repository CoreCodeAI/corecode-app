package service

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestQuotaSinceSharesTheHourInsideTheWindow(t *testing.T) {
	quota := common.QuotaPerUnit
	hours := map[int64]int64{
		0:    int64(6 * quota), // a whole hour
		3600: int64(3 * quota), // the open hour, 1800 s of it passed
	}
	now := int64(3600 + 1800)
	// The last 30 minutes are the open hour's whole use so far.
	assert.InDelta(t, 3, quotaSince(hours, now-1800, now), 1e-9)
	// The last hour takes the open hour and the second half of the one before.
	assert.InDelta(t, 3+3, quotaSince(hours, now-3600, now), 1e-9)
	assert.InDelta(t, 9, quotaSince(hours, now-3*3600, now), 1e-9)
}

func TestChannelProviderNamesTheVendorItServes(t *testing.T) {
	assert.Equal(t, model.VendorClaude, ChannelProvider("claude"))
	assert.Equal(t, model.VendorCodex, ChannelProvider("codex"))
	assert.Equal(t, model.VendorGemini, ChannelProvider("antigravity"))
	assert.Equal(t, "openai", ChannelProvider("openai"), "a channel no vendor names keeps its own name")
	assert.Equal(t, []string{"gpt-", "codex-"}, model.VendorPrefixes(model.VendorCodex))
}

func TestDemandOverMovesTheLevelThroughTheDay(t *testing.T) {
	hour := time.Hour.Milliseconds()
	flat := flatDemand()
	// Half an hour into an hour, for two hours: two hours at $10.
	assert.InDelta(t, 20, flat.over(10, hour/2, hour/2+2*hour, false), 1e-9)

	shaped := flatDemand()
	shaped.shape[0], shaped.shape[1] = 2, 0
	assert.InDelta(t, 20, shaped.over(10, 0, 2*hour, false), 1e-9, "hour 0 doubles, hour 1 is idle")

	growing := flatDemand()
	growing.growth = 0.1
	assert.Greater(t, growing.over(10, 0, 24*hour, true), growing.over(10, 0, 24*hour, false))
}

func TestReadPoolUsageReadsBothSidesForOneProvider(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.QuotaData{}))
	previousDB := model.DB
	model.DB = db
	t.Cleanup(func() { model.DB = previousDB })

	hour := int64(1_800_000_000) - 1_800_000_000%3600
	now := time.Unix(hour+1800, 0)
	quota := int(common.QuotaPerUnit)
	require.NoError(t, db.Create(&[]model.QuotaData{
		{ModelName: "claude-sonnet", CreatedAt: hour, Quota: 2 * quota},
		{ModelName: "claude-opus", CreatedAt: hour - 3600, Quota: 4 * quota},
		{ModelName: "claude-opus", CreatedAt: hour - 30*3600, Quota: 10 * quota},
		{ModelName: "gpt-5", CreatedAt: hour, Quota: 100 * quota},
	}).Error)

	var requested []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/group-concurrency":
			_, _ = w.Write([]byte(`{"code":0,"data":{"credential_limit":1,"groups":[
				{"id":1,"name":"Team","channel_id":"claude","enabled":true,"credentials":[]},
				{"id":2,"name":"Codex","channel_id":"codex","enabled":true,"credentials":[]}
			]}}`))
		case "/api/group-concurrency/pool-estimate":
			_, _ = w.Write([]byte(`{"code":0,"data":{"five_hour":{},"week":{}}}`))
		case "/api/usage":
			query := r.URL.Query()
			requested = append(requested, query.Get("channel_id"))
			from, _ := strconv.ParseInt(query.Get("from_ms"), 10, 64)
			to, _ := strconv.ParseInt(query.Get("to_ms"), 10, 64)
			// $1 an hour of the span, in nano-dollars, with one $1 bucket.
			cost := (to - from) * 1_000_000_000 / time.Hour.Milliseconds()
			_, _ = w.Write([]byte(`{"code":0,"data":{"summary":{"request_count":3,"estimated_cost_nano_usd":"` +
				strconv.FormatInt(cost, 10) + `","unpriced_request_count":1},"series":[{"bucket_start_ms":` +
				strconv.FormatInt(from, 10) + `,"estimated_cost_nano_usd":"1000000000"}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})
	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "pool-usage"

	usage, err := readPoolUsage(model.VendorClaude, now)
	require.NoError(t, err)
	require.Empty(t, usage.EngineError)
	assert.Equal(t, []string{"claude"}, usage.Channels, "only the provider's channels")
	for _, channel := range requested {
		assert.Equal(t, "claude", channel)
	}
	require.Len(t, usage.Windows, len(PoolUsageWindowHours))
	one, day, week := usage.Windows[0], usage.Windows[4], usage.Windows[5]
	// The open hour's ¥2, and half of the hour before's ¥4.
	assert.InDelta(t, 4, one.Quota, 1e-9)
	assert.InDelta(t, 6, day.Quota, 1e-9, "the hour 30 hours back is outside a day")
	assert.InDelta(t, 16, week.Quota, 1e-9, "Codex's models are not Claude's")
	assert.InDelta(t, 1, one.EngineUSD, 1e-9)
	assert.InDelta(t, 168, week.EngineUSD, 1e-6)
	assert.Equal(t, int64(3), one.EngineRequests)
	assert.Equal(t, int64(1), one.EngineUnpriced)
	assert.InDelta(t, 168/16.0, usage.OfficialPerQuota, 1e-6)

	require.Len(t, usage.Hourly, poolUsageSeriesHours)
	last := usage.Hourly[len(usage.Hourly)-1]
	assert.Equal(t, hour, last.Hour)
	assert.InDelta(t, 2, last.Quota, 1e-9)
	assert.InDelta(t, 1, usage.Hourly[0].EngineUSD, 1e-9, "each day's span starts with a $1 bucket")

	// Without a day of shape, the forecast holds the last day's level flat.
	assert.Zero(t, usage.Forecast.ProfileHours)
	assert.InDelta(t, 24, usage.Forecast.Next24hUSD, 1e-6)
	assert.InDelta(t, 5, usage.Forecast.Next5hUSD, 1e-6)
	assert.InDelta(t, 6, usage.Forecast.Next24hQuota, 1e-6)
	assert.Nil(t, usage.Forecast.Next24hLowUSD)
}

func TestFetchPoolUsageRejectsAnUnknownProvider(t *testing.T) {
	_, err := FetchPoolUsage("openai")
	assert.Error(t, err)
}
