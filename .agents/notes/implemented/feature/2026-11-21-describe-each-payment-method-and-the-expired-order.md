# Agent Note: Describe each payment method, and say what an expired order means

Status: implemented

## Problem

The weekly review of 2026-11-21 saw 17 card attempts and 7 successes in seven days,
and about a third of Alipay and WeChat Pay orders expiring. The wallet named
the methods and nothing else, and an expired order read as a bare red "Expired".

Reading what a customer sees, not what the administrator's screenshot shows:

- **Dodo Payments and the on-chain deposit are administrator-only.**
  `DodoPaymentsAdminOnly` is unset in production, so it defaults to on, and
  `ChainDepositAdminOnly` is `true`. The "(Test)" tag and the second USDT
  entry never reach a customer. A customer sees Alipay, WeChat Pay, Card and
  one "USDT / USDC" (NOWPayments), so there is nothing to merge.
- **Every method a customer sees earns the top-up bonus**, USDT included
  (`topUpBonusQuota` in `controller/topup_nowpayments.go`). Only Creem and Waffo
  do not, and neither is open. The task text said "USDT: no bonus"; that is not
  what the server does, so the line does not say it.
- **Paid orders, last 30 days** (`top_ups`, created to completed): `nowpayments`
  18 paid, 4.9 minutes on average, 7.8 at the 90th percentile; `stripe_alipay` and
  `stripe_wechat_pay` 0.7 minutes, 1.2 at the 90th; `stripe_card` 18 paid, 36
  expired and 35 refunded. The chain service exposes no confirmation count, so
  "about N minutes" comes from these orders.

## Decision

- Each method gets one line under its name (`paymentMethodHint` in
  `lib/payment-names.ts`): Alipay and WeChat Pay "Instant, recommended"; Card
  "International cards only. Some banks decline; if it fails, use Alipay or WeChat
  Pay."; USDT / USDC "On-chain USDT/USDC, usually credited in about 5 minutes".
  Creem and Waffo say "No bonus on this method", and only while a bonus is on
  offer to some other method.
- An expired order in the history says "This order expired. You can place a new
  one."; the badge keeps its red "Expired".
- On a phone the amount grid is three across, and a price line that only repeats
  the amount and the "Bonus $N" line are hidden below `sm`, so the methods come
  into view after one screen instead of four. The percentage label stays on each
  amount, and the bonus line for the chosen amount stays under the custom field.
- No server change: only copy, layout and the history's wording.

## Alternatives considered

- **Move the methods above the amounts.** Rejected: a method button opens the
  payment confirmation at the amount already chosen, which starts at the minimum.
  A customer who pressed a method first would confirm ten dollars and have to
  come back for the amount. The grid is made shorter instead.
- **Two columns on desktop.** Not done: beside the subscription card the
  recharge card is about 560 px wide, too narrow for two columns, and a new
  Tailwind class costs every core page bytes (`change-the-console-bundle-or-dependencies`).
- **Merge the two USDT entries.** There is one for customers; the other is the
  administrator's.

## Verification

- `bun run typecheck`, `bunx oxfmt --check` on `src/features/wallet` and `src/i18n`,
  `bun run lint:check`, vitest on `src/features/wallet` and `src/i18n` (138 passed),
  `bun run build` and `bun run first-load:check` (398, 749 and 1,259 bytes left on
  `/sign-in`, `/dashboard/overview` and `/keys`).
