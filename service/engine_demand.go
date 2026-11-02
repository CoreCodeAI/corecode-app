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
	// demandMaxGrowth bounds the daily growth the trend scenario carries on.
	demandMaxGrowth = 0.15
	// demandGrowthDamping is the share of a day's growth the next day keeps,
	// so the trend levels off after about five days instead of compounding.
	demandGrowthDamping = 0.8
	demandProfileTTL    = 10 * time.Minute
)

// demandProfile is how the pool's demand moves around its 24-hour average.
// The engine's spend gives the level; the console's own hourly use of the
// same models gives the shape, which is all it is used for, since it is
// billed at the customer's price, not at the upstream cost.
type demandProfile struct {
	// shape is demand in each UTC hour of the day over the daily mean: 24
	// values averaging 1. All 1 without enough history.
	shape [24]float64
	// hours of history the shape is drawn from; 0 for a flat shape.
	hours int
	// growth is the daily log growth of use over the last week, bounded by
	// demandMaxGrowth; 0 without a week of history.
	growth float64
	// low and high are the 10th and 90th percentiles of actual over
	// forecast use across demandBandHorizon, scored on past hours; both 0
	// with fewer than demandMinOrigins forecasts.
	low, high float64
	origins   int
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

	var ratios []float64
	// Only the last week's forecasts: older ones score a younger pool.
	oldest := max(demandMinHours, len(series)-demandBandHorizon-demandWeek)
	for origin := len(series) - demandBandHorizon; origin >= oldest; origin-- {
		past, pastHours := demandShape(series, origin, utcHour)
		if pastHours == 0 {
			continue
		}
		level := mean(series[origin-24 : origin])
		forecast, actual := 0.0, 0.0
		for k := range demandBandHorizon {
			forecast += level * past[utcHour(origin+k)]
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

var claudeDemandCache struct {
	mu      sync.Mutex
	profile demandProfile
	hour    int64
	readAt  time.Time
}

// claudeDemandProfile reads the Claude models' hourly use over the
// demandHistory whole hours before now and builds the profile, reusing it
// for demandProfileTTL within the same hour. A failed read gives a flat
// shape, which is the projection the pool had before.
func claudeDemandProfile(now time.Time) demandProfile {
	hour := now.Unix() - now.Unix()%3600
	claudeDemandCache.mu.Lock()
	defer claudeDemandCache.mu.Unlock()
	if claudeDemandCache.hour == hour && time.Since(claudeDemandCache.readAt) < demandProfileTTL {
		return claudeDemandCache.profile
	}
	from := hour - demandHistory*3600
	quota, err := model.HourlyQuotaWithPrefix(model.ClaudeModelPrefix, from, hour)
	if err != nil {
		common.SysError("read hourly Claude use for the pool demand: " + err.Error())
		// Retried after a minute, not on every pool read.
		claudeDemandCache.profile, claudeDemandCache.hour = flatDemand(), hour
		claudeDemandCache.readAt = time.Now().Add(time.Minute - demandProfileTTL)
		return claudeDemandCache.profile
	}
	series := make([]float64, demandHistory)
	for i := range series {
		series[i] = float64(quota[from+int64(i)*3600])
	}
	profile := buildDemandProfile(series, from)
	claudeDemandCache.profile, claudeDemandCache.hour, claudeDemandCache.readAt = profile, hour, time.Now()
	return profile
}
