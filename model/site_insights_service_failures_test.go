package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestServiceFailureCounts(t *testing.T) {
	// 56 requests, 36 failed: 30 no-channel refusals, 5 upstream errors and a
	// customer's 400. The service failed 5 of the 25 it could have served.
	requests, errors := serviceFailureCounts(false, 56, 36, map[string]int64{ErrorNoChannel: 30, ErrorUpstream: 5, ErrorClient: 1})
	require.NotNil(t, requests)
	require.NotNil(t, errors)
	assert.EqualValues(t, [2]int64{25, 5}, [2]int64{*requests, *errors})

	// An hour stored before categories with failures has no service counts.
	requests, errors = serviceFailureCounts(true, 40, 6, nil)
	assert.Nil(t, requests)
	assert.Nil(t, errors)
	// Without failures there is nothing to categorise: the counts are the requests.
	requests, errors = serviceFailureCounts(false, 40, 0, nil)
	require.NotNil(t, requests)
	require.NotNil(t, errors)
	assert.EqualValues(t, [2]int64{40, 0}, [2]int64{*requests, *errors})
	// Excluded requests cannot exceed the requests they came from.
	requests, errors = serviceFailureCounts(false, 10, 4, map[string]int64{ErrorNoChannel: 3, ErrorClient: 2})
	assert.EqualValues(t, [2]int64{5, 0}, [2]int64{*requests, *errors})
}

// seedServiceFailureLogs writes one hour of logs: 20 served requests, 30
// requests no channel could take, 5 upstream 502s and a customer's 400.
func seedServiceFailureLogs(t *testing.T, userID int, hour int64) {
	t.Helper()
	upstream := `{"error_type":"openai_error"}`
	var logs []Log
	for i := range 20 {
		logs = append(logs, Log{RequestId: fmt.Sprintf("ok-%d-%d", hour, i), UserId: userID, Type: LogTypeConsume, CreatedAt: hour + 100 + int64(i), UseTime: 1, ChannelId: 7, ModelName: "gpt-6", Other: `{}`})
	}
	for i := range 30 {
		logs = append(logs, Log{RequestId: fmt.Sprintf("nc-%d-%d", hour, i), UserId: userID, Type: LogTypeError, CreatedAt: hour + 200 + int64(i), ChannelId: 0, ModelName: "gpt-6",
			Content: NoChannelErrorContent(503, "vip"), Other: `{"error_type":"new_api_error"}`})
	}
	for i := range 5 {
		logs = append(logs, Log{RequestId: fmt.Sprintf("up-%d-%d", hour, i), UserId: userID, Type: LogTypeError, CreatedAt: hour + 300 + int64(i), ChannelId: 7, ModelName: "gpt-6",
			Content: "status_code=502, bad gateway", Other: upstream})
	}
	logs = append(logs, Log{RequestId: fmt.Sprintf("bad-%d", hour), UserId: userID, Type: LogTypeError, CreatedAt: hour + 400, ChannelId: 7, ModelName: "gpt-6",
		Content: "status_code=400, invalid request", Other: upstream})
	require.NoError(t, LOG_DB.Create(&logs).Error)
}

func int64Ptr(v int64) *int64 { return &v }

func requireServiceCounts(t *testing.T, requests, errors *int64, wantRequests, wantErrors int64) {
	t.Helper()
	require.NotNil(t, requests)
	require.NotNil(t, errors)
	assert.EqualValues(t, [2]int64{wantRequests, wantErrors}, [2]int64{*requests, *errors})
}

// The service counts are the same for a stored hour and for the hour still
// filling, and the customers' 400 and the refusals are left out of both.
func TestServiceFailuresLeaveOutRefusalsAndClientErrors(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			alice := registerAffiliateTestUser(t, "alice", "")
			const past = int64(1759248000)
			seedServiceFailureLogs(t, alice.Id, past)

			r := InsightsRange{Start: past, End: past + 3600}
			capacity, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			require.Len(t, capacity.Hourly, 1)
			assert.EqualValues(t, [2]int64{56, 36}, [2]int64{capacity.Hourly[0].Requests, capacity.Hourly[0].Errors})
			requireServiceCounts(t, capacity.Hourly[0].ServiceRequests, capacity.Hourly[0].ServiceErrors, 25, 5)

			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			require.Len(t, quality.Hourly, 1)
			requireServiceCounts(t, quality.Hourly[0].ServiceRequests, quality.Hourly[0].ServiceErrors, 25, 5)

			// The same logs in the hour still filling: that hour is not stored.
			current := time.Now().Unix() - time.Now().Unix()%3600
			seedServiceFailureLogs(t, alice.Id, current)
			open := InsightsRange{Start: current, End: current + 3600}
			filling, err := GetCapacityInsights(open, "")
			require.NoError(t, err)
			require.Len(t, filling.Hourly, 1)
			assert.EqualValues(t, [2]int64{56, 36}, [2]int64{filling.Hourly[0].Requests, filling.Hourly[0].Errors})
			requireServiceCounts(t, filling.Hourly[0].ServiceRequests, filling.Hourly[0].ServiceErrors, 25, 5)
		})
	}
}

// An hour stored under a version without categories has failures whose
// categories are unknown, so its service counts are absent; an hour of
// version 5 keeps them.
func TestServiceFailuresAbsentOnAnHourWithoutCategories(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			useInsightsTestDB(t, dialect)
			const older = int64(1759248000) - 3*3600
			require.NoError(t, DB.Create(&InsightHour{HourStart: older, Version: insightHourCategories - 1, Data: `{"requests":40,"errors":6}`, CreatedAt: 1}).Error)
			require.NoError(t, DB.Create(&InsightHour{HourStart: older + 3600, Version: insightHourCategories,
				Data: `{"requests":10,"errors":4,"categories":{"no_channel":3,"upstream_error":1}}`, CreatedAt: 1}).Error)
			// The quality view reads each model's row: the same figures per model.
			require.NoError(t, DB.Create(&[]InsightModelHour{
				{HourStart: older, ModelName: "gpt-6", Requests: 40, Errors: 6},
				{HourStart: older + 3600, ModelName: "gpt-6", Requests: 10, Errors: 4},
			}).Error)
			r := InsightsRange{Start: older, End: older + 2*3600}
			capacity, err := GetCapacityInsights(r, "")
			require.NoError(t, err)
			require.Len(t, capacity.Hourly, 2)
			assert.Nil(t, capacity.Hourly[0].ServiceRequests)
			assert.Nil(t, capacity.Hourly[0].ServiceErrors)
			requireServiceCounts(t, capacity.Hourly[1].ServiceRequests, capacity.Hourly[1].ServiceErrors, 7, 1)

			quality, err := GetQualityInsights(r, nil)
			require.NoError(t, err)
			require.Len(t, quality.Hourly, 2)
			assert.Nil(t, quality.Hourly[0].ServiceRequests)
			assert.Nil(t, quality.Hourly[0].ServiceErrors)
			requireServiceCounts(t, quality.Hourly[1].ServiceRequests, quality.Hourly[1].ServiceErrors, 7, 1)
		})
	}
}
