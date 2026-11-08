# Agent Note: Charge Stripe in HKD, and send small WeChat and Alipay orders through epay

Status: implemented

## Problem

The Stripe account settles in HKD. Charging the CNY price, as
[2026-11-08-stripe-topup-priced-like-epay](2026-11-08-stripe-topup-priced-like-epay.md)
decided, costs a 2% conversion fee on every payment on top of the method fee.
The four WeChat Pay payments on 2026-11-07 (¥10, ¥36, ¥50, ¥100) were charged
2.2% + HK$2.00 + 2%. The fixed HK$2.00 made the ¥10 order cost 21.3% and the
¥100 order 5.9%. Epay charges no fixed fee, so it is cheaper for small orders.

The operators asked, on 2026-11-08, for both changes: Stripe charges in HKD,
and an order of ¥50 or less paid by WeChat Pay goes through epay, while a
larger one goes through Stripe. The rule applies to plans as well as
top-ups. Cards stay on Stripe at every amount, since epay has no card method.

## Decision

- **Checkout charges HKD.** `stripeCheckoutParams` takes HK cents: the
  order's CNY price times the live rate, rounded to the cent. `Money` and a
  plan order's money still record the CNY price, which the top-up report,
  paid-total tiers and commission read. Plans with a recurring
  `stripe_price_id` keep the currency of their Stripe Price.
- **HKD only, a little under the CNY price.** Checkout sets
  `adaptive_pricing.enabled=false`; otherwise Stripe offered the customer a
  CNY option (¥103.97 for a ¥100 order) at its own marked-up rate. The line
  item's description gives the CNY price (`人民币价 ¥100.00`). The HKD amount
  is reduced by `StripeHKDDiscount` (option row, default 0.004, capped at 5%) and
  rounded down. In the first live test, HK$117.48 for a ¥100 order became
  ¥100.30 in WeChat Pay, which converted at about 1.1713. The operators
  preferred to charge slightly less rather than slightly more. 0.003 would
  match that one test exactly, at about ¥99.99, but the ECB rate lags on
  weekends and the fallback source sat 0.3% lower, so 0.004 (about ¥99.90)
  leaves room for the rates to drift.
- **The rate is fetched, not configured** (`controller/stripe_fx.go`).
  Frankfurter (ECB reference rates) is asked first, and ExchangeRate-API's open
  feed is asked when it fails. Neither needs a key. A rate is used for an hour.
  When every source fails, the last rate serves for up to 24 hours, and a
  failed refresh waits a minute before the next try. After 24 hours, a Stripe
  order is refused rather than priced from an old rate. A rate outside 0.8–1.6
  is rejected. On 2026-11-08 the sources quoted 1.1748 and 1.1714, and Stripe
  converted at 1.17515.
- **`StripeSmallOrderEpayMax` (CNY, option row, default 0 = off).** A Stripe
  method with an epay twin (`stripe_wechat_pay` → `wxpay`,
  `stripe_alipay` → `alipay`) carries `epay_max_money` in
  `/api/user/topup/info` while epay is configured. When an order's CNY price
  is at most that figure, the console posts it to the epay endpoint under the
  Stripe method's name. `epayTypeFor` checks the price again on the server and
  charges it through the twin. The order records the twin (`wxpay`). Above
  the threshold, or for a method without a twin, epay refuses the order.
- **The console decides the gateway; the server checks it.** The decision
  uses the price the console already quoted (`paymentAmount` for a top-up,
  `price_amount` for a plan), so it stays in the confirm step and the plan
  dialog. Stripe does not refuse a small order. A console that has not yet
  picked up the change only pays a higher fee.

## Alternatives considered

- **An administrator-set rate.** No outside dependency, but the price drifts
  until someone updates it. The operators chose the live rate.
- **One server endpoint that picks the gateway.** Epay answers with form
  fields and Stripe with a link, so the console would still branch on the
  response. It would also change the API that the console in production
  calls.
- **Disable the card button for small orders.** The operators kept cards on
  Stripe, accepting the fixed fee for customers who have no other way to pay.

## Consequences

- Customers see the HK$ amount on Checkout, with the CNY price under the
  product name. WeChat Pay, Alipay and the card issuer convert it back at
  their own rate, which with the discount comes to slightly under the CNY
  price. The wallet still quotes ¥, and the credit is the full amount.
- The threshold takes effect only after the console with this change is
  released and `StripeSmallOrderEpayMax` is set to 50. The server releases
  first, and the old console keeps sending every order to Stripe until then.
- Each server process fetches its own rate, so during a blue/green release
  the two colors may price one order up to an hour's drift apart.
- Stripe Alipay, once Stripe approves it, inherits the same threshold through
  its twin.

## Verification

- `TestStripeCheckoutChargesThePriceInHKD`: ¥100 at 1.1748 is 11748 HK
  cents with no discount, 11701 at 0.004, and 11160 at the 5% cap. A
  negative discount charges no surcharge. The line item is in `hkd`, carries
  `人民币价 ¥100.00`, and Adaptive Pricing is off.
- `TestStripeCheckoutOffersTheChosenMethod`: a ¥29.9 plan by WeChat Pay
  posts `unit_amount=3498`, `currency=hkd`, `adaptive_pricing[enabled]=false`
  and the CNY description to a stub Stripe API.
- `TestStripeHKDPerCNYFallsBackAndCaches`: the first source is used and then
  cached; a 502 falls to the second source; a nonsense quote and a provider
  error keep the last rate without refetching each request; past 24 hours,
  `errNoHKDRate`.
- `TestEpayTypeForSendsSmallStripeOrdersToEpay` and
  `TestSmallStripeWeChatTopUpGoesThroughEpay`: ¥50 by `stripe_wechat_pay`
  creates an epay `wxpay` top-up; ¥51, and a card order, are refused by epay.
  A ¥29.9 plan becomes an epay `wxpay` plan order. Only the WeChat entry in
  top-up info carries `epay_max_money`, and the `PayMethods` option is
  unchanged. Changing the boundary to `>=` fails both tests.
- Console: `paysThroughEpay` tests at 10, 50 and 50.01. The payment hook
  posts a small WeChat order to epay. The plan dialog sends a ¥9.9 plan to
  epay at a ¥50 threshold and to Stripe at a ¥5 threshold; with the dialog's
  check removed, a test fails.
