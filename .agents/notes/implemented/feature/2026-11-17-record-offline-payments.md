# Agent Note: Record offline payments as paid orders

Status: implemented

## Problem

An enterprise customer pays by bank transfer, and an administrator adds the
quota by hand (`user.quota_add`). New-api then holds no order for the money.
The funds view prices a wallet from its paid orders (`readWalletPrices`), so
a wallet that only received manual credit has no paid share, and every dollar
it spends counts as gifted. On 2026-11-17 an enterprise account funded only
this way had several thousand dollars of use counted as gifted, and none of
the money it paid as revenue.

## Decision

- **An offline payment is a paid top-up order.** `POST /api/user/topup/offline`
  takes `user_id`, `money` (payment currency), `amount` (whole quota dollars),
  `paid_at` (default now) and `backfill`. `model.RecordOfflineTopUp` stores a
  successful `top_ups` row with `payment_method` `offline`. Both of its times
  are `paid_at`, because the funds view counts an order's money at completion.
  Every reader of paid orders then counts it: revenue, payment methods, paying
  users, the user's paid total (and its concurrency tier) and the user-spend
  view.
- **Two providers say what the order did to the wallet.** `offline` credits
  `amount` to the wallet, like a completed online order. `offline_backfill`
  credits nothing: it pays for quota administrators already added by hand.
  `readWalletPrices` and `readWalletHistory` move a backfill's quota from given
  to paid, so the hand-added credit stops counting as gifted from `paid_at` on.
  A backfill may not exceed the user's net hand-added quota less earlier
  backfills. The check runs under a lock on the user's row.
- **Offline payments earn no affiliate commission.** `affiliatePaidCents`
  leaves both providers out: the owner decided enterprise terms are settled
  with the payer directly, so an inviter earns nothing on them. `AffiliatePaidMoney`, the user's paid total, still includes them.
- **Same guard as marking a refund.** The endpoint needs a step-up proof under
  the new scope `admin.user.topup.offline`. The proof binds the user, the money
  rounded to the cent, the amount, the time and `backfill`. A personal access
  token needs `billing:write`. Each recording writes one `user.topup_offline`
  audit entry. Like the refund endpoint
  ([its controls were dropped](2026-11-14-drop-the-top-up-refund-controls.md)),
  the console has no control for it, and a script calls it.

## Alternatives considered

- **Flag enterprise users and read their manual credit as paid at ¥1 per
  dollar.** Rejected: the revenue would be estimated, not received,
  and a negotiated price differs from list.
- **Carry the money on the `user.quota_add` audit entry.** Rejected: revenue,
  paid totals and the affiliate program all read `top_ups`, and every one of
  them would need a second source.
- **Count offline payments toward commission.** Rejected by the owner.

## Trade-offs

- The channels view's `GrantedUSD` still lists hand-added quota in its range
  as granted. Its gift consumption and outstanding gift do follow the backfill,
  through `readWalletHistory`.
- Offline orders are not invoiceable in the invoice center, because
  `invoiceableProviders` does not list them. Enterprise invoices are issued
  outside it.
- The console shows `offline` as the raw payment method name and the audit
  entry in its server English, because no locale key was added. This keeps
  the change server-only.
- To correct a mistaken recording, mark it refunded
  (`POST /api/user/topup/refund`). For a credited one, take the quota back by
  hand as well.

## Verification

- `TestOfflineBackfillTurnsHandAddedQuotaIntoPaidCredit` replays the
  enterprise case. Before the backfill, a $50 use from hand-added quota is gifted. After
  it, revenue is 10,000, gift is 0 and paid use is 50. The wallet is not
  credited again, an oversized or second backfill is refused, and the channels
  view's paid share is 1. With `backfilled()` forced to zero the test fails.
- `TestOfflinePaymentCreditsTheWalletAndEarnsNoCommission`: the credit mode
  adds the quota and rounds the money to the cent. The paid total includes the
  order and the commission base does not. A future `paid_at` is refused.
- `TestAdminRecordOfflineTopUpNeedsAProofForTheExactPayment`: the endpoint is
  refused without a proof, and refused when the money differs from the proof's.
  It accepts extra digits and a missing `backfill`, refreshes the paid total,
  and writes the audit entry.
