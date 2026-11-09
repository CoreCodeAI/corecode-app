# Agent Note: Add an upstream tab to site insights

Status: implemented

## Problem

The GPT group has two channels: `engine-gpt` (channel 2, the engine's Codex subscription) and `吱吱鼠渠道` (channel 7, a third-party new-api relay). On 2026-11-09 the subscription answered 503 and 429 for hours. Each check needed ad hoc log queries:

- which channel failed and why;
- how many requests failover moved to the relay;
- what the relay charged for them.

No view split requests by channel, and the relay's bill was visible only in its own console.

## Decision

- **A new `upstream` view and tab** under Operations: `GET /api/site-insights/upstream` (root, `billing:read`).
  - Per channel: requests served, failed attempts, failure rate, requests rescued from another channel, TTFT and duration percentiles, revenue, cost and gross margin.
  - Per model and channel, the same figures. The console compares models served by more than one channel and marks the best channel per figure, among channels with at least 20 attempts.
  - Daily series per channel, the failure messages per channel, and from→to failover counts.
- **Channel figures come from the hour cache.** A new table, `InsightChannelHour`, keyed by hour, channel and model, is filled by `computeInsightHour` beside `InsightModelHour`. Every request is counted on the channel that served it, and every failed attempt on the channel it failed on. `admin_info.use_channel` names the channels a served request tried before. `insightHourVersion` goes from 3 to 4, so stored hours are rebuilt from the logs while the logs last.
- **Upstream cost is read from the upstream with the channel's own key.** A new-api site answers `GET /api/log/token` to a key with that key's latest logs, and `GET /api/status` gives its `quota_per_unit`.
  - `StartUpstreamCostTask` runs every five minutes on the master node and reads each enabled channel whose base URL names a public host. The engine at `http://gpt-load:3001` is skipped.
  - Each billed request goes into `UpstreamCost`, keyed by channel and the upstream's request id, so overlapping reads are stored once. That request id is the `upstream_request_id` of our log for the same request.
  - A channel whose upstream does not answer as new-api is retried after six hours. Costs older than 122 days are pruned.
  - The task reads the key from the database, so the admin key view's security proof is not involved. Adding a new-api upstream needs no further setup.
- **Fixed-cost channels take a monthly fee.** The `UpstreamChannelFees` option maps a channel id to US dollars a month. `PUT /api/site-insights/upstream-fees` (root, `billing:write`) replaces it. A fee is spread a thirtieth of a month per day, and only for a channel whose upstream bill is not read. It is not split by model.

## Alternatives considered

- **A per-channel cost ratio typed by hand**, such as 囤囤鼠's group ratio. The relay changes the group a key bills in: both `GPT特惠` (0.09) and `GPTPRO特惠` (0.15) appeared within a day. A typed ratio goes stale without anyone noticing; the upstream's own log does not.
- **The upstream's `/api/log/self`.** It filters by time and pages, but it needs an account access token for each upstream. `/api/log/token` needs only the channel key. 囤囤鼠 returns the latest 1,000 rows, which covers about 20 hours of current traffic, so a five-minute read misses nothing.
- **Matching each upstream cost to our log by request id.** The view sums costs by channel, model and day instead. A key used outside this site would be billed here too; the channel's key is dedicated, so the simpler sum holds.

## Consequences

- After the release, every stored hour is of the old version. Views compute missing hours on demand, and the rollup refills up to 200 hours every ten minutes. The first loads of a long range are slower until the 92 days are back.
- Upstream cost starts at the first read, plus whatever history the upstream's 1,000-row window still holds. Earlier ranges show revenue without cost.
- A channel's failure rate counts attempts, so a request that failed on one channel and was served by another is a failure on the first channel and a success on the second. The headline failure rate is per attempt, not per request.

## Verification

- `go test ./model -run 'TestUpstreamInsightsDatabaseMatrix|TestSiteInsightsDatabaseMatrix|TestInsightHourSpansHours|TestCapacitySplitsByVendor'` passed on SQLite 3.50.4, MySQL 5.7.44 and PostgreSQL 9.6.24. The upstream test also passed on MySQL 8.0 and PostgreSQL 15. It covers the failover rescue count, root's revenue left out, dedup of upstream costs, fee proration, cost source per channel, model rows, daily totals, and stored hours reading back the same figures. A MySQL database must be utf8mb4: a latin1 one rejects the upstream's Chinese group names.
- With SQLite only, as CI runs them, `go test ./model ./controller ./router ./middleware` passed. `./service` had the same single failure as `origin/main` (`TestUpstreamAddressesMaskOnlyConfiguredAddresses`).
- A throwaway test ran `syncUpstreamChannel` against `https://usdj.zzshu.cc` with channel 7's key:
  - The first read stored 976 requests, with `quota_per_unit` 500000 and group `GPT特惠` at 0.09.
  - A second read stored only the 1 new request.
  - An invalid key returned 401.
- Console: `bun run format:check`, `lint:check`, `typecheck`, `build`, and `vitest run src/features/site-insights` passed (124 tests). The full vitest run had the same single failure as `origin/main` (`models/__tests__/metadata-editing.test.tsx`).
- A local server with channel 7's real key and two days of seeded logs showed the tab at 1440 px and 390 px, with no horizontal overflow. Hover at 23 points across each of the three charts read out a value at every point. A tap on each bar opened its tooltip. Saving a $300 monthly fee for channel 2 stored `{"2":300}` and showed $70.00 over seven days.
