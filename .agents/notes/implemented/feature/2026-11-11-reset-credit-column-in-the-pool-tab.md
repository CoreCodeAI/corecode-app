# Agent Note: A reset credit column in the pool tab

Status: implemented

## Problem

Root watches the Claude accounts on `/site-insights?tab=pool`. To use an account's reset
credit, root had to open the engine console through the IAP tunnel and find the same
account again. corecode-engine now reports each account's credits and their kind (full or
partial) in `/group-concurrency`, and it redeems a credit of a chosen kind. The order the
two repositories ship in is set out in corecode-infra's
`notes/workspace/implemented/feature/2026-11-11-redeem-reset-credits-from-the-pool-tab.md`.

## Decision

- **Server**
  - `EngineAccount.reset_credits` copies the engine's list. An engine that predates the
    field yields an empty list.
  - `POST /api/site-insights/pool/groups/:group_id/credentials/:credential_id/reset-credits`
    is root only, with PAT scope `ops:write`. It forwards `kind` and `idempotency_key` to
    the engine's consume endpoint, sending the key in the `Idempotency-Key` header, and
    drops the cached pool.
  - Engine error codes become translatable messages. The response keeps the engine's
    `code`. When the engine gives no answer, the response carries
    `RESET_CREDIT_OUTCOME_UNKNOWN`, because the redemption may have been sent.
- **Console**
  - The "Reset credits" column appears only when an account in the provider holds a credit.
    Each account gets one button per kind; its tooltip says which limits that kind clears
    and when each credit expires.
  - The confirmation names the kind and the account.
  - The browser generates one idempotency key per account and kind. It keeps the key after
    `RESET_CREDIT_OUTCOME_UNKNOWN`, so a second confirmation asks the engine about the same
    redemption instead of spending another credit. It drops the key after any other answer.

## Alternatives considered

- **Generate the idempotency key on the server.** A server-side key would be new on every
  request, so a retry after a timeout could spend a second credit. The key has to live
  where the operator retries, which is the browser.

## Verification

- `TestEnginePoolCarriesResetCredits` and `TestConsumeEngineResetCredit` check the field,
  the request the server sends to the engine, the cache drop, and how an engine error code
  is read.
- `reset-credits-cell.test.tsx` checks that each kind gets its own button, that an account
  without credits gets none, and that a retry after an unknown outcome reuses the key.
