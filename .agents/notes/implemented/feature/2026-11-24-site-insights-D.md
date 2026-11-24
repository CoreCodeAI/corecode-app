# Agent Note: Site insights growth, activity and channels tabs open on charts, with a customer book

Status: implemented

## Problem

The growth, activity and channels tabs were tables and paragraphs. Sign-ups by week, the
money paid next to sign-ups, retention by sign-up week, paying accounts that went silent,
spend concentration and the biggest customers were only in prose or not shown. Nothing told
the owner which customer was slipping.

## Decision

Charts first; no existing figure changed meaning. Backend fields are additive and old
clients ignore them.

- **Growth.** Three cards (registered, first-paid, payment conversion), weekly sign-up bars
  (Monday weeks in the viewer's time zone, partial weeks drawn faint), a daily sign-ups bar
  with the day's top-up money as a right-axis line, the existing funnel chart, and the funnel
  by sign-up method and by referral as horizontal stacked bars (`StackedFunnel`). Server:
  `GrowthInsights.topups` (day, money, plan money, payers, from `top_ups` and plan orders
  paid that day, staff excluded) and `silent_payers`.
- **Activity and retention.** Weekly cohort heatmap (`retention_weeks`: all / activated /
  paid, week 0..n, the last reported week marked live), silent paying accounts by days since
  the last quota use, and spend tiers (whale ≥ $500, large $100–500, mid $10–100, tail < $10)
  as users-share and revenue-share donuts plus a table, with a Claude / GPT / other filter
  (`spend_tiers`, one group per vendor).
- **Customers.** New `GET /api/site-insights/customers` (`CustomerInsights`): top-20 profile
  table, top 5/10/20 concentration, and a churn list drawn from the 50 biggest customers by
  30-day spend: use in the last 7 days fell by more than half against the 7 before, or no
  request for 3 days. It sits in the access-token scope `user:read`
  (`middleware/access_token_routes.go` must declare every dashboard route once).
- **Channels.** Horizontal bars of sign-ups, paying accounts and revenue per source, and a
  daily sign-ups stack by the three biggest sources plus "other" (`signups_by_day`).
  Commission stays a note.
- **Units.** The new spend panels show quota dollars (¥1 each, `fmt.usd`), as the rest of the
  page does; top-ups and plan payments stay in the payment currency, labelled as such.
- **Error rule.** A new panel whose read failed renders nothing (or its loading / error
  state), never "No data" or zeros; the existing "could not be read" tests enforce it.
- **Customer read cost.** The view runs three reads: range spend by user and model; 30-day
  spend by user (month total); and 30-day spend by user and hour only for the top 20 plus the
  50 watched users (the 7-day trend and the two 7-day windows). A first version read every
  user by hour and scanned 900k rows twice as long. The view goes through `settledRead`, so a
  settled range is cached for 5 minutes like the others.

## Alternatives not taken

- Reading the hour rollup for every user: the heavy version above.
- A chart library: `/dashboard/overview` and `/keys` have about 1 KB left; every chart is
  hand-rolled SVG and lives in the `rest` locale part and the lazy route chunk.
- Converting the quota-dollar figures to yuan: they are equal by construction; showing `¥`
  next to top-up money in the same table would read as two currencies.

## Verification

- Go: `model/site_insights_review_test.go` runs the new reads on SQLite, MySQL 8 and
  PostgreSQL 16 (containers, removed afterwards); CI runs SQLite only. `go build ./...`,
  `go vet` and `go test ./model ./router ./middleware ./controller` (3,444 tests) pass.
- Query cost, synthetic data of 900k log rows and 3,000 users on SQLite: customers view 0.93 s
  for 7 days, 1.61 s for 30 and 90 days (2.3 s before the restructure); `EXPLAIN` uses
  `idx_qdt_created_at` and a temp b-tree for the group. Production was not touched.
- Console: 23 component tests and the `growth-weeks` tests (`niceScale`, weeks, retention
  rows), `bun run typecheck`, lint baseline, `bun run test` (4,496 tests), `bun run build`,
  `bun run first-load:check` (sign-in 353.9 of 355 KB, overview 536.2 of 537, keys 617.0 of 618;
  at least 786 bytes left each). All 80 new keys are `rest` in `localeParts`; the eight locales
  carry them.
- Looked at in a browser against a local stub with synthetic data (never production): light,
  dark and 390 px, before and after, on all three tabs.
