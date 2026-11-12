package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A poll a minute after the last read is served from the cache: the console
// polls every minute, so the cache has to outlast one interval.
func TestUserSpendPollHitsItsCache(t *testing.T) {
	userSpendCache.mu.Lock()
	previous := userSpendCache.entries
	userSpendCache.entries = map[int64]userSpendEntry{
		24: {spend: UserSpend{Hours: 24, Customers: 7}, readAt: time.Now().Add(-90 * time.Second)},
	}
	userSpendCache.mu.Unlock()
	t.Cleanup(func() {
		userSpendCache.mu.Lock()
		userSpendCache.entries = previous
		userSpendCache.mu.Unlock()
	})

	spend, err := FetchUserSpend(24)
	require.NoError(t, err)
	assert.Equal(t, 7, spend.Customers, "a read 90 seconds old is still shared")
}
