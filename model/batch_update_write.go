package model

import (
	"database/sql/driver"
	"errors"
	"net"
	"strings"

	"github.com/QuantumNous/new-api/common"

	"github.com/go-sql-driver/mysql"
	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

// batchWriteOutcome is what one row's batched write left in the database.
type batchWriteOutcome int

const (
	batchWriteApplied batchWriteOutcome = iota
	// batchWriteRetry: the transaction did not commit, and the cause passes
	// (no connection, a restart, a lock timeout). The delta goes back into
	// the queue.
	batchWriteRetry
	// batchWriteRejected: the transaction did not commit because the
	// database refused the values. The same write fails the same way again.
	batchWriteRejected
	// batchWriteUnknown: the commit was sent and its answer was lost, so the
	// row may already hold the delta. Replaying it could charge twice.
	batchWriteUnknown
)

// commitBatchWrite commits a row's write. Tests replace it to lose a commit's
// answer.
var commitBatchWrite = func(tx *gorm.DB) error { return tx.Commit().Error }

// applyBatchWrite runs one row's write in a transaction of its own. Any
// failure before the commit leaves nothing applied, since the database rolls
// back a transaction whose connection is gone, so the delta can be queued
// again; only a commit that got no answer has an unknown outcome.
func applyBatchWrite(write func(tx *gorm.DB) error) (batchWriteOutcome, error) {
	tx := DB.Begin()
	if err := tx.Error; err != nil {
		return uncommittedOutcome(err), err
	}
	if err := write(tx); err != nil {
		tx.Rollback()
		return uncommittedOutcome(err), err
	}
	if err := commitBatchWrite(tx); err != nil {
		if commitRolledBack(err) {
			return uncommittedOutcome(err), err
		}
		return batchWriteUnknown, err
	}
	return batchWriteApplied, nil
}

func uncommittedOutcome(err error) batchWriteOutcome {
	if databaseRefusedValues(err) {
		return batchWriteRejected
	}
	return batchWriteRetry
}

// databaseRefusedValues reports an error the database raised against the
// statement itself: bad data (SQLSTATE class 22), a violated constraint (23),
// or a statement it cannot run (42).
func databaseRefusedValues(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return refusedSQLState(pgErr.Code)
	}
	var myErr *mysql.MySQLError
	if errors.As(err, &myErr) {
		return refusedSQLState(string(myErr.SQLState[:]))
	}
	return false
}

func refusedSQLState(code string) bool {
	return strings.HasPrefix(code, "22") || strings.HasPrefix(code, "23") || strings.HasPrefix(code, "42")
}

// commitRolledBack reports a failed commit that provably committed nothing:
// the driver failed before sending it, or the database answered it with an
// ERROR, which aborts the transaction. A FATAL or a broken connection after
// the commit was sent leaves the outcome unknown.
func commitRolledBack(err error) bool {
	if errors.Is(err, driver.ErrBadConn) || pgconn.SafeToRetry(err) {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.SeverityUnlocalized == "ERROR" || (pgErr.SeverityUnlocalized == "" && pgErr.Severity == "ERROR")
	}
	var myErr *mysql.MySQLError
	if errors.As(err, &myErr) {
		return true
	}
	// SQLite commits in-process: a failed commit, such as SQLITE_BUSY, left
	// the transaction uncommitted.
	return common.UsingMainDatabase(common.DatabaseTypeSQLite)
}

// databaseUnreachable reports an error every other row would meet too: no
// connection could be made, or the server is shutting down or starting up.
// The flush stops trying and queues the rest for the next run.
func databaseUnreachable(err error) bool {
	if errors.Is(err, driver.ErrBadConn) || pgconn.SafeToRetry(err) {
		return true
	}
	var connectErr *pgconn.ConnectError
	if errors.As(err, &connectErr) {
		return true
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return strings.HasPrefix(pgErr.Code, "08") || strings.HasPrefix(pgErr.Code, "57P")
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

// batchRow is one row's pending deltas: how to write them, how to put them
// back in the queue, and how to name them in a log line an operator can
// reconcile by hand.
type batchRow struct {
	describe string
	write    func(tx *gorm.DB) error
	requeue  func()
}

// batchFlush tallies one flush.
type batchFlush struct {
	applied     int
	requeued    int
	dropped     int
	firstErr    error
	unreachable bool
}

func (flush *batchFlush) apply(row batchRow) {
	if flush.unreachable {
		row.requeue()
		flush.requeued++
		return
	}
	outcome, err := applyBatchWrite(row.write)
	switch outcome {
	case batchWriteApplied:
		flush.applied++
		return
	case batchWriteRetry:
		row.requeue()
		flush.requeued++
		flush.unreachable = databaseUnreachable(err)
	case batchWriteRejected:
		flush.dropped++
		common.SysError(common.LogText("batch update rejected by the database, delta dropped: %s: %v", row.describe, err))
	case batchWriteUnknown:
		flush.dropped++
		common.SysError(common.LogText("batch update commit got no answer, delta may or may not be applied and is not retried: %s: %v", row.describe, err))
	}
	if flush.firstErr == nil {
		flush.firstErr = err
	}
}
