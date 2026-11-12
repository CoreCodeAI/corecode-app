# Agent Note: A daily quota on a key with no total

Status: implemented

## Problem

A key's daily quota worked only on a key with a total. Turning on Unlimited Quota hid the
daily field, and the API stored 0 for it
([`2026-11-12-daily-quota-per-api-key.md`](2026-11-12-daily-quota-per-api-key.md)). An
operator who wants "at most 100 a day, no lifetime total" could not set that: the total
field only means a balance that runs out, and 0 in it is a key that is already spent.

## Decision

- **The daily cap is independent of Unlimited Quota.** The API keeps `daily_quota` on an
  unlimited key, `SetupContextForToken` always puts it in the context, and
  `TokenDailyQuota` no longer skips unlimited keys. "No total, daily 100" is stored as
  `unlimited_quota = true` with `daily_quota = 100`; no column or migration is added.
  Today's use is already counted for every key, because `TryReserveTokenQuota` calls
  `DecreaseTokenQuota` for unlimited keys too, so a cap turned on mid-day sees what the
  key already used that day.
- **The console shows a total of 0 as "no total limit".** With the Unlimited switch off,
  the total and the daily fields both show, and 0 in either one means no limit. A
  zero total with a daily cap is sent as `unlimited_quota` plus the cap. Editing such a
  key shows it that way again, with the switch off, instead of as plain Unlimited.
- **Both at 0 is rejected in the form.** With the switch off and neither limit set, the
  form reports "Set a total quota or a daily quota, or turn on Unlimited Quota." Both
  fields at 0 would mean the same as the Unlimited switch, so the switch stays the one
  way to get a key with no limit at all, and nobody gets there by leaving two fields
  empty.
- **The server does not repeat that check.** It cannot tell "no total" from an unlimited
  key: both arrive as `unlimited_quota = true`. A key with the switch off, a total of 0
  and no cap was already accepted, and it rejects every request as exhausted, so it is
  not a way to get an unlimited key.

## Alternatives considered

- **A separate "no total" flag.** It would say what the key means, but it adds a column
  and a third state to every place that reads `unlimited_quota`, for a combination the
  existing flag already carries.
- **Keep the switch hiding the daily field and add a second switch.** Two switches say
  "no total" in two ways. Treating 0 as none matches how the daily field already reads.

## Consequences

- An old console that edits an unlimited key with a cap sends `daily_quota: 0` (it forces
  that for an unlimited key) and clears the cap. No such key exists until the new console
  creates one, and the console releases with the server in the same merge, so the window
  is the release itself.
- `GET /v1/dashboard/billing/subscription` still reports an unlimited key as a very
  large limit, including one with a daily cap; the cap is not part of that response.
- The quota query a client such as the setup guide makes treats the key as unlimited.

## Verification

Run on 2026-11-12 in a worktree at `feat/daily-quota-without-total`.

- `go vet ./controller/ ./middleware/ ./model/` is clean, and `go test ./controller/
  ./middleware/ ./model/` passes.
- `TestTokenDailyQuota` now checks that an unlimited key with a cap gets 403 at the cap
  and one without a cap passes. `TestTokenDailyQuotaOnCreateAndUpdate` checks that an
  unlimited key keeps its cap on create and on update, and that 0 or a negative value
  clears it.
- Console: `bunx vitest run src/features/keys` (159 tests), `bun run typecheck` and
  `bun run lint:check` pass. The form tests cover the payload for a total only, a
  cap only, both, and the Unlimited switch; that an unlimited key with a cap reopens
  with the switch off and saves back unchanged; and that neither limit is rejected.
