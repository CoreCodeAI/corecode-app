# Agent Note: Offer Dodo Payments as WeChat Pay only

Status: implemented

## Problem

After the test-mode trial of
[2026-11-15-dodopayments-topup-admins-first](2026-11-15-dodopayments-topup-admins-first.md),
the operators asked whether Dodo Checkout could offer only WeChat Pay and
Alipay. Unrestricted, it showed cards, Apple Pay, Google Pay and FPS.

Dodo has no mainland Alipay. It offers only Alipay HK, which needs HKD and a
Hong Kong billing address and never appears on a CNY checkout. WeChat Pay works
in CNY on one-time payments between 4 and 1000 CNY. Above 1000 CNY, checkout
hides it.

## Decision

- **`DodoPaymentsMethodTypes`**, comma-separated Dodo method types, is sent as
  `allowed_payment_method_types`. Empty sends nothing and keeps Dodo's default.
  The option accepts only lower-case letters and underscores; Dodo validates
  the names themselves.
- **`DodoPaymentsMaxMoney`** caps one order's CNY price; 0 sets no cap. With
  WeChat Pay alone it is 1000, so the wallet refuses a larger order before it
  opens a checkout that offers no way to pay.
- **A `dodopayments` entry in `PayMethods` names the wallet button** and sets
  its icon, as a `stripe` entry does for Stripe. It shows only to users
  `canUseDodoPayments` admits, gets " (Test)" in test mode, and is copied, so
  the shared option is never changed. Without an entry, the default
  "Dodo Payments" button is appended as before.

## Alternatives considered

- **Alipay HK beside WeChat Pay.** It would need HKD pricing and a Hong Kong
  billing address, and mainland Alipay users generally cannot pay with it.
- **Hard-code WeChat Pay.** A later change of methods, or the full list for
  overseas customers, would need a release instead of an option.

## Consequences

- A top-up above the cap must use another method. The console shows the
  server's refusal and does not hide larger preset amounts in advance.
- The setting does not change Dodo's own rules: a method Dodo does not offer
  for the order's currency or billing country still does not appear.

## Verification

- Before the change, a test-mode session with `["we_chat_pay"]` billed to
  mainland China showed only 微信 at CN¥10.00; one with `ali_pay_hk` added
  opened as well.
- `TestDodoPaymentsCheckoutAndWebhookCreditOnce` now also checks that, with
  the types set to `" We_Chat_Pay ,"` and a 1000 cap, a 1001 order is refused
  without a checkout, and a 1000 order sends `["we_chat_pay"]` and 100000 fen.
  A listed entry reaches the administrator as `微信支付 (Dodo) (Test)` with
  its icon and the epay minimum, the customer sees none, and `PayMethods` is
  unchanged. Removing the cap, or showing the entry to everyone, fails it.
- `TestDodoPaymentsMethodTypes` covers trimming, case, repeats and refused
  shapes.
- `go test ./controller ./router ./model ./middleware ./setting/...`; console
  `bun run typecheck`, `bun run lint:check`, oxfmt, and the wallet,
  system-settings and site-insights suites.
