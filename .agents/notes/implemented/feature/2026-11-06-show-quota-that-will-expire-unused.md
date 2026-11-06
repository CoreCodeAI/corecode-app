# Agent Note: Show on the pool tab which accounts will leave weekly quota unused

Status: implemented

## Problem

The pool tab showed how much weekly quota the pool has left and whether it keeps up with
demand. It did not show where quota will go to waste. On 2026-11-06 the engine's pool
estimate projected $1,084 of weekly quota unused at the resets, 9.4% of the pool's $11.5k
weekly capacity, while three accounts were close to their weekly ceiling:

| Account | Weekly capacity | Used | Resets in | Spend per hour | Projected unused |
|---|---|---|---|---|---|
| #10024 | $1,223 | 7% | 4.3 days | $4.17 | $683 |
| #10015 | $1,407 | 13% | 5.3 days | $7.45 | $242 |
| #13 | $1,344 | 10% | 6.8 days | $6.34 | $155 |

The runway and the seat count answer whether the pool as a whole is short. They hide this
case, where the pool is short and quota still expires on a few accounts. The engine already
returns `week_unused_usd` per account and `week_unused` in total, but the app decoded
neither, so an operator had to read the engine's own API to see it.

## Decision

- **The server passes the projection through.** `service/engine_pool.go` decodes
  `week_unused_usd` into `EngineAccount.SevenDayUnusedUSD` and `week_unused` into
  `EnginePool.WeekUnused`. Both are new fields; nothing is renamed, so the console already in
  production keeps working. An engine without the projection sends neither, and both stay nil.
- **The pool tab gets a panel and a tile, for Claude only.**
  - "Quota that will expire unused" lists the accounts the engine projects to leave quota,
    worst first, with the weekly quota left, the hours to the reset, and the spend per hour
    against the spend per hour the account would need to use what is left.
  - "Unused at reset" is a summary tile with the pool total, in the warning tone from 5% of
    the weekly capacity.
  - The panel renders nothing when no account qualifies, and neither piece appears against an
    engine that sends no projection.
- **An account qualifies at the larger of $25 and 3% of its weekly capacity.** Below that the
  figure is rounding in the whole-percent readings. `UNUSED_FLOOR_USD` and
  `UNUSED_CAPACITY_SHARE` repeat the two numbers of corecode-engine's pace controller, which
  uses them to decide which accounts to send more new conversations
  (`internal/control/pace_routing.go`). The panel shows the problem and the controller acts on
  it, so the two should flag the same accounts.
- **The helpers live in `unused-quota.ts`**, apart from the panel component, because the
  console's lint gate rejects a component file that also exports functions.

## Alternatives considered

**A new engine endpoint for the projection.** The estimate the app already reads carries it, so
this needs no engine release and no cross-repository ordering.

**Computing the projection in the app from the burn rate.** The engine owns the calibration and
the reset times. A second computation in the app would drift from the one the controller uses.

**Showing every account's projection in the table.** Most accounts project nothing, so the
column would be mostly empty; the panel lists only the ones that need attention.

## Consequences

- The projection is the engine's: remaining weekly quota minus the last 24 hours' average
  spend over the hours to the reset. It reads a day, so a quiet day overstates the waste and a
  busy one hides it. The panel says so in its help text.
- The panel only shows the problem. Moving traffic is the engine's pace controller, which ships
  off and is turned on by the operator.
- A server release carries this. The console reads the new fields as optional, so either can
  go first.

## Verification

- `go test ./service/ -run 'EnginePool|EngineRunway|EngineDemand'` passes, with the estimate
  fixture extended by `week_unused` and `week_unused_usd` and asserts for an account that has
  a projection and one that has none.
- `bun run typecheck`, `bunx vitest run src/features/site-insights` (17 files, 114 tests),
  `bun run lint:check` and `node scripts/format-with-protected-headers.mjs --check` pass. The
  new tests cover the ordering, the noise floor, an engine without the projection, the hours
  and the needed rate, and the panel rendering nothing when no account qualifies.
- The strings are added to all eight locales.
- Not checked in a browser against production data. The figures above come from the engine's
  management API on 2026-11-06.
