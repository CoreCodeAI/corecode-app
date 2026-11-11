package service

import (
	"math"
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

const (
	// demandHistory is how much hourly use the demand model reads: the shape
	// from its last week, and the band from forecasts made over the last
	// week that their horizon has passed, each drawing on the week before.
	demandHistory = 21 * 24
	demandWeek    = 7 * 24
	// demandBandHorizon is the span each past forecast is scored over.
	demandBandHorizon = 72
	// demandMinHours is the least history a shape is drawn from.
	demandMinHours = 3 * 24
	// demandMinOrigins is the least past forecasts a band is drawn from.
	demandMinOrigins = 24
	// demandLevelHalfLife and demandLevelSpan weigh the hours the level is
	// read from: each hour counts half as much as the one 12 hours later.
	demandLevelHalfLife = 12
	demandLevelSpan     = 4 * 24
	// demandMaxGrowth bounds the daily growth the trend scenario carries on.
	demandMaxGrowth = 0.15
	// demandGrowthDamping is the share of a day's growth the next day keeps,
	// so the trend levels off after about five days instead of compounding.
	demandGrowthDamping = 0.8
	demandProfileTTL    = 10 * time.Minute
	// demandMomentumHours is the latest whole hours the momentum is read
	// from, demandMomentumHalfLife how fast it fades from the forecast, in
	// hours, and demandMomentumBound the most it moves the level either way.
	// Backtested on the Claude models over the ten days to 2026-11-11, a
	// forecast carrying it missed the next 5 hours by a mean absolute log
	// error of 0.257 against 0.278 without, and the next 24 by 0.208 against
	// 0.211; over a week it has faded and changes nothing.
	demandMomentumHours    = 2
	demandMomentumHalfLife = 2.0
	demandMomentumBound    = 1.5
)

// demandProfile is how the pool's demand moves around its 24-hour average.
// The engine's spend gives the level; the console's own hourly use of the
// same models gives the shape and how far the level has moved from the last
// 24 hours' mean, since it is billed at the customer's price, not at the
// upstream cost, and is used only for shares and multiples.
type demandProfile struct {
	// shape is demand in each UTC hour of the day over the daily mean: 24
	// values averaging 1. All 1 without enough history.
	shape [24]float64
	// hours of history the shape is drawn from; 0 for a flat shape.
	hours int
	// growth is the daily log growth of use over the last week, bounded by
	// demandMaxGrowth; 0 without a week of history.
	growth float64
	// recent is the level now over the last 24 hours' mean use: above 1
	// when the latest hours run above what the shape expects of them. 0
	// reads as 1.
	recent float64
	// low and high are the 10th and 90th percentiles of actual over trend
	// forecast use across demandBandHorizon, scored on past hours; both 0
	// with fewer than demandMinOrigins forecasts. A trend forecast grows the
	// level by the growth read at its own origin.
	low, high float64
	origins   int
	// momentum is the latest demandMomentumHours' use over what the level
	// and the shape expect of those hours, bounded by demandMomentumBound:
	// above 1 when use is running ahead of its level right now. 0 reads as 1.
	momentum float64
}

func flatDemand() demandProfile {
	var profile demandProfile
	for hour := range profile.shape {
		profile.shape[hour] = 1
	}
	return profile
}

// at is the shape's multiple for the UTC hour that holds ms.
func (profile demandProfile) at(ms int64) float64 {
	return profile.shape[(ms/time.Hour.Milliseconds())%24]
}

// peak is the shape's largest hourly multiple.
func (profile demandProfile) peak() float64 {
	peak := 0.0
	for _, value := range profile.shape {
		peak = max(peak, value)
	}
	return peak
}

// growthAt is the trend scenario's multiple of demand days after now: the
// daily growth carried on, each day keeping demandGrowthDamping of the last.
func (profile demandProfile) growthAt(days float64) float64 {
	carried := (1 - math.Pow(demandGrowthDamping, days)) / (1 - demandGrowthDamping)
	return math.Exp(profile.growth * carried)
}

// buildDemandProfile reads the profile from hourly use, oldest first, whose
// first hour starts at firstHour, unix seconds. Hours before the first use
// are dropped, so a young site is not read as growing out of zero.
func buildDemandProfile(series []float64, firstHour int64) demandProfile {
	for len(series) > 0 && series[0] <= 0 {
		series, firstHour = series[1:], firstHour+3600
	}
	profile := flatDemand()
	if len(series) < demandMinHours {
		return profile
	}
	utcHour := func(index int) int { return int((firstHour/3600 + int64(index)) % 24) }
	shape, hours := demandShape(series, len(series), utcHour)
	if hours == 0 {
		return profile
	}
	profile.shape, profile.hours = shape, hours
	profile.growth = demandGrowth(series)
	level := demandLevel(series, len(series), shape, utcHour)
	if day := mean(series[len(series)-24:]); day > 0 {
		profile.recent = level / day
	}
	profile.momentum = demandMomentum(series, level, shape, utcHour)

	var ratios []float64
	// Only the last week's forecasts: older ones score a younger pool.
	oldest := max(demandMinHours, len(series)-demandBandHorizon-demandWeek)
	for origin := len(series) - demandBandHorizon; origin >= oldest; origin-- {
		past, pastHours := demandShape(series, origin, utcHour)
		if pastHours == 0 {
			continue
		}
		level := demandLevel(series, origin, past, utcHour)
		// Scored against the trend forecast, as the pool is sized by it: a
		// flat one fell a quarter short over three days while use grew.
		then := demandProfile{growth: demandGrowth(series[:origin])}
		forecast, actual := 0.0, 0.0
		for k := range demandBandHorizon {
			forecast += level * past[utcHour(origin+k)] * then.growthAt(float64(k)/24)
			actual += series[origin+k]
		}
		if forecast > 0 {
			ratios = append(ratios, actual/forecast)
		}
	}
	if len(ratios) >= demandMinOrigins {
		sort.Float64s(ratios)
		quantile := func(q float64) float64 { return ratios[int(math.Round(q*float64(len(ratios)-1)))] }
		profile.low, profile.high, profile.origins = quantile(0.1), quantile(0.9), len(ratios)
	}
	return profile
}

// demandLevel is the use an average hour of the day holds at end: the last
// demandLevelSpan hours, weighted by demandLevelHalfLife, over the shape's
// multiples for the same hours. Backtested on the Claude models from
// 2026-10-26 to 11-06, it was closer than the last 24 hours' mean at every
// horizon: a mean absolute log error of 0.18 against 0.21 over 24 hours,
// 0.14 against 0.16 over 72, 0.08 against 0.11 over a week. Reading only
// the last 6 or 12 hours did worse, at 0.29 to 0.37 over 24 hours.
func demandLevel(series []float64, end int, shape [24]float64, utcHour func(int) int) float64 {
	used, expected := 0.0, 0.0
	for k := max(0, end-demandLevelSpan); k < end; k++ {
		weight := math.Exp2(-float64(end-1-k) / demandLevelHalfLife)
		used += weight * series[k]
		expected += weight * shape[utcHour(k)]
	}
	if expected <= 0 {
		return mean(series[max(0, end-24):end])
	}
	return used / expected
}

// demandMomentum is the use of the last demandMomentumHours over what level
// and shape expect of them, kept within demandMomentumBound; 1 without a
// level to compare with.
func demandMomentum(series []float64, level float64, shape [24]float64, utcHour func(int) int) float64 {
	used, expected := 0.0, 0.0
	for k := max(0, len(series)-demandMomentumHours); k < len(series); k++ {
		used += series[k]
		expected += level * shape[utcHour(k)]
	}
	if expected <= 0 {
		return 1
	}
	return math.Max(1/demandMomentumBound, math.Min(demandMomentumBound, used/expected))
}

// momentumAt is the multiple the momentum puts on demand hours after now:
// all of it at once, halving every demandMomentumHalfLife.
func (profile demandProfile) momentumAt(hours float64) float64 {
	if profile.momentum <= 0 {
		return 1
	}
	return 1 + (profile.momentum-1)*math.Exp2(-hours/demandMomentumHalfLife)
}

// levelScale is the multiple of the last 24 hours' mean the level stands at.
func (profile demandProfile) levelScale() float64 {
	if profile.recent <= 0 {
		return 1
	}
	return profile.recent
}

// demandShape averages each hour's use over the mean of the 24 hours around
// it, by hour of day, across the last demandWeek hours before end. Dividing
// by the local mean keeps growth out of the shape.
func demandShape(series []float64, end int, utcHour func(int) int) ([24]float64, int) {
	var sums [24]float64
	var counts [24]int
	hours := 0
	for k := max(0, end-demandWeek); k < end; k++ {
		start := min(max(0, k-12), end-24)
		if start < 0 {
			continue
		}
		local := mean(series[start : start+24])
		if local <= 0 {
			continue
		}
		sums[utcHour(k)] += series[k] / local
		counts[utcHour(k)]++
		hours++
	}
	var shape [24]float64
	total := 0.0
	for hour := range shape {
		shape[hour] = 1
		if counts[hour] > 0 {
			shape[hour] = sums[hour] / float64(counts[hour])
		}
		total += shape[hour]
	}
	if total <= 0 {
		return shape, 0
	}
	for hour := range shape {
		shape[hour] *= 24 / total
	}
	return shape, hours
}

// demandGrowth fits a line to the log of each of the last seven days' use,
// counted back from the latest hour, and bounds its slope. Fewer than seven
// whole days, or a day without use, give no growth.
func demandGrowth(series []float64) float64 {
	const days = 7
	if len(series) < days*24 {
		return 0
	}
	var xs, ys []float64
	for day := range days {
		end := len(series) - day*24
		total := mean(series[end-24:end]) * 24
		if total <= 0 {
			return 0
		}
		xs, ys = append(xs, float64(-day)), append(ys, math.Log(total))
	}
	mx, my := mean(xs), mean(ys)
	num, den := 0.0, 0.0
	for i := range xs {
		num += (xs[i] - mx) * (ys[i] - my)
		den += (xs[i] - mx) * (xs[i] - mx)
	}
	return math.Max(-demandMaxGrowth, math.Min(demandMaxGrowth, num/den))
}

func mean(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

type demandCacheEntry struct {
	profile demandProfile
	// series is the hourly use the profile was built from, oldest first,
	// and first the hour its first entry starts at, unix seconds.
	series []float64
	first  int64
	hour   int64
	readAt time.Time
}

var demandCache struct {
	mu      sync.Mutex
	entries map[string]demandCacheEntry
}

// claudeDemandProfile is the Claude models' demand profile.
func claudeDemandProfile(now time.Time) demandProfile {
	return vendorDemandProfile(model.VendorClaude, now)
}

// vendorDemandProfile reads the vendor's models' hourly use over the
// demandHistory whole hours before now and builds the profile, reusing it
// for demandProfileTTL within the same hour. A failed read gives a flat
// shape, which is the projection the pool had before.
func vendorDemandProfile(vendor string, now time.Time) demandProfile {
	profile, _, _ := vendorDemandHistory(vendor, now)
	return profile
}

// vendorDemandHistory is vendorDemandProfile with the hourly use it was
// built from: demandHistory whole hours, oldest first, the first starting at
// the returned unix second. A failed read gives a flat shape and no hours.
// The slice is shared between callers and must not be modified.
func vendorDemandHistory(vendor string, now time.Time) (demandProfile, []float64, int64) {
	hour := now.Unix() - now.Unix()%3600
	demandCache.mu.Lock()
	defer demandCache.mu.Unlock()
	if demandCache.entries == nil {
		demandCache.entries = make(map[string]demandCacheEntry)
	}
	if entry, ok := demandCache.entries[vendor]; ok && entry.hour == hour && time.Since(entry.readAt) < demandProfileTTL {
		return entry.profile, entry.series, entry.first
	}
	from := hour - demandHistory*3600
	quota, err := vendorHourlyQuota(vendor, from, hour)
	if err != nil {
		common.SysError("read hourly " + vendor + " use for the pool demand: " + err.Error())
		// Retried after a minute, not on every pool read.
		demandCache.entries[vendor] = demandCacheEntry{
			profile: flatDemand(), hour: hour, readAt: time.Now().Add(time.Minute - demandProfileTTL),
		}
		return flatDemand(), nil, 0
	}
	series := make([]float64, demandHistory)
	for i := range series {
		series[i] = float64(quota[from+int64(i)*3600])
	}
	profile := buildDemandProfile(series, from)
	demandCache.entries[vendor] = demandCacheEntry{profile: profile, series: series, first: from, hour: hour, readAt: time.Now()}
	return profile, series, from
}

// vendorHourlyQuota sums quota_data per hour over every model prefix the
// vendor sells under, for hours starting in [from, to).
func vendorHourlyQuota(vendor string, from, to int64) (map[int64]int64, error) {
	hours := make(map[int64]int64)
	for _, prefix := range model.VendorPrefixes(vendor) {
		quota, err := model.HourlyQuotaWithPrefix(prefix, from, to)
		if err != nil {
			return nil, err
		}
		for at, value := range quota {
			hours[at] += value
		}
	}
	return hours, nil
}

// over is the demand over [fromMS, toMS) when it averages level an hour
// over a day, moved through the day by the shape and, when growing, by the
// trend scenario's growth from fromMS on.
func (profile demandProfile) over(level float64, fromMS, toMS int64, growing bool) float64 {
	hour := time.Hour.Milliseconds()
	total := 0.0
	for at := fromMS; at < toMS; {
		until := min(toMS, (at/hour+1)*hour)
		amount := level * profile.at(at) * float64(until-at) / float64(hour)
		if growing {
			amount *= profile.growthAt(float64(at-fromMS) / float64(hour) / 24)
		}
		total += amount
		at = until
	}
	return total
}

// growthPerDay is the profile's daily growth as a share.
func (profile demandProfile) growthPerDay() float64 {
	return math.Exp(profile.growth) - 1
}
