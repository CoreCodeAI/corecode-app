package controller

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
)

// stubHKDSourceForTest points both FX sources at one server that answers
// body and counts its hits.
func stubHKDSourceForTest(t *testing.T, body string) *atomic.Int32 {
	t.Helper()
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		_, _ = w.Write([]byte(body))
	}))
	previous := hkdPerCNYSources
	hkdPerCNYSources = []hkdPerCNYSource{
		{name: previous[0].name, url: server.URL, parse: previous[0].parse},
		{name: previous[0].name, url: server.URL, parse: previous[0].parse},
	}
	t.Cleanup(func() {
		hkdPerCNYSources = previous
		server.Close()
	})
	return &hits
}

func TestPricingHKDPerCNYNeverWaitsAndFetchesInTheBackground(t *testing.T) {
	resetHKDPerCNYForTest(t)
	previousDiscount := setting.StripeHKDDiscount
	setting.StripeHKDDiscount = 0.01
	t.Cleanup(func() { setting.StripeHKDDiscount = previousDiscount })
	hits := stubHKDSourceForTest(t, `{"rates":{"HKD":1.1}}`)

	// No rate yet: the page gets 0 at once, and a fetch starts.
	assert.Equal(t, 0.0, pricingHKDPerCNY())
	assert.Eventually(t, func() bool { return hkdPerCNYLatest.Load() != nil && !hkdPerCNYRefreshing.Load() },
		5*time.Second, 10*time.Millisecond)
	assert.Equal(t, int32(1), hits.Load())

	// The fetched rate, less the Checkout discount: 1.1 × 0.99.
	assert.Equal(t, 1.089, pricingHKDPerCNY())
	assert.Equal(t, int32(1), hits.Load(), "a fresh rate starts no fetch")
}

func TestPricingHKDPerCNYDropsARateOlderThanADay(t *testing.T) {
	resetHKDPerCNYForTest(t)
	hits := stubHKDSourceForTest(t, `{"rates":{"HKD":1.1}}`)
	// The lock's cache says a fetch is not due, so the background refresh
	// changes nothing and the stale quote stays.
	hkdPerCNY.rate, hkdPerCNY.fetchedAt, hkdPerCNY.nextFetch = decimal.RequireFromString("1.1"), time.Now(), time.Now().Add(time.Hour)
	hkdPerCNYLatest.Store(&hkdPerCNYQuote{rate: decimal.RequireFromString("1.2"), fetchedAt: time.Now().Add(-hkdPerCNYMaxAge - time.Minute)})

	assert.Equal(t, 0.0, pricingHKDPerCNY())
	assert.Eventually(t, func() bool { return !hkdPerCNYRefreshing.Load() }, 5*time.Second, 10*time.Millisecond)
	assert.Equal(t, int32(0), hits.Load())
}
