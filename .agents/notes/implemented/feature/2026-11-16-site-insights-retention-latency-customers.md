# Agent Note: Retention for the sign-ups who started or paid, first-token delay over time, and the customers who met the most failures

Status: implemented

## Problem

The activity tab's retention table gave the share of every sign-up active on each day after sign-up. About 70% of sign-ups never make a request, so the table mostly measured activation. The reader could not pick the sign-ups who started or the ones who paid.

The quality tab gave the first-token time (TTFT) p50 and p95 for the range and the change against the previous period, but not when it moved. The keys view named no customer, so nothing said who met the most service failures.

## Decision

### Retention for the chosen sign-ups

`RetentionCohort` gains three fields, all additive:

- `active`: the users of the cohort active on each day the cohort reports. These are the counts behind `days`.
- `activated`: `{size, active}` for the sign-ups the funnel counts as activated (`RequestCount > 0`).
- `paid`: `{size, active}` for the sign-ups with a paid order (`money > 0`, any time up to now), as the funnel counts payers.

A user is active on day N when a request of theirs came back with usage (tokens or a charge), the existing definition in `GetActivityInsights`. The panel's help says so.

The console (`components/retention-panel.tsx`, pure logic in `retention-cohorts.ts`) lets the reader pick all sign-ups, activated or paid. Each cell shows the rate, and the count on hover. A cohort under `MIN_COHORT` (20) sign-ups is drawn muted with no colour. A range longer than two weeks groups sign-up days by week, pooling counts over the days that have reached each day N. A week of fewer than seven days is marked partial.

### First-token delay over time

`QualityInsights.ttft_vendors` holds, per vendor, the daily points and, for a range with hourly rows, the hourly points. Each point is merged at read time from the stored TTFT histograms of the selected models. It counts customers' successful streamed requests that have a first-response time, the same requests the histograms hold. A point with no streamed request is absent. The panel draws one line per vendor with at least 100 streamed requests in the range, p95 by default, with a p50 and p95 switch. A day with fewer than 100 streamed requests (an hour, fewer than 20) breaks the line. A partial first or last day is dashed, as the other daily charts mark it.

### Customers with the most service failures

`KeyInsights.failing_users` ranks customers from the same key totals as the rest of the view, so the stored-hours path and the open-hours path agree. A service failure is a failed request less the ones the customer caused (`ClientErrors`). The list leaves out staff and rows with no owner (token 0 and the folded other-keys row), and keeps the 20 with the most service failures, each with the model that failed most for them.

Requests no channel could take are counted as failures. The stored key rows do not tell them apart from other failures, so the panel's help says so rather than guessing.

## Alternatives considered

- **Count the cohorts in the console from the existing rates.** The rates are rounded, and a weekly pooled rate needs the counts. The server sends the counts, which are exact.
- **Reuse the `Paid` key for the paid segment.** Its Chinese translation is 已打款 ("paid out"), so a new key `Paid sign-ups` was added.
- **Import `UserActions` from the risk tab.** It made the risk tab's module a shared chunk, which regrouped the console's lazy chunks. The activity panel now renders its own usage-log link.
- **Reuse `SMALL_SAMPLE` (100) for cohorts.** It would mute most daily cohorts. The cohort floor is `MIN_COHORT`, which the tab already uses for conversion rates.
- **Build the TTFT series in the console from hourly rows.** The view sends the merged histograms, not each model's hourly histogram, so the series has to come from the server.

## Consequences

- Every field is additive. An older console ignores them. A newer console against an older server hides the failing-customers panel and the TTFT panel, and offers no choice of sign-ups.
- The keys view cannot name a customer whose keys were folded into other keys in a busy hour.
- Paid sign-ups count orders up to now, not up to the end of the cohort's window.
- The `/dashboard/overview` first load costs 108 bytes against main (357 bytes left on main, 249 on the branch). No lazy chunk is added. Two chunk ids are renamed, as the quality tab's chunk changes content.
- Schema is unchanged; `insightHourVersion` is not raised and no rollup data is added.

## Verification

- `go test ./model/ ./controller/ ./service/ ./router/ ./middleware/ -count=1` passed on SQLite.
- The new tests pass on SQLite and on PostgreSQL 16 (run against a local server). MySQL was not run: no MySQL server is available here.
- `go vet` and `gofmt -l` are clean on the changed Go files.
- `bun run typecheck`, `bunx oxfmt --check src/features/site-insights`, `bun run lint:check`, `bunx vitest run src/features/site-insights src/i18n`, `bun run build` and `bun run first-load:check` passed.
- The locale partition for the branch and main agree on all keys except the 24 new ones and the removed orphan. The new keys are all in the rest part; none moved into boot or core.
