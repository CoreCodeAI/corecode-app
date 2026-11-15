package service

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"golang.org/x/sync/singleflight"
)

// EngineClaudeModelPrefix limits the engine's official-price cost to Claude
// models; the engine can carry other providers' groups too.
const EngineClaudeModelPrefix = model.ClaudeModelPrefix

// EngineCostDay is one local day of Claude usage the engine priced at the
// official rates, before any new-api ratio.
type EngineCostDay struct {
	Day      int64   `json:"day"`
	CostUSD  float64 `json:"cost_usd"`
	Requests int64   `json:"requests"`
}

// EngineDailyCost is the official-price cost per day from the engine, of
// Claude's models or of every model. Configured is false without
// EngineControlURL and EngineControlKey; Error holds a failed read so the
// rest of the view still renders. Unpriced counts requests the engine had
// no price for, which are not in the cost.
type EngineDailyCost struct {
	Configured bool            `json:"configured"`
	Error      string          `json:"error,omitempty"`
	CostUSD    float64         `json:"cost_usd"`
	Requests   int64           `json:"requests"`
	Unpriced   int64           `json:"unpriced_requests"`
	Daily      []EngineCostDay `json:"daily"`
}

type engineUsageDaily struct {
	Days []struct {
		DayStartMS           int64  `json:"day_start_ms"`
		RequestCount         int64  `json:"request_count"`
		UnpricedRequestCount int64  `json:"unpriced_request_count"`
		EstimatedCostNanoUSD string `json:"estimated_cost_nano_usd"`
	} `json:"days"`
}

// FetchEngineDailyCost reads Claude's cost from /api/usage/daily for
// [start, end) in unix seconds, split into days at offset seconds east of
// UTC. The engine splits days on its hourly buckets, so an offset that is
// not whole hours is reported as an error rather than shifted.
func FetchEngineDailyCost(start, end, offset int64) EngineDailyCost {
	return fetchEngineDailyCost(start, end, offset, EngineClaudeModelPrefix)
}

// FetchEngineDailyTotal is FetchEngineDailyCost over every model the engine
// serves: Claude, Codex, Grok and Gemini.
func FetchEngineDailyTotal(start, end, offset int64) EngineDailyCost {
	return fetchEngineDailyCost(start, end, offset, "")
}

func fetchEngineDailyCost(start, end, offset int64, prefix string) EngineDailyCost {
	base := strings.TrimRight(strings.TrimSpace(operation_setting.EngineControlURL), "/")
	key := strings.TrimSpace(operation_setting.EngineControlKey)
	result := EngineDailyCost{Daily: []EngineCostDay{}}
	if base == "" || key == "" {
		return result
	}
	result.Configured = true
	if offset%3600 != 0 {
		result.Error = "engine splits days on whole-hour offsets only"
		return result
	}
	query := url.Values{
		"from_ms":           {strconv.FormatInt(start*1000, 10)},
		"to_ms":             {strconv.FormatInt(end*1000, 10)},
		"tz_offset_minutes": {strconv.FormatInt(offset/60, 10)},
	}
	if prefix != "" {
		query.Set("model_prefix", prefix)
	}
	path := "/usage/daily?" + query.Encode()
	return cachedEngineDailyCost(base+path, func() EngineDailyCost {
		return readEngineDailyCost(base, key, path)
	})
}

// readEngineDailyCost is one uncached read of the engine's daily usage at path,
// priced as the engine priced it.
func readEngineDailyCost(base, key, path string) EngineDailyCost {
	result := EngineDailyCost{Configured: true, Daily: []EngineCostDay{}}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	usage, err := engineGet[engineUsageDaily](ctx, base, key, path)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	var total big.Int
	for _, day := range usage.Days {
		nano, ok := new(big.Int).SetString(day.EstimatedCostNanoUSD, 10)
		if !ok || nano.Sign() < 0 {
			result.Error = fmt.Sprintf("engine usage: invalid cost %q", day.EstimatedCostNanoUSD)
			return result
		}
		total.Add(&total, nano)
		result.Requests += day.RequestCount
		result.Unpriced += day.UnpricedRequestCount
		result.Daily = append(result.Daily, EngineCostDay{
			Day: day.DayStartMS / 1000, CostUSD: nanoToUSD(nano), Requests: day.RequestCount,
		})
	}
	result.CostUSD = nanoToUSD(&total)
	return result
}

// engineUsageTTL is how long a read of the engine's daily usage is shared. An
// overview load asks for the same range from finance and activity, and both
// for the earlier period too, so the same read repeats within one load.
var engineUsageTTL = 2 * time.Minute

var engineUsageCache struct {
	mu      sync.Mutex
	entries map[string]cachedEngineCost
	flight  singleflight.Group
}

type cachedEngineCost struct {
	cost   EngineDailyCost
	readAt time.Time
}

// cachedEngineDailyCost returns the read for key, shared for engineUsageTTL.
// A read that failed is not kept, so the next request asks the engine again.
// The Daily slices of a shared read must not be modified.
func cachedEngineDailyCost(key string, read func() EngineDailyCost) EngineDailyCost {
	engineUsageCache.mu.Lock()
	if entry, ok := engineUsageCache.entries[key]; ok && time.Since(entry.readAt) < engineUsageTTL {
		engineUsageCache.mu.Unlock()
		return entry.cost
	}
	engineUsageCache.mu.Unlock()
	value, _, _ := engineUsageCache.flight.Do(key, func() (any, error) {
		cost := read()
		if cost.Error == "" {
			engineUsageCache.mu.Lock()
			if engineUsageCache.entries == nil {
				engineUsageCache.entries = make(map[string]cachedEngineCost)
			}
			for stored, entry := range engineUsageCache.entries {
				if time.Since(entry.readAt) >= engineUsageTTL {
					delete(engineUsageCache.entries, stored)
				}
			}
			engineUsageCache.entries[key] = cachedEngineCost{cost: cost, readAt: time.Now()}
			engineUsageCache.mu.Unlock()
		}
		return cost, nil
	})
	return value.(EngineDailyCost)
}

func nanoToUSD(nano *big.Int) float64 {
	usd, _ := new(big.Rat).SetFrac(nano, big.NewInt(1_000_000_000)).Float64()
	return usd
}

// EngineCredentialRow is the usage one credential accrued in one group over a
// window at official prices. CredentialID 0 holds usage the engine did not
// attribute to an account. Both timestamps are nil for a credential the engine
// no longer has.
type EngineCredentialRow struct {
	CredentialID            int64
	GroupID                 int64
	CreatedAtMS             *int64
	SubscriptionCreatedAtMS *int64
	Requests                int64
	Failures                int64
	CostUSD                 float64
}

// EngineCredentialUsage is the per-credential usage of the engine's
// /usage/credentials for [start, end) in milliseconds. Configured is false
// without EngineControlURL and EngineControlKey. Unsupported is set when the
// engine predates the endpoint (HTTP 404): that is not an error, and the view
// simply has no per-plan usage. Error holds any other failed read.
type EngineCredentialUsage struct {
	Configured  bool
	Unsupported bool
	Error       string
	Credentials []EngineCredentialRow
}

type engineUsageCredentials struct {
	Credentials []struct {
		CredentialID            int64  `json:"credential_id"`
		GroupID                 int64  `json:"group_id"`
		CreatedAtMS             *int64 `json:"created_at_ms"`
		SubscriptionCreatedAtMS *int64 `json:"subscription_created_at_ms"`
		RequestCount            int64  `json:"request_count"`
		FailureCount            int64  `json:"failure_count"`
		EstimatedCostNanoUSD    string `json:"estimated_cost_nano_usd"`
	} `json:"credentials"`
}

// FetchEngineCredentialUsage reads the engine's per-credential usage for
// [startMS, endMS). The dashboard's range is at most 366 days and the engine
// accepts 367, so one read covers it.
func FetchEngineCredentialUsage(startMS, endMS int64) EngineCredentialUsage {
	base := strings.TrimRight(strings.TrimSpace(operation_setting.EngineControlURL), "/")
	key := strings.TrimSpace(operation_setting.EngineControlKey)
	if base == "" || key == "" {
		return EngineCredentialUsage{}
	}
	query := url.Values{
		"from_ms": {strconv.FormatInt(startMS, 10)},
		"to_ms":   {strconv.FormatInt(endMS, 10)},
	}
	return readEngineCredentialUsage(base, key, "/usage/credentials?"+query.Encode())
}

// readEngineCredentialUsage is one uncached read of the engine's usage per
// credential at path.
func readEngineCredentialUsage(base, key, path string) EngineCredentialUsage {
	result := EngineCredentialUsage{Configured: true, Credentials: []EngineCredentialRow{}}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	usage, err := engineGet[engineUsageCredentials](ctx, base, key, path)
	var httpErr *EngineHTTPError
	if errors.As(err, &httpErr) && httpErr.Status == http.StatusNotFound {
		result.Unsupported = true
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	for _, row := range usage.Credentials {
		nano, ok := new(big.Int).SetString(row.EstimatedCostNanoUSD, 10)
		if !ok || nano.Sign() < 0 {
			result.Error = fmt.Sprintf("engine usage credentials: invalid cost %q", row.EstimatedCostNanoUSD)
			return result
		}
		result.Credentials = append(result.Credentials, EngineCredentialRow{
			CredentialID: row.CredentialID, GroupID: row.GroupID,
			CreatedAtMS: row.CreatedAtMS, SubscriptionCreatedAtMS: row.SubscriptionCreatedAtMS,
			Requests: row.RequestCount, Failures: row.FailureCount, CostUSD: nanoToUSD(nano),
		})
	}
	return result
}
