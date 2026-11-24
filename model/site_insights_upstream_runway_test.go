package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func runwayChannel(id int, name, baseURL string, status int, balance float64, readAt int64) *Channel {
	channel := &Channel{Id: id, Name: name, Status: status, Balance: balance, BalanceUpdatedTime: readAt}
	channel.BaseURL = &baseURL
	return channel
}

func accountAt(t *testing.T, runway *UpstreamRunway, host string) UpstreamAccount {
	t.Helper()
	for _, account := range runway.Accounts {
		if account.Host == host {
			return account
		}
	}
	require.Failf(t, "no account", "no account at %s", host)
	return UpstreamAccount{}
}

// TestUpstreamRunwayOneAccountPerHost checks that channels sharing a host share
// one balance, the freshest read, and pool all their bills, and that the days
// left are the balance over the trailing seven days' average.
func TestUpstreamRunwayOneAccountPerHost(t *testing.T) {
	const now = int64(1_800_000_000)
	unit := 500000.0
	channels := []*Channel{
		runwayChannel(7, "gpt", "https://usdj.example.com", common.ChannelStatusEnabled, 319.7, now-50000),
		runwayChannel(13, "gpt welfare", "https://usdj.example.com", common.ChannelStatusEnabled, 208.59, now-9000),
		runwayChannel(9, "video", "https://sub.example.com", common.ChannelStatusEnabled, 449.62, now-100),
		runwayChannel(12, "image", "https://sub.example.com", common.ChannelStatusEnabled, 449.62, now-120),
		runwayChannel(1, "pool", "http://gpt-load:3001", common.ChannelStatusEnabled, 9175.1, now-60),
		runwayChannel(20, "retired", "https://old.example.com", common.ChannelStatusManuallyDisabled, 50, now-500),
	}
	costs := []upstreamCostRow{
		// Requests of the last 24 hours: $14 on channel 7, $7 on channel 13.
		{ChannelId: 7, CreatedAt: now - 3600, Quota: int64(14 * unit), QuotaPerUnit: unit},
		{ChannelId: 13, CreatedAt: now - 7200, Quota: int64(7 * unit), QuotaPerUnit: unit},
		// Six days and a bit back, still inside the window: $28.
		{ChannelId: 7, CreatedAt: now - 6*86400 - 3600, Quota: int64(28 * unit), QuotaPerUnit: unit},
		// Older than seven days: not counted.
		{ChannelId: 7, CreatedAt: now - 8*86400, Quota: int64(1000 * unit), QuotaPerUnit: unit},
	}
	today := (now+UpstreamBillDayOffset)/86400*86400 - UpstreamBillDayOffset
	bills := []UpstreamBillDay{
		// Yesterday and three days ago, in the supplier's days; today is not counted.
		{ChannelId: 9, DayStart: today - 86400, ModelName: "seedance", CostUSD: 20},
		{ChannelId: 12, DayStart: today - 3*86400, ModelName: "gpt-image", CostUSD: 15},
		{ChannelId: 9, DayStart: today, ModelName: "seedance", CostUSD: 99},
		{ChannelId: 9, DayStart: today - 9*86400, ModelName: "seedance", CostUSD: 99},
	}
	perRequest := map[int]bool{7: true, 13: true}
	runway := buildUpstreamRunway(now, channels, costs, perRequest, bills)

	require.Len(t, runway.Accounts, 2, "channels 7+13 and 9+12 are two accounts; the pool and the disabled channel are not accounts")
	usdj := accountAt(t, runway, "usdj.example.com")
	assert.Equal(t, []int{7, 13}, usdj.Channels)
	assert.InDelta(t, 208.59, usdj.Balance, 1e-9, "the freshest read of the account, not the stale one")
	assert.Equal(t, int64(now-9000), usdj.BalanceUpdatedAt)
	assert.Equal(t, 13, usdj.BalanceChannel)
	assert.Equal(t, RunwayBasisRequest, usdj.Basis)
	assert.InDelta(t, 49, usdj.SpentUSD, 1e-9, "14 + 7 + 28, the older request is outside the window")
	assert.InDelta(t, 7, usdj.DailyUSD, 1e-9)
	require.NotNil(t, usdj.DaysLeft)
	assert.InDelta(t, 208.59/7, *usdj.DaysLeft, 0.01)
	require.Len(t, usdj.Daily, UpstreamRunwayDays)
	assert.InDelta(t, 21, usdj.Daily[UpstreamRunwayDays-1], 1e-9, "the newest block is last")
	assert.InDelta(t, 28, usdj.Daily[0], 1e-9, "the oldest block is first")

	sub := accountAt(t, runway, "sub.example.com")
	assert.Equal(t, RunwayBasisDay, sub.Basis)
	assert.InDelta(t, 35, sub.SpentUSD, 1e-9, "20 yesterday and 15 three days ago; the partial day today is left out")
	require.NotNil(t, sub.DaysLeft)
	assert.InDelta(t, 449.62/5, *sub.DaysLeft, 0.01)
	assert.Equal(t, "usdj.example.com", runway.Accounts[0].Host, "fewest days left first")

	require.Len(t, runway.Pools, 1)
	assert.Equal(t, 1, runway.Pools[0].Channel)
	assert.InDelta(t, 9175.1, runway.Pools[0].Balance, 1e-9)
}

// TestUpstreamRunwayWithoutABillHasNoDaysLeft pins that an account with no bill
// read is listed with its balance and no figure of days, never an infinite one,
// and that an account with a bill and no spending has none either.
func TestUpstreamRunwayWithoutABillHasNoDaysLeft(t *testing.T) {
	const now = int64(1_800_000_000)
	channels := []*Channel{
		runwayChannel(4, "fee", "https://fee.example.com", common.ChannelStatusEnabled, 80, now-10),
		runwayChannel(5, "idle", "https://idle.example.com", common.ChannelStatusAutoDisabled, 30, now-10),
		runwayChannel(6, "unread", "https://unread.example.com", common.ChannelStatusEnabled, 0, 0),
	}
	today := (now+UpstreamBillDayOffset)/86400*86400 - UpstreamBillDayOffset
	bills := []UpstreamBillDay{{ChannelId: 5, DayStart: today - 86400, ModelName: "", CostUSD: 0}}
	runway := buildUpstreamRunway(now, channels, nil, map[int]bool{}, bills)

	require.Len(t, runway.Accounts, 2, "a channel whose balance was never read is no account")
	fee := accountAt(t, runway, "fee.example.com")
	assert.Equal(t, RunwayBasisNone, fee.Basis)
	assert.Nil(t, fee.DaysLeft)
	idle := accountAt(t, runway, "idle.example.com")
	assert.Equal(t, RunwayBasisDay, idle.Basis, "the bill is read, it just shows no spending")
	assert.Nil(t, idle.DaysLeft)
	assert.Zero(t, idle.SpentUSD)
}

// TestUpstreamRunwayDatabaseMatrix reads balances, request-level costs and
// supplier day bills from the database, not from fixtures: one account of two
// channels, one of them read per request and one by day.
func TestUpstreamRunwayDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			previousMap := common.OptionMap
			common.OptionMap = map[string]string{}
			t.Cleanup(func() { common.OptionMap = previousMap })

			const now = int64(1759248000 + 5*86400 + 7200)
			dollar := int64(common.QuotaPerUnit)
			site, engine := "https://usdj.example.cc", "http://gpt-load:3001"
			require.NoError(t, DB.Create(&[]Channel{
				{Id: 7, Name: "request", Type: 1, Key: "k7", Status: common.ChannelStatusEnabled, BaseURL: &site, Balance: 70, BalanceUpdatedTime: now - 60},
				{Id: 13, Name: "day", Type: 1, Key: "k13", Status: common.ChannelStatusEnabled, BaseURL: &site, Balance: 90, BalanceUpdatedTime: now - 600},
				{Id: 1, Name: "pool", Type: 14, Key: "k1", Status: common.ChannelStatusEnabled, BaseURL: &engine, Balance: 5000, BalanceUpdatedTime: now - 30},
			}).Error)
			_, err := SaveUpstreamCosts([]UpstreamCost{
				{ChannelId: 7, RequestId: "a", CreatedAt: now - 3600, ModelName: "m", Quota: 10 * dollar, QuotaPerUnit: float64(dollar)},
				{ChannelId: 7, RequestId: "b", CreatedAt: now - 2*86400, ModelName: "m", Quota: 4 * dollar, QuotaPerUnit: float64(dollar)},
				{ChannelId: 7, RequestId: "old", CreatedAt: now - 9*86400, ModelName: "m", Quota: 500 * dollar, QuotaPerUnit: float64(dollar)},
			})
			require.NoError(t, err)
			today := (now+UpstreamBillDayOffset)/86400*86400 - UpstreamBillDayOffset
			require.NoError(t, SaveUpstreamBillDays(13, today-3*86400, []UpstreamBillDay{
				{ChannelId: 13, DayStart: today - 86400, ModelName: "v", Requests: 1, CostUSD: 6, ReadAt: now},
			}))

			runway, err := GetUpstreamRunway(now)
			require.NoError(t, err)
			require.Len(t, runway.Accounts, 1)
			account := runway.Accounts[0]
			assert.Equal(t, "usdj.example.cc", account.Host)
			assert.Equal(t, []int{7, 13}, account.Channels)
			assert.InDelta(t, 70, account.Balance, 1e-9, "the newest read of the two")
			assert.Equal(t, RunwayBasisRequest, account.Basis)
			assert.InDelta(t, 20, account.SpentUSD, 1e-9, "10 + 4 by request and 6 by day; the nine-day-old request is outside")
			require.NotNil(t, account.DaysLeft)
			assert.InDelta(t, 70/(20.0/7), *account.DaysLeft, 0.01)
			require.Len(t, runway.Pools, 1)
			assert.InDelta(t, 5000, runway.Pools[0].Balance, 1e-9)
		})
	}
}
