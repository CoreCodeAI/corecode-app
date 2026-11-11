# Agent Note: Flush dashboard data outside the accounting lock

Status: implemented

## Problem

`SaveQuotaDataCache` (`model/usedata.go`) held `CacheQuotaDataLock` while it
wrote every cached dashboard row: a `First` and then an `Update` or `Create`
per row, two database round trips each. `LogQuotaData`, which every consume
and error log calls from `RecordConsumeLog`, takes the same lock. Every five
minutes (`DataExportInterval`) each relay request settling during the flush
waited for all of the writes, holding its goroutine and, where it already had
one, a database connection.

Write errors were also ignored: a failed `First` read as "no row" and
inserted, a failed `Create` or `Update` was logged or dropped, and the cache
was cleared either way, so the row's counts were lost.

## Decision

- Under `CacheQuotaDataLock` the flush only swaps `CacheQuotaData` for an empty
  map. It writes the swapped-out rows with the lock released, so accounting
  goes on into the new map.
- A row whose write fails is merged back into the live cache with
  `logQuotaDataCache`, adding to any usage for the same key that arrived
  meanwhile, and the next flush writes it. `First` now returns its error unless
  it is `ErrRecordNotFound`, and `increaseQuotaData` returns its error.
- A failing row is kept only while its hour is less than a day old. Older rows
  are dropped with a log line, so a write the database always refuses cannot
  grow the cache without bound.
- `quotaDataFlushLock` keeps flushes one at a time. The shutdown flush in
  `main.go` therefore waits for a background flush that is still writing, and
  then writes whatever arrived since, including rows that background flush put
  back.
- The SQL is unchanged: the same `First`, `Updates` and `Create` per row.

Two servers during a blue/green release behave as before: each flushes its own
cache, the check-then-insert can still leave two rows for one key, and every
reader sums with `GROUP BY`.

## Alternatives considered

- **One transaction, or a dialect-specific upsert per batch.** Fewer round
  trips, but the upsert needs a unique index on the eight key columns, which is
  a migration on a table with existing duplicates, and three dialect branches.
  Out of scope for this change.
- **Copy the map under the lock instead of swapping it.** It still holds the
  lock for the copy and has to subtract what was written afterwards.

## Consequences

- A row whose write fails at shutdown is still lost, as before; there is no
  later flush to retry it.
- A `Create` that commits but reports an error (a lost connection after the
  commit) is counted again at the next flush. Before, a failed write lost the
  row instead.
- The "saved dashboard data" line counts written rows, not cached rows.

## Verification

- `go test ./model -run 'TestSaveQuotaDataCache|TestLogQuotaData' -count=1 -race`:
  ok.
  - `TestSaveQuotaDataCacheLetsAccountingContinueDuringTheWrite` holds the
    first `quota_data` statement of a flush in a GORM callback and requires
    `LogQuotaData` to return within 5 s meanwhile, then requires the next flush
    to add up both uses. Against the previous `usedata.go` it fails with
    "LogQuotaData waited for the database write".
  - `TestSaveQuotaDataCacheKeepsARowThatFailedToWrite` fails every
    `quota_data` statement for one flush, logs the same usage again, and
    requires the next flush to write count 2 and the summed quota, tokens and
    cache reads, leaving the cache empty. Against the previous `usedata.go` it
    reads count 1.
  - `TestSaveQuotaDataCacheDropsAFailedRowOlderThanADay` requires a failing row
    two days old to be dropped and a current one kept; with the age check
    disabled it fails.
