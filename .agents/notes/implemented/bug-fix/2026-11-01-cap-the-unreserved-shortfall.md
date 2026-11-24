# Agent Note: Refuse a request whose unreserved shortfall passes a cap

Status: implemented; the refusal is HTTP 402 with code `insufficient_quota` in an OpenAI-shaped body since [2026-11-24](../feature/2026-11-24-answer-a-balance-refusal-with-402.md)

## Problem

The relay watch kept reporting customers below -$1 after
[reserve what the balance holds](2026-10-28-reserve-what-the-balance-holds.md).
That change admits a request whose balance is positive but below the estimate.
It reserves what the balance holds and charges the rest at settlement, with no
limit on that rest. The logs of the three alerts on 2026-10-31 and 2026-11-01:

- **#526** paid $0.05–0.13 per request on a 260k-token Sonnet context that hit
  the cache. After seven idle hours, one request rewrote the whole prefix
  (263,165 cache-write tokens) for $2.01. The wallet held about $0.39 and ended
  at -$1.62.
- **#543** was at $49.10 of a $50 newcomer plan with wallet overflow and an empty
  wallet. Parallel Fable requests missed the cache: one wrote 352,451 tokens and
  cost $22.37 after reserving $10.96. Another cost $7.26. The wallet took $9.04
  and $1.55, ending at -$10.59.
- **#259** reached -$4.13 the same way and has since topped up.

Claude Code writes its cache with the 1-hour TTL, which costs twice the input
rate (`cache_creation_ratio_1h` 2). The reservation prices prompt tokens at the
input rate times `quota_setting.pre_consume_multiplier`, which production holds
at 1. A full cache miss therefore costs about twice what it reserves, and the
shortfall rule admitted it on balances that held a fraction of even that.

## Decision

- **`quota_setting.max_shortfall_usd`, default $1.** In
  `BillingSession.preConsume`, after both sources have reserved what they can, a
  request whose unreserved part (`estimate - held`) is above the cap is refused
  with `quota.pre_consume_insufficient` (403, `insufficient_user_quota`). The
  reservations are released. At or below the cap it is admitted as before.
- **The same check covers subscriptions.** A nearly spent plan with wallet
  overflow and a small wallet is refused once the two together are short by more
  than the cap. Before, settlement charged the rest to the wallet.
- **The refusal keeps the existing error code**, so `wallet_first` still falls
  back to the subscription and `subscription_first` to the wallet.
- **The console exposes it** in System settings → Billing → Quota, next to the
  pre-consume multiplier. 0 requires full reservation.
- Trusted requests, async tasks, image requests and plans without wallet
  overflow are unchanged: the first reserve nothing by design, and the others
  already reserve in full.

## Alternatives considered

- **Disable the shortfall rule (cap 0).** It brings back the refusal the
  2026-10-28 change fixed: a $2.27 wallet refused for a $3.00 estimate whose
  cache-hit cost was $0.09–0.59.
- **Cap only users who never paid.** It targets free credit, but #543 bought its
  plan, and paid users' debt is still uncollected until they return.
- **Price the estimate as a cache hit.** A miss would then exceed the
  reservation by about forty times, which is the debt this change bounds.

## Consequences

- Debt per request is at most the cap plus what the estimate misses: output
  tokens, and with multiplier 1 the second half of a 1-hour cache write.
- **With multiplier 1 the cap catches only part of these cases.** For #526 the
  estimate was about $1.0, so its $0.61 shortfall stays under the cap and the
  same request would still settle at about -$1.6. Raising
  `pre_consume_multiplier` to 2 makes the reservation cover a full 1-hour cache
  write. #526's shortfall then becomes about $1.6 and is refused. This is an
  operator decision, because it also refuses more parallel requests from
  mid-sized balances. Each Fable request on a 200k context would reserve about
  $12 instead of $6.
- Customers near the end of their balance are asked to top up a little earlier,
  even when the request would have hit the cache.

## Verification

- `go test ./controller -run 'TestPreConsumeShortfallCap|TestPreConsumeShortfallAcrossWalletAndSubscription|TestPreConsumePolicyDatabaseMatrix'`
  passes on SQLite. The new test admits a shortfall equal to the cap, refuses one
  above it, lets a second source close the gap, and refuses a nearly spent plan
  with a small or empty wallet, leaving both sources unchanged. Without the
  `preConsume` check, the two above-cap cases fail. MySQL and PostgreSQL were not
  run: the local Docker could not pull their images.
- `go test ./service/` passes with the proxy environment unset. With it set,
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses` fails on the local proxy's
  host name, the same as on main.
- `bunx vitest run` of `pre-consume-settings.test.tsx` and `src/i18n` passes. It
  covers saving 0 and 2.5, refusing -1, and every locale carrying the new
  strings. `tsc --noEmit` and `bun run lint:check` are clean.
