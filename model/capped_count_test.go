package model

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCountUpToStopsAtTheLimit(t *testing.T) {
	const userId = 7_400_001
	t.Cleanup(func() { LOG_DB.Where("user_id = ?", userId).Delete(&Log{}) })
	for i := 0; i < 5; i++ {
		require.NoError(t, LOG_DB.Create(&Log{UserId: userId, Type: LogTypeConsume}).Error)
	}
	query := LOG_DB.Model(&Log{}).Where("user_id = ?", userId)

	capped, err := countUpTo(query, 3)
	require.NoError(t, err)
	require.EqualValues(t, 3, capped)

	all, err := countUpTo(query, 10)
	require.NoError(t, err)
	require.EqualValues(t, 5, all)

	// The query is left as it was, so the caller can still page it.
	var logs []*Log
	require.NoError(t, query.Order("id desc").Limit(2).Offset(0).Find(&logs).Error)
	require.Len(t, logs, 2)
}

func TestGetUserLogsCapsTheTotal(t *testing.T) {
	const userId = 7_400_002
	t.Cleanup(func() { LOG_DB.Where("user_id = ?", userId).Delete(&Log{}) })
	for i := 0; i < 4; i++ {
		require.NoError(t, LOG_DB.Create(&Log{UserId: userId, Type: LogTypeConsume}).Error)
	}

	logs, total, err := GetUserLogs(userId, LogFilter{}, 0, 2)
	require.NoError(t, err)
	require.EqualValues(t, 4, total)
	require.Len(t, logs, 2)
}

func TestGetUserLogsSkipsTheCountOnRequest(t *testing.T) {
	const userId = 7_400_003
	t.Cleanup(func() { LOG_DB.Where("user_id = ?", userId).Delete(&Log{}) })
	for i := 0; i < 5; i++ {
		require.NoError(t, LOG_DB.Create(&Log{UserId: userId, Type: LogTypeConsume}).Error)
	}

	counted, total, err := GetUserLogs(userId, LogFilter{}, 2, 2)
	require.NoError(t, err)
	require.EqualValues(t, 5, total)

	// Without the count, total is the rows through the page: the offset plus
	// the rows returned.
	uncounted, total, err := GetUserLogs(userId, LogFilter{SkipCount: true}, 2, 2)
	require.NoError(t, err)
	require.EqualValues(t, 4, total)
	require.Equal(t, counted, uncounted)

	_, total, err = GetUserLogs(userId, LogFilter{SkipCount: true}, 4, 2)
	require.NoError(t, err)
	require.EqualValues(t, 5, total)
}
