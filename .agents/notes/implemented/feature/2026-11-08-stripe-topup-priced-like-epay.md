# Agent Note: Take top-ups through Stripe, priced like epay

Status: implemented

## Problem

The operators want customers to pay by card, Alipay or WeChat Pay through
their Stripe account, as one more wallet method under the epay ones. Epay
stays.

new-api's Stripe gateway does not fit CoreCode's orders. It charges a
dashboard Price (`StripePriceId`) times the amount and records
`amount × top-up group ratio` as `money`, so `money` is not the CNY epay price
the top-up report, paid-total concurrency tiers and invite commission read.
It also skips the top-up bonus, which the wallet advertises (11–18% on
2026-11-08) and epay and NOWPayments orders earn. An administrator completing
a Stripe order credited `money`, not `amount`.

## Decision

- **A Stripe order is priced like an epay order.** `RequestStripePay` uses
  `getPayMoney` (Price, top-up group ratio, `amount_discount`), stores that CNY
  figure as `money`, and fixes `bonus_quota` at order time. The Checkout
  Session has one line item with inline `price_data`: CNY, `money` in fen,
  quantity 1. `RequestStripeAmount` quotes the same figure.
- **No dashboard Price.** `isStripeTopUpEnabled` needs only the API secret and
  the webhook secret. `StripePriceId` and `StripeUnitPrice` no longer affect
  top-ups; a subscription plan still carries its own `stripe_price_id`.
- **Completion shares epay's transaction.** The webhook calls
  `RechargeStripe`, which goes through `completeOnlineTopUp`: row lock,
  provider check, `amount` plus `bonus_quota` credited once, and the Stripe
  customer saved on the user for the next checkout. Upstream's `Recharge` is
  gone. `ManualCompleteTopUp` credits every online order the same way.
- **Stripe chooses the methods.** The session sets no
  `payment_method_types`, so Checkout offers the methods the dashboard enables
  that support CNY and the order's amount. Cards, Alipay and WeChat Pay are
  enabled there; on 2026-11-08 Alipay and WeChat Pay awaited Stripe's
  approval.
- **The minimum is at least epay's.** `getStripeMinTopup` is the larger of
  `StripeMinTopUp` and `MinTopUp`; Alipay and WeChat Pay need HKD 4 or more
  on this account.
- **One order stays capped at 10000**, as upstream had it, to bound what a
  stolen card buys in one checkout. Epay has no such cap.
- **The console counts Stripe as bonus-eligible.** It was in
  `NO_BONUS_PAYMENT_TYPES`; the confirm dialog now lists the bonus for it.

## Alternatives considered

- **Keep upstream's gateway with a ¥1 Price.** No code change, and with
  `Price` = 1 `money` would happen to be CNY, but Stripe top-ups would earn no
  bonus while the wallet advertises one, and a discount or group ratio would
  charge a different amount from the one quoted.
- **One wallet button per method**, each forcing `payment_method_types`.
  A forced type has to be approved before its button works, and three more
  buttons named like epay's Alipay and WeChat crowd the grid.
  The operators chose one button.
- **Charge in HKD, the account's settlement currency.** Customers would see a
  foreign price; CNY matches the price the wallet quotes. Stripe converts on
  payout.

## Consequences

- The wallet button's label comes from a `stripe` entry in `PayMethods`, set
  by an administrator after `StripeApiSecret` and `StripeWebhookSecret`.
  Without the entry it reads "Stripe".
- Orders created by upstream's gateway (Price-based, no bonus) would now be
  completed as `amount` plus bonus. CoreCode never enabled Stripe before this
  change, so there are none.
- Stripe settles in HKD and charges conversion and method fees; `money` keeps
  the CNY price the customer paid, not what lands in the account.

## Verification

- `controller/topup_stripe_test.go`: the session charges ¥100 as 10000 fen,
  ¥9.9 as 990, one item, no Price; a signed `checkout.session.completed`
  credits 100 + 11 bonus once across a repeat and an `async_payment_succeeded`,
  saves `cus_1`, a forged signature is refused, and `expired` closes a
  pending order. Skipping the customer update fails it.
- `TestEpayTopUpBonusDatabaseMatrix` gains Stripe orders (webhook and manual
  completion): SQLite, MySQL 8.0.46, PostgreSQL 17.11, three runs each under
  `-race`.
- `go test ./model ./controller ./router ./service`; console wallet suite (53
  tests), `bun run typecheck`, `bun run lint:check`, oxfmt on the changed files.
- Not verified before merge: a live Checkout Session. The restricted key
  (Checkout Sessions, Customers, Products, Prices: write) listed sessions with
  200 and was refused `/v1/balance` with 403.
