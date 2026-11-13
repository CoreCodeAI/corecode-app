# Agent Note: Show a plan's balance without the quota running requests hold

Status: implemented

## Problem

On 2026-11-13 ticket #3338 asked why a balance moved between $20-something and
$30. The customer ran Claude Code on a $50 plan: a 270k-token context, a
request every 5 to 20 seconds, three or four in flight at once.

A subscription request reserves its estimate when it starts. For that context
the estimate is about $4.20 (`subscription_pre_consumed` 2.1M), and the request
settles for $0.10 to $0.20. The reservation sits in `amount_used` until then, so
`/api/subscription/self` reported a balance lower by roughly $4 per request
still running. The log rows of one minute show `subscription_used` at 9.4M,
12.4M and 10.2M. The charges were right; the number shown was not stable.

## Decision

- **A reservation is `reserved` until its request settles, then `consumed`.**
  `SubscriptionPreConsumeRecord.Status` already held `consumed` or `refunded`,
  and `consumed` was written when the reservation was made. It is now written
  when `BillingSession.Settle` finishes. Rows written before this change are
  `consumed`, so none of them counts as in flight. A server of the previous
  release running beside this one during a blue/green release writes
  `consumed` and is simply not counted.
- **`/api/subscription/self` subtracts the reservations of running requests from
  `amount_used`.** The stored subscription is untouched; only the customer's
  response changes, floored at zero. The console already sums
  `amount_total - amount_used`, so it needs no release and its first-load
  budget is unchanged. The admin subscription endpoints still show the stored
  value.
- **A reservation counts as in flight for 15 minutes.** A request that died
  without settling or refunding keeps its quota reserved on the plan, and must
  not lift the displayed balance forever.

## Not changed

- The reservation size and `pre_consume_multiplier`: a 1-hour cache rewrite costs
  twice the input rate, and lowering either brings back negative balances.
- The wallet's own balance. A wallet request also holds its estimate until it
  settles, and `/api/user/self` still shows the swing. The customer in the
  ticket had an empty wallet.
- The displayed balance excludes what a running request will really charge, so it
  reads high by that amount, about $0.15 per request, until the request settles.

## Checks

- `model.TestSubscriptionInFlightReservationsDatabaseMatrix` covers reserved,
  settled, refunded, another subscription, another user, a reservation past the
  window, the zero floor, and that the stored row is not modified.
