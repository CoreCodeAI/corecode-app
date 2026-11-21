# Agent Note: Name every payment method in top-up records

Status: implemented

## Problem

The top-up records page (table, filter and summary) and the wallet's billing history showed
`stripe_card`, `stripe_alipay`, `stripe_wechat_pay`, `nowpayments` and `dodopayments` as
stored. `getPaymentMethodName` in `wallet/lib/billing.ts` knew six values and returned any
other one unchanged. The site insights carried a second, fuller mapping
(`paymentMethodLabel`), so the same order read differently on two pages.

Values found in `top_ups` on 2026-11-21: `alipay` 1110, `wxpay` 725, `stripe_alipay` 325,
`stripe_wechat_pay` 256, `stripe_card` 89, `nowpayments` 44, `dodopayments` 4, `stripe` 3,
`offline` 3, `chain_deposit` 3.

## Decision

`paymentMethodLabel(method, t)` in `wallet/lib/billing.ts` is the only mapping. The records
table, its filter and summary, the billing history and every site-insights page call it.

| Value | Label (en / zh) |
|---|---|
| `alipay` | Alipay / 支付宝 |
| `wxpay` | WeChat Pay / 微信支付 |
| `stripe_alipay` | Alipay (Stripe) / 支付宝（Stripe） |
| `stripe_wechat_pay` | WeChat Pay (Stripe) / 微信支付（Stripe） |
| `stripe_card` | Card (Stripe) / 银行卡（Stripe） |
| `stripe` | Stripe |
| `nowpayments` | USDT/USDC (NOWPayments) |
| `chain_deposit` | On-chain deposit (USDT/USDC) / 链上充值 (USDT/USDC) |
| `dodopayments` | Dodo Payments |
| `creem`, `waffo`, `waffo_pancake` | Creem, Waffo, Waffo Pancake |
| `balance` | Balance / 余额 |
| `offline` | Offline transfer / 线下转账 |
| anything else | Other (value) / 其他（value） |

- **The gateway shows only where the method name alone is ambiguous.** `alipay` (Epay) and
  `stripe_alipay` are different gateways with different fees, so an administrator filtering
  one must not get the other's orders. Both readers see the same label; there is no
  admin-only variant to keep in step.
- **An unknown value stays visible.** An Epay method an operator adds, or a gateway added
  later, reads `Other (value)`. The raw value is in the label itself, since a tooltip does
  not exist on a phone.
- **Brand names are not translated.** Stripe, Creem, Waffo, Dodo Payments and NOWPayments
  stay as written. Three keys are new in all eight locales: `{{method}} (Stripe)`,
  `Offline transfer`, `Other ({{method}})`.
- **The function lives in `billing.ts` and uses plain string keys.** The overview reaches it
  through the site insights. A new module, or an import of `wallet/constants`, moved the
  first-load numbers: see Consequences.

The usage-log detail dialog's "Order Payment Method" and "Callback Payment Method" rows keep
the stored values. Their purpose is to compare what the order recorded with what the gateway
reported, and an administrator matches them against the gateway's dashboard.

## Alternatives considered

- **Reuse `paymentMethodName` from `payment-names.ts`.** It names a wallet button by the
  operator's `PayMethods` text and maps `alipay` and `stripe_alipay` to the same word, which
  the records filter cannot use.
- **Keep the site insights' `Stripe · Alipay` form.** It reads well but is a second
  convention. One form (`Alipay (Stripe)`) now serves every page.
- **Label the audit rows in the usage-log dialog too.** It added 128 bytes to the first-load
  files, because the dialog's chunk then shared `billing.ts` and the bundler split a new
  shared chunk that the entry has to list.

## Consequences

- The overview's first load is 66 bytes larger than main (132 to 66 bytes of budget left;
  sign-in 411 to 345; keys 936 to 870). The code is the new tables; the locale keys are in
  the `rest` part.
- A payment method added to the server must be added to `PAYMENT_METHOD_BRANDS`,
  `PAYMENT_METHOD_LABEL_KEYS` or `STRIPE_METHOD_KEYS`. `payment-method-label.test.ts` fails
  while a value of `PAYMENT_TYPES` reads `Other (...)`.
