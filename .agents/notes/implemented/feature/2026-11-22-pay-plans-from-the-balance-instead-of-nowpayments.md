# Agent Note: Pay plans from the balance instead of NOWPayments

Status: implemented

## Problem

On 2026-11-22 the on-chain deposit opened to every customer and replaced NOWPayments in the
wallet's top-up list. Plans were still bought through NOWPayments: all three had
`allow_balance_pay = false`, and a deposit address cannot take a plan's fixed price. So the
plan dialog kept a "Pay with USDT / USDC" button opening a NOWPayments invoice, the method
the deposit was meant to replace.

## Decision

A user with a deposit address pays a plan in USDT or USDC in two steps: an on-chain top-up
(earning the tier bonus plus `ChainDepositBonusRate`), then "Pay with Balance".

- `GET /api/user/topup/info` returns no `nowpayments_currencies` to a user who
  `canUseChainDeposit`, so neither the wallet nor the plan dialog offers NOWPayments.
- `POST /api/user/nowpayments/pay` and `POST /api/subscription/nowpayments/pay` refuse such
  a user, so a console loaded before the change cannot open a new invoice. The IPN callback
  is untouched and keeps crediting invoices already open.
- The plan dialog's balance box tells such a user to top up on-chain first, with the extra
  bonus rate, whenever the plan allows balance payment.
- Users without an address (deposits switched off, or admin-only again) keep NOWPayments
  for top-ups and plans.

Data, changed live on 2026-11-22 through `PUT /api/subscription/admin/plans/:id` with every
other field read back unchanged: `allow_balance_pay = true` on plan 1 (新人体验包, ¥9.9)
and plan 2 (新人福利包, ¥29.9). A plan's price is CNY and one balance unit is bought for
¥1, so the balance price equals the epay price.

## Alternatives considered

- **Enable balance payment on plan 3 (渠道体验包).** Its price is 0 and it is granted only
  as an affiliate gift; with balance payment on, any eligible account could take it free.
  It stays off.
- **Keep NOWPayments for plans.** It costs more than the deposit and keeps a second crypto
  path for customers to choose between.

## Consequences

- Balance bought with a top-up bonus buys plans at the same nominal price, so a plan bought
  this way costs the customer slightly less than by epay.
- A new paid plan needs `allow_balance_pay` on, or customers with an address have no crypto
  way to buy it.
