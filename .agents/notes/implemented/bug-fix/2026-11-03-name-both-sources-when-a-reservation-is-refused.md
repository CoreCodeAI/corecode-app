# Agent Note: Name both sources when neither can hold a reservation

Status: implemented

## Problem

On 2026-11-03 a customer on `subscription_first` with an empty wallet had
$0.003 left on a gift plan. A Claude Opus request needed a $3.05 reservation,
which the plan could not cover, and the empty wallet could not cover it either.
The client received
`Insufficient user quota, remaining quota: $0.000000`. Magpie reported the
quota as exhausted and fell back to another model, and the customer filed a
billing bug: the console had shown plan credit the whole time. The refusal
named only the wallet, so it read as if the plan were empty too.

A `wallet_first` user in the same position got the plan's raw model error,
`subscription quota insufficient, need=1500`, in quota units.

## Decision

- `preConsumeUserSubscription` now returns `SubscriptionQuotaInsufficientError`,
  which carries the amount needed and the most any single active subscription
  has left. A reservation draws from one subscription, so the largest
  remainder, not the sum, is what bounds it. The error text is unchanged,
  because `fundingError` still matches on it.
- `fundingError` keeps that error behind the localized message, so callers can
  still read the amounts through `errors.As`.
- When the second source also refuses, `NewBillingSession` returns
  `quota.subscription_and_wallet_insufficient` on both fallback paths
  (`subscription_first` with wallet overflow, and `wallet_first`). The message
  states the reservation, the subscription's remainder and the wallet balance,
  and says that the request is charged its actual usage, since the reservation
  includes the pre-consume multiplier. The error code and status stay
  `insufficient_user_quota` and 403.

## Alternatives considered

- **Query the subscription remainder again at the fallback.** That adds a read,
  and the answer could differ from the figure the refusal was based on.
- **Report the sum of all subscriptions.** With two plans of $5 each, a $8
  request is refused while the message would say $10 is left.

## Consequences

- Refusals that carry no amounts (no active subscription, a database error)
  keep their old messages.
- Clients that match the old English text no longer match when both sources
  refuse; the error code is the stable field.
