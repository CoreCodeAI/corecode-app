# Agent Note: Take top-ups through Dodo Payments, administrators first

Status: implemented

## Problem

The operators want Dodo Payments, a merchant of record, as another wallet
method. They want to try it in Dodo's test mode first, with the button shown
only to administrators, before customers see it.

Dodo has no inline price. A checkout needs a dashboard product, and only a
pay-what-you-want product takes a per-order `amount`. Such a product also has
a public buy link where the buyer picks the price and can set metadata, so a
payment's metadata cannot be trusted to name an order.

## Decision

- **An order is priced like an epay order.** `RequestDodoPaymentsPay` uses
  `getPayMoney`, stores that CNY figure as `money`, fixes `bonus_quota` at order
  time and completes through `completeOnlineTopUp`, like Stripe and
  NOWPayments. The console quotes it through `/api/user/amount`.
- **One CNY pay-what-you-want product, priced per order.** The checkout sends
  `amount` in fen on `DodoPaymentsProductId`, with `billing_currency` CNY and
  both `allow_discount_code` and `allow_currency_selection` off. The product is
  tax-inclusive, so the customer pays the price the wallet quoted. The test
  product is `pdt_0Ns0GG1nJuVpUXiXZMoW0` ("CoreCode 余额充值", minimum ¥1).
- **The trade number is the checkout session.** The order is created after
  the session, as `DODOTEST_<session_id>` in test mode or `DODO_<session_id>`
  live, and the webhook finds it from the payment's `checkout_session_id`. A
  payment through the public link has a session this server never opened, so
  it names no order.
- **The webhook credits only `payment.succeeded`, and only in full.** It
  checks a Standard Webhooks signature (`webhook-id`, `webhook-timestamp`,
  `webhook-signature`, HMAC-SHA256, five-minute window). A payment that is not
  in CNY, or charges less than the order's fen, stays pending for an
  administrator. A failed attempt leaves the order pending, because the
  customer may retry in the same session. Refunds and disputes are logged
  only.
- **Two switches, both on by default.** `DodoPaymentsTestMode` picks
  `test.dodopayments.com` over `live.dodopayments.com`. `DodoPaymentsAdminOnly`
  lists the method in `/api/user/topup/info` only for a role of administrator
  or above, and `RequestDodoPaymentsPay` refuses anyone else. They are separate,
  so live mode can also be tried by administrators before it opens.
- **Top-ups only.** The plan dialog leaves the method out; plans keep their
  existing purchase paths.

## Alternatives considered

- **A product per amount.** Every preset and custom amount would need its own
  product, and the bonus and group-ratio prices would not match.
- **Name the order in session metadata.** The public buy link accepts
  `metadata_*` parameters, so a customer could pay ¥1 against a ¥1000 order's
  trade number. Binding the order to the session closes that.
- **Store the session id in a new column.** That is a schema change on three
  databases for a value the trade number can carry.

## Consequences

- A paid test order credits real quota to the administrator who paid it, and
  counts in site insights as a top-up. Its `DODOTEST_` trade number tells it
  apart; an administrator can deduct the quota afterwards.
- The API key, webhook secret and product belong to one Dodo mode. Switching
  mode means replacing all three. Orders still pending from the other mode
  then never complete.
- The dashboard must keep the product tax-inclusive and in CNY. If adaptive
  currency or a discount changes what is charged, payments wait for an
  administrator rather than crediting.

## Verification

- `TestDodoPaymentsSignatureMatchesStandardWebhooks` checks the Standard
  Webhooks reference vector, a second listed signature, and refuses a stale or
  future timestamp, an edited body, another id, `v2`, and another secret.
- `TestCanUseDodoPayments`: no product, no method; with the admin-only switch
  on, a common user is refused and an administrator and root are allowed; with
  it off, a common user is allowed.
- `TestDodoPaymentsCheckoutAndWebhookCreditOnce` (SQLite): against a stub API,
  a common user is refused and opens no checkout; an administrator's ¥10 sends
  1000 fen, CNY, both flags off and the account email; the order is
  `DODOTEST_cks_1`. A forged signature answers 400. `payment.failed`, a 999-fen
  payment, a USD payment and a payment from an unknown session credit nothing.
  `payment.succeeded` twice credits the order once. Live mode names the order
  `DODO_`. Removing the amount check, or letting a common user through, fails
  the test.
- The same request body sent to Dodo's test API opened a session. Previews
  billed to Hong Kong and to the US charged CNY 990 for ¥9.90, tax included.
- `go test ./controller ./router ./model ./middleware ./setting/...`; console
  `bun run typecheck`, `bun run lint:check`, oxfmt on the changed files, and
  the wallet, system-settings and site-insights suites (853 tests).
- Not yet run: a real test-mode payment and webhook, which need the deployed
  endpoint registered in the Dodo dashboard.
