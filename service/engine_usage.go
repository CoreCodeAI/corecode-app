package service

import (
	"context"
	"fmt"
	"math/big"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
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
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	usage, err := engineGet[engineUsageDaily](ctx, base, key, "/usage/daily?"+query.Encode())
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

func nanoToUSD(nano *big.Int) float64 {
	usd, _ := new(big.Rat).SetFrac(nano, big.NewInt(1_000_000_000)).Float64()
	return usd
}
