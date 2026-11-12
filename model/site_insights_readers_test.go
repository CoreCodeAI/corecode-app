package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// An older row with no request and no attempt has nothing a rebuild would
// change, so it is current: the capacity and quality views keep their pool
// peak and attempts over it rather than dropping them for the whole range.
func TestEmptyOlderHourIsCurrent(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	require.NoError(t, DB.Create(&InsightHour{HourStart: hour, Version: insightHourVersion - 1, Data: `{}`, CreatedAt: 1}).Error)
	r := InsightsRange{Start: hour, End: hour + 3600}

	capacity, err := GetCapacityInsights(r, "")
	require.NoError(t, err)
	assert.Equal(t, 0, capacity.StaleHours)
	require.NotNil(t, capacity.PoolPeak, "an empty older hour does not hide the pool peak")
	require.NotNil(t, capacity.Attempts)
	require.Len(t, capacity.Hourly, 1)
	assert.NotNil(t, capacity.Hourly[0].PoolPeak)

	quality, err := GetQualityInsights(r, nil)
	require.NoError(t, err)
	assert.Equal(t, 0, quality.StaleHours)
	assert.NotNil(t, quality.Attempts)
}

// logs_since is the earliest log the rollups read. It is read once per
// insightLogsSinceTTL and not kept while there are no logs.
func TestLogsSinceIsTheFirstLogAndIsReadOncePerTTL(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	alice := registerAffiliateTestUser(t, "alice", "")

	since, err := InsightLogsSince()
	require.NoError(t, err)
	assert.Zero(t, since, "no logs read as zero")

	require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 500, UseTime: 2, ModelName: "opus", Other: `{}`}).Error)
	since, err = InsightLogsSince()
	require.NoError(t, err)
	assert.Equal(t, hour+500, since)

	require.NoError(t, LOG_DB.Create(&Log{UserId: alice.Id, Type: LogTypeConsume, CreatedAt: hour + 100, UseTime: 2, ModelName: "opus", Other: `{}`}).Error)
	since, err = InsightLogsSince()
	require.NoError(t, err)
	assert.Equal(t, hour+500, since, "the value is shared for insightLogsSinceTTL")

	insightLogsSince.mu.Lock()
	insightLogsSince.readAt = time.Now().Add(-insightLogsSinceTTL)
	insightLogsSince.mu.Unlock()
	since, err = InsightLogsSince()
	require.NoError(t, err)
	assert.Equal(t, hour+100, since, "read again once the TTL has passed")
}

// A range that starts half an hour into an hour counts that hour whole, on
// the activity and the funds views: the quota_data row and the top-up stored
// at the hour's start are both in the window.
func TestWindowsCountTheHourTheyStartIn(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	dollar := int(common.QuotaPerUnit)
	alice := registerAffiliateTestUser(t, "alice", "")
	require.NoError(t, DB.Create(&QuotaData{UserID: alice.Id, Username: "alice", ModelName: "gpt-6", CreatedAt: hour, Count: 2, Quota: dollar, TokenUsed: 10}).Error)
	require.NoError(t, DB.Create(&TopUp{UserId: alice.Id, Amount: 10, Money: 10, PaymentMethod: "alipay", Status: common.TopUpStatusSuccess, TradeNo: "T-HOUR", CreateTime: hour + 600}).Error)

	r, ok := ResolveInsightsRange(hour+1800, hour+3*3600, 0, InsightsMaxDays)
	require.True(t, ok)
	assert.Equal(t, hour, r.Start, "the range starts on its hour")
	activity, err := GetActivityInsights(r)
	require.NoError(t, err)
	assert.EqualValues(t, 2, activity.Requests)
	finance, err := GetFinanceInsights(r)
	require.NoError(t, err)
	assert.Equal(t, 10.0, finance.TopupRevenue)

	// The activity view keeps the hour too when it is handed a range that
	// starts mid-hour directly.
	direct, err := GetActivityInsights(InsightsRange{Start: hour + 1800, End: hour + 3*3600})
	require.NoError(t, err)
	assert.EqualValues(t, 2, direct.Requests)
}

// The day profile is read once per UTC hour: a request later in the same hour
// gets the profile read at its start, and the next hour reads again.
func TestDayProfileIsReadOncePerHour(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1759248000)
	now := hour + 1800
	end := now - now%86400
	require.NoError(t, DB.Create(&QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-6", CreatedAt: end - 86400 + 3*3600, Count: 1, Quota: 1, TokenUsed: 1}).Error)

	first, err := CachedDayProfile(now)
	require.NoError(t, err)
	assert.Equal(t, 1.0, first.Hours[3])

	require.NoError(t, DB.Create(&QuotaData{UserID: 1, Username: "alice", ModelName: "gpt-6", CreatedAt: end - 86400 + 5*3600, Count: 1, Quota: 1, TokenUsed: 1}).Error)
	cached, err := CachedDayProfile(now + 600)
	require.NoError(t, err)
	assert.Equal(t, 1.0, cached.Hours[3], "the same hour is served from the cache")
	assert.Zero(t, cached.Hours[5])

	fresh, err := CachedDayProfile(hour + 3600 + 1800)
	require.NoError(t, err)
	assert.Equal(t, 0.5, fresh.Hours[3])
	assert.Equal(t, 0.5, fresh.Hours[5])
}
