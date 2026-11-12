package service

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The engine's daily usage is read once per engineUsageTTL for one range, one
// model prefix and one offset; a failed read is not kept.
func TestEngineUsageReadIsSharedWithinTTL(t *testing.T) {
	var hits atomic.Int32
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if fail.Load() {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		_, _ = w.Write([]byte(`{"code":0,"data":{"days":[]}}`))
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "secret"
	engineUsageCache.mu.Lock()
	engineUsageCache.entries = nil
	engineUsageCache.mu.Unlock()
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
		engineUsageCache.mu.Lock()
		engineUsageCache.entries = nil
		engineUsageCache.mu.Unlock()
	})

	const start, end, offset = int64(1761408000), int64(1761580800), int64(8 * 3600)
	FetchEngineDailyCost(start, end, offset)
	FetchEngineDailyCost(start, end, offset)
	assert.Equal(t, int32(1), hits.Load(), "the second read of the same range is shared")

	FetchEngineDailyTotal(start, end, offset)
	assert.Equal(t, int32(2), hits.Load(), "every model is another read")

	FetchEngineDailyCost(start, end, 0)
	assert.Equal(t, int32(3), hits.Load(), "another offset is another read")

	fail.Store(true)
	failed := FetchEngineDailyCost(start+3600, end, offset)
	require.NotEmpty(t, failed.Error)
	fail.Store(false)
	again := FetchEngineDailyCost(start+3600, end, offset)
	assert.Empty(t, again.Error, "a failed read is not kept")
	assert.Equal(t, int32(5), hits.Load())

	engineUsageCache.mu.Lock()
	for key, entry := range engineUsageCache.entries {
		entry.readAt = entry.readAt.Add(-engineUsageTTL)
		engineUsageCache.entries[key] = entry
	}
	engineUsageCache.mu.Unlock()
	FetchEngineDailyCost(start, end, offset)
	assert.Equal(t, int32(6), hits.Load(), "a read past the TTL asks the engine again")
}
