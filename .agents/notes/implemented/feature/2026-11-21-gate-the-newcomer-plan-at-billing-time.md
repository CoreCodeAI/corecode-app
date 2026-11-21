# Agent Note: Gate the newcomer plan when a request is billed

Status: implemented

## Problem

The purchase check (`CheckSubscriptionPurchaseFrom`, `checkLimitedPlanAddressFarm`) sees
the address an order comes from. A studio defeats it: on 2026-11-21, 44 accounts of one
studio each registered, bought the newcomer plan through a different proxy for every
order, sent no request, and two to ten minutes later sent all their requests from
117.150.5.21. The address that gives them away appears only in the request, so only
billing can act on it.

## Decision

`NewBillingSession` asks `model.CheckLimitedPlanGate(userId, clientIp)` before it picks a
funding source. A "newcomer plan" is any plan with `max_purchase_per_user > 0` (plans 1,
2 and 3). The gate returns a verdict only for a customer who holds an active such
subscription, and then only when:

- at least `limited_plan_use_setting.threshold` (default 3) *other* accounts sent a
  request from the address in the last 30 days and hold, or held, such a plan not given
  by an administrator;
- the address is not a shared exit (below);
- the customer is not exempt (`subscriptionAddressExempt`).

A gated request leaves the customer's newcomer subscriptions out of the reservation
(`PreConsumeUserSubscriptionExcept`, `SubscriptionFunding.except`):

- another plan the customer holds pays it, logged as `other_plan`;
- otherwise the wallet pays it, whatever the billing preference, logged as `wallet`;
- otherwise the request is refused with `quota.limited_plan_gate` (403,
  `insufficient_user_quota`, skip retry), logged as `refused`.

The plan itself is untouched: the same customer on another address still draws on it.

`limited_plan_use_setting.enabled` defaults to true and `.threshold` to 3; both are
options, independent of `limited_plan_address_setting`. With the switch off, billing is
the old path: the gate is never consulted.

**Logs.** The admin log carries `limited_plan_ip_gate` (`wallet`, `refused`,
`other_plan`) and `limited_plan_ip_gate_holders`; the customer's log carries
`limited_plan_gate`, which the usage-log details show as "billed to balance (newcomer plan
network limit)". A refusal is an error log, which production records
(`ERROR_LOG_ENABLED=true`).

**Shared exits.** `sharedExit` (many requesters in a week) would exempt the studio, whose
forty accounts all send requests. The gate counts bystanders instead: accounts that used
the address by request, sign-in or order and hold no newcomer plan. Five or more, and no
fewer than the holders, make an exit. 117.150.5.21 had 44 holders and 0 bystanders.

**Cost.** Per request, one indexed read of the customer's active newcomer subscriptions
(0.06 ms on production, nothing found for customers without one). Per address and per 60
seconds, one lookup of the holders, shared by concurrent requests (`singleflight`) and
cached in the process: the heaviest address on production (24k rows in 30 days)
takes 100-130 ms through `idx_logs_ip`, so no index was added. Only customers who hold a
newcomer plan ever trigger it. A failed lookup lets the request through.

## Replay on production data (read-only, 2026-11-21)

Requests billed to plans 1, 2 and 3 over the last 14 days: 128,695 from 1,026 accounts.
Each request counted only the holders who had sent a request from its address before it.

- **117.150.5.21:** 13,076 of 13,076 requests would be gated, 38 accounts, $1,743.13 of
  plan spend. Over 30 days, 14,158 of 15,146 requests, 41 of 44 accounts: the first three
  holders' early requests pass.
- **Other addresses at threshold 3, shared exits excluded:** 3,033 requests from 34-36
  accounts, $761. Of those, plan 1 and 2: 2,892 requests, 25 accounts, $741. Most have
  the studio's pattern: the plan ran out ($37-$60 used), one top-up, no balance, on
  addresses with 4-10 holders and 0-4 bystanders, and the same accounts appear on several
  addresses of one proxy range (67.159.48.x, 103.135.100.x). Three do not fit:
  oidc_4088 and oidc_3244 are paying customers (4-5 top-ups, $100+ used, a balance)
  and oidc_4166 used $18. They sit on proxy ranges the studio accounts share, and would
  pay those requests from the balance.
- **Plan 3 (inviter gift):** 141 requests, 11 accounts, $20. Their addresses carry 4-11
  holders and 1-5 bystanders, which looks like gift farming through proxies, but is
  not proof. Two of the nine listed hold a balance and would pay it; seven have none and
  would see the refusal.
- **Threshold sensitivity** (other addresses): 4 gives 1,456 requests and 18 accounts, 5
  gives 490 and 6, 6 gives 274 and 2, 7 gives none. The plan 3 share falls first: 141,
  40, 6, 0.
- **oidc_1314:** its only newcomer plan (subscription 1027) expired on 2026-11-13. All 5,420
  requests of the last 14 days were billed to the wallet, so nothing changes for it, and
  the gate never runs for a customer without an active newcomer plan.

Threshold 3 stays the default: the plan 1 and 2 accounts it catches outside 117.150.5.21 are
the same pattern, and the cost of a false positive is one request billed to the balance.

## Consequences

- A real customer behind an address that also carries three studio accounts, such as a
  shared proxy, pays those requests from the balance, or is refused with a message that
  names the way out (top up, or ask support). The administrator exempts such an
  account on the same screen that exempts a purchase.
- The holders of an address are remembered for 60 seconds, so a studio's fourth account
  is gated within a minute of the third one's first request, not instantly.
- A raised threshold is a trade: 4 keeps 13 of the 25 plan 1 and 2 accounts gated.

## Verification

Tests cover the verdict (below, at and above the threshold; administrator grants; expired
plans; exemption; shared exit; the 30-day window; the cache; the switch), the reservation
that leaves a subscription out, and billing: below the threshold the plan pays, above it
the wallet pays, with no balance the request is refused with a translated 403 that is not
retried, and with the switch off billing is the old path. The database tests run on
SQLite, MySQL 8 and PostgreSQL 16.
