# Agent Note: Keep the usage-log aggregates on stable query keys

Status: implemented

## Problem

**"Spend by key"** on `/usage-logs/common` (`GET /api/data/flow/self`, a GROUP BY over
`quota_data`) reran on re-renders that changed nothing it depends on. With no time range
in the URL, its end came from `getDefaultTimeRange()`, which is "now + 1 hour" to the
second. The end is in the query key, so any re-render a second or more after the last
one made a new key and a new request, and the popover lost its rows until that request
returned.

## Decision

- **`usage-logs/lib/query-ranges.ts` `spendBreakdownRange`**: with no end time in the
  URL, the range ends at the next hour boundary. `quota_data` rows are stamped with the
  start of their hour (`model/usedata.go`), and the newest one is stamped at or before
  now, so this selects the same rows as "now + 1 hour" and keeps one key for the rest of
  the hour. An end time in the URL is used as given.
- **The key also holds the URL search** and sits under the `usage-logs-stats` prefix. A
  page turn or a filter change still refreshes the figures, as it did before, and the
  filter bar's `invalidateQueries(['usage-logs-stats'])` refresh now covers them too.
  The figures stay as fresh as the stats badges next to them.
- **The stats badges keep their key**, `page` and `pageSize` included.

## Alternatives considered

- **Drop `page` and `pageSize` from the stats key.** The stats request always asks for
  page 1 of size 1, so the result does not depend on the page. But the response also
  carries RPM and TPM, last-60-second figures that a page turn refreshes today. Dropping
  paging would leave them stale while paging, a visible change this batch rules out.
  The spend breakdown follows the stats for the same reason.
- **Fetch the spend breakdown only while its popover is open**, with a prefetch on
  pointer enter and focus. On a touch screen `pointerenter` fires just before the tap, so
  the popover would open on "Spend in this range: $0.00" and fill in a moment later.
- **Round the end down to the hour.** It would drop the current hour's row.

## Consequences

- The spend breakdown is requested once per URL search, per hour, plus each filter-bar
  refresh. Re-renders with the same URL, such as the stats response arriving, no longer
  request it.
- When the hour turns, the next re-render requests it again, which is when its range
  could gain a new row.
- Paging still reruns both aggregates. Removing that needs RPM and TPM split from the
  stats response, or the owner accepting stale figures while paging.

## Verification

- `usage-logs/components/__tests__/log-stats-requests.test.tsx`, with `Date` faked so
  each step lands two seconds later in the same hour: three re-renders with the same URL
  leave `/api/data/flow/self` and `/api/log/self/stat` at one request each; three page
  turns bring both to four requests, as on `origin/main`; invalidating
  `['usage-logs-stats']` sends a second spend request. A model filter change still sends
  a second stats request carrying `model_name`. Range rounding: 09:00:01 and 09:59:59
  give the same end, 10:00:00, and exactly 09:00:00 gives 09:00:00.
- With `spend-breakdown-popover.tsx` restored from `origin/main`, the re-render test
  fails and so does the refresh test. With the key moved back to the `usage-logs` prefix,
  the refresh test fails.
- `bun run test`, `bun run typecheck`, `bun run lint:check`, `bun run format:check`,
  `bun run build` and `bun run first-load:check`, all exiting 0.
