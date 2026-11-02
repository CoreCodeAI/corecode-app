package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchEngineDailyCost(t *testing.T) {
	var query string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/usage/daily" || r.Header.Get("Authorization") != "Bearer secret" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		query = r.URL.RawQuery
		_, _ = w.Write([]byte(`{"code":0,"data":{"days":[
			{"day_start_ms":1761408000000,"request_count":3,"unpriced_request_count":1,"estimated_cost_nano_usd":"1500000000"},
			{"day_start_ms":1761494400000,"request_count":2,"estimated_cost_nano_usd":"9007199254740993000"}]}}`))
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = "", ""
	assert.Equal(t, EngineDailyCost{Daily: []EngineCostDay{}}, FetchEngineDailyCost(0, 86400, 0))

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL+"/", "secret"
	cost := FetchEngineDailyCost(1761408000, 1761580800, 8*3600)
	require.Empty(t, cost.Error)
	assert.Equal(t, "from_ms=1761408000000&model_prefix=claude-&to_ms=1761580800000&tz_offset_minutes=480", query)
	assert.Equal(t, int64(5), cost.Requests)
	assert.Equal(t, int64(1), cost.Unpriced)
	require.Len(t, cost.Daily, 2)
	assert.Equal(t, EngineCostDay{Day: 1761408000, CostUSD: 1.5, Requests: 3}, cost.Daily[0])
	assert.InDelta(t, 9007199254.740993, cost.Daily[1].CostUSD, 1e-3, "nano dollars past 2^53 still convert")
	assert.InDelta(t, 9007199256.240993, cost.CostUSD, 1e-3)

	FetchEngineDailyTotal(1761408000, 1761580800, 8*3600)
	assert.Equal(t, "from_ms=1761408000000&to_ms=1761580800000&tz_offset_minutes=480", query, "every model")

	half := FetchEngineDailyCost(1761408000, 1761580800, 5*3600+1800)
	assert.True(t, half.Configured)
	assert.NotEmpty(t, half.Error, "a half-hour offset cannot split on hourly buckets")

	operation_setting.EngineControlKey = "wrong"
	assert.Contains(t, FetchEngineDailyCost(1761408000, 1761580800, 0).Error, "HTTP 404")
}
