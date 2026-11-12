package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHourlyQuotaWithPrefixSumsTheModelsOfEachHour(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	const hour = int64(1_800_000_000)
	for _, row := range []QuotaData{
		{ModelName: "claude-opus", CreatedAt: hour, Quota: 300, Username: "a"},
		{ModelName: "claude-sonnet", CreatedAt: hour, Quota: 200, Username: "b"},
		{ModelName: "gpt-6", CreatedAt: hour, Quota: 9000, Username: "a"},
		{ModelName: "claude-opus", CreatedAt: hour + 3600, Quota: 50, Username: "a"},
		{ModelName: "claude-opus", CreatedAt: hour + 7200, Quota: 70, Username: "a"},
	} {
		require.NoError(t, DB.Create(&row).Error)
	}

	hours, err := HourlyQuotaWithPrefix(ClaudeModelPrefix, hour, hour+7200)
	require.NoError(t, err)
	assert.Equal(t, map[int64]int64{hour: 500, hour + 3600: 50}, hours, "other models and the hour at the end are left out")
}

func TestDayProfileSharesRequestsByUTCHour(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			// 2027-01-15 00:00 UTC; now is that day's 10:30.
			const today = int64(1_799_971_200)
			for _, row := range []QuotaData{
				{ModelName: "opus", CreatedAt: today - 86400 + 3*3600, Count: 30, Username: "a"},
				{ModelName: "sonnet", CreatedAt: today - 86400 + 3*3600, Count: 10, Username: "b"},
				{ModelName: "opus", CreatedAt: today - 2*86400 + 13*3600, Count: 60, Username: "a"},
				// Today's requests and those before the 14 days are left out.
				{ModelName: "opus", CreatedAt: today + 3600, Count: 500, Username: "a"},
				{ModelName: "opus", CreatedAt: today - 15*86400, Count: 700, Username: "a"},
			} {
				require.NoError(t, DB.Create(&row).Error)
			}

			profile, err := GetDayProfile(today + 10*3600 + 1800)
			require.NoError(t, err)
			require.Len(t, profile.Hours, 24)
			assert.Equal(t, 14, profile.Days)
			assert.InDelta(t, 0.4, profile.Hours[3], 1e-9)
			assert.InDelta(t, 0.6, profile.Hours[13], 1e-9)
			assert.Zero(t, profile.Hours[1])
		})
	}
}

func TestDayProfileIsEmptyWithoutRequests(t *testing.T) {
	useInsightsTestDB(t, "sqlite")
	profile, err := GetDayProfile(1_799_971_200)
	require.NoError(t, err)
	assert.Empty(t, profile.Hours)
}
