# Agent Note: Set a window's demand against the quota that window can draw on

Status: implemented

## Problem

The pool tab's three demand-and-supply figures read as contradicting each other, and the
owner reported them as such on 2026-11-11 with production numbers:

| Where | Figure | What it is |
|---|---|---|
| "Is capacity enough?" | demand over the next week averages $241/h | the trend averaged over 7 days |
| "Is capacity enough?" | next 24 hours ≈ $4,341 | the forecast's 24-hour average, $181/h |
| "7-day left" | ≈ $3,963 | the remainder now, 21.1% of $18,796 |
| "Claude pool supply" | demand $173.06/h | demand at its current level |

The rates are consistent once the horizons are read off: at 13.8% growth a day, 24 hours
average about 1.07× demand now and 7 days about 1.39×. Nothing on the page says which
horizon each figure covers, so they read as four answers to one question.

The remainder is worse. $3,963 left against $4,341 of demand over the next 24 hours says
the pool runs dry within the day, while the curve beside it shows the 12th served. Both
are right: the remainder is what the pool holds *now*, and the curve refills each account
at its weekly reset. Comparing a stock with a flow was the reader's only option, because
no figure on the page carried the resets.

## Decision

- **`poolRunway` reports `supply_windows`**, one entry per window in
  `runwaySupplyWindows` (5 and 24 hours), each with the window's demand, the quota its
  weekly resets bring back (`refill_usd`), what it can draw on in all
  (`supply_usd` = `week_remaining_usd` + `refill_usd`), and the demand it leaves
  unserved (`short_usd`).
- **The figures come from the base projection**, not from a second model: `projectRunway`
  already steps through resets and meets demand from what is left, so it closes each
  window on the totals it has reached. A window closes before the resets due at the
  moment it closes, so its quota is quota a reader could actually spend inside it.
- **`refill_usd` is what a reset adds**, not a whole week: an account drops what it still
  held when it resets, so the refill is `full - remaining` at that moment. Summing
  remainder and whole weeks would double-count a quiet pool's leftovers.
- **`short_usd` carries the timing** the two totals lose. It is above zero when a refill
  lands after the quota runs out, so a window whose supply covers its demand can still
  report hours served nothing.
- **The pool supply panel gains one card**, "Next 24 hours · quota": the day's drawable
  quota, with its demand, the split between remainder and refill, and the unserved
  demand when there is any. It is the figure the "7-day left" card cannot be.
- **The capacity verdict's 24-hour forecast** reads against the same supply, in its hint
  and in its tone, so the card that asks whether capacity is enough answers it over the
  horizon it shows.
- **"7-day left" says what it is not**: its help now states that the resets ahead are not
  in it, so it is not a day of demand to compare against.

## Alternatives considered

- **Remainder plus the full week of each reset in the window.** Demand-free and simple,
  but it double-counts what an account still holds at its reset. On a quiet pool it
  would overstate the day's quota by nearly a full account.
- **A refill curve, one point an hour.** It gives any window for free and would suit a
  chart, but it adds 169 floats beside the curve already sent, and nothing asks for a
  window the two cards do not cover.
- **Changing "7-day left" to carry the resets.** It is the engine's own estimate of a
  budget line, read in several places; moving the resets into it would make the two
  5-hour and 7-day cards mean different things.
- **Renaming the cards in Chinese only.** The label was part of the confusion, but
  renaming would have left the page with no figure that carries a reset.

## Consequences

- `supply_windows` is absent from a server released before this change; the card and the
  hint stay out of the way, which `pool-tab.test.tsx` checks.
- The window's demand follows demand as it is now. The trend is not carried into it, so
  a fast-growing pool's 24-hour demand reads a few percent low against the capacity
  verdict's own forecast, which is grown.
- 5-hour account windows are not modelled by the runway, so the 5-hour entry refills
  only when a weekly reset lands inside it. The 5-hour card keeps its own cautious
  comparison.

## Verification

- `engine_runway_test.go`:
  - a window whose reset refills it: $150 left and $10/h, a reset at hour 10 that brings
    the account back to its $200 line and drops the $50 it held, so the day draws on
    $300 against $240 of demand;
  - a window whose refill lands too late: $50 left, the reset at hour 20, so $250 of
    supply covers $240 of demand while $150 goes unserved.
- `pool-tab.test.tsx`: the card's value and its split, the unserved figure, the verdict's
  hint against the day's quota, and both staying hidden without `supply_windows`.
- `go test ./service/`, `bun run test -- src/features/site-insights` (131),
  `bun run typecheck`, `bun run lint:check`, `gofmt`, `go vet`.
- Not checked against production data: the figures need this server, and production runs
  the one before it. The release order covers it — the server ships first, and the
  console hides the card until the field arrives.
