# Agent Note: Cap page counts, time the outbound build, and reload refusals off the request path

Status: implemented

## Problem

A review of the request and console paths on 2026-11-04 found four costs that
were either unbounded or unmeasured:

- **Page totals were never capped.** `GetUserLogs`, `SearchUserTokens`,
  `SearchUserTopUps` and `SearchAllTopUps` called `query.Limit(n).Count(&total)`
  to stop the count at 10,000 rows (or the token cap). GORM 1.25.12 keeps the
  `LIMIT` on a count, where it applies to the one result row:
  `SELECT count(*) FROM logs WHERE user_id = ? LIMIT 10000` counts every row.
  A heavy Claude Code user's logs page therefore counted all of their logs on
  each load and filter change.
- **The post-channel body build was untimed.** `ClaudeHelper` deep-copies the
  decoded request through reflection, converts it and marshals it again before
  each attempt. `pre_channel_ms` stops at the channel selection, so the cost of
  that work on 4 to 30 MB bodies was invisible. In pass-through the deep copy
  was made and never sent.
- **The refusal set reloaded under the lock every check takes.** Every ten
  minutes the request that found the similarity set stale ran
  `GetRecentRefusedExcerpts` and fingerprinted up to 2,000 excerpts while
  holding `riskGateRefusals`, so every concurrent similarity check waited on
  the database.
- **Every consume log serialized its whole params to the server log**, `other`
  included, at info level.

## Decision

- **`countUpTo` counts over a limited subquery**:
  `SELECT count(*) FROM (SELECT 1 … LIMIT n) AS capped_rows`. The four call
  sites use it. It leaves the caller's query unchanged, so paging it afterwards
  is unaffected. `GetAllLogs`, the administrator's view, still counts exactly;
  it had no cap before either.
- **`outbound_build_ms` in `other.admin_info`** holds the first attempt's build
  time, from before the copy to just before the upstream call, to 0.1 ms. It is
  admin-only like `pre_channel_ms` and is not part of its `total`.
- **Pass-through takes a shallow copy.** The received body goes upstream, and
  the steps before it assign only top-level fields of the copy (`Model` through
  `SetModelName`, `System` through `SetStringSystem` or a new slice), which a
  shallow copy keeps off `info.Request`. `ApplyReasoningModelSuffix` returns
  before touching the request in pass-through.
- **The refusal set loads outside the lock.** The first check after a start
  still waits for the set, through a singleflight, so it is compared like every
  later one. A check that finds the set stale starts one background reload and
  compares against the set it has. Refusals remembered while a load runs are
  kept in front of the loaded set, since the query may predate them. A failed
  load keeps the current set and retries at the next interval.
- **The params line is debug-only**, and is not built unless `DebugEnabled`.

## Alternatives considered

- **Skip the deep copy whenever no mutation follows, outside pass-through.**
  Model mapping, the reasoning suffix and the system prompt all write the copy,
  and conversion may write nested fields. Proving which requests escape all of
  them needs the timing first.
- **Replace only `"model"` in the raw bytes.** It would avoid the decode
  round trip, but changes which unknown fields reach the upstream. Not done.
- **Show "10,000+" in the console.** The total keeps its shape; a capped total
  ends pagination at 10,000 rows, which the cap was always meant to do. Filters
  reach older rows.

## Consequences

- A user, token or top-up list with more matching rows than the cap reports the
  cap as its total, where it reported the true count. Pagination stops there.
- A check right after a reload starts may miss a refusal recorded by the other
  server in the last ten minutes for the length of the reload, as it could for
  up to ten minutes before.
- Operators who read `record consume log` lines from the container log need
  `DEBUG=true`; nothing in `corecode-infra` reads them.

## Verification

- `TestCountUpToStopsAtTheLimit` counts 5 rows under caps of 3 and 10 and pages
  the same query afterwards; with `Limit(n).Count()` the capped count is 5.
  `TestGetUserLogsCapsTheTotal` covers the log path.
- `TestClaudeHelperKeepsTheClientRequestAcrossAttempts` runs two attempts
  against a failing upstream, converted and pass-through, with model mapping
  and a system prompt override, and requires the client's request to be
  unchanged after each, the converted body mapped, the pass-through body
  identical to what was received, and `outbound_build_ms` recorded. With the
  shallow copy replaced by the original request the pass-through case fails.
- `TestSimilarRefusalReloadsOutsideTheRequest` covers the first load waiting,
  a stale check returning against the old set while the reload completes, and
  a refusal remembered during a load surviving it. It passes under `-race`.
- `go test ./model ./service ./relay` passes. `TestUpstreamAddressesMaskOnlyConfiguredAddresses`
  fails only when the shell sets `HTTP_PROXY`; it passes with the proxy
  variables unset.
