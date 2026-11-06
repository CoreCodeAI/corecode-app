# Agent Note: Stop listing quota as unused when the pool is projected to run short

Status: implemented

## Problem

The pool tab's "Quota that will expire unused" panel
(`2026-11-06-show-quota-that-will-expire-unused`) listed #10024 with $678 unused at its reset,
while the capacity verdict on the same tab projected the pool running out of quota around
2026-11-10 04:00. The owner noticed: if the pool runs dry, the quota cannot all go unused.

The two figures answer different questions. The projection holds each account at its own spend
rate of the last 24 hours until its reset. It does not move traffic. A pool short of quota does:
the accounts that reach their five-hour or weekly budget line first are excluded, and their
traffic goes to the accounts that still have quota. What one account would leave at its own
recent rate gets used.

A replay of last week's requests against the pool as it stood on 2026-11-06 shows where the
projection stops meaning anything. Scaling the demand, medians over 12 seeds, weekly quota
unused at the resets:

| Demand against last week | Pool total unused | #10024 unused | Demand no account could take |
|---|---|---|---|
| ×1.0 | $444 | $138 | $0 |
| ×1.3 | $66 | $6 | $119 |
| ×1.6 | $59 | $6 | $1,770 |
| ×2.0 | $55 | $6 | $6,067 |

Somewhere between ×1.0 and ×1.3 the waste goes. The figures left over are a few dollars on
accounts about to reset. #10024 also spent $14 an hour over the last three hours, above the $11.68
an hour it needed, while the 24-hour average the panel reads was $5.1.

## Decision

- **The panel says the quota will be used when the runway projects a shortage.** In place of
  the account list it shows one sentence naming the amount and why: accounts that reach their
  budget lines first send their traffic to the rest. The list returns when the pool keeps up.
- **The "Unused at reset" tile keeps its figure and loses its warning tone**, with a hint that
  most of it will be used.
- **One test of "short" for both.** `poolRunsShort` in `unused-quota.ts` is
  `week_load >= 1 || week_hours != null`, the test `CapacityVerdict` already used for "not enough
  capacity", which now calls the helper. A panel and a verdict that read different tests would
  disagree again the first time one was tuned. A tight pool (`week_load` of 0.85 to 1) is not
  short here: the list stays.
- **The strings are in all eight locales.**

## Alternatives considered

**Hide the panel when the pool runs short.** The sentence keeps the amount visible and says why it
does not count, so the owner does not wonder where the panel went.

**Compute a redistribution-aware projection in the engine.** The engine's `week_unused_usd` could
fill the weekly quota earliest-reset-first from the pool's total demand instead of each account's
own rate. It would fix the figure itself, for every consumer. It changes the meaning of an existing
field, so it needs its own change and release; the engine has not been deploying (below).

**Show the last three hours' rate beside the 24-hour one.** It would show an account that is
catching up. The app would need the engine's per-account usage for a short window, and a three-hour
sample swings with the time of day. Not done.

## Consequences

- When the pool is short, the projection is not shown as a list of accounts. An account can still
  strand quota if it is excluded by something other than the pool's load, such as a cooldown or a
  reauthorization; the status columns of "All accounts" show that.
- The engine's pace controller (`pace_routing`, off) reads the same per-account projection. It
  normalizes the factors, so a pool that is behind everywhere moves nothing. Under a shortage it
  has little to do, and the replay shows its gain only at about last week's demand or below.
- The engine's last three releases (#66, #67, #68) were published but not deployed: the release
  script waits up to ten minutes for a moment with no request in flight and postpones otherwise, and
  in-flight requests have stayed at 10 to 20. That is separate from this change and needs an owner's
  decision.

## Verification

- `bun run typecheck`, `bunx vitest run src/features/site-insights` (17 files, 118 tests),
  `bun run lint:check` and `node scripts/format-with-protected-headers.mjs --check` pass.
- New tests cover `poolRunsShort` at the boundaries (load 0.9 is not short, 1 is, a gap is), the list
  while the pool keeps up, the sentence and no account when it runs short, and nothing when no
  account qualifies.
- The replay table uses the engine's `pace_replay_test.go` with the demand scaled
  (`PACE_REPLAY_DEMAND`, a local change that is not in the repository), 12 seeds per scale, estimates
  perturbed by ±30%. It scales demand uniformly and leaves out concurrency limits and per-group
  eligibility, so the crossing between ×1.0 and ×1.3 is not located more finely than that.
- Not checked in a browser against production data.
