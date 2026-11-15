# Agent Note: Magpie import reads the account balance

Status: implemented

## Problem

A customer who imported CoreCode into Magpie saw no balance and had to type
one by hand (feedback #34). The import link named no balance query, so Magpie
found `/api/usage/token/` by itself and read its guess for new-api's key
query, `$data.total_available / 500000`: the key's own remaining quota. The
console creates keys with unlimited quota, where that field is 0. A balance
typed by hand is counted down at Magpie's own prices, which know neither group
ratios nor cache pricing, so it drifted from CoreCode's billing.

## Decision

- **The import link names the query and the field.** `buildMagpieImportURL`
  adds `balance=<base>/api/usage/token/` and
  `balance_path=$data.user_quota.total_available / 500000`: the account's
  balance in USD, which the endpoint returns when the key allows querying
  user quota. This is the same query the CC Switch usage script asks.
- **The CLI snippet sets the same two values** (`balance=` and a quoted
  `balance.path=`), so both Magpie tabs set the provider up the same way.
- **The trailing slash is kept.** Without it, the gateway answers 301 first.

Magpie only accepts a balance URL on the host of one of the provider's own
endpoints (`linkBalance` in magpie's `internal/provider/importurl.go`), and
the base URL is that host.

## Alternatives considered

- Asking Magpie to read `user_quota` whenever `unlimited_quota` is true: that
  would also cover providers added by hand, but it is a change in a
  third-party repository, and a link that names its field does not depend on
  Magpie's guess.
- A field that falls back to the key's quota: Magpie's balance expressions
  have no conditional, and the key's quota on an unlimited key is the 0 that
  caused the report.

## Consequences

- A key created before 2026-10-13 has "allow querying user quota" off. Its
  card shows Magpie's "nothing at data.user_quota.total_available" error, not
  $0, until the customer turns the switch on.
- Importing again replaces the provider with the shared `corecode` id, so a
  customer who imported before gets the balance by importing again.
- Magpie never takes a link's balance query unless the user confirms the
  import, so nothing changes for existing providers on its own.

## Verification

`buildMagpieImportURL` tests pin both parameters and the same-host
requirement, and the snippet test pins the new line. Magpie's own
`ParseImport` and `readBalancePath` at origin/main 129baeca0, run in a
throwaway test, accepted the generated link and read `$24.69` from a reply
with `user_quota.total_available` 12345678. A reply without `user_quota`
gave the error above. The console's typecheck, oxfmt, oxlint, lint baseline,
tests (4027), build and first-load budget pass.
