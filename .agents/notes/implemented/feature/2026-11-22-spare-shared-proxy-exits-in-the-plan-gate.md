# Agent Note: Spare shared proxy exits in the newcomer plan gate

Status: implemented. Refines [gate the newcomer plan by network and
account](2026-11-21-gate-the-newcomer-plan-by-network-and-account.md).

## Problem

On 2026-11-22 feedback #52: a customer who registered at 00:28, bought the newcomer plan and
topped up $10 had all 92 requests moved from the plan to the wallet
(`limited_plan_ip_gate=wallet`, `_scope=network`, `_holders=7`). Their address 185.220.236.155
belongs to a commercial proxy block (Akari Networks, Taipei). The block's 30-day record held
nine plan holders by request, five of them accounts that look like one studio (random names,
no top-up, two of them rotating over 7-9 addresses), and six accounts without a plan. `isSharedExit`
needs five bystanders **and** at least as many bystanders as holders, so the block counted as
a farm and the real customer was caught with it.

An automatic rule that reads how the holders move does not separate the two: the five accounts
rotate through the block exactly like the studio of 103.135.100.0/24 that the gate must keep
refusing.

## Decision

1. **`limited_plan_use_setting.shared_exit_networks`**, an option an administrator edits
   (`PUT /api/option/`): CIDRs separated by commas, spaces or newlines, default
   `185.220.236.0/24`. A request from a listed block is not counted per network. The address
   is still counted, so three other holders on one listed address still gate it. A bare address
   or an IPv6 prefix is accepted; an entry that does not parse is ignored. An empty value lists
   nothing. Listing a block does not exempt a customer already marked sticky; an exemption does.
2. **A traffic test in `sharedExit`**, next to the bystander count: the accounts without a
   plan that used the scope spent at least $20 through it in 30 days, and at least half of what
   its holders spent. A proxy block that sells to the public carries customers who pay for what
   they use; a studio's block carries what its accounts burn and nothing else. Money, not request
   count, so that faking it costs real balance.
3. **A marker for a spared scope**: `admin_info.limited_plan_ip_gate_exit` is `listed`, `crowd`
   (the old bystander count), `traffic`, or `unread` (a lookup failed and the request was let
   through). It is written on a request of a plan holder whose address or network carried enough
   holders to gate it and was spared, whether or not another scope gates the request, so a
   customer who stays on their plan from a proxy can be explained from the log. Customers do not
   see it.

`CheckLimitedPlanVerdict` returns the gate and the marker; `CheckLimitedPlanGate` still returns
the gate alone.

Not changed: the purchase-time checks (`checkLimitedPlanAddressFarm`, the strict address
check), the funding behaviour of a gated request, the sticky mark, the exemption table.

## Evidence

Spend per block over the 30 days ending 2026-11-22, accounts with a plan against accounts
without one, from production (`logs.quota`, consume rows):

| Block | Holders | Holders spent | Without a plan | Spent | Share |
|---|---|---|---|---|---|
| 185.220.236.0/24 (proxy) | 12 | $286 | 9 | $249 | 0.87 |
| 103.135.100.0/24 (studio 2) | 22 | $564 | 6 | $6.5 | 0.01 |
| 117.150.5.0/24 (studio 1) | 44 | $3,501 | 0 | $0 | 0 |
| 188.253.121.0/24 | 9 | $350 | 5 | $2.2 | 0.01 |
| 202.214.238.0/24 | 6 | $390 | 5 | $2.1 | 0.01 |
| 216.195.192.0/24 | 8 | $205 | 3 | $0 | 0 |
| 141.11.46.0/24, 38.181.82.0/24, 95.169.0.0/24, 220.167.91.0/24, 119.130.130.0/24 | 5-6 | $122-$469 | 0-4 | $0 | 0 |
| 173.224.219.0/24 | 4 | $122 | 3 | $10.5 | 0.09 |

The proxy is at 0.87 and the nearest studio at 0.09; the threshold of 0.5 and the $20 floor sit
in the gap.

Replay: the real `checkLimitedPlanVerdictAt` against a local SQLite load of the last 44 days
of production (3,306 subscriptions, 918,378 log rows, 21,734 hourly consume buckets), every
bucket judged as of its hour, exemptions ignored, requests of the last 14 days:

| Group | Before: accounts / requests / plan-billed | After |
|---|---|---|
| 117.150.5.21 studio | 36 / 17,703 / $1,527 | 36 / 17,703 / $1,527 |
| 103.135.100.0/24 studio | 14 / 2,656 / $450 | 14 / 2,656 / $450 |
| 185.220.236.0/24 | 3 / 538 / $77 | 0 |
| other | 24 / 9,361 / $704 | 24 / 9,361 / $704 |

Three accounts are released, all in 185.220.236.0/24: 4687 (92 requests, the reporter), 3773
(193) and 3976 (253), the last two members of the five-account group. The traffic test alone
and the list alone release the same three. Every other gated account keeps its requests. The
four accounts the live gate has gated since it shipped (4262, 3576, 2618, 4687) stay gated
except 4687.

Cost of the traffic query on production, `EXPLAIN ANALYZE` through `idx_logs_ip`: 7 ms for
185.220.236.0/24, 10 ms for 103.135.100.0/24, 45 ms for 117.150.5.0/24; once per scope per 60
seconds, and only when the holders already reach the threshold and the bystander count did not
spare the scope.

## Consequences

- A studio that sits behind a listed block, or that spends on non-plan accounts at half of what
  its holders burn, keeps the plan there. The five accounts of 185.220.236.0/24 now pass; they
  carry a remark for follow-up and are not banned or charged.
- The traffic test is a heuristic. A studio could pay to mimic a proxy: $20 at least, and half
  of what its holders spend, against a $50 plan per holder.
- A customer already marked sticky stays gated for up to seven days from every address; the
  listing does not clear a mark. 4687 is exempted by hand.
- The purchase-time farm check is not changed by the list.

## Verification

Model tests (SQLite, MySQL and PostgreSQL in CI): the list (hit, miss, neighbouring block,
address still counted, nothing spared when nobody else holds, removal), the traffic test (under
the floor, under half, at half, one address, error logs do not count), the crowd marker, and the
option's parser (separators, bare address, IPv6, mapped IPv4, invalid entries, a changed
option). A service test bills a holder from a listed block, then reads the log marker.
