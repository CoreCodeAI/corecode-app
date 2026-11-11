package service

import (
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// outlookSeat is an account with both windows: week left of weekFull that
// resets in weekResetHours, and five left of fiveFull that resets in
// fiveResetHours. A reset of 0 is a window that is not running.
func outlookSeat(week, weekFull float64, weekResetHours float64, five, fiveFull float64, fiveResetHours float64) outlookAccount {
	hour := float64(runwayHourMS)
	return outlookAccount{
		week: week, weekFull: weekFull, weekReset: int64(weekResetHours * hour),
		five: five, fiveFull: fiveFull, fiveReset: int64(fiveResetHours * hour), fiveLimited: true,
	}
}

func constantDemand(perHour float64) func(int64) float64 {
	return func(int64) float64 { return perHour }
}

func TestOutlookDrawableCountsEachResetItIsAllowed(t *testing.T) {
	// $50 of a $100 window that resets in 2 hours, inside a week with plenty.
	account := outlookSeat(1000, 1000, 100, 50, 100, 2)
	five, day := 5*runwayHourMS, 24*runwayHourMS

	assert.InDelta(t, 50, account.drawable(0, five, false, false), 1e-9, "the running window alone")
	assert.InDelta(t, 150, account.drawable(0, five, true, false), 1e-9, "and the window that starts at hour 2")
	// Windows start at hours 2, 7, 12, 17 and 22: five more.
	assert.InDelta(t, 550, account.drawable(0, day, true, false), 1e-9)

	account.week = 120
	assert.InDelta(t, 120, account.drawable(0, day, true, false), 1e-9, "the week bounds what the windows pass")
}

func TestOutlookDrawableStartsAWindowWithTheFirstSpend(t *testing.T) {
	// A full window that is not running starts now, so it resets at hours 5,
	// 10, 15 and 20: five windows in a day.
	idle := outlookSeat(1000, 1000, 100, 100, 100, 0)
	assert.InDelta(t, 500, idle.drawable(0, 24*runwayHourMS, true, false), 1e-9)

	// An account at its weekly line holds a full window it cannot open. The
	// week resets at hour 3, the window opens then and resets at hour 8.
	waiting := outlookSeat(0, 1000, 3, 100, 100, 0)
	assert.Zero(t, waiting.drawable(0, 5*runwayHourMS, true, false), "no weekly reset, nothing to spend")
	assert.InDelta(t, 100, waiting.drawable(0, 5*runwayHourMS, true, true), 1e-9)
	assert.InDelta(t, 200, waiting.drawable(0, 9*runwayHourMS, true, true), 1e-9, "the second window opens at hour 8")
}

func TestOutlookDrawableDropsWhatAWeekHeldAtItsReset(t *testing.T) {
	// $30 of the week left bounds the first spend; the reset at hour 3 brings
	// the week back to $1000 and the window, reset at hour 2, opens with it.
	account := outlookSeat(30, 1000, 3, 50, 100, 2)
	assert.InDelta(t, 130, account.drawable(0, 5*runwayHourMS, true, true), 1e-9)
}

func TestOutlookDrawableWaitsForACoolingAccount(t *testing.T) {
	account := outlookSeat(1000, 1000, 100, 100, 100, 0)
	account.readyMS = 2 * runwayHourMS
	assert.Zero(t, account.drawable(0, runwayHourMS, true, true))
	// It spends at hour 2, so its window resets at hour 7, past the 5 hours.
	assert.InDelta(t, 100, account.drawable(0, 5*runwayHourMS, true, true), 1e-9)
	assert.InDelta(t, 200, account.drawable(0, 8*runwayHourMS, true, true), 1e-9)
}

func TestOutlookRemainingSplitsWhatIsHeldFromWhatResetsBring(t *testing.T) {
	accounts := []outlookAccount{
		// Spends $50 now and $100 more from hour 2.
		outlookSeat(1000, 1000, 100, 50, 100, 2),
		// At its weekly line until hour 3.
		outlookSeat(0, 400, 3, 100, 100, 0),
	}
	rows := outlookRemaining(accounts, 0)
	require.Len(t, rows, 3)

	five := rows[0]
	assert.Equal(t, 5.0, five.Hours)
	assert.InDelta(t, 50, five.OnHandUSD, 1e-9, "no window resets inside 5 hours")
	assert.InDelta(t, 100, five.FiveHourRefillUSD, 1e-9)
	assert.InDelta(t, 100, five.WeekRefillUSD, 1e-9)
	assert.InDelta(t, 250, five.WithResetsUSD, 1e-9)

	day := rows[1]
	assert.InDelta(t, 550, day.OnHandUSD, 1e-9, "5-hour windows turn over inside a day")
	assert.Zero(t, day.FiveHourRefillUSD)
	// The second account opens windows at hours 3, 8, 13, 18 and 23, and its
	// week holds $400.
	assert.InDelta(t, 400, day.WeekRefillUSD, 1e-9)
	assert.InDelta(t, 950, day.WithResetsUSD, 1e-9)

	week := rows[2]
	assert.InDelta(t, 1000, week.OnHandUSD, 1e-9, "the weekly remainder, with no weekly reset")
	// Both weeks reset once: $1000 at hour 100, and $400 at hour 3 and again
	// a week after the account's first spend, past the horizon.
	assert.InDelta(t, 1000+1000+400, week.WithResetsUSD, 1e-9)
}

func TestOutlookResetsListsRunningWindowsSoonestFirst(t *testing.T) {
	first := outlookSeat(600, 1000, 100, 50, 100, 2)
	first.id, first.label = 1, "a***@x.com"
	second := outlookSeat(0, 400, 3, 100, 100, 0)
	second.id, second.label = 2, "b***@x.com"
	resets := outlookResets([]outlookAccount{first, second}, 0)
	require.Len(t, resets, 3, "a window that is not running has no reset")

	assert.Equal(t, EngineOutlookReset{CredentialID: 1, EmailMask: "a***@x.com", Window: "five_hour", AtMS: 2 * runwayHourMS, AddsUSD: 50}, resets[0])
	assert.Equal(t, "seven_day", resets[1].Window)
	assert.Equal(t, 2, resets[1].CredentialID)
	assert.InDelta(t, 400, resets[1].AddsUSD, 1e-9)
	assert.InDelta(t, 400, resets[2].AddsUSD, 1e-9, "the used part of the first account's week")
}

func TestProjectOutlookRunsOutOfAWeek(t *testing.T) {
	// $100 left, $10 an hour, no reset inside the week: dry after 10 hours.
	account := outlookAccount{week: 100, weekFull: 400, weekReset: 1000 * runwayHourMS}
	projection := projectOutlook([]outlookAccount{account}, 0, constantDemand(10), outlookSampleHours())
	require.Len(t, projection.windows, 3)

	five, day, week := projection.windows[0], projection.windows[1], projection.windows[2]
	assert.InDelta(t, 50, five.DemandUSD, 1e-9)
	assert.InDelta(t, 50, five.ServedUSD, 1e-9)
	assert.Zero(t, five.ShortUSD)
	assert.Nil(t, five.FirstShortHours)
	assert.InDelta(t, 50, five.LowestUSD, 1e-9)
	assert.InDelta(t, 5, five.LowestHours, 1e-9)

	assert.InDelta(t, 240, day.DemandUSD, 1e-9)
	assert.InDelta(t, 100, day.ServedUSD, 1e-9)
	assert.InDelta(t, 140, day.ShortUSD, 1e-9)
	assert.InDelta(t, 14, day.ShortHours, 1e-9)
	require.NotNil(t, day.FirstShortHours)
	assert.InDelta(t, 10, *day.FirstShortHours, 1e-9)
	assert.Zero(t, day.LowestUSD)

	assert.InDelta(t, 1680, week.DemandUSD, 1e-9)
	assert.InDelta(t, 158, week.ShortHours, 1e-9)
}

func TestProjectOutlookStopsAtAFiveHourWindowWithWeekToSpare(t *testing.T) {
	// $20 of the window lasts 2 hours at $10 an hour; the window resets at
	// hour 3 and its $100 lasts 10 more. The week never runs out.
	account := outlookSeat(10000, 10000, 1000, 20, 100, 3)
	projection := projectOutlook([]outlookAccount{account}, 0, constantDemand(10), outlookSampleHours())
	five := projection.windows[0]
	assert.InDelta(t, 50, five.DemandUSD, 1e-9)
	assert.InDelta(t, 40, five.ServedUSD, 1e-9)
	assert.InDelta(t, 10, five.ShortUSD, 1e-9)
	assert.InDelta(t, 1, five.ShortHours, 1e-9)
	require.NotNil(t, five.FirstShortHours)
	assert.InDelta(t, 2, *five.FirstShortHours, 1e-9)

	// Samples stand every 5 minutes at first: 12 an hour.
	assert.InDelta(t, 20, projection.drawable[0], 1e-9)
	assert.InDelta(t, 10, projection.drawable[12], 1e-9)
	assert.Zero(t, projection.drawable[24], "dry at hour 2")
	assert.InDelta(t, 100, projection.drawable[36], 1e-9, "a reset on the sample shows refilled")
	assert.InDelta(t, 10000-20, projection.weekLeft[36], 1e-9)
	assert.InDelta(t, 10, projection.demand[0], 1e-9)
}

func TestProjectOutlookStartsAWindowWithTheFirstSpend(t *testing.T) {
	// A window that is not running opens now: $100 at $50 an hour is gone by
	// hour 2 and back at hour 5, five windows in a day.
	account := outlookSeat(10000, 10000, 0, 100, 100, 0)
	projection := projectOutlook([]outlookAccount{account}, 0, constantDemand(50), outlookSampleHours())
	day := projection.windows[1]
	assert.InDelta(t, 1200, day.DemandUSD, 1e-9)
	assert.InDelta(t, 500, day.ServedUSD, 1e-9)
	assert.InDelta(t, 14, day.ShortHours, 1e-9, "3 of every 5 hours, less the last window's hour past the day")
	assert.InDelta(t, 2, *day.FirstShortHours, 1e-9)
}

func TestProjectOutlookSpreadsDemandAndDropsWhatAResetReplaces(t *testing.T) {
	// The runway's example: two accounts drain together at $10 an hour, the
	// first resets at hour 5 with $25 left, which its $200 replaces, so $225
	// lasts 22.5 more hours.
	accounts := []outlookAccount{
		{week: 50, weekFull: 200, weekReset: 5 * runwayHourMS},
		{week: 50, weekFull: 200, weekReset: 500 * runwayHourMS},
	}
	projection := projectOutlook(accounts, 0, constantDemand(10), outlookSampleHours())
	week := projection.windows[2]
	require.NotNil(t, week.FirstShortHours)
	assert.InDelta(t, 27.5, *week.FirstShortHours, 1e-9)
	assert.InDelta(t, 50+225, projection.windows[2].ServedUSD, 1e-9)
}

func TestProjectOutlookLeavesACoolingAccountOutUntilItReturns(t *testing.T) {
	cooling := outlookAccount{week: 100, weekFull: 100, weekReset: 1000 * runwayHourMS, readyMS: 3 * runwayHourMS}
	projection := projectOutlook([]outlookAccount{cooling}, 0, constantDemand(10), outlookSampleHours())
	five := projection.windows[0]
	assert.InDelta(t, 20, five.ServedUSD, 1e-9, "hours 3 to 5")
	assert.InDelta(t, 3, five.ShortHours, 1e-9)
	assert.Zero(t, *five.FirstShortHours)
	assert.Zero(t, projection.drawable[0])
	assert.InDelta(t, 100, projection.weekLeft[0], 1e-9, "the week is held, not spendable")
}

func TestOutlookSamplesStandOnEveryWindow(t *testing.T) {
	hours := outlookSampleHours()
	assert.Zero(t, hours[0])
	assert.Equal(t, 168.0, hours[len(hours)-1])
	for i := 1; i < len(hours); i++ {
		assert.Greater(t, hours[i], hours[i-1])
	}
	for _, window := range outlookWindowHours {
		assert.Contains(t, hours, window)
	}
	assert.InDelta(t, 1.0/12, hours[1], 1e-12, "5 minutes apart at first")
	assert.InDelta(t, 5.25, hours[61], 1e-12, "then 15")
}

func TestOutlookLinearModelsMoveTheDayByTheLatestHours(t *testing.T) {
	// The day ran at $5 an hour on gpt-load, the last 12 hours at $7.50 and
	// the last hour at $10; the pool's own dollars put the day at $100.
	demand := outlookDemand{burn: 100, profile: flatDemand(), hourUSD: 10, halfDayUSD: 90, dayUSD: 120}
	models := demand.models(0)
	require.Len(t, models, 5)
	ids := make([]string, len(models))
	for i, spec := range models {
		ids[i] = spec.id
	}
	assert.Equal(t, []string{OutlookLinearHour, OutlookLinearHalf, OutlookLinearDay, OutlookHistory, OutlookSmart}, ids)
	assert.InDelta(t, 200, models[0].rate(0), 1e-9)
	assert.InDelta(t, 150, models[1].rate(123456789), 1e-9, "a linear rate holds")
	assert.InDelta(t, 100, models[2].rate(0), 1e-9)

	demand.dayUSD = 0
	models = demand.models(0)
	assert.Nil(t, models[0].rate, "no reading of gpt-load's day, no ratio to it")
	assert.Nil(t, models[1].rate)
	assert.NotNil(t, models[2].rate)
}

func TestOutlookHistoryModelRepeatsEachHourOfTheDay(t *testing.T) {
	// Two days of use: 3 units in UTC hour 0 and 1 in every other hour, so a
	// day holds 26 units; the last day cost the pool $52, $2 a unit.
	series := make([]float64, 48)
	for i := range series {
		series[i] = 1
		if i%24 == 0 {
			series[i] = 3
		}
	}
	demand := outlookDemand{burn: 52.0 / 24, profile: flatDemand(), series: series, firstHour: 0}
	history := demand.models(48 * runwayHourMS)[3]
	require.NotNil(t, history.rate)
	assert.InDelta(t, 6, history.rate(48*runwayHourMS), 1e-9, "UTC hour 0")
	assert.InDelta(t, 2, history.rate(49*runwayHourMS+1), 1e-9)

	demand.series = series[:23]
	assert.Nil(t, demand.models(0)[3].rate, "under a day of history")
}

func TestOutlookSmartModelFadesTheMomentumOut(t *testing.T) {
	profile := flatDemand()
	profile.recent, profile.momentum = 1.2, 1.5
	demand := outlookDemand{burn: 100, profile: profile}
	smart := demand.models(0)[4]
	assert.InDelta(t, 120*1.5, smart.rate(0), 1e-9, "the level, with all of the momentum")
	assert.InDelta(t, 120*1.25, smart.rate(2*runwayHourMS), 1e-9, "half of it two hours on")
	assert.InDelta(t, 120, smart.rate(100*runwayHourMS), 1e-3)

	profile.shape[1] = 2
	profile.growth = math.Log(1.1)
	demand.profile = profile
	smart = demand.models(0)[4]
	hour := float64(runwayHourMS)
	want := 120 * 2 * profile.growthAt(1.0/24) * profile.momentumAt(1)
	assert.InDelta(t, want, smart.rate(int64(hour)), 1e-9, "the shape and the trend ride the same level")
}

func TestDemandMomentumIsBounded(t *testing.T) {
	shape := flatDemand().shape
	utcHour := func(index int) int { return index % 24 }
	assert.InDelta(t, 1.2, demandMomentum([]float64{10, 10, 12, 12}, 10, shape, utcHour), 1e-9)
	assert.InDelta(t, demandMomentumBound, demandMomentum([]float64{10, 30, 30}, 10, shape, utcHour), 1e-9)
	assert.InDelta(t, 1/demandMomentumBound, demandMomentum([]float64{10, 1, 1}, 10, shape, utcHour), 1e-9)
	assert.Equal(t, 1.0, demandMomentum([]float64{10, 10}, 0, shape, utcHour), "no level to compare with")
	assert.Equal(t, 1.0, flatDemand().momentumAt(0), "a profile without a momentum reads as none")
}

// outlookPoolAccount is runwayAccountAt with a 5-hour window: five left of
// fiveCapacity, resetting in fiveResetHours.
func outlookPoolAccount(remaining, capacity, burn float64, resetHours int64, five, fiveCapacity float64, fiveResetHours int64) EngineAccount {
	account := runwayAccountAt(1, remaining, capacity, burn, resetHours)
	account.Plan, account.Tier, account.SevenDayCapacitySource = "Team", "team_tier_1", "measured"
	account.FiveHourRemainingUSD, account.FiveHourCapacityUSD = dollars(five), dollars(fiveCapacity)
	account.FiveHourReset = fiveResetHours * runwayHourMS
	return account
}

func TestPoolOutlookCountsTheChannelAndItsBudgetLines(t *testing.T) {
	// Group 1 stops accounts at 80% of the 5-hour window and 50% of the week.
	counted := outlookPoolAccount(150, 400, 10, 100, 30, 100, 2)
	counted.CredentialID, counted.EmailMask = 7, "a***@x.com"
	unread := runwayAccountAt(1, 0, 0, 3, 100)
	unread.SevenDayRemainingUSD, unread.SevenDayCapacityUSD = nil, nil
	suspended := outlookPoolAccount(500, 400, 2, 100, 30, 100, 2)
	suspended.Status = "suspended"
	outlook := poolOutlook(runwayPool(counted, unread, suspended, runwayAccountAt(2, 900, 900, 50, 100), runwayAccountAt(3, 900, 900, 50, 100)),
		"claude", 0, outlookDemand{profile: flatDemand()})
	require.NotNil(t, outlook)

	assert.Equal(t, 1, outlook.Counted)
	assert.Equal(t, 1, outlook.Unknown)
	assert.InDelta(t, 200, outlook.WeekCapacityUSD, 1e-9, "a week up to the 50% line")
	assert.InDelta(t, 80, outlook.FiveHourCapacityUSD, 1e-9, "a window up to the 80% line")
	assert.InDelta(t, 200/168.0, outlook.SustainableUSDPerHour, 1e-9)
	assert.InDelta(t, 16, outlook.PeakUSDPerHour, 1e-9)
	assert.Equal(t, outlookSampleHours(), outlook.SampleHours)

	// The demand is every Claude account's spend, as the runway counts it:
	// the suspended one's and the disabled group's too, since their traffic
	// moves to the others, and not the Codex group's.
	linear := outlook.Models[2]
	assert.Equal(t, OutlookLinearDay, linear.ID)
	assert.InDelta(t, 65, linear.RateUSDPerHour, 1e-9)
	assert.InDelta(t, 65*168/200.0, linear.WeekLoad, 1e-9)

	require.Len(t, outlook.Remaining, 3)
	assert.InDelta(t, 30, outlook.Remaining[0].OnHandUSD, 1e-9)
	assert.InDelta(t, 80, outlook.Remaining[0].FiveHourRefillUSD, 1e-9)
	require.Len(t, outlook.Resets, 2)
	assert.Equal(t, "five_hour", outlook.Resets[0].Window)
	assert.Equal(t, 7, outlook.Resets[0].CredentialID)

	assert.Nil(t, poolOutlook(runwayPool(), "claude", 0, outlookDemand{profile: flatDemand()}), "no account, no outlook")
}

func TestPoolOutlookMarksAModelWithoutItsInputUnavailable(t *testing.T) {
	outlook := poolOutlook(runwayPool(outlookPoolAccount(150, 400, 10, 100, 30, 100, 2)), "claude", 0, outlookDemand{profile: flatDemand()})
	require.Len(t, outlook.Models, 5)
	for _, row := range outlook.Models {
		switch row.ID {
		case OutlookLinearDay, OutlookSmart:
			assert.True(t, row.Available, row.ID)
			assert.Len(t, row.Windows, 3, row.ID)
			assert.Len(t, row.Drawable, len(outlook.SampleHours), row.ID)
			assert.Len(t, row.WeekLeft, len(outlook.SampleHours), row.ID)
			assert.Len(t, row.Demand, len(outlook.SampleHours), row.ID)
		default:
			assert.False(t, row.Available, row.ID)
			assert.Empty(t, row.Windows, row.ID)
		}
		assert.NotNil(t, row.Additions, row.ID)
	}
}

func TestPoolOutlookRunsTheSmartModelAcrossItsUsualRange(t *testing.T) {
	profile := flatDemand()
	profile.low, profile.high, profile.origins = 0.5, 2, 30
	pool := runwayPool(outlookPoolAccount(150, 400, 10, 1000, 80, 100, 0))
	smart := poolOutlook(pool, "claude", 0, outlookDemand{profile: profile}).Models[4]
	require.NotNil(t, smart.Low)
	require.NotNil(t, smart.High)
	assert.Equal(t, 0.5, smart.Low.Scale)
	assert.Equal(t, 2.0, smart.High.Scale)
	assert.InDelta(t, 25, smart.Low.Windows[0].DemandUSD, 1e-9)
	assert.InDelta(t, 100, smart.High.Windows[0].DemandUSD, 1e-9)
	assert.Len(t, smart.High.Drawable, len(outlookSampleHours()))

	assert.Nil(t, poolOutlook(pool, "claude", 0, outlookDemand{profile: flatDemand()}).Models[4].Low, "no scored forecasts, no range")
	linear := poolOutlook(pool, "claude", 0, outlookDemand{profile: profile}).Models[2]
	assert.Nil(t, linear.Low, "only the smart forecast has a scored range")
}

func TestPoolOutlookSizesAdditionsByWeekAndByWindow(t *testing.T) {
	// One Team seat: $200 a week and $80 a window below its lines, with $150
	// of the week and a full window that is not running. Demand of $20 an
	// hour is $3360 a week.
	pool := runwayPool(outlookPoolAccount(150, 400, 20, 1000, 80, 100, 0))
	linear := poolOutlook(pool, "claude", 0, outlookDemand{profile: flatDemand()}).Models[2]
	require.Len(t, linear.Additions, 1)
	addition := linear.Additions[0]
	assert.Equal(t, "team_tier_1", addition.Tier)
	assert.InDelta(t, 200, addition.WeekUSD, 1e-9)
	assert.InDelta(t, 80, addition.FiveHourUSD, 1e-9)
	assert.Equal(t, 1, addition.Measured)
	// (20 − 200/168) × 168 = $3160 a week short, at $200 an account.
	assert.Equal(t, 16, addition.KeepUp)
	// Each added seat holds one week now and none again inside the horizon:
	// $3360 less the $150 held takes 17 of them.
	require.NotNil(t, addition.CoverWeek)
	assert.Equal(t, 17, *addition.CoverWeek)

	// At $1 an hour the seat's own week lasts and nothing is added.
	quiet := poolOutlook(runwayPool(outlookPoolAccount(200, 400, 1, 1000, 80, 100, 0)), "claude", 0, outlookDemand{profile: flatDemand()}).Models[2]
	assert.Zero(t, quiet.Additions[0].KeepUp)
	require.NotNil(t, quiet.Additions[0].CoverWeek)
	assert.Zero(t, *quiet.Additions[0].CoverWeek)

	// At $1000 an hour even 30 seats leave a gap.
	flood := poolOutlook(runwayPool(outlookPoolAccount(150, 400, 1000, 1000, 80, 100, 0)), "claude", 0, outlookDemand{profile: flatDemand()}).Models[2]
	assert.Nil(t, flood.Additions[0].CoverWeek)
}

func TestReadPoolOutlookJoinsThePoolItsUsageAndItsHistory(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.QuotaData{}))
	previousDB := model.DB
	model.DB = db
	clearCaches := func() {
		poolUsageCache.mu.Lock()
		poolUsageCache.entries = nil
		poolUsageCache.mu.Unlock()
		demandCache.mu.Lock()
		demandCache.entries = nil
		demandCache.mu.Unlock()
		enginePoolCache.mu.Lock()
		enginePoolCache.readAt = time.Time{}
		enginePoolCache.mu.Unlock()
	}
	clearCaches()
	t.Cleanup(func() {
		model.DB = previousDB
		clearCaches()
	})

	now := time.Now()
	hour := now.Unix() - now.Unix()%3600
	// Two days of use, one unit an hour.
	var rows []model.QuotaData
	for k := int64(1); k <= 48; k++ {
		rows = append(rows, model.QuotaData{ModelName: "claude-opus", CreatedAt: hour - k*3600, Quota: int(common.QuotaPerUnit)})
	}
	require.NoError(t, db.Create(&rows).Error)

	nowMS := strconv.FormatInt(now.UnixMilli(), 10)
	weekReset := strconv.FormatInt(now.Add(100*time.Hour).UnixMilli(), 10)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/group-concurrency":
			_, _ = w.Write([]byte(`{"code":0,"data":{"observed_at_ms":` + nowMS + `,"credential_limit":1,"groups":[
				{"id":1,"name":"Team","channel_id":"claude","enabled":true,"quota_supported":true,
				 "quota_effective":{"enabled":true,"five_hour_percent":80,"seven_day_percent":50},
				 "credentials":[{"id":6,"name":"bob@x.com","status":"available","five_hour":{"utilization":0.5},
				   "seven_day":{"utilization":0.1,"reset_at_ms":` + weekReset + `}}]}
			]}}`))
		case "/api/group-concurrency/pool-estimate":
			_, _ = w.Write([]byte(`{"code":0,"data":{"five_hour":{},"week":{},"accounts":[{"credential_id":6,
				"five_hour":{"remaining_usd":30,"capacity_usd":100},
				"seven_day":{"remaining_usd":160,"capacity_usd":400,"source":"measured"},"burn_usd_per_hour":4}]}}`))
		case "/api/usage":
			query := r.URL.Query()
			from, _ := strconv.ParseInt(query.Get("from_ms"), 10, 64)
			to, _ := strconv.ParseInt(query.Get("to_ms"), 10, 64)
			// $2 an hour over the last hour, $1 an hour before it.
			span := float64(to-from) / float64(time.Hour.Milliseconds())
			cost := int64((span + math.Min(span, 1)) * 1e9)
			_, _ = w.Write([]byte(`{"code":0,"data":{"summary":{"request_count":1,"estimated_cost_nano_usd":"` +
				strconv.FormatInt(cost, 10) + `"},"series":[]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	previousURL, previousKey := operation_setting.EngineControlURL, operation_setting.EngineControlKey
	t.Cleanup(func() {
		operation_setting.EngineControlURL, operation_setting.EngineControlKey = previousURL, previousKey
	})

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = "", ""
	assert.False(t, readPoolOutlook().Configured)

	operation_setting.EngineControlURL, operation_setting.EngineControlKey = server.URL, "pool-outlook"
	outlook := readPoolOutlook()
	require.True(t, outlook.Configured)
	require.Empty(t, outlook.Error)
	require.Empty(t, outlook.UsageError)
	assert.Equal(t, 1, outlook.Counted)
	require.Len(t, outlook.Models, 5)
	for _, row := range outlook.Models {
		assert.True(t, row.Available, row.ID)
	}
	// The pool's $4 an hour over the day, moved by gpt-load's last hour and
	// last 12 hours against its day: $2 against 25/24, 13/12 against 25/24.
	assert.InDelta(t, 4*2/(25.0/24), outlook.Models[0].RateUSDPerHour, 1e-6)
	assert.InDelta(t, 4*(13.0/12)/(25.0/24), outlook.Models[1].RateUSDPerHour, 1e-6)
	assert.InDelta(t, 4, outlook.Models[2].RateUSDPerHour, 1e-9)
	assert.InDelta(t, 4, outlook.Models[3].RateUSDPerHour, 1e-9, "a flat history repeats the day's rate")
	assert.InDelta(t, 30, outlook.Remaining[0].OnHandUSD, 1e-9)
}
