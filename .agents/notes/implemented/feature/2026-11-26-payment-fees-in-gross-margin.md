# Agent Note: Subtract payment processing fees in the gross margin, and count the Codex account as free

Status: implemented

## Problem

After the IP cost ledger, the profit waterfall still named payment processing fees as missing. They are measured, not guessed:

- **Epay (ezfp)** keeps 8% of each order plus 0.1% of the daily settlement, about 8.11%.
- **Stripe's Hong Kong account** keeps 2.2% + HK$2 of an Alipay or WeChat Pay charge, and 3.4% + HK$2.35 + 0.5% for a foreign card. A refunded charge does not return its fee.

Over 10/27–11/25 these came to about 5% of cash. The vendor panel also still priced the Codex account at $200 a month, but the ChatGPT Pro plan behind it was cancelled in November 2026 and will not be renewed.

## Decision

- **Fee rates per payment method, in an option.** The `PaymentFeeRates` option holds `{method, percent, fixed}` entries, with `fixed` in yuan per order. An empty option means `defaultPaymentFeeRates`, the measured rates: `alipay` and `wxpay` 8.11%; `stripe`, `stripe_alipay` and `stripe_wechat_pay` 2.2% + ¥1.84; `stripe_card` 3.9% + ¥2.16; `chain_deposit` and `offline` 0. `PUT /api/site-insights/payment-fee-rates` replaces the list, and an empty list restores the defaults.
- **The funds view prices each method's orders** (`readPaymentFees`). It reads top-ups created in the range with status `success` or `refunded`, wallet orders left out, and returns `payment_fees`: orders, money, refunded count, fee, and whether a rate is recorded. A refunded order's fee is counted; its money is not. A method with no rate, such as `nowpayments` or `dodopayments`, costs nothing and is flagged. The response also carries the rates in force as `payment_fee_rates`.
- **The gross margin takes the fees' share of cash off recognized revenue.** `paymentFeeRate` is the total fee over the money still paid. `financeMargins` adds `revenue × paymentFeeRate` to cost as `paymentFee`, so the overview verdict, the vendor panel and the waterfall move together. Recognized revenue and cash fall in different ranges (a top-up is spent over weeks), so applying the rate keeps the two from mixing. The waterfall gets a `payments` step before the gross margin, and its note no longer lists payment fees as missing.
- **The Codex account costs nothing.** `VENDOR_ACCOUNT_MONTHLY_USD.codex` is 0, as Grok's and Gemini's already were.
- **An editor on the funds tab** (`PaymentFeesPanel`, below the IP cost ledger) lists every method with orders in the range and every rate, and saves a rate per method. A bad entry is refused with `Invalid parameters`, which keeps new server messages out of the core locale part.

## Alternatives considered

- **Subtract the cash fees as they fell, after the gross margin.** This is simpler and matches cash. But a top-up sale makes cash, and with it fees, jump in one range while the revenue is recognized later. That would make the gross margin swing with sales rather than with cost.
- **Read the processors' own fee reports.** Epay's settlement API gives the real figure but only per day across all methods. The Stripe key the relay holds lacks `balance_read`. A rate table is accurate to within the rounding, and the owner can correct it in place.
- **Store rates per provider, not per method.** Stripe charges a card differently from a wallet, and the epay methods have no provider on old rows, so the method is the key that prices correctly.

## Consequences

- The gross margin falls by about 4–5% of recognized revenue. The Codex account no longer costs ¥1,400 or so a month, so the Codex row and the total margin rise by that much.
- Stripe charges before 2026-11-08 also paid about 2% currency conversion, and the default rates leave that out, so ranges before then understate Stripe's fees slightly.
- All new fields are additive. An older console ignores them. A newer console against an older server shows no fee step amount and an editor with its Save button disabled.
