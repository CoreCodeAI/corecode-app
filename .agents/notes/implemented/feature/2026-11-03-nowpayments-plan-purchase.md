# Agent Note: Sell subscription plans for USDT and USDC through NOWPayments

Status: implemented

## Problem

Top-ups take USDT and USDC through NOWPayments
([the top-up note](2026-11-03-nowpayments-crypto-topup.md)), but the plans in
the wallet, such as the ¥29.9 and ¥9.9 starter packs, could only be bought
with epay or balance. The plan dialog also built its epay list from
`pay_methods` and dropped only Stripe and Creem, so it offered "USDT / USDC"
as an epay method, which epay refused.

## Decision

- **`POST /api/subscription/nowpayments/pay`** takes `plan_id` and a
  `pay_currency` from `NowPaymentsPayCurrencies`. It runs the checks the epay
  plan path runs (compliance, plan enabled, `CheckSubscriptionPurchase`), opens
  an invoice for `price_amount / USDExchangeRate` dollars, then stores a
  `SubscriptionOrder` with the CNY price, provider and method `nowpayments`.
  A refused invoice stores nothing.
- **One IPN endpoint.** Plan trade numbers start with `NPSUB`, top-ups with
  `NPUSR`, and `/api/nowpayments/webhook` sends a signed IPN by that prefix.
  `finished` calls `CompleteSubscriptionOrder`, the path Stripe, Creem and
  epay use, so the plan is granted once and the per-user limit holds.
- **A paid order the plan cannot take goes to a person.** When completion
  fails for good (purchase limit reached, plan gifted, account not eligible,
  order unknown or not pending), the IPN answers 200 and the Feishu group is
  told; any other failure answers 500 so NOWPayments retries. The limit case is
  real: a customer can open two invoices before paying either.
- `failed`, `refunded` and `expired` close a pending plan order
  (`ExpireSubscriptionOrder`); the first two are announced. `partially_paid`
  and parented deposits are announced and left, as for top-ups.
- **The dialog** shows a network picker and "Pay with USDT / USDC" when the
  wallet offers networks, with the dollar amount at the site rate, and sends
  the customer to the invoice in the same tab. The epay list now drops
  `nowpayments` too.

## Alternatives considered

- **Buy the plan from balance after a USDT top-up.** Two payments instead of
  one, and only for plans that allow balance pay.
- **A second IPN endpoint for plans.** The dashboard has one IPN secret and
  the invoice already names its callback, so a prefix needs no new route
  or setting.

## Consequences

- An order NOWPayments was paid for but the plan could not take stays
  pending. An administrator refunds it in NOWPayments or grants the plan from
  the subscription admin page.
- ¥9.9 is $1.46 at 6.8; the networks offered on 2026-11-03 asked at most
  about $1.38, so the cheapest plan clears every network's minimum by little.

## Verification

- `TestNowPaymentsSubscriptionPurchase` (SQLite, against a stub NOWPayments):
  an unoffered ticker and a refused invoice create no order; ¥29.9 is
  invoiced as $4.40 in `usdcarb` with the success page `/wallet`; two invoices
  for a one-purchase plan; `partially_paid` grants nothing; `finished` grants
  the plan once and a repeat is silent; the second paid order is refused by
  the limit, stays pending and is announced; a new invoice is then refused; a
  refund and an expiry close orders, and only the refund is announced; an
  unknown `NPSUB` order is announced. With the dispatch disabled the test
  fails.
- No query or schema changed; plan completion is the existing
  `CompleteSubscriptionOrder`, so the database matrix was not rerun.
- Console: the purchase-dialog tests check that the method is absent when
  NOWPayments is off, that it shows "About $9.90" and sends
  `{plan_id, pay_currency}` before redirecting; `bun run typecheck`,
  `bun run lint:check`, `bun run format:check` and the subscriptions and
  wallet suites pass.
