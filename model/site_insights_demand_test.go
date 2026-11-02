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
