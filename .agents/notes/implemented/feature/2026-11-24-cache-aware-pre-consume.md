# Agent Note: Pre-consume Claude requests on the cache price when the balance is tight

Status: implemented

## Problem

User #3188 ran Claude Code on opus-5-5 with an 800k-token context that was almost all cache
reads. One request cost $0.405 in the end, yet the pre-consume held $13.75 (every input token at
the full rate) and refunded $13.34 afterwards. With $5.68 in the wallet the request got a 402,
though the balance covered a dozen real requests.

## Decision

- **Only when the old rule refuses.** `PreConsumeBilling` first runs the existing funding
  decision. When the balance covers the full estimate, nothing changes. Only a 402
  (`ErrorCodeInsufficientUserQuota`) from that decision starts the cache-aware retry.
- **Session and cache life.** The session key is the channel affinity key the client sends
  (Claude Code's `metadata.user_id`) + user + model. After a request settles, its start time and
  cache read + write tokens are kept in a `cachex.HybridCache` (in-process LRU, Redis when
  enabled, entry TTL 1h). Never the database. The next request counts the cache as alive when
  the gap is at most 90 % of the effective TTL: 1h by default, 5m when the client sends
  `X-CoreCode-Cache-TTL: 5m` or the previous request was billed 5m writes only.
- **Estimate.** Input up to the previous request's cache is priced at cache read, the rest at
  the 1h or 5m write price, as the settlement prices them (tiered expression or legacy ratios),
  times `CacheAwarePreConsumeMargin` = 1.5. The result never exceeds the full estimate.
- **Admission.** The cache estimate must fit the balance, with the shortfall cap set to 0 for
  this retry. The reservation is scaled to the cache estimate in `BillingSession.reserve`, also
  after the channel is selected and the tiered price is recomputed.
- **Overspend.** Settlement is unchanged and charges the actual usage, so the wallet can go
  negative for that one order. The next request is refused by the ordinary rule. A subscription
  funding source is eligible only with `allow_wallet_overflow`, because without it the excess
  could not be collected. `subscription_only` and wallet-only refusals stay as before.
- **Wallet-only early refusal.** A wallet refund updates the Redis balance cache
  asynchronously. `preConsume` therefore refuses a wallet-only request before it reserves when
  the full estimate does not fit, so a refused try never leaves a stale balance that the retry
  would read.
- **Switch.** Option `billing.cache_aware_pre_consume_enabled`, default true. Off means the
  old behavior, since the retry is never attempted.
- **Observability.** `logs.other.admin_info` gets `pre_consume_mode: "cache_aware"`,
  `cache_aware_gap_seconds`, `cache_aware_ttl_seconds`, `cache_aware_full_quota`,
  `cache_aware_quota` and, when the actual cost exceeds the reservation, `overdraft`. One INFO
  line per admitted request.

## Limits

- No output term, as in the existing estimate.
- The gap is measured between request start times, which is more conservative than completion
  times.
- Inactive when channel affinity is disabled or no rule reads a key from the request.
- Token-quota failures (`PreConsumeTokenQuotaFailed`) are not retried.
- Per-request price models and models without a cache price are left on the full estimate.
- A failed retry returns the original 402 message.

## Replay (7 days of production Claude consume logs, read-only)

187,289 consume rows, 182,840 with legacy ratios (4,449 tiered or unpriced rows skipped), 375
users. 402s are not logged, so each request was judged as if its user held a hypothetical
balance B and the old rule refused it when the full estimate exceeded B by more than $1.
Request time order, previous request of the same (user, affinity key, model) taken from the
logs.

| B | refused by old rule | admitted | cache missed (hit < 0.5) | p99 overdraft | max overdraft |
|---|---|---|---|---|---|
| $1 | 84,834 | 74,299 (87.6 %) | 175 (0.2 %) | $0.60 | $44.58 |
| $5 | 14,962 | 13,952 (93.2 %) | 36 (0.3 %) | $1.10 | $44.58 |
| $10 | 2,784 | 2,568 (92.2 %) | 12 (0.5 %) | $1.65 | $44.58 |
| $20 | 502 | 455 (90.6 %) | 1 (0.2 %) | $1.62 | $44.58 |

Among requests of 300k tokens or more, the cache missed on 0.2 % (146 of 67,001) when the
previous request was inside the lifetime, and on 89.6 % (575 of 642) when it was not. The
lifetime check is what separates them.

## Worst case

One admitted order can cost its full uncached price while reserving only the cache estimate.
Replay maximum: $45.43 actual against $0.85 reserved (overdraft $44.58). Largest request in
the window was 998,093 tokens: $49.11 of input at the 1h write price, plus output. Observed
maximum cost of any 300k+ request: $54.70. So one order overdraws by roughly $55 at most, and
the next request is refused. Concurrent requests of one user each reserve atomically against the
wallet, but each may overdraw, so the bound is about $55 times the user's concurrency.
