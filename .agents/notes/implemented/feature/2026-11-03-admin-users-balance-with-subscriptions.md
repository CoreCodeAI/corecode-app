# Agent Note: Count subscriptions in the admin user list's balance

Status: implemented

## Problem

The admin user list's 可用余额 column showed `users.quota`, the wallet only.
A customer on a subscription plan with an empty wallet read as 无额度 or 0,
while the 已用 line under it counted their subscription use, because
`used_quota` grows whichever source a request is billed to. The operator
wants the column to show what the user can spend: wallet and subscriptions
together.

## Decision

- **`GET /api/user/` and `GET /api/user/search` add `subscription_remaining`
  to each item:** the quota left on the user's spendable subscriptions, read
  for the whole page in one grouped query (`model.UsersSubscriptionRemaining`),
  beside `paid_total`. The field is added, so a console already in production
  keeps working.
- **A spendable subscription is one billing would spend:** `status = 'active'`
  and `end_time` after now, the predicate the pre-consume path uses. A
  subscription used past its total adds nothing rather than debt.
- **An unlimited subscription (`amount_total = 0`) adds nothing.** It has no
  amount to show; the user's subscriptions dialog still lists it.
- **The console shows the sum as the balance** and lists 钱包 and 当前订阅剩余
  apart in the details popover. A server that does not send the field yet
  counts as no subscription, which is the old display.
- **`sort_by=quota` sorts by the same sum,** the wallet plus a correlated
  subquery over `user_subscriptions`, written as one ORDER BY expression with
  its id tiebreak, as `paid_total` is.

## Alternatives considered

- **A separate subscription column.** The operator asked for one total; the
  breakdown is one click away in the popover.
- **Store the sum on `users`.** Every billing, refund, reset and expiry path
  would need to update it; a sum over `user_subscriptions` cannot drift.

## Consequences

- Each list request runs one more query, over `user_subscriptions` filtered
  by the page's user ids, which `idx_user_sub_active` serves.
- Sorting by balance sums subscriptions for every matching user before the
  page is cut, the same cost profile as sorting by paid total.
- The column's red color now marks a negative total, so a wallet in debt
  offset by a subscription is no longer red; the popover still shows the
  negative wallet.

## Verification

- `TestUsersSubscriptionRemainingDatabaseMatrix`: active capped subscriptions
  count, expired, cancelled, past-end and unlimited ones do not, overuse
  counts as zero, users without one are absent, and `GetAllUsers` descending
  and `SearchUsers` ascending sort by wallet plus subscriptions. Passes on
  SQLite 3.50.4, MySQL 5.7.44 and 8.0.46, PostgreSQL 18.6, with the
  paid-total matrix tests beside it.
- `go test -p 1 ./model/ ./controller/` passes on SQLite.
- Frontend: `vitest run src/features/users`, including a wallet in debt
  offset by a subscription and the popover's wallet and subscription lines;
  `bun run typecheck`, `bun run lint:check`, `oxfmt --check`.
