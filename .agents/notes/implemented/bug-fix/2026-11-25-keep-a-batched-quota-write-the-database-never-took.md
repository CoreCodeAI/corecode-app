# Agent Note: Keep a batched quota write the database never took

Status: implemented

## Problem

With `BATCH_UPDATE_ENABLED`, charges, refunds, top-up rollbacks and token
spend wait in memory and `batchUpdate` (`model/utils.go`) writes them every
`BATCH_UPDATE_INTERVAL` seconds. It swapped the stores for empty ones and then
only logged a failed write, so the delta was gone. Redis already held it, and
when the cached balance expired the stale database balance came back: a charge
was forgiven, or a refund vanished.

It happened once in production. On 2026-11-06 at 09:03:20 UTC, while the relay
was being resized, a flush met `failed to connect ... FATAL: the database
system is shutting down (SQLSTATE 57P03)` and dropped 6 token rows and 7 user
rows, about $0.3. The 30 days of logs before 2026-11-25 hold no other failed
flush.

## Decision

- **Each row is written in a transaction of its own** (`applyBatchWrite`,
  `model/batch_update_write.go`). GORM already wrapped each `Updates` in a
  default transaction, so the statement count is unchanged; the explicit
  transaction tells a failure before the commit apart from one at the commit.
- **What a failure leaves decides what happens to the delta:**
  - Before the commit, or a commit the database answered with an `ERROR`,
    nothing committed. If the cause passes (no connection, a restart, a lock
    timeout, a serialization failure), the delta goes back into the queue
    through `addNewRecord`, merged with any change made since, and the next
    run writes it.
  - If the database refused the values (SQLSTATE class 22, 23 or 42), the same
    write would fail forever and, merged, would hold back the row's later
    charges. The delta is dropped with an error line naming the row and
    amounts.
  - A commit sent without an answer, or answered with a `FATAL`, may have
    applied. Replaying it could charge twice, so it is dropped with an error
    line naming the row and amounts, for reconciliation by hand.
- **An unreachable database stops the flush** (`databaseUnreachable`: a
  connect error, `driver.ErrBadConn`, an error pgx raised before sending, class
  08 or 57P). The remaining rows go back into the queue without an attempt
  each.
- **Rows go money first:** users, then tokens, then the channels' usage
  statistics.
- **Shutdown tries again for 3.75 s** (`batchShutdownRetryDelays`) and then
  logs each row it still holds as `batch update lost at shutdown`. The release
  stops the old server with `docker stop`, whose grace period is 10 s and also
  covers the HTTP shutdown and the other flushes.
- A flush that did not write everything logs `batch update incomplete` with
  counts and the first error at error level, in place of `batch update
  finished`.

## Alternatives considered

- **Retry every failure.** A refused value would loop forever and hold back the
  row's later charges; a commit without an answer could charge twice.
- **An idempotency ledger** (a row per flushed delta, written in the same
  transaction and checked before a replay). It would make the unknown commit
  outcome safe to retry, at the cost of a table, a migration and one more
  write per row every 5 s. That outcome needs the connection to break between
  sending a commit and reading its answer, and production has not logged one.
  Revisit if a `commit got no answer` line appears.
- **Stop batching money.** Direct writes put a database round trip in every
  request's settlement, which is what batching avoids.

## Consequences

- A delta can now wait in memory across several runs while the database is
  down. It is still lost if the process dies before the database returns;
  shutdown logs it row by row.
- relay-watch reads new-api's database, not its container logs, so the new
  error lines raise no alert. Search the container logs for `batch update
  incomplete`, `rejected by the database`, `commit got no answer` and `lost at
  shutdown`.

## Verification

- `go test ./model -count=1`: ok.
- `TestBatchUpdateKeepsChargesTheDatabaseNeverReceived` fails every write of
  one flush with the 2026-11-06 error, charges again, and requires the next
  flush to write both charges. Copied onto origin/main (`55137bc4`) it fails:
  quota 980 where 950 is required, and the token, channel, used quota and
  request count each lack the first charge.
- `TestFlushBatchUpdatesRetriesThenReportsWhatRemains` fails the first two
  shutdown writes and requires the charge written; then fails them all and
  requires a `lost at shutdown` line with the user and amount. Its first half,
  copied onto origin/main with one failed write, leaves quota 1000 where 970
  is required.
- `TestBatchUpdateNeverReplaysACommitWithoutAnAnswer` commits and then reports
  `io.ErrUnexpectedEOF`, and requires the balance charged once after two runs.
- `TestBatchUpdateDropsARowTheDatabaseRefused`,
  `TestBatchUpdateStopsTryingAnUnreachableDatabase` and
  `TestBatchWriteOutcomeClassification` cover the other outcomes.
