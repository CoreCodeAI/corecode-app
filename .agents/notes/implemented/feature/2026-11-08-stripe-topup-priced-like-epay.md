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
- **One wallet button per Stripe method.** `PayMethods` may list
  `stripe_card`, `stripe_wechat_pay` and `stripe_alipay` beside epay's; each
  opens Checkout with `payment_method_types` set to that one method
  (`wechat_pay` with `client=web`, which Stripe requires). Plain `stripe`
  still offers every enabled method. The order records the wallet method.
  Listed Stripe methods show only while Stripe is configured, and no extra
  plain "Stripe" is appended beside them. On 2026-11-08 the operators put
  Stripe WeChat Pay in place of epay's 微信 and added Stripe 银行卡; Stripe
  Alipay waits for Stripe's approval.
- **Plans are sold through the same buttons.** The plan dialog's method
  picker lists the epay methods while epay is on and the Stripe methods while
  Stripe is on. A plan without a `stripe_price_id` is charged once at its CNY
  price, like an epay plan order, so it needs no Stripe product; a plan with
  one keeps upstream's recurring checkout. Without this, removing epay 微信
  would have left plans without WeChat (71 plan purchases by WeChat in the 30
  days to 2026-11-08).
- **A paid customer returns to `/wallet`**, where the new balance shows, as
  a cancelled one does; upstream sent them to `/usage-logs`.
- **Checkout asks for an email only when the account has none.** Stripe
  offers no way to skip it. An account email is sent as `customer_email`,
  and the Stripe customer the first checkout creates prefills it after
  that. On 2026-11-08, 707 of 2279 accounts had no email; a placeholder
  address was rejected because receipts and fraud checks would get nothing.
- **One order stays capped at 10000**, as upstream had it, to bound what a
  stolen card buys in one checkout. Epay has no such cap.
- **The console counts Stripe as bonus-eligible.** It was in
  `NO_BONUS_PAYMENT_TYPES`; the confirm dialog now lists the bonus for it.

## Alternatives considered

- **Keep epay 微信 for plans only.** Plans and top-ups would offer different
  WeChat paths, and the method list would need a second setting.

- **Keep upstream's gateway with a ¥1 Price.** No code change, and with
  `Price` = 1 `money` would happen to be CNY, but Stripe top-ups would earn no
  bonus while the wallet advertises one, and a discount or group ratio would
  charge a different amount from the one quoted.
- **One combined Stripe button.** Shipped first; the operators then asked
  for a button per method so Stripe 微信 could replace epay's. A forced type
  works only once Stripe approves it, so Stripe 支付宝 is not listed yet.
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
- After the first release, a live ¥10 session showed "CoreCode 余额充值
  ¥10.00" with cards, WeChat Pay, Apple Pay and Link, and a real ¥10 card
  payment credited 10 plus the 11% bonus. The restricted key (Checkout
  Sessions, Customers, Products, Prices: write) was refused `/v1/balance`.
- `TestStripeCheckoutOffersTheChosenMethod` posts plan purchases to a stub
  Stripe API: `stripe_wechat_pay` sends `payment_method_types[0]=wechat_pay`
  and `payment_method_options[wechat_pay][client]=web`, `stripe_card` sends
  `card` only, no method sends none, one payment of 2990 fen, success URL
  `/wallet`. `TestTopUpInfoListsStripeMethodsOnlyWhileConfigured` fails if
  listed Stripe methods show while Stripe is off. The plan dialog test fails
  if a Stripe pick goes to epay.
