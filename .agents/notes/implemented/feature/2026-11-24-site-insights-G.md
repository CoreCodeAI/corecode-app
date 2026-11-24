# Agent Note: Site insights "Customer experience" tab: money customers wasted, and what became of their reports

Status: implemented

## Problem

The owner could not see what customers lost to our own system. A refused request that was
still charged, a stream that died and was billed, a task refunded, a newcomer-plan gate that
fell back to the wallet, a one-hour cache write nothing read: each lived in a log row or an
`other` JSON field, and none was totalled. Reports customers filed were readable one by one
in the feedback admin, with no view of volume, reply time, backlog, or whether a sender kept
using the service. Nobody could say which of the customers who lost most had never spoken.

## Decision

A new business-group tab, `experience` ("Customer experience"), after "Activity and
retention" and before "Risk". Charts first; no existing figure changed meaning; backend
fields are additive; the pool tab is untouched.

- **Endpoint.** `GET /api/site-insights/experience`, `ExperienceInsights{series_unit, series,
  waste, feedback}`, through `serveInsights` and `settledRead` (5-minute cache). It is
  declared in `middleware/access_token_routes.go` under `user:read`, like every dashboard
  route. Ranges up to 92 days (`VIEW_MAX_DAYS.experience`).
- **No rollup change.** The hourly rollup carries no refusal, stream-end, gate or cache-write
  detail. The view scans `LOG_DB`: an `other LIKE` marker per kind, then Go-side JSON parsing
  of the matching rows only. A LIKE reads every row of its range, so the scan walks the range
  **newest hour first** (one query per hour, through the `created_at` index), stops at a time
  budget (6 s for the refusal, failed and gate kinds, 3 s for the cache pass) and returns how
  far back it got in `waste.log_start` / `cache_start`; the console prints "Waste is counted
  only from X" and hides the period-over-period change when the range was not read in full
  (`wasteComparable`). Event kinds read at most 30 days back, the 1h cache pass the last day
  (it needs the requests that follow each write: only the writers' requests are read), 250,000
  rows each, with a `truncated` flag for the row bound.
- **First version, and why it was replaced.** It paged by `id` (`WHERE ... AND id > ? ORDER BY
  id LIMIT 5000`) and read every consume row of the last 3 days for the cache pass. On
  production (2026-11-24, after #383 merged) one read took 45 s for a 1-day range and 45 s for
  7 days: the planner walked the primary key of the whole logs table whatever the range. A
  test on SQLite cannot show this. Fixed in a follow-up: time-window paging, the budget, and
  the cache pass cut to one day. The lasting answer for 30- and 90-day ranges is a pre-
  aggregated table (below).
- **What counts as waste.** Per log row, one kind, by priority: refusal
  (`upstream_refusal`) > abnormal stream end (`timeout`, `scanner_error`, `panic`,
  `ping_fail`; `done` and `client_gone` are not failures) > plan gate charged to the wallet
  (`limited_plan_ip_gate` = `wallet`). A refused request that also wrote a cache costs once.
  The 1h cache kind is the premium of the one-hour price over the five-minute price on
  writes with no later consume log of the same (user, token) within 3,600 s; the last hour
  of the window is not judged; writes with no ratios to price them are counted apart as
  `unpriced`. The figure is an estimate and the verdict says so.
- **Refunds are not waste.** Task refunds return the money, so they are a separate card and
  panel (how often a paid task fails). Rows carrying `pre_consumed_quota` are settlement
  deltas, not failures, and are skipped.
- **Staff left out** everywhere (`StaffUserIDs()`): their consumption, refusals and reports.
- **Customers.** Top 20 by wasted money with the four kinds, the total, whether they ever
  filed a report and whether they are silent (no request in 3 days); a second list of the
  top losers who filed nothing and went silent. Mobile gets a card per row.
- **Feedback.** Daily new reports by category, status and category breakdowns, first-reply
  p50 / p90, open backlog, reports unanswered over 24 hours (the oldest listed), rewards, and
  sender retention: of senders whose first-report week is over, the share who sent a request
  in the week after, spend the week before and after, and the senders who lapsed.
- **Verdict.** Headline plus chips (Wasted, Refusals charged, Reports, Unanswered over 24
  hours). Waste share of consumption: warning from 1%, danger from 5%; any report unanswered
  over a day is a warning, five or more is danger. Long lists and the refusal details are
  folded.
- **Units.** Dollars are quota dollars (¥1 each, `fmt.usd`), as the other panels do.
- **Errors.** A failed read shows `-` and "Could not be read", never zeros; loading shows
  skeletons.

## Limits and alternatives not taken

- **Manual compensation** (a staff member topping a user up by hand) leaves no log type, so
  it is invisible here. The only compensation the view can see is `feedbacks.reward_quota`.
- **Overview signal skipped.** An optional overview card would run these scans on every
  overview load. The tab is opened on demand; the overview stays as cheap as before.
- **A pre-aggregated table** (one row per refusal / failed / gate / unreused-cache event,
  filled by a periodic job from a watermark, backfilled once) would answer any range in
  milliseconds. It needs a schema change, a job and a backfill on production, so it is the
  follow-up the owner decides on; until then the console shows the time the figures begin.
- **A chart library** was not added: the first-load budget has about 1 KB left on
  `/dashboard/overview` and `/keys`. Charts are the existing hand-rolled SVG, in the lazy
  tab chunk.

## Verification

- Go: `go build ./...`, `go vet ./model ./controller ./router ./middleware`, and
  `go test ./model ./router ./middleware ./controller` pass.
  `TestExperienceInsightsCountWastedMoneyAndFollowReports` runs on SQLite always and on MySQL
  and PostgreSQL when `TEST_MYSQL_DSN` / `TEST_POSTGRES_DSN` are set; CI runs SQLite only.
  It covers kind totals and priority, the unpriced write, the staff exclusion, refunds with a
  settlement delta, the series adding up to the totals, the top order, the silent list,
  reply p50 / p90, open and unanswered counts, retention before / after and the lapsed list.
  `TestExperienceInsightsReadByTheHourOverADay` covers the hour series, and
  `TestExperienceInsightsStopAtTheScanBudget` the stop at the time budget and the reported start.
- Web: `bun run typecheck`, `bun run lint:check` (no new findings), `bun run test` (432
  files, 4,544 tests, including 19 in `experience-tab.test.tsx`) pass; `bun run i18n:sync`
  ran and the 8 locales carry the 96 new keys; `bun run first-load:check` passes (`/sign-in`
  1,175 B, `/dashboard/overview` 747 B, `/keys` 986 B left).
  `bun run format:check` fails on files this change does not touch (other lines' format
  debt); the files of this change are clean.
- Screenshots: synthetic data. A stub server serves the built bundle and answers `/api` from
  captured production fixtures plus generated experience data; before is the same stub on
  `origin/main`. They show layout, dark mode and 390 px, not real figures.
- Online: after the deploy, the live tab is screenshotted and the endpoint's latency for 30
  and 90 days is recorded in the pull request.
