# Agent Note: Root invitation page and custom invite codes

Status: implemented

## Problem

- The invitation program's terms sat in System Settings → Billing, next to
  payment gateways, and per-user rates sat in the user list's row menu.
  Nothing listed who invites, how many users each brought in, or what they
  earned, so the operators had no place to watch the program.
- Every invite code was four random characters. A promotion channel could not
  be given a link that carries its own name.
- Every administrator could change any user's rate, channel mark and inviter,
  and pay out withdrawals. The operators want that to be root's alone.

## Decision

- **`/affiliates` is a root-only console page** with three tabs: the
  affiliate list, the withdrawal requests, and the program settings. The
  settings form and the withdrawal table moved there from
  `system-settings/billing` unchanged; the settings still save as the
  `affiliate_setting.*` option rows through `PUT /api/option/`. Above the tabs
  sit the program totals and its current rates.
- **`GET /api/affiliate/admin/affiliates`** pages users who have an
  `affiliates` row or at least one invitee. The second case keeps users who
  invited people while the program was off, when codes bind without creating
  a row. It filters by keyword (id, username, email, display name, exact
  code) and by type (`channel`, `inviting`, `revoked`), and sorts by invitee
  count, earned commission or newest user. Invitee counts come from a grouped
  subquery on `users.inviter_id` joined to the page, so one query serves the
  rows and the order.
- **`GET /api/affiliate/admin/overview`** sums inviters, invitees, channels,
  earned and unpaid commission, and pending withdrawals.
- **`PUT /api/affiliate/admin/users/:id/code`** sets a user's `aff_code` to a
  code root chooses: 3 to 32 of `A-Z a-z 0-9 _ -`, which fits the
  `varchar(32)` column and needs no escaping in a URL. Uniqueness is checked
  with `LOWER(aff_code)` across deleted users too, because MySQL's unique
  index and lookups ignore case while PostgreSQL's and SQLite's do not, and a
  deleted row still holds its index entry. The old code stops binding at
  once; the dialog says so. Sign-up binding is unchanged: the code is still
  looked up in `InviterIdForAffCode`.
- **`GET /api/affiliate/admin/users/:id/invitees`** gives root the invitee
  list the user sees on their invitations page, unmasked, with the same
  totals. The user's invitation dialog shows it, with the code editor and the
  copyable link.
- **Managing the program is `RootAuth`.** Every `/api/affiliate/admin` route
  moved to root except `GET /users/:id`, which the usage-log user card calls
  for any administrator to show a user's inviter. The user list shows the
  Invitation settings item to root only. The access-token scopes of the
  existing routes are unchanged.

## Alternatives considered

Not recorded when the change shipped.

## Compatibility

The server ships before the console. The console in production calls only
routes that still exist; an administrator who is not root loses the write
calls, which is the intended change. The new console reads only the new
routes, so it must not ship before the server.

## Verification

- `go test ./model -run 'TestAffiliate|TestSetUserInviter'` against SQLite,
  PostgreSQL 16 and MySQL 8.0 (`TestAffiliateAdminDatabaseMatrix` covers the
  list filters, the overview, case-insensitive code uniqueness, binding with a
  new code and rejecting invalid ones).
- `go test ./middleware ./router ./controller`.
- `bun run typecheck`, `vitest` (the dialog test covers the code editor).
