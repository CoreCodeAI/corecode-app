# Agent Note: Magpie import reads the account balance

Status: implemented

## Problem

A customer who imported CoreCode into Magpie saw no balance and had to type
one by hand (feedback #34). The import link named no balance query, so Magpie
found `/api/usage/token/` by itself and read its guess for new-api's key
query, `$data.total_available / 500000`: the key's own remaining quota. The
console creates keys with unlimited quota, where that field is 0 or below. A
balance typed by hand is counted down at Magpie's own prices, which know
neither group ratios nor cache pricing, so it drifted from CoreCode's billing.

The account's `user_quota` in the same reply was no answer on its own either:
it is the wallet alone. The reporting customer's wallet was 0, with about $36
left on two active subscriptions, as is usual for a customer who bought a
plan. The CC Switch usage script had the same blind spot.

## Decision

- **`/api/usage/token/` adds `user_quota.subscription_available`**: what is
  left on the owner's spendable subscriptions (active, unexpired, with a
  total), from `model.UsersSubscriptionRemaining`, the sum the admin user list
  shows. It is a new field. `total_available` keeps its meaning, because
  new-api channels upstream of other relays and existing CC Switch scripts
  read it.
- **The Magpie import link names the query and the field.**
  `buildMagpieImportURL` adds `balance=<base>/api/usage/token/` and
  `balance_path=$(data.user_quota.total_available + data.user_quota.subscription_available) / 500000`:
  the wallet plus the subscriptions, in USD. The CLI snippet sets the same two
  values (`balance=` and a quoted `balance.path=`). The trailing slash is kept
  because without it the gateway answers 301 first.
- **The CC Switch script adds `subscription_available` too**, as 0 when a
  server does not send it.

Magpie only accepts a balance URL on the host of one of the provider's own
endpoints (`linkBalance` in magpie's `internal/provider/importurl.go`), and
the base URL is that host.

## Alternatives considered

- Folding subscriptions into `user_quota.total_available`: a changed meaning
  for every existing reader of the field.
- Asking Magpie to read `user_quota` whenever `unlimited_quota` is true: a
  change in a third-party repository that would still miss subscriptions.
- A field that falls back to the key's quota: Magpie's balance expressions
  have no conditional, and the key's quota on an unlimited key is the number
  that caused the report.

## Consequences

- The Magpie field needs a server that sends `subscription_available`;
  against an older one Magpie shows "nothing at
  data.user_quota.subscription_available". `release-app.yml` releases the
  server before the console and stops if the server fails. A rollback of the
  server alone, past this change, breaks the Magpie card until the server
  moves forward again.
- A key created before 2026-10-13 has "allow querying user quota" off. Its
  card shows Magpie's "nothing at data.user_quota.total_available" error, not
  $0, until the customer turns the switch on.
- Importing again replaces the provider with the shared `corecode` id, so a
  customer who imported before gets the balance by importing again. Magpie
  only takes a link's balance query once the user confirms the import.
- Each balance read with the switch on costs one more indexed query on
  `user_subscriptions`. The route is already rate-limited by
  `TokenQueryRateLimit`.

## Verification

- `TestGetTokenUsageFollowsTheUserQuotaSwitchAndIPWhitelist` seeds two
  spendable subscriptions (900 + 100), plus an expired one, one used past its
  total and another user's, and pins `subscription_available: 1000`.
- The console tests pin both link parameters, the same-host requirement, the
  snippet line, and the CC Switch sum (wallet 0 + subscriptions $35 = $35).
- Magpie's own `ParseImport` and `readBalancePath` at origin/main 129baeca0,
  run in a throwaway test on the link the console builds, read `$35.51` from
  a reply shaped like the reporting customer's, and `$24.69` from a wallet
  alone. A reply from an older server and a key with the switch off each gave
  the errors above.
