# Agent Note: Keep the usage-log aggregates on stable query keys

Status: implemented

## Problem

Two aggregate requests on `/usage-logs/common` reran when nothing they depend on had
changed:

- **"Spend by key"** (`GET /api/data/flow/self`, a GROUP BY over `quota_data`). With no
  time range in the URL, its end came from `getDefaultTimeRange()`, which is "now + 1
  hour" to the second. The end is in the query key, so any re-render a second or more
  after the last one (a page turn, a filter change, the stats request returning) made a
  new key and a new request.
- **The stats badges** (`GET /api/log/self/stat`, two aggregates over `logs`). Their key
  held the whole URL search, `page` and `pageSize` included, although the request always
  asks for page 1 of size 1. Every page turn reran both aggregates.

## Decision

- **`usage-logs/lib/query-ranges.ts`** holds the two key inputs.
- **`spendBreakdownRange`**: with no end time in the URL, the range ends at the next hour
  boundary. `quota_data` rows are stamped with the start of their hour
  (`model/usedata.go`), and the newest one is stamped at or before now, so this selects
  the same rows as "now + 1 hour" and keeps one key for the rest of the hour. An end
  time in the URL is used as given.
- **`logStatsSearch`**: the stats key and request drop `page` and `pageSize`. Every
  filter stays in the key, so changing one still refreshes the badges, and the filter
  bar's `invalidateQueries(['usage-logs-stats'])` still matches.

## Alternatives considered

- **Fetch the spend breakdown only while its popover is open**, with a prefetch on
  pointer enter and focus. On a touch screen `pointerenter` fires just before the tap, so
  the popover would open on "Spend in this range: $0.00" and fill in a moment later.
  Today the figures are loaded with the page and are ready on open, so this would be a
  visible change. The stable key already removes the repeated requests. What remains is
  one request per page visit, per range, per hour.
- **Round the end down to the hour.** It would drop the current hour's row.

## Consequences

- RPM and TPM are last-60-second figures in the same stats response. A page turn used to
  refresh them as a side effect. Now they refresh on a filter change, the filter bar's
  refresh, or the next mount after the 10-second default stale time.
- The spend breakdown is requested again when the hour turns, at the first re-render
  after that, which is when its range could gain a new row.

## Verification

- `usage-logs/components/__tests__/log-stats-requests.test.tsx`: with `Date` faked so
  each of three page turns lands two seconds later in the same hour, `/api/log/self/stat`
  and `/api/data/flow/self` are each requested once. With both components reverted the
  test fails with 4 spend requests. A model filter change still sends a second stats
  request carrying `model_name`. The popover shows the rows loaded with the page without
  another request. Range rounding: 09:00:01 and 09:59:59 give the same end, 10:00:00, and
  exactly 09:00:00 gives 09:00:00.
- `bun run test`, `bun run typecheck`, `bun run lint:check`, `bun run format:check`,
  `bun run build` and `bun run first-load:check`, all exiting 0.
