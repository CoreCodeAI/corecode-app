package service

import (
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
	runway := poolRunway(runwayPool(runwayAccountAt(1, 100, 400, 10, 100)), "claude", 0)
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
	), "claude", 0)
	require.NotNil(t, runway.WeekHours)
	assert.InDelta(t, 27.5, *runway.WeekHours, 1e-9)
	assert.Zero(t, runway.LowestUSD)
	assert.InDelta(t, 27.5, runway.LowestHours, 1e-9)
}

func TestPoolRunwayLastsWhenTheWeekRefillsFasterThanItIsSpent(t *testing.T) {
	runway := poolRunway(runwayPool(
		runwayAccountAt(1, 150, 1000, 1, 24),
		runwayAccountAt(1, 300, 1000, 1, 96),
	), "claude", 0)
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
	), "claude", 0)
	assert.InDelta(t, 5+3+2+0.5, runway.BurnUSDPerHour, 1e-9, "paused accounts' traffic moves to the others")
	assert.Equal(t, 2, runway.Counted, "the serving and the budget-paused account")
	assert.Equal(t, 1, runway.Unknown)
	assert.Equal(t, 100.0, runway.WeekRemainingUSD)
	require.NotNil(t, runway.WeekHours)
	// The paused account refills $200 at hour 1: $100 - $10.5 + $200 = $289.5.
	assert.InDelta(t, 1+(100-10.5+200)/10.5, *runway.WeekHours, 1e-9)

	assert.Nil(t, poolRunway(runwayPool(runwayAccountAt(2, 1, 1, 1, 1)), "claude", 0), "no Claude account, no runway")
}

func TestPoolRunwayWithoutSpend(t *testing.T) {
	runway := poolRunway(runwayPool(runwayAccountAt(1, 100, 400, 0, 10)), "claude", 0)
	assert.Nil(t, runway.WeekHours)
	assert.Nil(t, runway.FiveHourHours)
	assert.Zero(t, runway.WeekLoad)
	assert.Equal(t, 1.0, runway.ServedShare)
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
	), "claude", 0)
	require.NotNil(t, runway.WeekHours)
	assert.InDelta(t, 5, *runway.WeekHours, 1e-9)
	require.NotNil(t, runway.FirstShortHours)
	assert.InDelta(t, 15, *runway.FirstShortHours, 1e-9)
	assert.InDelta(t, 15+60+48, runway.ShortHours, 1e-9)
	assert.InDelta(t, (50+200+200)/(10*168.0), runway.ServedShare, 1e-9)
}

func TestPoolRunwayReportsAGrazingGapAsShort(t *testing.T) {
	// $100 lasts 10 hours, and a reset at hour 10.1 brings $2000: a six-minute
	// gap, not a pool that has run out.
	refilling := runwayAccountAt(1, 50, 4000, 5, 0)
	refilling.SevenDayReset = int64(10.1 * float64(runwayHourMS))
	runway := poolRunway(runwayPool(refilling, runwayAccountAt(1, 50, 400, 5, 160)), "claude", 0)
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
	runway := poolRunway(runwayPool(young, old), "claude", 0)
	assert.InDelta(t, (50+100)*0.8/5, runway.PeakUSDPerHour, 1e-9, "5-hour capacity up to the 80% line, per hour")
	assert.InDelta(t, 3+400*0.25/100, runway.WeekToDateUSDPerHour, 1e-9, "the young window counts its last day")
}
