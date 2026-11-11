# Agent Note: Administrators filter usage logs by user ID

Status: implemented

## Problem

The usage-log filter took only a username, matched exactly against
`logs.username`. An administrator who knows a customer's ID, from the users
page or a support message, typed `546` into it and got nothing, because no
username is "546". Upstream new-api has no ID filter either.

## Decision

- `GET /api/log`, `/api/log/stat` and `/api/log/export` read `user_id` for
  administrators and filter on `logs.user_id`, which is indexed. The self
  routes ignore it, as they ignore `username` and `channel`.
- The console adds a separate 「用户 ID」 input beside 「用户名」 in the
  administrator view. It accepts digits only and travels as `userId` in the
  page URL; the route schema also takes a bare number there, which is what a
  hand-written `?userId=546` parses to.
- `SumUsedQuota` takes the user ID as a new argument; the self stat passes 0
  and keeps filtering by the caller's username.

## Alternatives considered

- **Treat a numeric username input as an ID too**, as the users page search
  does with `id = ? OR username LIKE ?`. Magic-link sign-up names an account
  after the mailbox, so a QQ address such as `546@qq.com` gets the username
  `546`, and one input would mix that account's logs with user 546's. A
  separate field keeps both searches exact.

## Consequences

- The server change is additive: the console in production does not send
  `user_id`, so the server can ship first. The new console sends `user_id`
  without checking that the server reads it; if the console ships first, an
  older server ignores the field and the page shows every user's logs, which
  is visible rather than wrong.
- Logs keep the `user_id` they were written with, so an ID search also finds
  rows written before a rename, which a username search misses.

## Verification

- `go test ./controller/... ./model/... ./service/... ./middleware/... ./common/...`:
  pass, except `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails
  only with the local shell's proxy variables and passes without them. The new
  `user_id` assertions in `TestLogExportDatabaseMatrix` fail when the filter
  condition is disabled.
- From `web/`: `bun run typecheck`, `bun run lint:check`, `bun run format:check`,
  `bun run test src/features/usage-logs src/features/dashboard` (40 files, 577
  tests), `bun run build` and `bun run first-load:check`: pass. The new
  `user-id-filter.test.tsx` fails when `buildApiParams` drops `user_id` and
  when the route schema stops accepting a number.
