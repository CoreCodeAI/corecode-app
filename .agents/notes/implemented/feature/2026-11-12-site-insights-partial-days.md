# Agent Note: Mark and project the days a site-insights range covers in part

Status: implemented

## Problem

Every `/site-insights` view reads a rolling range, `[now − N days, now)`, split at the viewer's midnight. Its first day starts at the time N days ago and its last day ends now. Both days hold only part of a day's traffic, but the charts drew them like the whole days between them. A seven-day revenue or request trend ended in what looked like a collapse every morning. The first point looked low too.

The comparison with the previous period was not affected. That period is also a rolling window of the same length, `[now − 2N, now − N)`.

## Decision

- **Both partial days are marked.** `Sparkline` and `BarSeries` accept a `partial` mark on a point: a note on what the point covers ("进行中，截至 08:50" or "不完整，从 08:50 起"), and optionally what the whole day is projected to come to.
  - A line runs dashed through every segment that touches a partial day. When the day is projected, the line ends at the projection and a hollow dot marks the actual value.
  - A bar for a partial day is drawn lighter. The rest of its projection is a dashed outline on top, and the value axis reaches the projection.
  - The readout and tooltip give the note and "预计全天".
- **Amounts are projected by a day profile, not by the clock.** `GET /api/site-insights/day-profile` (root, `ops:read`) returns each UTC hour's share of the requests over the last 14 whole UTC days, from `quota_data`. The console sums those shares over the part of the day the range covers and divides the amount by that sum. Traffic is concentrated in the Chinese daytime: on 2026-11-12 the hours before 08:50 Beijing time held 18% of a typical day, not the 37% the clock gives.
- **Projection only where it means something.**
  - A rate (failure rates), a count of distinct users (DAU), and earned revenue (plans earn by the hour, wallets by use) are marked, not projected.
  - Below 15% of a typical day (`MIN_PROJECTED_SHARE`), a day is marked but not projected. On 2026-11-12 that meant no projection before about 08:00 Beijing time.
  - A server without the endpoint, or one with no recent requests, leaves the days marked but not projected.
- **The page owns the range and the profile.** `InsightsSpanContext` carries the page's `now`, each view's day count and the profile's hours. `usePartialDays(view)` turns a day's start, and its values for an amount, into the mark. Outside the page, for example in component tests, no day is marked.

## Alternatives considered

- **Drop the partial days.** This removes the false drop, but it also hides today, which is the day the operator checks most.
- **Align the range to midnight**, so only today is partial. A seven-day range would then hold 6.4 days, and its comparison with an equal previous period would no longer be like with like.
- **Project by the clock.** At 08:50 that would assume 37% of the day had passed against a real 18%, and project about half the actual total.
- **A profile per weekday or per vendor.** Fourteen days give only two samples per weekday. One profile over all requests is steadier. Day-to-day spread is large either way: in the eight days to 2026-11-12, the share before 08:52 ranged from 11% to 33%. The projection is an estimate, and the tooltip says so.

## Consequences

- The profile weights hours by request count. Projections of revenue, top-ups and sign-ups assume those follow the same daily shape as requests.
- Hourly series (capacity, pool usage, risk sign-ups over three days or less) still end in a partial hour, which this change does not mark.
- "Busiest day", "worst day" and similar descriptions still consider partial days.

## Verification

- `go test ./model -run 'TestDayProfile|TestSiteInsightsDatabaseMatrix'` passed on SQLite, MySQL 5.7.44, PostgreSQL 9.6.24 and PostgreSQL 18.6. With SQLite only, `go test ./model ./controller ./router ./middleware` passed; the router test caught a missing access-token scope rule for the new route before it was added.
- Console, from `web/`: `bun run typecheck` (it failed on a planted error first), `format:check`, `lint:check`, `build` and `first-load:check` passed. The full `bun run test` passed: 331 files, 3271 tests.
- The dev server was run against production through a read-only proxy that forwarded only GET requests. The proxy computed the profile from production's capacity view. At 1488 px, the overview and funds tabs showed dashed ends, hollow dots, lighter partial bars and outlined projections. Sweeping 41 positions across the revenue sparkline and the daily revenue bars read out a value at every position. At 390 px, a tap read out the last point, with no horizontal overflow.
