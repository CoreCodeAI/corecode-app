# Agent Note: Tell the customer, in the confirm dialog, that Stripe charges HKD

Status: implemented

## Problem

Stripe Checkout charges in HKD
([why](2026-11-08-stripe-hkd-small-orders-through-epay.md)), and its page leads
with an HKD figure (`HK$351.15` for a ¥300 order). The wallet's confirm dialog
showed only `您支付 ¥300`, so a customer who paid by WeChat Pay, Alipay or card
met a bigger number in another currency with no warning. The operators asked on
2026-11-13 for the dialog to say the charge currency is HKD, to show both
amounts when the rate is known, and otherwise to explain that the HKD figure
looks larger because of the exchange rate while the RMB paid matches the
purchase amount.

## Decision

- **The quote carries the HKD amount.** `POST /api/user/stripe/amount` keeps
  `data` (the CNY price, a string) and adds `hkd_amount`, the figure
  `stripeCheckoutParams` will charge: the same `stripeHKDCents`, so the dialog
  and Checkout cannot disagree. It is omitted when `stripeHKDPerCNY` has no
  rate. The CNY quote never depends on the rate, so an FX outage cannot stop a
  customer from reaching the dialog. An older console ignores the new field.
- **The dialog shows a note only for an order Stripe Checkout charges.** That
  is a Stripe method (`isStripePayment`) that `paysThroughEpay` does not send to
  epay. A WeChat or Alipay order of ¥50 or less goes to epay and is charged in
  RMB, so it shows nothing. A card has no epay twin, so it shows the note at
  every amount.
- **The note leads with the currency, then the amounts.** `You Pay ¥300.00`
  stays the large figure. Beneath it: "Charged in Hong Kong dollars (HKD)",
  `¥300.00 ≈ HK$351.15` in semibold, and one small line of explanation.
- **Wording by case.**
  - Rate known: "The payment page shows the HKD amount, converted at today's
    exchange rate."
  - No rate: "The payment page shows an HKD amount that looks larger than ¥300
    because of the exchange rate. It is not an extra charge."
  - WeChat Pay and Alipay add: "convert it back to RMB, so what you pay in RMB
    matches the purchase amount." The charge sits under the CNY price by
    `StripeHKDDiscount`, so "matches" is true to within that margin.
  - Card and plain Stripe add: "your bank may convert it at its own rate." A
    card's issuer decides the rate and any foreign-currency fee, so the dialog
    promises no RMB figure there.

## Alternatives considered

- **Compute HKD in the browser from a rate in `/api/user/topup/info`.** Rejected:
  float rounding in the browser could differ by a cent from `stripeHKDCents`,
  and the figure would go stale on a long-open page.
- **Promise the same RMB guarantee for cards.** Rejected: a card issuer, not
  this site, sets the conversion.

## Verification

- `TestStripeAmountQuoteCarriesTheHKDCharge`: ¥100 at 1.1748 quotes
  `data=100.00` and `hkd_amount=117.48`; with every source down and no cached
  rate, `data` is unchanged and `hkd_amount` is absent.
- `stripe-hkd-notice.test.tsx`: the note appears for WeChat Pay with both
  amounts and the RMB sentence, for a card with the bank sentence and no RMB
  promise, and without a rate with the "looks larger" sentence. It is absent for
  a ¥50 WeChat order (epay) and for Alipay by epay, and a ¥20 card order shows it.
- `use-payment-calculation.test.tsx`: the hook keeps a valid `hkd_amount` and
  drops a malformed one without failing the CNY quote.
- Not checked in a browser. The subscription purchase dialog has the same Stripe
  routing and is not changed here.
