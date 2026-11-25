package model

import (
	"bytes"
	"database/sql/driver"
	"fmt"
	"io"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// databaseShuttingDown is the error the 2026-11-06 flush met while Cloud SQL
// restarted: the connection was refused before any statement ran.
func databaseShuttingDown() error {
	return fmt.Errorf("failed to connect to `user=newapi database=newapi`: %w",
		&pgconn.PgError{Severity: "FATAL", SeverityUnlocalized: "FATAL", Code: "57P03", Message: "the database system is shutting down"})
}

// failBatchWrites makes every UPDATE fail with whatever fail returns, before
// the statement runs, and counts the attempts.
func failBatchWrites(t *testing.T, fail func() error) *int {
	t.Helper()
	attempts := 0
	name := "test:fail_batch_writes"
	require.NoError(t, DB.Callback().Update().Before("gorm:update").Register(name, func(db *gorm.DB) {
		attempts++
		if err := fail(); err != nil {
			db.AddError(err)
		}
	}))
	t.Cleanup(func() { require.NoError(t, DB.Callback().Update().Remove(name)) })
	return &attempts
}

func captureSysErrors(t *testing.T) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	common.LogWriterMu.Lock()
	previous := gin.DefaultErrorWriter
	gin.DefaultErrorWriter = &output
	common.LogWriterMu.Unlock()
	t.Cleanup(func() {
		common.LogWriterMu.Lock()
		gin.DefaultErrorWriter = previous
		common.LogWriterMu.Unlock()
	})
	return &output
}

func createBatchTestChannel(t *testing.T) Channel {
	t.Helper()
	channel := Channel{Name: "batch-channel-" + common.GetRandomString(6), Key: "sk-test", Status: common.ChannelStatusEnabled}
	require.NoError(t, DB.Create(&channel).Error)
	return channel
}

func pendingBatchDelta(kind int, id int) (int, bool) {
	batchUpdateLocks[kind].Lock()
	defer batchUpdateLocks[kind].Unlock()
	value, ok := batchUpdateStores[kind][id]
	return value, ok
}

// A charge the database never received is written once the database is back,
// merged with the charges made in between.
func TestBatchUpdateKeepsChargesTheDatabaseNeverReceived(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true

	user := createReserveTestUser(t, 1000)
	token := createReserveTestToken(t, 500)
	channel := createBatchTestChannel(t)
	require.NoError(t, DecreaseUserQuota(user.Id, 30, false))
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 30))
	UpdateUserUsedQuotaAndRequestCount(user.Id, 30)
	UpdateChannelUsedQuota(channel.Id, 30)

	down := databaseShuttingDown()
	failBatchWrites(t, func() error { return down })
	batchUpdate()
	assert.Equal(t, 1000, getUserQuotaFromDB(t, user.Id), "the failed write applied nothing")
	assert.Equal(t, 500, getTokenFromDB(t, token.Id).RemainQuota)

	require.NoError(t, DecreaseUserQuota(user.Id, 20, false))
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 20))
	UpdateUserUsedQuotaAndRequestCount(user.Id, 20)
	UpdateChannelUsedQuota(channel.Id, 20)

	down = nil
	batchUpdate()

	var reloaded User
	require.NoError(t, DB.Select("quota", "used_quota", "request_count").First(&reloaded, user.Id).Error)
	assert.Equal(t, 950, reloaded.Quota)
	assert.Equal(t, 50, reloaded.UsedQuota)
	assert.Equal(t, 2, reloaded.RequestCount)
	reloadedToken := getTokenFromDB(t, token.Id)
	assert.Equal(t, 450, reloadedToken.RemainQuota)
	assert.Equal(t, 50, reloadedToken.UsedQuota)
	var reloadedChannel Channel
	require.NoError(t, DB.Select("used_quota").First(&reloadedChannel, channel.Id).Error)
	assert.Equal(t, int64(50), reloadedChannel.UsedQuota)
}

// Once the database is unreachable, the other rows are queued without
// another attempt each.
func TestBatchUpdateStopsTryingAnUnreachableDatabase(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true

	first := createReserveTestUser(t, 1000)
	second := createReserveTestUser(t, 1000)
	token := createReserveTestToken(t, 500)
	require.NoError(t, DecreaseUserQuota(first.Id, 30, false))
	require.NoError(t, DecreaseUserQuota(second.Id, 40, false))
	require.NoError(t, DecreaseTokenQuota(token.Id, token.Key, 50))

	attempts := failBatchWrites(t, databaseShuttingDown)
	assert.Equal(t, 3, batchUpdate(), "every row is queued again")
	assert.Equal(t, 1, *attempts)
	for kind, want := range map[int]map[int]int{
		BatchUpdateTypeUserQuota:  {first.Id: -30, second.Id: -40},
		BatchUpdateTypeTokenQuota: {token.Id: -50},
	} {
		for id, delta := range want {
			got, ok := pendingBatchDelta(kind, id)
			assert.True(t, ok)
			assert.Equal(t, delta, got)
		}
	}
}

// A row the database refuses is dropped and logged, so it cannot hold back
// the row's later charges.
func TestBatchUpdateDropsARowTheDatabaseRefused(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true
	errorsLog := captureSysErrors(t)

	user := createReserveTestUser(t, 1000)
	require.NoError(t, DecreaseUserQuota(user.Id, 30, false))

	refused := error(&pgconn.PgError{Severity: "ERROR", SeverityUnlocalized: "ERROR", Code: "22003", Message: "integer out of range"})
	failBatchWrites(t, func() error { return refused })
	assert.Equal(t, 0, batchUpdate())
	_, pending := pendingBatchDelta(BatchUpdateTypeUserQuota, user.Id)
	assert.False(t, pending)
	assert.Contains(t, errorsLog.String(), fmt.Sprintf("rejected by the database, delta dropped: user_id=%d quota_delta=-30", user.Id))

	refused = nil
	require.NoError(t, DecreaseUserQuota(user.Id, 10, false))
	batchUpdate()
	assert.Equal(t, 990, getUserQuotaFromDB(t, user.Id))
}

// A commit sent without an answer may have applied, so it is logged, not
// replayed.
func TestBatchUpdateNeverReplaysACommitWithoutAnAnswer(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true
	errorsLog := captureSysErrors(t)

	user := createReserveTestUser(t, 1000)
	require.NoError(t, DecreaseUserQuota(user.Id, 30, false))

	// The test database is SQLite, whose commits never lose their answer.
	previousMain := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	t.Cleanup(func() { common.SetMainDatabaseType(previousMain) })
	previous := commitBatchWrite
	commitBatchWrite = func(tx *gorm.DB) error {
		require.NoError(t, tx.Commit().Error)
		return io.ErrUnexpectedEOF
	}
	t.Cleanup(func() { commitBatchWrite = previous })

	assert.Equal(t, 0, batchUpdate())
	commitBatchWrite = previous
	batchUpdate()
	assert.Equal(t, 970, getUserQuotaFromDB(t, user.Id), "charged once")
	assert.Contains(t, errorsLog.String(), fmt.Sprintf("commit got no answer, delta may or may not be applied and is not retried: user_id=%d quota_delta=-30", user.Id))
}

// Shutdown tries again while the database restarts, and logs every row it
// still could not write.
func TestFlushBatchUpdatesRetriesThenReportsWhatRemains(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	common.BatchUpdateEnabled = true
	errorsLog := captureSysErrors(t)
	previousDelays := batchShutdownRetryDelays
	batchShutdownRetryDelays = []time.Duration{time.Millisecond, time.Millisecond, time.Millisecond}
	t.Cleanup(func() { batchShutdownRetryDelays = previousDelays })

	user := createReserveTestUser(t, 1000)
	require.NoError(t, DecreaseUserQuota(user.Id, 30, false))
	failures := 2
	failBatchWrites(t, func() error {
		if failures == 0 {
			return nil
		}
		failures--
		return databaseShuttingDown()
	})
	FlushBatchUpdates()
	assert.Equal(t, 970, getUserQuotaFromDB(t, user.Id))

	require.NoError(t, DecreaseUserQuota(user.Id, 40, false))
	failures = 100
	FlushBatchUpdates()
	assert.Equal(t, 970, getUserQuotaFromDB(t, user.Id))
	_, pending := pendingBatchDelta(BatchUpdateTypeUserQuota, user.Id)
	assert.False(t, pending, "the lost row is reported, not left behind")
	assert.Contains(t, errorsLog.String(), fmt.Sprintf("batch update lost at shutdown: user_id=%d quota_delta=-40", user.Id))
}

func TestBatchWriteOutcomeClassification(t *testing.T) {
	previousMain := common.MainDatabaseType()
	common.SetMainDatabaseType(common.DatabaseTypePostgreSQL)
	t.Cleanup(func() { common.SetMainDatabaseType(previousMain) })

	pgError := func(severity, code string) error {
		return &pgconn.PgError{Severity: severity, SeverityUnlocalized: severity, Code: code}
	}
	mysqlError := func(state string) error {
		myErr := &mysql.MySQLError{Number: 1264}
		copy(myErr.SQLState[:], state)
		return myErr
	}
	cases := []struct {
		name        string
		err         error
		beforeSent  batchWriteOutcome
		atCommit    batchWriteOutcome
		unreachable bool
	}{
		{"connect refused while shutting down", databaseShuttingDown(), batchWriteRetry, batchWriteUnknown, true},
		{"admin shutdown", pgError("FATAL", "57P01"), batchWriteRetry, batchWriteUnknown, true},
		{"serialization failure", pgError("ERROR", "40001"), batchWriteRetry, batchWriteRetry, false},
		{"lock timeout", pgError("ERROR", "55P03"), batchWriteRetry, batchWriteRetry, false},
		{"numeric out of range", pgError("ERROR", "22003"), batchWriteRejected, batchWriteRejected, false},
		{"constraint", pgError("ERROR", "23514"), batchWriteRejected, batchWriteRejected, false},
		{"bad connection", fmt.Errorf("wrapped: %w", driver.ErrBadConn), batchWriteRetry, batchWriteRetry, true},
		{"connection reset", io.ErrUnexpectedEOF, batchWriteRetry, batchWriteUnknown, false},
		{"mysql out of range", mysqlError("22003"), batchWriteRejected, batchWriteRejected, false},
		{"mysql lock wait", mysqlError("HY000"), batchWriteRetry, batchWriteRetry, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.beforeSent, uncommittedOutcome(tc.err))
			atCommit := batchWriteUnknown
			if commitRolledBack(tc.err) {
				atCommit = uncommittedOutcome(tc.err)
			}
			assert.Equal(t, tc.atCommit, atCommit)
			assert.Equal(t, tc.unreachable, databaseUnreachable(tc.err))
		})
	}
}
