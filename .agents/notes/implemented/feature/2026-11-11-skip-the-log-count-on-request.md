# Agent Note: Skip the self log count on request

Status: implemented

## Problem

`GET /api/log/self` runs `countUpTo` on every call: a count of up to 10,000
matching rows. A customer without a time filter searches a year back, so an
active customer's count visits all 10,000 index entries and checks each row's
type and time. The overview's recent requests panel asks for the latest 100
consume logs, reads only `items`, and never reads `total`, yet pays for that
count on every load. The request sits on the overview's first-load path, after
the session refresh.

## Decision

- `GET /api/log/self` accepts `skip_count=1`. `controller/log.go` sets
  `LogFilter.SkipCount`, and `model.GetUserLogs` then runs only the page query.
- With the count skipped, `total` is the number of rows known to exist through
  the requested page: the page offset plus the rows returned. The field keeps
  its type and stays in the response, so a reader of the page shape does not
  break, and a pager built on it offers no page past the current one unless
  the current one is beyond the last row.
- Without the parameter, or with any value other than `1`, the response is what
  it was: the capped count.
- Only the self list reads the flag. The administrator list and the exports do
  not.

The console sends the parameter from its overview request and the matching
prefetch in `index.html`; that change ships with the console. A console that
does not send it gets the counted response, so either release order works.

## Alternatives considered

- **Drop the count when `page_size` is large or `p=1`.** It changes the response
  for the usage logs page, which reads `total` for its pager.
- **Return `total: -1` or omit it.** Readers that compute page counts from it
  would show negative or NaN pages; the rows-through-the-page value cannot.

## Consequences

- A caller that sends `skip_count=1` cannot tell how many rows exist beyond the
  page. Only the overview sends it.

## Verification

- `go test ./model -run 'TestGetUserLogs|TestCountUpTo' -count=1`: 3 passed.
  `TestGetUserLogsSkipsTheCountOnRequest` requires a total of 5 with the count,
  4 for the second page of two rows without it, and 5 for the third page, with
  the same rows returned both ways. With the model change reverted it fails.
- `go test ./controller -run TestLogExport -count=1`: 6 passed (MySQL,
  PostgreSQL and ClickHouse subtests skip without their DSNs). The SQLite
  subtest of `TestLogExportDatabaseMatrix` requires a total of 1 for
  `page_size=1&skip_count=1`; with the model change reverted it reads 2 and
  fails.
