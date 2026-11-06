package service

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// demandSeries is days of hourly use from UTC midnight, each hour's value
// given by value(index).
func demandSeries(days int, value func(index int) float64) []float64 {
	series := make([]float64, days*24)
	for i := range series {
		series[i] = value(i)
	}
	return series
}

func TestDemandProfileReadsTheDailyShape(t *testing.T) {
	// One busy hour a day at UTC 05:00, three times the others.
	series := demandSeries(14, func(i int) float64 {
		if i%24 == 5 {
			return 3
		}
		return 1
	})
	profile := buildDemandProfile(series, 0)

	assert.Equal(t, demandWeek, profile.hours)
	assert.InDelta(t, 3/(26.0/24), profile.shape[5], 1e-9)
	assert.InDelta(t, 1/(26.0/24), profile.shape[6], 1e-9)
	assert.InDelta(t, 3/(26.0/24), profile.peak(), 1e-9)
	assert.InDelta(t, 0, profile.growth, 1e-9)
	require.Positive(t, profile.origins)
	assert.InDelta(t, 1, profile.low, 1e-9, "a steady week is forecast exactly")
	assert.InDelta(t, 1, profile.high, 1e-9)
	// A first hour at UTC 22:00 moves the busy hour with it.
	assert.InDelta(t, 3/(26.0/24), buildDemandProfile(series, 22*3600).shape[3], 1e-9)
}

func TestDemandProfileFollowsGrowthAndBoundsIt(t *testing.T) {
	growing := func(rate float64) []float64 {
		return demandSeries(14, func(i int) float64 { return math.Exp(rate * float64(i) / 24) })
	}
	profile := buildDemandProfile(growing(math.Log(1.08)), 0)
	assert.InDelta(t, math.Log(1.08), profile.growth, 1e-9)
	assert.InDelta(t, 1, profile.shape[0], 0.01, "growth stays out of the shape")
	// Scored against the trend: its damping leaves it a little short of
	// steady growth, where a flat forecast falls short by about 17%.
	// Three weeks, as the pool reads, give every past forecast a week of
	// growth behind it.
	threeWeeks := buildDemandProfile(demandSeries(21, func(i int) float64 { return math.Exp(math.Log(1.08) * float64(i) / 24) }), 0)
	assert.Greater(t, threeWeeks.low, 1.0)
	assert.Less(t, threeWeeks.high, 1.08, "the band is scored against the trend, not a flat forecast")

	assert.Equal(t, demandMaxGrowth, buildDemandProfile(growing(0.5), 0).growth)

	// Damped: a day of growth carries on as 1, 0.8, 0.64 … of a day.
	assert.InDelta(t, math.Exp(0.1), profile2(0.1).growthAt(1), 1e-9)
	assert.InDelta(t, math.Exp(0.1*1.8), profile2(0.1).growthAt(2), 1e-9)
	assert.Less(t, profile2(0.1).growthAt(100), math.Exp(0.1*5)+1e-9)
}

func TestDemandProfileReadsTheLevelTheLatestHoursHold(t *testing.T) {
	busy := func(i int) float64 {
		if i%24 == 5 {
			return 3
		}
		return 1
	}
	// Ending on the busy hour: the shape expects it, so the level holds.
	// A first hour at UTC 06:00 puts the last of 14 days at 05:00.
	steady := buildDemandProfile(demandSeries(14, func(i int) float64 { return busy(i + 6) }), 6*3600)
	assert.InDelta(t, 1, steady.levelScale(), 1e-9)

	// The last four days count, halving every 12 hours back: use doubled
	// over the last 12 hours carries half the weight.
	var flat [24]float64
	for hour := range flat {
		flat[hour] = 1
	}
	stepped := demandSeries(14, func(i int) float64 {
		if i >= 14*24-12 {
			return 2
		}
		return 1
	})
	assert.InDelta(t, 1+0.5/(1-1/256.0), demandLevel(stepped, len(stepped), flat, func(int) int { return 0 }), 1e-9)

	assert.InDelta(t, 1, demandProfile{}.levelScale(), 1e-9, "a profile without a level reads as the last day")
}

func profile2(growth float64) demandProfile {
	profile := flatDemand()
	profile.growth = growth
	return profile
}

func TestDemandProfileStaysFlatWithoutHistory(t *testing.T) {
	// Two days of use after a week of nothing: too little for a shape.
	series := append(make([]float64, 7*24), demandSeries(2, func(i int) float64 { return float64(i%24 + 1) })...)
	profile := buildDemandProfile(series, 0)
	assert.Equal(t, flatDemand(), profile)

	// Five days: a shape, but no week for growth and too few forecasts for a band.
	profile = buildDemandProfile(demandSeries(5, func(int) float64 { return 2 }), 0)
	assert.Positive(t, profile.hours)
	assert.Zero(t, profile.growth)
	assert.Zero(t, profile.origins)
}
