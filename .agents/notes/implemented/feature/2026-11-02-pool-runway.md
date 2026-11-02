# Agent Note: Show how long the Claude pool lasts on the pool tab

Status: implemented

## Problem

The pool tab shows the dollars the pool has left in its 5-hour and 7-day windows, but
the owner asks how long the pool lasts. Dollars left divided by spend is misleading:
each account refills at its own weekly reset, and what it has not spent by then is
lost. On 2026-11-02 the pool had $2,056 of weekly quota left at $41.7 an hour, which
reads as 49 hours; counting the resets due in that time, it lasts about 100.

## Decision

- **The pool response adds `runway`** for the Claude channel, computed in
  `service/engine_runway.go` from figures the response already carries. The engine
  is unchanged.
- **Demand** is every Claude account's `burn_usd_per_hour`, its logged spend over the
  last 24 hours, including accounts paused now: their traffic moves to the others.
- **Supply** is each counted account's weekly remainder now and, at each weekly reset,
  its calibrated weekly capacity times its group's 7-day budget line. An account is
  counted when its group is enabled, it is not suspended, disabled, blacklisted or
  awaiting reauthorization, and the estimate gives its remainder, capacity and reset.
  An account that could serve but lacks one of those figures is reported as `unknown`.
- **The projection** spreads demand over the accounts in proportion to what each has
  left, which is close to the engine's headroom routing, so all drain at one rate. A
  reset replaces an account's remainder with its full budget. `week_hours` is the first
  time demand finds nothing left, looking 14 days ahead; past that the pool has cycled
  every account twice and `week_load` (a week of demand over a week of capacity)
  says whether it keeps up.
- **The 5-hour figure** is the counted accounts' 5-hour remainder over the same demand.
  It ignores 5-hour resets, so it is a lower bound.
- **The tab** shows a "Claude pool runway" panel: 7-day lasts with the time it runs out,
  weekly load with a meter, 5-hour lasts, and demand per hour with the counted and unknown
  accounts. The panel is hidden when the server does not send `runway`.

## Alternatives considered

- **Remainder over spend.** It ignores resets and halves the answer for this pool.
- **Earliest-reset-first draining.** It is the most the pool could serve, but the
  engine does not route that way, so it would overstate the runway.
- **All channels together.** Codex, Grok and Gemini quota cannot serve Claude
  requests. Only Claude carries calibrated capacities today; another channel can be
  added by calling `poolRunway` with its name.
- **Computing in the engine.** The engine's own page would gain it too, but the app
  already has every input, and this ships without a cross-repository order.

## Consequences

- Spend the pool turned away is not in the demand, so a saturated pool lasts less than
  shown. The panel's help says so.
- A 24-hour average hides daytime peaks; the 5-hour figure is optimistic during them.
- The figure moves with calibration: a capacity the engine revises moves the runway.

## Verification

- `engine_runway_test.go` covers running out before any reset, a reset that discards a
  remainder, a pool that keeps up past the horizon, channel and status filtering with
  unknown accounts, and no spend. `TestFetchEnginePool` checks the field is joined.
- `go test ./service/ ./controller/ ./router/ ./middleware/` passes, except
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails the same way on
  `origin/main` here: the local proxy's DNS answers its `.invalid` host.
- Web: `bun run typecheck` (it reported a planted error first), `format:check`,
  `lint:check`, `bun run test` (2813), `build` and `first-load:check`.
- Production data: the live pool response, read through a read-only proxy, run through
  `poolRunway`, gave 8 counted accounts, $41.7 an hour, weekly load 126% and about
  100 hours, which a hand walk through the resets matched. The panel rendered those
  figures; each help label opened on hover, and at 390 px the page did not overflow.
