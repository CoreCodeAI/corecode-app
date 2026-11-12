# Agent Note: A daily quota on an API key

Status: implemented

Partly superseded by [`2026-11-12-daily-quota-without-a-total.md`](2026-11-12-daily-quota-without-a-total.md):
an unlimited key may now have a daily cap, so the API no longer stores 0 for it.

## Problem

An API key had either unlimited quota or a total that never refills. A company account
that hands one key to each employee wants each key to stop for the day after a set
spend, and start again the next day, without the administrator topping keys up by hand.
The day follows Beijing time, where the customers are.

## Decision

- **`tokens.daily_quota`** is the cap in quota units. 0 means no daily cap, and the API
  stores 0 for a negative value and for an unlimited key. A cap above the largest token
  quota is rejected. The create and update requests read it through a pointer, like
  `allow_user_quota_query`, so an update from a console released before the field keeps
  the stored cap.
- **Today's use is counted on the token row.** `daily_used_quota` holds the use of the
  Beijing day that ends at `daily_used_until`. Every write of the token's remaining and
  used totals goes through `tokenQuotaUpdates`, which adds the same delta to today's
  use, or starts it over when `daily_used_until` belongs to an earlier day. That covers
  reservation, settlement, refunds, task billing and the batch flush, which all end in
  `increaseTokenQuota`, `decreaseTokenQuota`, `persistTokenQuotaDelta` or
  `reserveTokenQuotaDB`.
- **The day is a fixed UTC+8 zone,** so it needs no tzdata in the image and does not
  follow the server's `TZ=UTC`.
- **`TokenDailyQuota` admits a request while today's use is below the cap.** It runs
  on the routes that spend quota, beside `ModelRequestRateLimit`: `/v1` relay,
  `/v1beta`, video generation and remix, task submission, and the task plugin create
  endpoints. Listing models and reading a task or its artifacts stay open, so a video
  paid for before the cap can still be fetched. Token auth puts the cap in the context
  as `token_daily_quota`. A rejected request gets 403, not 429, because Claude Code
  retries a 429 and the cap lifts only at midnight. Today's use is read from the
  database for capped keys only; the Redis token cache carries the cap but never the
  use.
- **The console** shows a daily quota field under the total quota when unlimited quota
  is off, and the key's quota detail shows today's use against the cap.

## Alternatives considered

- **Reserve against the daily cap,** like the total quota. That needs the cap and
  today's use in the Redis reservation script, its compensation path and the batch
  store. Admission against settled use is much smaller. Its cost is overshoot: requests
  admitted before the cap is reached may end the day above it.
- **Sum today's consume logs on each request.** The logs can live in another database,
  and the sum grows with traffic; a counter on the row is one primary-key read.
- **A table of daily rows per token.** It keeps history, but nothing reads that history,
  and it adds a second write to every quota change.

## Consequences

- Overshoot is bounded by the requests a key has in flight when it reaches the cap:
  with a per-key concurrency cap of 10, at most 10 requests' cost.
- With batch updates on, today's use lags by the batch interval, and use near midnight
  can be counted on the day the batch is written.
- A refund after midnight of a reservation made before it lowers the new day's use, at
  most to zero.
- `daily_used_quota` must sort before `daily_used_until`. GORM writes map columns in
  name order and MySQL evaluates SET left to right, so the CASE must run before the day
  changes. `TestTokenQuotaUpdatesAssignTodaysUseBeforeItsDay` fails if a rename breaks
  that.
- The Responses WebSocket route (`GET /v1/responses`) and Midjourney routes are not
  capped. The first is registered before the request limiters, like the concurrency
  limit; the second mixes submit and fetch routes under one group, and the relay has no
  Midjourney channel.
- During a release, the old and new servers disagree on a cached token's MAC, because
  the new one covers `DailyQuota`. Each rewrites the hash and the other reads the
  database, until the old server stops.

## Verification

Run on 2026-11-12 in a worktree at `feat/enterprise-account-limits`.

- `go vet ./...` is clean, and `go test ./common/... ./controller/... ./middleware/...
  ./model/... ./service/... ./setting/... ./i18n/...` passes.
- `TestTokenQuotaUpdatesTrackTodaysUseAcrossDatabases` passes on SQLite and on a local
  PostgreSQL 18; MySQL was not available, and the SQL-order test covers its one
  difference. It checks a charge, a same-day refund, the reset on the next Beijing day,
  a refund larger than the day's use, and a refund on a later day.
- `TestTokenDailyUsedFollowsQuotaWrites` drives reservation, refund and charge through
  the public functions. `TestTokenCacheCarriesDailyQuota` (miniredis) checks the cache
  carries the cap and a hash without it fails verification.
- `TestTokenDailyQuota` sets the token up through `SetupContextForToken` and checks
  admission below the cap, 403 at it, no cap for an unlimited key, and that
  yesterday's use does not count. `go test ./router/...` passes; which routes carry the
  middleware was checked by reading the router, not by a test.
- `TestTokenDailyQuotaOnCreateAndUpdate` covers create, omitted field on update,
  negative and zero values, unlimited keys and the upper bound.
- Console: `bun run typecheck`, `bunx vitest run src/features/keys
  src/features/usage-logs` (680 tests), `bun run lint:check`, `bun run format:check`
  and `bun run first-load:check` pass. `/keys` is 609.1 KB of 610 KB locally against
  608.9 KB for main in CI.
