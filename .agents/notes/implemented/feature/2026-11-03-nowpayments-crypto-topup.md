# Agent Note: Take top-ups in USDT and USDC through NOWPayments

Status: implemented

## Problem

The operators want customers to top up with USDT or USDC on the main chains,
through their NOWPayments account. The price must follow new-api's own rate:
a ¥100 top-up is ¥100 divided by `USDExchangeRate`, paid as that many dollars
in either coin. Other coins are not wanted.

new-api has no crypto gateway. Its Stripe, Creem and Waffo gateways price in
their own units and skip the top-up bonus, which CoreCode's epay orders earn.

## Decision

- **One wallet method, "USDT / USDC"**, appended to `pay_methods` when
  `NowPaymentsApiKey`, `NowPaymentsIpnSecret` and at least one currency are set
  and payment compliance is confirmed. The customer picks the network in the
  payment dialog.
- **The order is priced like an epay order.** `RequestNowPaymentsPay` uses
  `getPayMoney` (Price, top-up group ratio, `amount_discount`), stores that CNY
  figure as `money`, and fixes `bonus_quota` at order time. The invoice asks for
  `money / USDExchangeRate` US dollars, rounded to the cent, with `pay_currency`
  set, so the hosted page shows only that coin on that network. USDT and USDC
  both count as one dollar. Because `money` stays CNY, invite commission,
  paid-total concurrency tiers and the top-up report count these orders like
  epay ones without change.
- **Only USDT and USDC.** `setting/payment_nowpayments.go` holds the catalog of
  tickers the wallet may offer. `NowPaymentsPayCurrencies` (comma-separated)
  picks from it, and the option update rejects any other ticker. The default
  offers all twelve; each was enabled on the account's `/v1/merchant/coins`
  on 2026-11-03.
- **Completion shares epay's transaction.** `RechargeEpay` and the new
  `RechargeNowPayments` both call `completeOnlineTopUp`: row lock, provider
  check, credit `amount` plus `bonus_quota` once. An administrator's manual
  completion already credits a non-Stripe order the same way.
- **The IPN is trusted only when signed and plain.** `/api/nowpayments/webhook`
  checks `x-nowpayments-sig`, an HMAC-SHA512 of the key-sorted body. NOWPayments'
  docs show two sorters, Python's (arrays kept) and Node's (arrays become
  index-keyed objects), so both forms are accepted; values keep their original
  JSON text. Only `finished` credits. `failed`, `refunded` and `expired` close a
  pending order. `partially_paid`, and any deposit carrying `parent_payment_id`
  (a repeated or wrong-asset deposit), are logged and left to an administrator,
  as NOWPayments recommends.
- **The IPN URL travels with each invoice** (`ipn_callback_url`, from
  `CustomCallbackAddress` or `ServerAddress`), so the dashboard needs only the
  IPN secret.
- **A Feishu group hears what needs a person.** With
  `NowPaymentsFeishuWebhook` set, the IPN handler posts a text message, in the
  background, for a credited order, a `partially_paid` deposit, a deposit with
  a parent, a `finished` payment that matched no pending order, and a failed or
  refunded one. A duplicate callback and an expired invoice send nothing. The
  option accepts only a Feishu or Lark custom bot URL, and
  `NowPaymentsFeishuSecret` signs the message when the bot verifies
  signatures. Feishu reports most failures as HTTP 200 with a nonzero `code`,
  which counts as a failure. `POST /api/option/nowpayments/feishu-test` sends a
  test message to the saved bot.
- **`NowPaymentsMinTopUp`** (default 100, in the epay unit) sits above the
  epay minimum because each network has its own minimum on NOWPayments.
  `/v1/min-amount` on 2026-11-03 asked about $11.9 for USDT on Tron and at most
  $1.4 for the other networks; 100 is $14.71 at 6.8. An invoice NOWPayments
  still refuses as too small answers a message that says so.

## Alternatives considered

- **Let the customer choose the coin on NOWPayments' page.** No network picker
  in the console, but whatever coins the dashboard enables would be payable;
  CoreCode would depend on a dashboard toggle to keep to USDT and USDC.
- **One wallet button per network.** Eleven buttons crowd the method grid, and
  `pay_methods` entries are keyed by type.
- **Point NOWPayments' own notification URL at the Feishu bot.** Feishu
  accepts only its `msg_type` body, so it would refuse the raw IPN JSON, and
  the payment data would leave for a third party.
- **Add Feishu as a user notification channel**, next to email, Bark and
  Gotify. Every administrator could pick it, but the group would get each
  administrator's copy, and the notices would pass the per-user rate limit
  meant for quota warnings.
- **Re-fetch the payment from the API on each IPN instead of checking the
  signature.** It needs the API key on the callback path and still trusts the
  order id; the signature is what NOWPayments specifies.

## Consequences

- The dashboard's "Default payment status" must stay "Partially Paid". Set to
  "Finished", NOWPayments marks an underpaid deposit finished and it is credited.
- A partial, repeated or wrong-asset deposit leaves its order pending until an
  administrator completes it from the top-up records, which credits the full
  order.
- NOWPayments converts the dollar price to the coin at its own rate, so a
  customer may send a few thousandths more or less than the dollar figure.
  Network and service fees come out of what the account receives.
- A console released before the server reads no `nowpayments_currencies` and
  shows no crypto method; the server keeps its existing fields.

## Verification

- `TestNowPaymentsSignature` signs the Python-sorted and the Node-sorted forms
  of one body and accepts both, and rejects a wrong secret, an edited amount
  and an empty signature.
- `TestNowPaymentsPriceAndCurrencies` checks ¥100 → $14.71, ¥1000 → $147.06 and
  ¥9.9 → $1.46 at 6.8, a zero rate, and that `btc` is refused.
- `TestNowPaymentsWebhookCreditsFinishedOrderOnce` (SQLite): a forged signature
  answers 400; `partially_paid` and a deposit with a parent leave the order
  pending; `finished` twice credits the order and its bonus once; `expired`
  closes another order.
- The same test checks the Feishu messages: one each for the partial
  payment, the parented deposit, the credited order (order, user, amount,
  bonus, ¥ price, invoice and paid amounts) and the unknown order; none for
  the forged callback, the duplicate `finished` or the expired invoice.
  `TestFeishuBotWebhookAndSignature` checks the URL allowlist, a signature
  against Feishu's Python sample, and that a nonzero `code` is an error.
  No message was sent to a real Feishu bot.
- `TestEpayTopUpBonusDatabaseMatrix` now also completes a NOWPayments order
  once, with its bonus, and checks that neither gateway completes the other's
  order. Passed on SQLite 3.50.4, MySQL 8.0.46 and PostgreSQL 17.11, three
  runs under `-race`. No schema changed.
- Against a local build on SQLite: `/api/user/topup/info` lists the method and
  eleven networks; ¥100 quotes `14.71`; 20 is refused below the minimum; `btc`
  is refused as a currency and as an option value; an invoice with a fake key
  reaches `api.nowpayments.io`, which answers 403, and no order is created. A
  signed IPN credited ¥300 plus its 5% bonus ($315) once, and a forged one
  answered 400.
- In a desktop browser window (1476 px) against that build: the method shows and is disabled
  below 50; the dialog for $100 reads "$14.71" with "USDT · TRC20" chosen and
  the rate note; the list offers the eleven networks; choosing USDC · Base sent
  `usdcbase`; the admin NOWPayments tab renders.
- Console: `bun run typecheck`, `bun run lint:check`, and the wallet and
  system-settings suites (284 tests) pass.
