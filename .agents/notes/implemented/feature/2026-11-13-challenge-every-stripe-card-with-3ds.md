# Agent Note: Challenge every Stripe card payment with 3D Secure

Status: implemented

## Problem

On 2026-11-13 one account created that day topped up ¥8,492.9 in five hours through
35 Stripe card payments. It used about 30 different UQPAY PTE. LTD. (Singapore)
Visa debit cards. It started with small test amounts, charged each card once,
and retried each declined card at a lower amount after an "insufficient funds"
decline. Stripe's own card-testing detection blocked four of the attempts.
Every sampled payment passed its CVC check, and none showed the cardholder a
challenge: the sampled payments had Data Only 3D Secure or none. Neither shifts
a fraud dispute's liability to the issuer. If the cards were used
without the holders' consent, every dispute lands on a Stripe account whose
first charge was 2026-11-08, and its dispute standing is at risk.

The account runs Radar Lite, which has no custom rules, so the dashboard cannot
require 3D Secure. The operators asked for a forced 3D Secure challenge.

## Decision

- **Every Checkout Session that can take a card sets
  `payment_method_options[card][request_three_d_secure]=challenge`.**
  `stripeCardChallenge` builds the option. `stripeCheckoutParams` adds it when
  the session offers cards: every Stripe top-up, and plan purchases charged at
  the plan's own CNY price, when the method is `stripe_card` or plain `stripe`
  (every enabled method). `genStripeSubscriptionLink`, the dashboard-Price
  subscription path, always adds it.
- **WeChat Pay and Alipay sessions carry no card option.** Those sessions
  list only their wallet, so a card option would not apply to them.
- **A constant, not an option row.** It is a fraud-liability decision with one
  setting, so there is no setting to toggle. If too many legitimate customers
  fail, a revert is a one-line change.

## Alternatives considered

- **`any`.** Requests 3D Secure but lets the issuer authenticate without a
  challenge. Rejected because the operators asked for a challenge on every card
  payment.
- **Radar Standard rules.** These would challenge or block only risky payments.
  Not available on Radar Lite. They can be added later beside this change.
- **Per-account limits in the app** (cards per day, first-day top-up cap).
  This would address the same abuse at the account level and stays open. It is
  not part of this change.

## Trade-offs

- Every card customer now completes a bank verification step (an SMS code or a
  banking app), so card conversion may drop.
- Stripe documents `challenge` as a request to the issuer. Whether a card that
  cannot do 3D Secure is declined or paid without it is decided by Stripe and
  the issuer. This change does not test that case.

## Verification

- `TestStripeCheckoutOffersTheChosenMethod` reads the form sent to a stub
  Stripe API. The card and plain-Stripe plan checkouts send
  `request_three_d_secure=challenge`, the WeChat Pay checkout sends no card
  option, and a dashboard-Price plan opens a `subscription` session with the
  challenge. Top-ups build their session with the same `stripeCheckoutParams`.
- With the new test applied to `origin/main`, the three `challenge` assertions
  fail. With this change, `go test ./controller/` passes.
- stripe-go v81.4.0 defines
  `CheckoutSessionPaymentMethodOptionsCardRequestThreeDSecureChallenge = "challenge"`.
- Not checked against live Stripe. The first real card top-up after release
  shows whether the challenge appears.
