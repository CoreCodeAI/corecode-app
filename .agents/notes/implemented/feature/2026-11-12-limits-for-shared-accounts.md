# Agent Note: Limits for an account that many people share

Status: implemented

## Problem

A company asked for one administrator account that holds about 40 API keys, one per
employee, instead of 40 customer accounts. Every limit that counts per account then
counts all of them together:

- **Concurrency.** `token_setting.user_concurrency_limits` already raises one user's
  limit, and the account was given 200 (40 × the default of 5). With nothing below
  it, one key can take all 200 slots and leave the other 39 people waiting.
- **Requests per minute.** `ModelRequestRateLimit` counts per user: 150 a minute
  across every key. 200 long-running requests start about 400 a minute, so the rate
  limit binds long before the concurrency limit does. Its only override is per group,
  and it looks up the key's group (`Claude 满血（可外接）`, `auto`, …), not the user's,
  so no user group can raise it for one customer.

## Decision

- **`token_setting.user_token_concurrency_limits`** maps a user id to the number of
  requests each of that user's keys may have in flight. Absent or 0 leaves the keys
  uncapped, so every other account behaves as before. It is validated like
  `user_concurrency_limits`.
- **`UserConcurrencyLimit` checks the key before the account,** under the same lock,
  and holds both slots until the request ends. A key at its cap gets 429 with
  `Retry-After: 1` and a message that names the key; the account's 429 still names
  the account. Both rejections count in the dashboard's concurrency rejections.
  A request without a key (the playground) is not capped per key. An account
  without an account limit is still not counted per account, and billing's trust
  threshold still scales by the account limit only.
- **`ModelRequestRateLimitUser`** maps a user id to `[total, success]`, the same shape
  as `ModelRequestRateLimitGroup`. It replaces both the global and the group limits
  for that user, and all of the user's requests count together whatever their group.
  The value is validated like a group's, with a canonical positive user id as key.

## Alternatives considered

- **A user group for the company.** Groups also price requests and pick channels; a
  user group would appear as a key group with no channels, and the rate limit reads
  the key's group, not the user's. Per-user overrides change only the limits.
- **One account per employee.** It keeps every limit right with no code, but the
  company would manage 40 sign-ins and 40 wallets, which is what it asked to avoid.
- **Bring back a site-wide per-key limit.** `2026-10-27-user-concurrency-limit.md`
  dropped the per-token limit because, once the account total is bounded, a per-key
  cap adds nothing for an account one person uses. That still holds; here a key
  stands for a person, so the cap is opt-in per account.
- **Limit per key in corecode-engine.** Every customer request reaches it through the
  new-api channel's one access key, so it cannot tell the keys apart.

## Consequences

- Neither setting has a console field yet; an operator writes it with
  `PUT /api/option/`. The dashboard's per-user override panel saves only
  `user_concurrency_limits`, so it leaves both new maps alone.
- The per-key count lives in process memory like the account count, so during a
  blue/green release a key may reach twice its cap.
- Violation strikes still count per account: one employee's strikes suspend every key
  of the company's account.

## Verification

Run on 2026-11-12 in a worktree at `feat/enterprise-account-limits`.

- `go vet ./...` is clean (with the stand-in `web/dist` CI uses).
- `go test ./common/... ./controller/... ./middleware/... ./model/... ./service/...
  ./setting/... ./i18n/...` passes, and the middleware concurrency and rate-limit
  tests pass under `-race`.
- `TestUserTokenConcurrencyLimit` fills one key to its cap of two and checks that a
  third request on it gets the key's 429 while another key of the same account
  passes, that the account limit of three still holds across keys, that a key is
  capped for an account without an account limit, that keyless requests are not
  counted per key, and that every slot is freed at the end.
- `TestModelRateLimitUserOverride` checks that an overridden user passes a group limit
  of one, shares one count of three across two groups, and that another user keeps
  the global limit. `TestCheckModelRequestRateLimitUser` covers validation.
