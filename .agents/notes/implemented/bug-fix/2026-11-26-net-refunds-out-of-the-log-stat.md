# Agent Note: Net refunds out of the usage-log stat

Status: implemented

## Problem

The usage-log pages (`/usage-logs/common` for administrators, the user's own
log page) show a quota total from `GetLogsStat` and `GetLogsSelfStat`. Both
call `SumUsedQuota` (`model/log.go`), which summed only `type = consume` rows.

Async tasks such as Seedance videos reserve their price when submitted, as a
consume row. A failed task is refunded in full (`RefundTaskQuota`), and a task
that settles below its reservation refunds the difference
(`RecalculateTaskQuota`); both write a refund row with a positive quota. The
stat ignored those rows, so a media group's total was the sum of reservations,
not what users paid. User and channel used quota were already reduced on
refund, so the log page disagreed with them.

## Decision

- `SumUsedQuota` sums consume rows minus refund rows, over the same filters
  (user, token, model, channel, group, time).
- RPM and TPM still count consume rows only; a refund is not a request.

## Alternatives considered

- **Show refunds as a separate figure.** More informative but needs console
  changes; the single figure was the wrong one, and netting it fixes the page
  without new UI.

## Verification

- `TestLogExportDatabaseMatrix` adds a 15 refund against bob's 20 consume and
  requires the stat to read 5. With `model/log.go` at origin/main it fails:
  expected 5, actual 20.
- The matrix passed locally on SQLite, PostgreSQL 16 and ClickHouse 26.11
  (MySQL skipped). CI runs only the SQLite case.
- `go test ./model/ ./controller/ -count=1`: ok.
