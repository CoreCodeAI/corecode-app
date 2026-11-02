package service

import (
	"context"
	"fmt"
	"math/big"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"golang.org/x/sync/singleflight"
)

// PoolUsageWindowHours are the spans the pool tab reads usage over, newest
// first: the last hour to the last week.
var PoolUsageWindowHours = []int64{1, 3, 6, 24, 168}

const (
	// poolUsageSeriesHours is the hourly history the pool tab draws.
	poolUsageSeriesHours = 48
	// poolUsageTTL is how long one read is shared; the pool tab refreshes
	// every 15 s, and these figures move little within a minute.
	poolUsageTTL = time.Minute
)

// providerChannels are the engine channels that serve each vendor new-api
// sells. gpt-load serves Gemini through its antigravity channel.
var providerChannels = map[string][]string{
	model.VendorClaude: {"claude"},
	model.VendorCodex:  {"codex"},
	model.VendorGrok:   {"grok"},
	model.VendorGemini: {"gemini", "antigravity"},
}

// PoolProviders are the vendors the pool tab switches between, Claude
// first.
var PoolProviders = []string{model.VendorClaude, model.VendorCodex, model.VendorGrok, model.VendorGemini}

// ChannelProvider names the vendor an engine channel serves, or the
// channel itself when it serves none of them.
func ChannelProvider(channel string) string {
	for provider, channels := range providerChannels {
		if slices.Contains(channels, channel) {
			return provider
		}
	}
	return channel
}

// PoolUsage is one provider's use on both sides of the relay: what new-api
// charged for its models and what gpt-load spent serving its channels.
//
// new-api's charge, Quota, is in quota dollars, which customers pay ¥1 each
// for, so it is in yuan, as on the funds view. gpt-load's, EngineUSD, is the
// requests at the provider's official prices in US dollars: the unit the
// pool's capacity is estimated in.
type PoolUsage struct {
	Provider   string `json:"provider"`
	ObservedAt int64  `json:"observed_at"`
	// USDExchangeRate is yuan per US dollar, for new-api's charge in dollars.
	USDExchangeRate float64 `json:"usd_exchange_rate"`
	// Channels are the engine channels read; empty when the pool has none.
	Channels         []string `json:"channels"`
	EngineConfigured bool     `json:"engine_configured"`
	// EngineError is set when the engine could not be read; its figures are
	// then zero.
	EngineError string            `json:"engine_error,omitempty"`
	Windows     []PoolUsageWindow `json:"windows"`
	// OfficialPerQuota is gpt-load's spend for each yuan new-api charged over
	// the last week: what converts new-api's charge into pool capacity. 0
	// when either side is empty.
	OfficialPerQuota float64         `json:"official_per_quota"`
	Hourly           []PoolUsageHour `json:"hourly"`
	Forecast         PoolForecast    `json:"forecast"`
}

// PoolUsageWindow is the use over the Hours before ObservedAt. new-api
// records use per hour, so its figure shares each hour's use evenly across
// the part of the hour inside the window; gpt-load's is exact.
type PoolUsageWindow struct {
	Hours          int64   `json:"hours"`
	Quota          float64 `json:"quota"`
	EngineUSD      float64 `json:"engine_usd"`
	EngineRequests int64   `json:"engine_requests"`
	// EngineUnpriced counts requests gpt-load had no price for; they are
	// not in EngineUSD.
	EngineUnpriced int64 `json:"engine_unpriced"`
}

// PoolUsageHour is one clock hour's use; the last is the hour now open.
type PoolUsageHour struct {
	Hour      int64   `json:"hour"`
	Quota     float64 `json:"quota"`
	EngineUSD float64 `json:"engine_usd"`
}

// PoolForecast projects the provider's demand: the last 24 hours' use as
// the level, moved through the day by the shape of the last week's hourly
// use, as the Claude runway does. The USD figures take gpt-load's level,
// the Quota figures new-api's.
type PoolForecast struct {
	Next5hUSD       float64 `json:"next_5h_usd"`
	Next24hUSD      float64 `json:"next_24h_usd"`
	Next24hTrendUSD float64 `json:"next_24h_trend_usd"`
	// Next24hLowUSD and Next24hHighUSD scale it to the 10th and 90th
	// percentiles of how past forecasts compared with the use that
	// followed, widened to hold demand as now; nil without the history.
	Next24hLowUSD  *float64 `json:"next_24h_low_usd"`
	Next24hHighUSD *float64 `json:"next_24h_high_usd"`
	Next5hQuota    float64  `json:"next_5h_quota"`
	Next24hQuota   float64  `json:"next_24h_quota"`
	// ProfileHours is the hours of use the shape is drawn from; 0 projects
	// the level flat.
	ProfileHours  int     `json:"profile_hours"`
	GrowthPerDay  float64 `json:"growth_per_day"`
	BandForecasts int     `json:"band_forecasts"`
}

var poolUsageCache struct {
	mu      sync.Mutex
	entries map[string]poolUsageEntry
	flight  singleflight.Group
}

type poolUsageEntry struct {
	usage  PoolUsage
	readAt time.Time
}

// FetchPoolUsage reads the provider's use, sharing one read for
// poolUsageTTL. The provider must be one of PoolProviders.
func FetchPoolUsage(provider string) (PoolUsage, error) {
	if !slices.Contains(PoolProviders, provider) {
		return PoolUsage{}, fmt.Errorf("unknown provider %q", provider)
	}
	poolUsageCache.mu.Lock()
	if entry, ok := poolUsageCache.entries[provider]; ok && time.Since(entry.readAt) < poolUsageTTL {
		poolUsageCache.mu.Unlock()
		return entry.usage, nil
	}
	poolUsageCache.mu.Unlock()
	value, err, _ := poolUsageCache.flight.Do(provider, func() (any, error) {
		usage, err := readPoolUsage(provider, time.Now())
		if err != nil {
			return nil, err
		}
		poolUsageCache.mu.Lock()
		if poolUsageCache.entries == nil {
			poolUsageCache.entries = make(map[string]poolUsageEntry)
		}
		poolUsageCache.entries[provider] = poolUsageEntry{usage: usage, readAt: time.Now()}
		poolUsageCache.mu.Unlock()
		return usage, nil
	})
	if err != nil {
		return PoolUsage{}, err
	}
	return value.(PoolUsage), nil
}

func readPoolUsage(provider string, now time.Time) (PoolUsage, error) {
	nowSec, nowMS := now.Unix(), now.UnixMilli()
	hour := nowSec - nowSec%3600
	usage := PoolUsage{
		Provider: provider, ObservedAt: nowSec, USDExchangeRate: operation_setting.USDExchangeRate,
		Channels: []string{}, Windows: []PoolUsageWindow{}, Hourly: []PoolUsageHour{},
	}
	week := PoolUsageWindowHours[len(PoolUsageWindowHours)-1]
	quota, err := vendorHourlyQuota(provider, hour-week*3600, hour+3600)
	if err != nil {
		return usage, err
	}

	engine := readEngineProviderUsage(provider, nowMS, hour*1000)
	usage.EngineConfigured, usage.EngineError, usage.Channels = engine.configured, engine.err, engine.channels
	for i, hours := range PoolUsageWindowHours {
		window := PoolUsageWindow{Hours: hours, Quota: quotaSince(quota, nowSec-hours*3600, nowSec)}
		if engine.err == "" {
			window.EngineUSD, window.EngineRequests, window.EngineUnpriced = engine.windows[i].usd, engine.windows[i].requests, engine.windows[i].unpriced
		}
		usage.Windows = append(usage.Windows, window)
	}
	last := usage.Windows[len(usage.Windows)-1]
	if last.Quota > 0 && last.EngineUSD > 0 {
		usage.OfficialPerQuota = last.EngineUSD / last.Quota
	}
	for k := poolUsageSeriesHours - 1; k >= 0; k-- {
		at := hour - int64(k)*3600
		usage.Hourly = append(usage.Hourly, PoolUsageHour{
			Hour: at, Quota: float64(quota[at]) / common.QuotaPerUnit, EngineUSD: engine.hourly[at],
		})
	}

	day := usage.Windows[slices.Index(PoolUsageWindowHours, 24)]
	profile := vendorDemandProfile(provider, now)
	forecast := PoolForecast{ProfileHours: profile.hours, GrowthPerDay: profile.growthPerDay(), BandForecasts: profile.origins}
	next := func(level float64, hours int64, growing bool) float64 {
		return profile.over(level, nowMS, nowMS+hours*time.Hour.Milliseconds(), growing)
	}
	usdLevel, quotaLevel := day.EngineUSD/24, day.Quota/24
	forecast.Next5hUSD, forecast.Next24hUSD = next(usdLevel, 5, false), next(usdLevel, 24, false)
	forecast.Next24hTrendUSD = next(usdLevel, 24, profile.growth != 0)
	forecast.Next5hQuota, forecast.Next24hQuota = next(quotaLevel, 5, false), next(quotaLevel, 24, false)
	if profile.origins > 0 {
		low, high := forecast.Next24hUSD*min(profile.low, 1), forecast.Next24hUSD*max(profile.high, 1)
		forecast.Next24hLowUSD, forecast.Next24hHighUSD = &low, &high
	}
	usage.Forecast = forecast
	return usage, nil
}

// quotaSince is new-api's charge over [start, now), unix seconds, in quota
// dollars. Each hour's use is spread evenly over the part of it that has
// passed, so a window starting mid-hour takes its share of that hour.
func quotaSince(hours map[int64]int64, start, now int64) float64 {
	total := 0.0
	for at, quota := range hours {
		end := min(at+3600, now)
		if end <= at {
			continue
		}
		overlap := end - max(at, start)
		if overlap <= 0 {
			continue
		}
		total += float64(quota) * float64(overlap) / float64(end-at)
	}
	return total / common.QuotaPerUnit
}

type engineSpend struct {
	usd      float64
	requests int64
	unpriced int64
}

type engineProviderUsage struct {
	configured bool
	err        string
	channels   []string
	windows    []engineSpend
	hourly     map[int64]float64
}

// engineUsageReport is the part of the engine's /usage response read here.
type engineUsageReport struct {
	Summary struct {
		RequestCount         int64  `json:"request_count"`
		EstimatedCostNanoUSD string `json:"estimated_cost_nano_usd"`
		UnpricedRequestCount int64  `json:"unpriced_request_count"`
	} `json:"summary"`
	Series []struct {
		BucketStartMS        int64  `json:"bucket_start_ms"`
		EstimatedCostNanoUSD string `json:"estimated_cost_nano_usd"`
	} `json:"series"`
}

// readEngineProviderUsage reads gpt-load's spend on the provider's channels:
// one summary per window, and the hourly series over the last
// poolUsageSeriesHours in two spans of a day or less, which the engine
// buckets by the hour. Only channels the pool has groups in are read.
func readEngineProviderUsage(provider string, nowMS, hourMS int64) engineProviderUsage {
	result := engineProviderUsage{channels: []string{}, windows: make([]engineSpend, len(PoolUsageWindowHours)), hourly: map[int64]float64{}}
	base := strings.TrimRight(strings.TrimSpace(operation_setting.EngineControlURL), "/")
	key := strings.TrimSpace(operation_setting.EngineControlKey)
	if base == "" || key == "" {
		return result
	}
	result.configured = true
	pool := RecentEnginePool(2 * time.Minute)
	if pool.Error != "" {
		result.err = pool.Error
		return result
	}
	for _, group := range pool.Groups {
		if ChannelProvider(group.Channel) == provider && !slices.Contains(result.channels, group.Channel) {
			result.channels = append(result.channels, group.Channel)
		}
	}
	slices.Sort(result.channels)

	type span struct {
		fromMS, toMS int64
		window       int
	}
	var spans []span
	for i, hours := range PoolUsageWindowHours {
		spans = append(spans, span{nowMS - hours*time.Hour.Milliseconds(), nowMS, i})
	}
	day := 24 * time.Hour.Milliseconds()
	seriesFrom := hourMS - int64(poolUsageSeriesHours-1)*time.Hour.Milliseconds()
	for from := seriesFrom; from < nowMS; from += day {
		spans = append(spans, span{from, min(from+day, nowMS), -1})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	var mu sync.Mutex
	var wg sync.WaitGroup
	var firstErr error
	for _, channel := range result.channels {
		for _, s := range spans {
			wg.Go(func() {
				query := url.Values{
					"from_ms":    {strconv.FormatInt(s.fromMS, 10)},
					"to_ms":      {strconv.FormatInt(s.toMS, 10)},
					"channel_id": {channel},
				}
				report, err := engineGet[engineUsageReport](ctx, base, key, "/usage?"+query.Encode())
				var cost float64
				if err == nil {
					cost, err = nanoStringUSD(report.Summary.EstimatedCostNanoUSD)
				}
				mu.Lock()
				defer mu.Unlock()
				if err != nil {
					if firstErr == nil {
						firstErr = err
					}
					return
				}
				if s.window >= 0 {
					spend := &result.windows[s.window]
					spend.usd += cost
					spend.requests += report.Summary.RequestCount
					spend.unpriced += report.Summary.UnpricedRequestCount
					return
				}
				for _, bucket := range report.Series {
					usd, bucketErr := nanoStringUSD(bucket.EstimatedCostNanoUSD)
					if bucketErr != nil {
						if firstErr == nil {
							firstErr = bucketErr
						}
						return
					}
					at := bucket.BucketStartMS / 1000
					result.hourly[at-at%3600] += usd
				}
			})
		}
	}
	wg.Wait()
	if firstErr != nil {
		result.err = firstErr.Error()
	}
	return result
}

func nanoStringUSD(value string) (float64, error) {
	if value == "" {
		return 0, nil
	}
	nano, ok := new(big.Int).SetString(value, 10)
	if !ok || nano.Sign() < 0 {
		return 0, fmt.Errorf("engine usage: invalid cost %q", value)
	}
	return nanoToUSD(nano), nil
}
