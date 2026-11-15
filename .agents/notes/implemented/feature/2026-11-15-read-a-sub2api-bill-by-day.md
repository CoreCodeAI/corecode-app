# Agent Note: Read a Sub2API site's bill by day and model

Status: implemented

## Problem

Channels 8 and 9 (吱吱鼠 image and video) point at a Sub2API site, `sub.zzshu.cc`. The upstream bill reader reads `GET /api/log/token`, which a Sub2API site does not answer, so both channels showed `cost_source: none`: revenue with no cost. A Sub2API site returns no per-request log to a key, so the request-level path cannot bill them.

## Decision

### The supplier API

The source is `Wei-Shaw/sub2api` at commit `530c5e3a4f9c73ca2b0881191d0ef8e0d82c5484` (default branch, 2026-11-11):

- `backend/internal/server/routes/gateway.go` mounts `GET /v1/usage` in the `/v1` group. `GatewayHandler.Usage` in `backend/internal/handler/gateway_handler.go` authenticates the API key and answers.
- The answer has `mode` (`quota_limited` or `unrestricted`) and `usage` with `today` and `total`, each carrying `cost` and `actual_cost`.
- With `start_date` and `end_date` (`YYYY-MM-DD`, read in the site's app zone), it adds `model_stats`: one object per model with `model`, `requests`, `cost` and `actual_cost`. The site omits `model_stats` when the range has no usage. The answer also has `daily_usage` (`days`, 1 to 90), which the reader does not use.
- `actual_cost` is the sum of the `actual_cost` column, which the billing path deducts from the key owner's balance (`backend/internal/service/gateway_usage_billing.go`). `cost` is the list price before the multipliers. The reader stores `actual_cost` as `cost_usd` and keeps `cost` as `standard_cost_usd`, so the owner can compare them.
- `model` is the requested model name, the name the channel sent upstream after its mapping (`resolveModelDimensionExpression` defaults to `requested_model`).
- `daily_usage` labels days with `TO_CHAR(created_at)` in the database session zone, which the application does not set. `start_date` is read in the app zone (`backend/internal/pkg/timezone`, default `Asia/Shanghai`). The reader therefore asks for each day's `model_stats` in UTC+8 and does not use the `daily_usage` labels.

The aggregates-only hypothesis holds: `model_stats` covers a range, so one request per day gives per-day, per-model figures. The deployed site may differ from this source, so the reader accepts an answer only in the shape it needs.

### The table

`UpstreamBillDay` (`model/site_insights_upstream_bill.go`) has the primary key (`channel_id`, `day_start`, `model_name`). `day_start` is the Unix second of the UTC+8 midnight, `model_name` the billed name, empty for a day with no billed model. The day's requests, `cost_usd` (`actual_cost`), `standard_cost_usd` (`cost`) and `read_at` are stored with it. It is registered beside `UpstreamCost` in `model/main.go`.

### The reader

`service/upstream_cost_task.go` keeps the new-api path. Only when that path reads no key does `syncSub2APIBills` run:

- An answer is accepted when `mode` is one of the two values, `usage.total.actual_cost` is a number, and each model row has `model`, `requests`, `cost` and `actual_cost`, all non-negative. The days read may not add up to more than the key's total. Any other answer fails, and nothing is stored.
- A channel reads its bill at most every ten minutes, under the console's 30-minute stale threshold. Each read asks for the last three days. A channel whose stored bill does not reach back 90 days gets all 90 first.
- A day with no billed model is stored as one row with an empty model name, so a day counts as read.
- Each channel's rows are replaced from its window's oldest day in one transaction, with an upsert on the primary key. The write is idempotent, so two servers write the same rows.
- A channel that fails is retried after six hours, as before.

### Shared keys

A key held by two channels is counted once. `newBillOwners` gives each (key, model) bill to the lowest-numbered channel that serves the model, by its models or the targets of its mapping. If no holder serves it, the lowest-numbered holder takes it. A channel stores only the rows it owns.

### Edge days and the view

In `upstreamInsightsFromHours`, each bill day spreads over its 24 hours by the channel's hourly revenue (`billHourShares`): the hour's revenue over the day's revenue. A day with no revenue spreads evenly, 1/24 an hour. Only the hours inside the range count, so a day cut by the range's edge takes the share of its hours inside. Revenue for the hours outside the range comes from `loadInsightHoursStale`. Hourly and daily costs carry the same allocation.

A channel with request-level rows keeps those and ignores its day rows. A channel with any stored day bill is `upstream`, so the monthly fee does not apply.

### What the console sees

The console gets `cost_source: "upstream"`, which it already renders as "Upstream bill" with "read <time>", using `latest_cost_at` for staleness. `latest_cost_at` is the newest `read_at`. The additive field `cost_granularity` is `request` or `day` and is omitted otherwise. The console ignores unknown fields, so no console change is needed. A new `cost_source` value was not used, because `upstream.ts` and `upstream-tab.tsx` treat any value other than `none` as costed and render an unknown value under the wrong label.

## Alternatives considered

- **`daily_usage` for day totals.** Its labels follow the database session zone, which the application does not set, so they cannot be aligned to the app zone. It is also capped at 90 days, which is why the reader asks `model_stats` per day.
- **Storing per key and splitting by revenue in the view.** That is more accurate for a shared model, but it adds a key dimension and a second split. The lowest-owner rule is simpler; it can assign a shared model's bill to a channel that has no traffic for it.
- **A `day` value for `cost_source`.** It would render under the wrong label in the console.
- **Leaving hourly cost at zero for day bills.** The hourly chart would count those channels as costed with no cost, so margin would read as 100 percent.
- **Reading 90 days on every read.** That is 90 calls per key per read.

## Consequences

- Aggregates cannot be matched to requests. A task's charge, or a refund, cannot be traced to a request in our log, so the figure can be checked only in total and per day.
- The day boundary is UTC+8. A site whose app zone differs shifts each day's bill by up to a day.
- A model the site bills under another name lands in `unmatched_cost_usd`. It stays in the channel's cost.
- A refund that lowers a day is corrected only by the three-day refresh. A refund that lands on an older day is not read again, because the 90-day backfill runs once. This is a known gap. A full 90-day read once a day would close it at 90 calls per key per day.
- The site's dollar is compared with our revenue dollar one for one, as the new-api quota already is. Here `actual_cost` is already in dollars, so `quota_per_unit` does not apply.
- When two channels serve the same model on one key, the lower-numbered channel holds it. A former owner's rows stay until its next read, and a disabled one keeps them until they age out after 122 days.
- Hours not yet rolled up have no revenue, so their share of a day moves to the rolled-up hours until the rollup catches up.

### Check on production after release

- The log line `upstream bills: channel 8 read 90 days from a Sub2API site, N model rows` appears once, and channels 8 and 9 show no `not read, retried in 6h` line.
- `GET /api/site-insights/upstream` shows `cost_source: "upstream"` and `cost_granularity: "day"` for channels 8 and 9, with a recent `latest_cost_at`.
- The bill is plausible: image bills near $0.02 each and video near $1.20 per 4 seconds at 480p, allowing for refunds. The sum of the stored days for each key is at most the site's `usage.total.actual_cost`.
- One day's bill matches the site's own figure for that day, which settles the day boundary.

## Verification

- `go test ./model -run 'TestUpstreamBillDaysDatabaseMatrix|TestUpstreamInsightsDatabaseMatrix' -count=1`, SQLite 3.50.4: passed. PostgreSQL 18.6 (`TEST_POSTGRES_DSN` on a local cluster): passed. MySQL was skipped; no MySQL server is available here, so MySQL is unverified.
- `TestTmpBillDayMigrationTwice`, run and removed: `AutoMigrate` ran twice and an upsert overwrote a re-read value, on SQLite and PostgreSQL.
- `go test ./service -run 'Sub2API|SharedSub2API|NewAPIBillPath' -count=1` passed. The tests use `httptest` stubs. They cover backfill and refresh, idempotent replacement, a lowered day, a removed day, a shared key counted once, unexpected answers storing nothing, and the new-api path unchanged.
