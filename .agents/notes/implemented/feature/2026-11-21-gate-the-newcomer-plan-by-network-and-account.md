# Agent Note: Gate the newcomer plan by network and account, and spare free plans

Status: implemented. Refines [gate the newcomer plan when a request is
billed](2026-11-21-gate-the-newcomer-plan-at-billing-time.md).

## Problem

Three weaknesses of the per-address gate, found on 2026-11-21 within hours of its release:

1. **It gated a free gift.** Plan 3 (free, `affiliate_gift`, `max_purchase_per_user=1`)
   counted as a "newcomer plan": nine accounts, 114-141 requests, about $20 were gated,
   and gift holders counted towards the threshold for paying customers.
2. **A rotating studio never reaches the threshold.** A second studio bought plan 2 on
   seven accounts and sent their requests from 103.135.100.0/24, moving between
   .158 and .180-.192. No single address carried three other holders.
3. **A caught account walks away.** korbingo was moved to 119.246.95.21, an address nobody
   else used, and kept drawing on the plan.

## Decision

All four options are `limited_plan_use_setting.*` options (`setting/operation_setting`):

| Option | Default | Effect |
|---|---|---|
| `exclude_free_plans` | true | A plan with `price_amount <= 0`, or a subscription with `source = affiliate_gift`, neither counts its holder nor is gated. No plan id is named. |
| `network_enabled` | true | Count holders per IPv4 /24 (IPv6 /64) as well as per address; either triggers. |
| `network_threshold` | 4 | Other holders in the network. Separate from `threshold` (3, per address). |
| `sticky_days` | 7 | An account that sent a request from a gated address or network stays gated from every address for this long. 0 turns it off. |

**Network.** `limitedPlanScopeOf` takes an address or a network key and caches the holders
for 60 seconds with `singleflight`, as before. A /24 is read with `ip IN (256 addresses)`
on `idx_logs_ip`; an IPv6 /64 with `ip LIKE 'a:b:c:d:%'`. `isSharedExit` is evaluated per
scope, so a campus or proxy block with five or more bystanders, no fewer than the holders,
is not a farm. A free-plan holder is an ordinary account for that test.

**Sticky.** `limitedPlanMarkSticky` writes the mark when a request triggers (Redis key
`limited_plan_gate:sticky:<user>` with a TTL of the sticky days; the process when Redis is
off, so each server then marks for itself). A request that triggers nothing reads the mark;
without one it looks at the addresses of the account's last 200 consume requests inside the
sticky window and gates when any triggers now, caching a clear answer for 300 seconds. So a
restart, a second server, or a lost key recomputes the mark from the logs, and old use ages
out of the window. An exempt account (`subscription_address_exemptions`) is never gated, marked or not.
`LimitedPlanGate.Scope` is `address`, `network` or `sticky`; the admin log carries it as
`limited_plan_ip_gate_scope`.

Not changed: the funding behaviour of a gated request (other plan, wallet, refusal), the
exemption table, `limited_plan_address_setting`.

## Replay on production data (read-only, 2026-11-21)

The real `checkLimitedPlanGateAt` ran against a local SQLite load of the last 44 days of
production (3,257 subscriptions, 675,618 log rows, 16,781 per-hour consume buckets; the 30 days before the window warm the holder counts), each
request judged as of its hour, with the holders counted from the logs before it. Requests
billed to a plan, last 14 days:

| Rule | Gated accounts | Requests | Plan-billed |
|---|---|---|---|
| live rule (per address, free plans counted) | 76 | 22,177 | $2,278 |
| + exclude free plans | 58 | 21,578 | $2,121 |
| + network, threshold 4 | 76 | 25,021 | $2,680 |
| + sticky 7 days (new) | 78 | 30,887 | $2,843 |

The final rule, by group:

| Group | Accounts | Requests | Quota | Plan-billed |
|---|---|---|---|---|
| 1: 117.150.5.21 | 38 | 18,832 | $2,748 | $1,612 |
| 2: 103.135.100.0/24 named accounts | 6 of 7 | 1,513 | $276 | $259 |
| other | 34 | 10,542 | $2,391 | $972 |

- **Group 2.** 4219, 4274, 4523, 4534, 4554 and 4627 are gated, 4627 (korbingo) also from
  119.246.95.21 by the sticky mark. 3599 is not: its plan ended on 11-19 and its requests
  came before the /24 carried four holders. The /24 also gated eight accounts the owner had
  not listed (3995, 4004, 4052, 4291, 4373, 4383, 4391, 4498), all plan 2 with the same
  $40-$50 burn-down.
- **Other.** 27 of the 34 show the studio's pattern: plan 2 bought and spent ($37-$52 of
  a $50 plan, 100-450 requests) on a block shared with three or more holders (95.169.0.32,
  220.167.91.216, 188.253.121.0/24, 185.220.236.0/24, 119.130.130.69, 173.224.219.41).
  Three are heavy paying customers with the plan already spent, so the gate costs
  them nothing: 3576 (1,802 requests, $538), 4026 (3,426, $646), 3926 (205, $78).
  Four do not fit and are the candidate false positives: 926, 2618, 4185 (one request,
  $0.01) and 4556. Offer them to the owner as exemptions.
- **Exemptions.** With `subscription_address_exemptions` ignored, the old rule gates the
  three paying accounts (79 accounts then) the owner exempted by hand (3244, 4088, 4166); with free plans
  excluded none of the three is gated, so the exemption is no longer needed for them.
- **Threshold choice.** Network threshold 3 adds 13 accounts and $359 of plan spend;
  5 loses 7 and 6 loses 10 of the 78. 4 stays.

## Cost

The /24 lookup, once per network per 60 seconds, on production with `EXPLAIN (ANALYZE)`:
17 ms for 103.135.100.0/24, 22 ms for the busiest /24 of the day (122.234.49.0/24),
54 ms for 117.150.5.0/24 (23,500 rows in 30 days), always through `idx_logs_ip`. A single
address stays 0.07 ms. The cached path adds map lookups to the per-request read of the
customer's subscriptions: 14-20 microseconds per call on in-memory SQLite, including that read.
The sticky lookback reads the last 200 requests of an account only when it holds a plan, was not
triggered by its own address, and was not looked at in the last 300 seconds.

## Consequences

- An IPv6 /64 is matched on the written form of the address, so a /64 whose fourth group
  is zero, which the compressed form writes as `::`, is not matched. IPv4 is unaffected.
- A customer who shared a gated address once, even a paying one with a spent plan, is
  gated for seven days from every address. The cost is one request billed to the balance,
  or the refusal text, and an exemption lifts it.
- Without Redis each server marks separately; the log lookback makes them converge within
  five minutes. Production runs with Redis.
- Free-plan holders count as bystanders in `isSharedExit`, so a farm that also took the
  free gift needs more paid accounts than five-and-fewer-than-bystanders to look like a farm.

## Verification

Tests cover free plans (price zero, gift source, the switch), the network (threshold,
switch, address priority, shared exit by network, IPv6 /64, `LimitedPlanNetworkOf`), the
sticky mark (from the logs, account scope, exemption, expiry, switch off, Redis through
miniredis with its TTL), the log scope marker, and billing end to end (a rotating studio is
refused, the moved account stays refused, a clean holder is served). The database tests run
on SQLite, MySQL 8.4 and PostgreSQL 16.
