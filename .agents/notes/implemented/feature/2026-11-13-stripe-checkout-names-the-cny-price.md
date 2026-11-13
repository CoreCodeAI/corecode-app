# Agent Note: Put the CNY price in the Stripe Checkout product name

Status: implemented

## Problem

Stripe Checkout charges in HKD (see
[2026-11-08-stripe-hkd-small-orders-through-epay](2026-11-08-stripe-hkd-small-orders-through-epay.md)),
so the page showed `HK$351.15` in large type and `人民币价 ¥300.00` beneath it in
small grey text. Customers think in CNY and the CNY price was easy to miss. The
operators asked on 2026-11-13 for the CNY amount on top and the HKD amount below.

## Decision

- **The CNY price goes in the product name, the HKD amount in the description.**
  The line item is named `CoreCode 余额充值 ¥300.00` and described
  `折合 HK$351.15，按当日汇率`. The name renders larger than the description.
- **The large figure stays HKD.** Checkout always shows the charged currency
  largest, and no Checkout parameter enlarges the description. Making CNY the
  large figure means charging in CNY, which brings back the 2% conversion fee
  the HKD change removed. The operators chose the wording change over that cost.

## Alternatives considered

- **Charge in CNY.** Rejected for the 2% conversion fee on every payment, and it
  would also retire `StripeHKDDiscount` and the Adaptive Pricing setting.
- **Turn Adaptive Pricing on.** Stripe then offers CNY at its own marked-up rate
  (¥103.97 for a ¥100 order on 2026-11-08). Rejected for the same reason as before.

## Verification

- `TestStripeCheckoutChargesThePriceInHKD` and
  `TestStripeCheckoutOffersTheChosenMethod` assert the name carries `¥100.00` and
  `¥29.90` and the description carries the HKD amount (`HK$116.89`, `HK$34.95`).
- Not checked against a live Checkout page; the layout is Stripe's.
