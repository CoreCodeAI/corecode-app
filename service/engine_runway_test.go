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
			{ID: 1, Channel: "claude", Enabled: true, QuotaBudget: true, SevenDayBudget: 50},
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
}

func TestPoolRunwayLastsWhenTheWeekRefillsFasterThanItIsSpent(t *testing.T) {
	runway := poolRunway(runwayPool(
		runwayAccountAt(1, 150, 1000, 1, 24),
		runwayAccountAt(1, 300, 1000, 1, 96),
	), "claude", 0)
	assert.Nil(t, runway.WeekHours, "a $2/h demand never drains $1000 of weekly budget")
	assert.InDelta(t, 2*168/1000.0, runway.WeekLoad, 1e-9)
	assert.Equal(t, 336.0, runway.HorizonHours)
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
}
