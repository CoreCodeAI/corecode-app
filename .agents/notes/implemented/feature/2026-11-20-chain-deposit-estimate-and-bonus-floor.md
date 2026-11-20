# Agent Note: Estimate the on-chain transfer for the picked amount, and name the bonus floor

Status: implemented

Follows `2026-11-19-chain-deposit-addresses-admins-first.md`, whose Console bullet this
replaces.

## Problem

The deposit dialog asked for no amount, so a customer who picked 5000 in the wallet had to
work out the USDT themselves, and could send a cent too little for the bonus they picked:
on 2026-11-20 (`Price` 1, `USDExchangeRate` 6.8, tiers 300/1000/5000/10000 at 3/5/7/10%),
735.29 USDT credits 4999.97, which is in the 5% tier, not 7%. The dialog also listed every
token contract, which the owner did not want shown. After "I've sent it" the wallet's
banner said to finish paying in another tab.

## Decision

- **The server prices the estimate.** `POST /api/user/chain-deposit/quote` `{amount}`
  answers `usd`, the least whole-cent transfer `chainDepositPrice` reads as at least the
  amount, and, when the amount earns a bonus, `bonus_usd` (the least transfer that stays in
  the amount's tier), `bonus_rate` and `lower_rate` (what a smaller transfer earns).
  `chainDepositDollarsFor` rounds up to the cent and steps a cent at a time until the credit
  arithmetic itself reaches the amount, so the quote and the credit cannot disagree. The
  route is refused to callers `canUseChainDeposit` refuses, takes amounts from 1 to 10^9,
  and never calls the deposit service. `operation_setting.TopUpBonusTier` returns the tier's
  minimum beside its rate; `TopUpBonusRate` now reads it.
- **The dialog shows it above the address.** "充值 5000 预计需转账 735.30 USDT 或 USDC", and
  "单笔转账需不少于 735.30 USDT 或 USDC，才能享受 7% 赠送；少于这个数，赠送按下一档 5%
  计算" (or "则没有赠送" at the lowest tier). For an amount between tiers, such as 2000,
  the floor is the tier's own minimum's price (147.06 for 5%). "单笔" because the bonus is
  read per credited difference. A failed quote hides the estimate and leaves the address.
- **Tokens by symbol only.** Each network lists its token symbols; the contracts and their
  copy buttons are gone.
- **Credit time.** One line for both networks, "通常在 1 分钟内入账", since the deposit
  service reads Arbitrum 20 blocks behind its head (`corecode-deposit` note
  `2026-11-20-read-arbitrum-near-its-head.md`). `chainDepositDelayMinutes` had no caller and
  is removed.
- **The banner knows a transfer from a tab.** `usePaymentConfirmation().start` takes a kind;
  `chain` shows "正在等待链上到账" and that the balance updates on its own.

## Consequences

- One request per dialog open, cached a minute per amount.
- Every first-load page is about 145 bytes smaller than main's: the new strings are all in
  the wallet's `rest` part.

## Verification

- `go test ./controller -run 'ChainDeposit|NowPayments|TopUp'` and
  `go test ./setting/operation_setting`. `TestChainDepositQuoteIsTheLeastTransferThatKeepsTheTier`
  pins production's values (5000 → 735.30, 2000 → 294.12 with floor 147.06, 100 → 14.71
  without a bonus), checks for eight amounts that the quote's transfer credits the amount
  with its tier's bonus and that a cent less falls below it, and checks refusals. Rounding
  to the nearest cent instead of up made it fail with 735.29.
- Console `bun run typecheck`, `bun run lint:check`, `bun run format:check`, the wallet's
  vitest files (a new banner case for `chain`), `bun run build` and `bun run first-load:check`
  on the branch and on main.
