# Agent Note: Record a bonus on offline payments

Status: implemented

## Problem

Enterprise customers who pay by bank transfer get 10% on top: ¥5000 buys $5000
and $500 more. [Recording offline payments](2026-11-17-record-offline-payments.md)
had no bonus, so an administrator who added $5500 by hand could only record a
backfill of `amount` 5500, 5900 or 5100 with `bonus_quota` 0. The funds view
then counted the $500 as bought quota. PathPal's three transfers (11-12, 11-17,
11-21; `top_ups` ids 2039, 2063, 2590) were recorded that way: the bonus
figure was short by $1,500 and the customer's cost per dollar read too low.

## Decision

- **`bonus` on the offline endpoint.** `POST /api/user/topup/offline` takes an
  optional `bonus` in whole quota dollars beside `amount`, stored as
  `top_ups.bonus_quota`, as online orders store theirs. Without `backfill` the
  wallet gets `amount + bonus` and the log line is the one an online order with a
  bonus writes. The audit entry `user.topup_offline` records `bonus`.
- **The proof binds the bonus.** `AdminTopUpOfflineContext` gains `bonus`. A
  context issued before has five fields and means a bonus of zero; one with a
  bonus has six. A proof for a plain payment therefore cannot buy a bonus, and
  the reverse.
- **The backfill limit counts the bonus.** Earlier backfills' `amount` and
  `bonus_quota` plus this one's must not exceed the net quota added by hand.
- **A backfill covers its bonus.** `paidOrder.backfilled()` is `amount` plus
  `bonus_quota`. The funds readers already count a bonus as paid quota
  (`amount × QuotaPerUnit + BonusQuota`), so a backfill's whole $5500 leaves
  given and enters paid, and `bonus_usd` shows the $500. Use of the bonus part
  counts as gifted, as for an online order, so the wallet's price is the money
  over $5500. Without the change the $500 would stay given as well as paid, and
  the price would divide by $6000.
- **Correcting a recorded backfill.** `model.CorrectOfflineBackfills` moves an
  order's split between bought and bonus. An order's own total may change, since
  a hand deduction between two transfers can have been netted into their amounts
  (PathPal's 5900, 5500, 5100 became 5500 each); the corrections for one user
  must keep the sum, so the quota their backfills cover does not move. Each order
  must hold the expected split or the corrected one, so a second run changes
  nothing; anything else fails the whole batch. Money, status and times stay.
  `new-api offline-backfill-correct [-apply -operator ID -reason TEXT]
  ID:FROM_AMOUNT+FROM_BONUS=AMOUNT+BONUS ...` runs it against the database the
  environment names, as a dry run unless `-apply`. It never migrates, so it may
  run in the serving container. Each changed order writes
  `user.topup_offline_correct`, naming the operator (an administrator) and the
  reason.

## Alternatives considered

- **Raw SQL against production.** Rejected: no assertion that the rows hold
  what the author saw, and no audit entry.
- **A second endpoint for corrections.** Rejected: it needs a step-up proof for
  a rare repair, and adds a route to the public server for one use.
- **Count only the bought amount in `backfilled()`.** Rejected: the bonus
  would be both paid and given.

## Verification

- `TestOfflineBackfillWithBonusCoversTheBoughtAndTheBonusQuota`: a backfill of
  5000 plus 500 against $5500 hand-added leaves gift consumption at zero; bought
  5000, bonus 500 and the adjustment net 5500 agree; of a $50 use, 500/5500
  counts as gifted; a bonus of 501 is refused.
- `TestOfflinePaymentCreditsItsBonus`: the wallet gets 110 for 100 plus 10.
- `TestCorrectOfflineBackfillsMovesTheBonusOutOfTheBoughtAmount`: the three
  PathPal rows become 15,000 bought and 1,500 bonus, wallet and money unchanged,
  a dry run writes nothing, a wrong expectation or total fails the batch, the
  second run is a no-op with no second audit entry.
- `TestAdminRecordOfflineTopUpBindsTheBonusToTheProof`: a plain proof cannot
  buy a bonus.

An enterprise transfer is recorded with
`{"user_id":…,"money":5000,"amount":5000,"bonus":500,"paid_at":…,"backfill":true}`.
