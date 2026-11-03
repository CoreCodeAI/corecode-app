# Agent Note: Show the paid spend behind invitation commission

Status: implemented

## Problem

The invitations page lists each invitee's total spend (`users.used_quota`)
next to the commission they earned the caller. The two do not line up.
Commission is paid only on consumption the invitee's own payments cover
(`2026-10-25-affiliate-commission.md`); total spend also counts gifted plans,
top-up bonus and discount quota. A customer reading "spent $30, earned $0.50"
at a 10% rate sees an error. The page also did not show the caller's own rate
or whether they are a promotion channel.

## Decision

- **`commission_base` on each invitee and in `totals`.** It is
  `SUM(affiliate_commissions.base)` over the same level-1 credits that
  `commission` sums, so `commission` is `commission_base` at the rate of each
  credit. The console shows it as "Paid spend" (累计真实充值消费), between
  total spend and commission.
- **Sum the credit rows, not `affiliate_referrals.base`.** The referral's base
  belongs to the invitee and advances even when nothing is credited (program
  off, inviter disabled or at rate 0), and it would follow the invitee to a new
  inviter after an administrator changes the inviter. The credit rows are the
  caller's own and match the commission column exactly.
- **The overview shows the caller's rate and a promotion channel badge**,
  from the affiliate summary the page already loads, with the same badges as
  the wallet's invitation card.

## Alternatives considered

- **Sum `affiliate_referrals.base`.** It advances when nothing is credited
  and follows the invitee to a new inviter, so it would not match the
  commission column.

## Consequences

- Paid spend times the current rate equals the commission only while the rate
  has not changed. Each credit keeps the rate of its settlement, and each
  amount is floored.
- A settlement whose commission floors to zero writes no credit row, so its
  base is missing from paid spend. At 10% that base is under 10 quota units,
  a fraction of a cent.
- Settlement runs hourly, so paid spend trails total spend by up to an hour.

## Verification

- `TestAffiliateInviteesDatabaseMatrix` adds an invitee who paid ¥5 and spent
  $20: paid spend $5, commission $1.50. It checks every row and the totals,
  and passes on SQLite 3.50.4, MySQL 5.7.44 and 8.0.46, and PostgreSQL 9.6.24
  and 16.15. Summing `amount` in place of `base` fails it. The change adds no
  table, column or index.
- `go vet ./...` and `go test` over common, controller, middleware, model
  and service pass.
- `invitations-page.test.tsx` checks the paid spend cell, the rate badge, the
  channel badge, and no rate badge without invite rights. `bun run test`
  passes 238 files and 2687 tests; `bun check -b`, `format:check` and oxlint
  on the feature pass.
