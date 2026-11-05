package service

import (
	"math"

	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const runwayHourMS = int64(60 * 60 * 1000)

func dollars(value float64) *float64 { return &value }

func runwayPool(accounts ...EngineAccount) EnginePool {
	return EnginePool{
		Groups: []EngineGroup{
			{ID: 1, Channel: "claude", Enabled: true, QuotaBudget: true, FiveHourBudget: 80, SevenDayBudget: 50},
			{ID: 2, Channel: "codex", Enabled: true},
			{ID: 3, Channel: "claude", Enabled: false},
		},
		Accounts: accounts,
	}
}

func runwayAccountAt(group int, remaining, capacity, burn float64, resetHours int64) EngineAccount {
	return EngineAccount{
		GroupID: group, Status: "available",
		SevenDayRemainingUSD: dollars(remaining), SevenDayCapacityUSD: dollars(capacity),
		BurnUSDPerHour: dollars(burn), SevenDayReset: resetHours * runwayHourMS,
		FiveHourRemainingUSD: dollars(remaining / 10),
	}
}

func TestPoolRunwayRunsOutBeforeAnyReset(t *testing.T) {
	// $100 left, $10 an hour, resets in 100 hours: dry after 10 hours.
	runway := poolRunway(runwayPool(runwayAccountAt(1, 100, 400, 10, 100)), "claude", 0, flatDemand())
	require.NotNil(t, runway)
	require.NotNil(t, runway.WeekHours)
	assert.InDelta(t, 10, *runway.WeekHours, 1e-9)
	assert.Equal(t, 200.0, runway.WeekCapacityUSD, "capacity stops at the group's 50% budget line")
	assert.InDelta(t, 10*168/200.0, runway.WeekLoad, 1e-9)
	require.NotNil(t, runway.FiveHourHours)
	assert.InDelta(t, 1, *runway.FiveHourHours, 1e-9)
	assert.Equal(t, 1, runway.Counted)
}

func TestPoolRunwayCountsAResetAndDropsWhatWasLeft(t *testing.T) {
	// Two accounts drain together at $10 an hour. After 5 hours $50 of $100
	// is left, $25 each; the first account's reset discards its $25 and
	// brings $200, so $225 lasts 22.5 more hours: 27.5 in all.
	runway := poolRunway(runwayPool(
		runwayAccountAt(1, 50, 400, 6, 5),
		runwayAccountAt(1, 50, 400, 4, 500),
	), "claude", 0, flatDemand())
	require.NotNil(t, runway.WeekHours)
	assert.InDelta(t, 27.5, *runway.WeekHours, 1e-9)
	assert.Zero(t, runway.LowestUSD)
	assert.InDelta(t, 27.5, runway.LowestHours, 1e-9)
}

func TestPoolRunwayLastsWhenTheWeekRefillsFasterThanItIsSpent(t *testing.T) {
	runway := poolRunway(runwayPool(
		runwayAccountAt(1, 150, 1000, 1, 24),
		runwayAccountAt(1, 300, 1000, 1, 96),
	), "claude", 0, flatDemand())
	assert.Nil(t, runway.WeekHours, "a $2/h demand never drains $1000 of weekly budget")
	assert.Nil(t, runway.FirstShortHours)
	assert.InDelta(t, 2*168/1000.0, runway.WeekLoad, 1e-9)
	assert.InDelta(t, 1000/168.0, runway.SustainableUSDPerHour, 1e-9)
	assert.Zero(t, runway.ShortHours)
	assert.InDelta(t, 1, runway.ServedShare, 1e-9)
	// $450 less $48 by the first reset at hour 24 is the lowest point.
	assert.InDelta(t, 450-48, runway.LowestUSD, 1e-9)
	assert.InDelta(t, 24, runway.LowestHours, 1e-9)
	assert.Equal(t, 168.0, runway.HorizonHours)
}

func TestPoolRunwayKeepsToItsChannelAndCountsWhatItCannotUse(t *testing.T) {
	cooling := runwayAccountAt(1, 0, 400, 3, 1)
	cooling.Status = "quota_budget_exceeded"
	suspended := runwayAccountAt(1, 500, 400, 2, 1)
	suspended.Status = "suspended"
	unknown := runwayAccountAt(1, 0, 0, 0, 1)
	unknown.SevenDayCapacityUSD = nil
	runway := poolRunway(runwayPool(
		runwayAccountAt(1, 100, 400, 5, 1000),
		cooling,
		suspended,
		unknown,
		runwayAccountAt(2, 9000, 9000, 50, 1),  // codex: another channel
		runwayAccountAt(3, 9000, 9000, 0.5, 1), // disabled group
	), "claude", 0, flatDemand())
	assert.InDelta(t, 5+3+2+0.5, runway.BurnUSDPerHour, 1e-9, "paused accounts' traffic moves to the others")
	assert.Equal(t, 2, runway.Counted, "the serving and the budget-paused account")
	assert.Equal(t, 1, runway.Unknown)
	assert.Equal(t, 100.0, runway.WeekRemainingUSD)
	require.NotNil(t, runway.WeekHours)
	// The paused account refills $200 at hour 1: $100 - $10.5 + $200 = $289.5.
	assert.InDelta(t, 1+(100-10.5+200)/10.5, *runway.WeekHours, 1e-9)

	assert.Nil(t, poolRunway(runwayPool(runwayAccountAt(2, 1, 1, 1, 1)), "claude", 0, flatDemand()), "no Claude account, no runway")
}

func TestPoolRunwayWithoutSpend(t *testing.T) {
	runway := poolRunway(runwayPool(runwayAccountAt(1, 100, 400, 0, 10)), "claude", 0, flatDemand())
	assert.Nil(t, runway.WeekHours)
	assert.Nil(t, runway.FiveHourHours)
	assert.Zero(t, runway.WeekLoad)
	assert.Equal(t, 1.0, runway.ServedShare)
	assert.Empty(t, runway.Curve)
}

func TestPoolRunwayMeasuresEachGapUntilTheNextReset(t *testing.T) {
	// $10 an hour; $50 left lasts 5 hours. Then nothing is left until the
	// second account resets at hour 20 with $200, which lasts 20 hours, and
	// nothing again until the first resets at hour 100: 5 to 20 and 40 to 100
	// are gaps, 75 hours. From hour 100 its $200 lasts to 120, then the gap
	// runs to the end of the week at 168: 48 more.
	runway := poolRunway(runwayPool(
		runwayAccountAt(1, 25, 400, 6, 100),
		runwayAccountAt(1, 25, 400, 4, 20),
	), "claude", 0, flatDemand())
	require.NotNil(t, runway.WeekHours)
	assert.InDelta(t, 5, *runway.WeekHours, 1e-9)
	require.NotNil(t, runway.FirstShortHours)
	assert.InDelta(t, 15, *runway.FirstShortHours, 1e-9)
	assert.InDelta(t, 15+60+48, runway.ShortHours, 1e-9)
	assert.InDelta(t, (50+200+200)/(10*168.0), runway.ServedShare, 1e-9)

	require.Len(t, runway.Curve, 169, "every whole hour from now to the horizon")
	for hour, want := range map[int]float64{0: 50, 3: 20, 5: 0, 19: 0, 20: 200, 30: 100, 40: 0, 99: 0, 100: 200, 110: 100, 120: 0, 168: 0} {
		assert.InDelta(t, want, runway.Curve[hour], 1e-9, "hour %d; a reset on the hour shows refilled", hour)
	}
}

func TestPoolRunwayReportsAGrazingGapAsShort(t *testing.T) {
	// $100 lasts 10 hours, and a reset at hour 10.1 brings $2000: a six-minute
	// gap, not a pool that has run out.
	refilling := runwayAccountAt(1, 50, 4000, 5, 0)
	refilling.SevenDayReset = int64(10.1 * float64(runwayHourMS))
	runway := poolRunway(runwayPool(refilling, runwayAccountAt(1, 50, 400, 5, 160)), "claude", 0, flatDemand())
	require.NotNil(t, runway.FirstShortHours)
	assert.InDelta(t, 10, *runway.WeekHours, 1e-9)
	assert.InDelta(t, 0.1, *runway.FirstShortHours, 1e-9)
	assert.InDelta(t, 0.1, runway.ShortHours, 1e-9)
	assert.Greater(t, runway.ServedShare, 0.999)
}

func TestPoolRunwayPeakAndWeekToDate(t *testing.T) {
	young := runwayAccountAt(1, 100, 400, 3, 160) // 8 hours into its week
	young.FiveHourCapacityUSD = dollars(50)
	old := runwayAccountAt(1, 100, 400, 5, 68) // 100 hours in
	old.SevenDay = 25
	old.FiveHourCapacityUSD = dollars(100)
	runway := poolRunway(runwayPool(young, old), "claude", 0, flatDemand())
	assert.InDelta(t, (50+100)*0.8/5, runway.PeakUSDPerHour, 1e-9, "5-hour capacity up to the 80% line, per hour")
	assert.InDelta(t, 3+400*0.25/100, runway.WeekToDateUSDPerHour, 1e-9, "the young window counts its last day")
}

// halfDayDemand runs all demand in UTC 00:00–12:00, at twice the average.
func halfDayDemand() demandProfile {
	profile := flatDemand()
	for hour := range profile.shape {
		profile.shape[hour] = 0
		if hour < 12 {
			profile.shape[hour] = 2
		}
	}
	return profile
}

func TestPoolRunwayMovesDemandThroughTheDay(t *testing.T) {
	// $100 left and $10/h on average, all of it in the first half of each
	// UTC day: $20/h from midnight runs out at 05:00, not at 10:00.
	pool := runwayPool(runwayAccountAt(1, 100, 400, 10, 1000))
	runway := poolRunway(pool, "claude", 0, halfDayDemand())
	require.NotNil(t, runway.WeekHours)
	assert.InDelta(t, 5, *runway.WeekHours, 1e-9)
	assert.InDelta(t, 20, runway.PeakHourUSDPerHour, 1e-9)
	assert.InDelta(t, 163, runway.ShortHours, 1e-9, "quiet hours inside the gap count too")
	assert.InDelta(t, 100/(10*168.0), runway.ServedShare, 1e-9)
	assert.InDelta(t, 60, runway.Curve[2], 1e-9)
	assert.InDelta(t, 0, runway.Curve[5], 1e-9)

	// From UTC 12:00 the first six hours are quiet.
	runway = poolRunway(pool, "claude", 12*runwayHourMS, halfDayDemand())
	assert.InDelta(t, 17, *runway.WeekHours, 1e-9)
	assert.InDelta(t, 100, runway.Curve[11], 1e-9)
}

func TestPoolRunwayProjectsTheScenariosAndTheHeadroom(t *testing.T) {
	// $100 left and no reset in the week: at $10/h it lasts 10 hours, and
	// lasting the week takes demand at or below 100/1680 of it.
	pool := runwayPool(runwayAccountAt(1, 100, 400, 10, 1000))
	profile := flatDemand()
	profile.hours = 24 * 7
	profile.low, profile.high, profile.origins = 0.5, 2, 30
	runway := poolRunway(pool, "claude", 0, profile)

	require.NotNil(t, runway.Low)
	require.NotNil(t, runway.High)
	assert.InDelta(t, 20, *runway.Low.WeekHours, 1e-9)
	assert.InDelta(t, 5, *runway.High.WeekHours, 1e-9)
	assert.Equal(t, 0.5, runway.Low.DemandScale)
	assert.Equal(t, 30, runway.BandForecasts)
	assert.Nil(t, runway.Trend, "no growth, no trend")
	assert.InDelta(t, 10, runway.ExpectedUSDPerHour, 1e-9, "without growth the expected demand is the burn")

	profile.growth = math.Log(1.1)
	runway = poolRunway(pool, "claude", 0, profile)
	assert.Less(t, *runway.Low.WeekHours, 20.0, "the band rides the trend")
	assert.Less(t, *runway.High.WeekHours, 5.0)
	assert.InDelta(t, profile.over(10, 0, runwayWeek.Milliseconds(), true)/168, runway.ExpectedUSDPerHour, 1e-9)
	assert.Greater(t, runway.ExpectedUSDPerHour, 10.0)
	require.NotNil(t, runway.Trend)
	assert.Less(t, *runway.Trend.WeekHours, 10.0, "growing demand runs out sooner")
	assert.InDelta(t, profile.growthAt(7), runway.Trend.DemandScale, 1e-9)
	assert.InDelta(t, 0.1, runway.GrowthPerDay, 1e-9)
	require.NotNil(t, runway.HeadroomScale)
	assert.InDelta(t, 100/1680.0, *runway.HeadroomScale, 0.001)

	profile.low, profile.high = 1.2, 1.5
	runway = poolRunway(pool, "claude", 0, profile)
	assert.Equal(t, 1.0, runway.Low.DemandScale, "the band holds demand as now")
	assert.Equal(t, 1.5, runway.High.DemandScale)

	plenty := poolRunway(runwayPool(runwayAccountAt(1, 100000, 400000, 10, 1000)), "claude", 0, flatDemand())
	assert.Nil(t, plenty.HeadroomScale, "lasting at four times the demand is headroom enough")
	assert.Nil(t, plenty.Trend, "no growth, no trend")
	assert.Nil(t, plenty.Low, "no band without past forecasts")
}

func teamSeat(tier string, account EngineAccount) EngineAccount {
	account.Plan, account.Tier, account.SevenDayCapacitySource = "Team", tier, "measured"
	return account
}

func TestPoolRunwaySizesTeamAccountsToCloseTheGap(t *testing.T) {
	// $10 an hour against a $400 week at the 50% line: each added account
	// brings $200 a week, and the $1,480 shortfall takes eight of them.
	runway := poolRunway(runwayPool(teamSeat("team_tier_1", runwayAccountAt(1, 100, 400, 10, 100))), "claude", 0, flatDemand())
	require.NotNil(t, runway.Addition)
	addition := runway.Addition
	assert.Equal(t, "team_tier_1", addition.Tier)
	assert.InDelta(t, 200, addition.WeekUSD, 1e-9)
	assert.Equal(t, 50.0, addition.BudgetPercent)
	assert.Equal(t, 8, addition.ForLoad)
	assert.Equal(t, 8, addition.ForTrend, "without a trend it is the same")
	assert.Equal(t, 8, addition.ForExpected, "without growth the expected demand is the burn")
	assert.Nil(t, addition.ForLow, "no band without past forecasts")
	require.NotNil(t, addition.ForWeek)
	assert.Positive(t, *addition.ForWeek)
	assert.LessOrEqual(t, *addition.ForWeek, addition.ForLoad, "a week needs no more than the steady state")

	// Each added account starts a full week now: with ForWeek of them the
	// next 7 days have no gap, with one fewer they do.
	base := []runwayAccount{{remaining: 100, full: 200, resetMS: 100 * runwayHourMS}}
	flat := func(int64) float64 { return 10 }
	with := func(count int) []runwayAccount {
		accounts := append([]runwayAccount(nil), base...)
		for range count {
			accounts = append(accounts, runwayAccount{remaining: 200, full: 200, resetMS: 168 * runwayHourMS})
		}
		return accounts
	}
	assert.Nil(t, projectRunway(with(*addition.ForWeek), 0, flat).WeekHours)
	assert.NotNil(t, projectRunway(with(*addition.ForWeek-1), 0, flat).WeekHours)
}

func TestPoolRunwaySizesAdditionsByTheTrendAndItsBand(t *testing.T) {
	// $10 an hour growing 10% a day, damped: the week averages more than
	// today's demand and less than the week's end.
	pool := runwayPool(teamSeat("team_tier_1", runwayAccountAt(1, 100, 400, 10, 100)))
	profile := flatDemand()
	profile.hours, profile.growth = 24*7, math.Log(1.1)
	profile.low, profile.high, profile.origins = 0.8, 1.3, 30
	runway := poolRunway(pool, "claude", 0, profile)
	flat := poolRunway(pool, "claude", 0, flatDemand())
	addition := runway.Addition
	require.NotNil(t, addition)

	week := addition.WeekUSD
	closing := func(demand float64) int { return int(math.Ceil((demand-runway.SustainableUSDPerHour)*168/week - 1e-9)) }
	assert.Equal(t, closing(runway.ExpectedUSDPerHour), addition.ForExpected)
	assert.Greater(t, addition.ForExpected, addition.ForLoad)
	assert.Less(t, addition.ForExpected, addition.ForTrend)
	require.NotNil(t, addition.ForLow)
	require.NotNil(t, addition.ForHigh)
	assert.Equal(t, closing(runway.ExpectedUSDPerHour*0.8), *addition.ForLow)
	assert.Equal(t, closing(runway.ExpectedUSDPerHour*1.3), *addition.ForHigh)
	require.NotNil(t, addition.ForWeek)
	require.NotNil(t, flat.Addition.ForWeek)
	assert.Greater(t, *addition.ForWeek, *flat.Addition.ForWeek, "the 7 days are run at the trend")
}

func TestPoolRunwayAddsNothingWhenSupplyKeepsUp(t *testing.T) {
	runway := poolRunway(runwayPool(teamSeat("team_tier_1", runwayAccountAt(1, 200, 400, 1, 100))), "claude", 0, flatDemand())
	require.NotNil(t, runway.Addition)
	assert.Zero(t, runway.Addition.ForLoad)
	require.NotNil(t, runway.Addition.ForWeek)
	assert.Zero(t, *runway.Addition.ForWeek)
}

func TestPoolRunwayHasNoAdditionWithoutAMeasuredTeamSeat(t *testing.T) {
	account := runwayAccountAt(1, 100, 400, 10, 100)
	account.Plan, account.Tier, account.SevenDayCapacitySource = "Max", "default_claude_max_5x", "measured"
	runway := poolRunway(runwayPool(account), "claude", 0, flatDemand())
	assert.Nil(t, runway.Addition)
	assert.Empty(t, runway.Additions)
}

func TestPoolRunwaySizesEachTeamTierTierOneFirst(t *testing.T) {
	// Tier 1 serves $400 a week and Standard $80, each at the 50% line:
	// the $1,480 shortfall takes 8 Tier 1 seats or 37 Standard ones.
	pool := runwayPool(
		teamSeat("team_standard", runwayAccountAt(1, 20, 80, 10, 100)),
		teamSeat("team_tier_1", runwayAccountAt(2, 80, 400, 10, 100)),
	)
	runway := poolRunway(pool, "claude", 0, flatDemand())
	require.Len(t, runway.Additions, 2)
	assert.Equal(t, "team_tier_1", runway.Additions[0].Tier)
	assert.Equal(t, "team_standard", runway.Additions[1].Tier)
	require.NotNil(t, runway.Addition)
	assert.Equal(t, runway.Additions[0], *runway.Addition)
	assert.Less(t, runway.Additions[0].ForLoad, runway.Additions[1].ForLoad)
}
