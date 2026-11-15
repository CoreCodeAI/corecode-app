package controller

import (
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"golang.org/x/sync/singleflight"
)

// A view's model read is shared and, for a settled range, kept. Concurrent
// calls with the same key share one read, for example a request repeated while
// another is running. A read over a settled range (model.InsightsRangeSettled)
// is kept for insightsSettledTTL, because its request logs can no longer change.
// The other tables a view reads (balances, orders, plans) and a rollup rebuilt
// by FillInsightHours can still change inside the TTL; the console already
// treats the previous period as fresh for five minutes. A range still running
// is never kept.
//
// Only the model read is cached. Live figures a handler adds after it (in-flight
// requests, the engine's cost and pool, the exchange rate) are read on every
// request, so none of them is frozen. The operator's writes that a view reads
// (channel costs, upstream fees) drop the kept answers on this process.
const (
	insightsSettledTTL      = 5 * time.Minute
	insightsSettledMaxItems = 256
	insightsSettledMaxBytes = 32 << 20
)

// settledInsightsNow is the clock the cache reads; tests replace it.
var settledInsightsNow = time.Now

type settledInsight struct {
	value   any
	size    int
	expires time.Time
}

// settledInsightCache keeps the answers of settled ranges. mu guards entries,
// bytes (the sum of their sizes) and generation, which forget advances; a read
// that started under an older generation keeps nothing. flight shares reads in
// progress.
type settledInsightCache struct {
	mu         sync.Mutex
	entries    map[string]settledInsight
	bytes      int
	generation uint64
	flight     singleflight.Group
}

var settledInsights settledInsightCache

// insightsKey names one answer: the view, the resolved range and the query
// parameters the read depends on. Every element is quoted, so no two different
// lists of elements give the same key.
func insightsKey(view string, r model.InsightsRange, parts []string) string {
	elements := append([]string{view, strconv.FormatInt(r.Start, 10), strconv.FormatInt(r.End, 10), strconv.FormatInt(r.Offset, 10)}, parts...)
	for i, element := range elements {
		elements[i] = strconv.Quote(element)
	}
	return strings.Join(elements, ",")
}

// cachedRead returns read's answer for r. An error reaches the callers that
// shared the read and is not kept.
func cachedRead[T any](view string, r model.InsightsRange, read func(model.InsightsRange) (T, error), parts ...string) (T, error) {
	key := insightsKey(view, r, parts)
	now := settledInsightsNow()
	settled := model.InsightsRangeSettled(r, now.Unix())
	if settled {
		if value, ok := settledInsights.get(key, now); ok {
			return value.(T), nil
		}
	}
	generation := settledInsights.currentGeneration()
	value, err, _ := settledInsights.flight.Do(key, func() (any, error) {
		result, err := read(r)
		if err != nil {
			return nil, err
		}
		if settled {
			settledInsights.put(key, result, now, generation)
		}
		return result, nil
	})
	if err != nil {
		var zero T
		return zero, err
	}
	return value.(T), nil
}

// settledRead returns read with its answer cached as cachedRead does. parts
// are the query parameters the read depends on beyond the range.
func settledRead[T any](view string, read func(model.InsightsRange) (T, error), parts ...string) func(model.InsightsRange) (T, error) {
	return func(r model.InsightsRange) (T, error) {
		return cachedRead(view, r, read, parts...)
	}
}

// forgetSettledInsights drops every kept answer, after a write the views read.
// A read still running keeps nothing when it ends.
func forgetSettledInsights() {
	settledInsights.mu.Lock()
	defer settledInsights.mu.Unlock()
	settledInsights.generation++
	settledInsights.entries = nil
	settledInsights.bytes = 0
}

func (c *settledInsightCache) currentGeneration() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.generation
}

// get returns the kept answer for key if it has not expired at now.
func (c *settledInsightCache) get(key string, now time.Time) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.entries[key]
	if !ok {
		return nil, false
	}
	if !now.Before(entry.expires) {
		c.remove(key)
		return nil, false
	}
	return entry.value, true
}

// put keeps value under key for insightsSettledTTL from now, the time the read
// started, unless the generation has moved on since the read began. An answer
// that does not marshal, or is larger than the byte bound, is not kept. The
// oldest entries go first when the entry or byte bound is reached.
func (c *settledInsightCache) put(key string, value any, now time.Time, generation uint64) {
	body, err := common.Marshal(value)
	if err != nil {
		return
	}
	size := len(key) + len(body)
	if size > insightsSettledMaxBytes {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if generation != c.generation {
		return
	}
	for k, entry := range c.entries {
		if !now.Before(entry.expires) {
			c.remove(k)
		}
	}
	c.remove(key)
	for len(c.entries) > 0 && (len(c.entries) >= insightsSettledMaxItems || c.bytes+size > insightsSettledMaxBytes) {
		oldest := ""
		for k, entry := range c.entries {
			if oldest == "" || entry.expires.Before(c.entries[oldest].expires) {
				oldest = k
			}
		}
		c.remove(oldest)
	}
	if c.entries == nil {
		c.entries = make(map[string]settledInsight)
	}
	c.entries[key] = settledInsight{value: value, size: size, expires: now.Add(insightsSettledTTL)}
	c.bytes += size
}

// remove drops key if it is kept. The caller holds mu.
func (c *settledInsightCache) remove(key string) {
	if entry, ok := c.entries[key]; ok {
		c.bytes -= entry.size
		delete(c.entries, key)
	}
}
