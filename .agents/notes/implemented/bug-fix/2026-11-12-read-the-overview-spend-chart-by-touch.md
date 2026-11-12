# Agent Note: Read the overview's spend chart by touch

Status: implemented

## Problem

On the customer overview, each day's spend, request count and cache rate sat in a
tooltip that opens on mouse hover and keyboard focus only. On a phone a tap showed
nothing: 0 of 40 taps across the chart on production on 2026-11-11. The date labels
under the bars were truncated in columns narrower than a date, so a phone showed "10...".

`2026-11-02-read-console-charts-on-a-phone.md` fixed the same thing on `/site-insights`
and `/topups`; this chart was not part of it.

## Decision

- Each day uses `TapTooltip` / `TapTooltipTrigger` (`components/tap-tooltip.tsx`), and
  the `<li>` itself is the trigger, with the bar's side padding and the date label inside
  it. No element sits between a list item and its trigger, which is what left dead
  slivers in the earlier charts.
- At phone width every other date is hidden, counting back from today, and the ones that
  stay may spill past their column (`max-sm:overflow-visible`) into the hidden
  neighbours' space. From `sm` up the labels are as before.

## Alternatives considered

- **Swap the tooltip component and keep the inner `<div>` trigger.** The 11-02 note
  records that layout missing taps at a list item's edge (36 of 40).
- **Day-of-month only on a phone.** "31, 2, 4" across a month boundary reads worse than
  fewer full dates.

## Consequences

- A mouse and the keyboard behave as before: hover and focus open the day at once.
- The tooltip of a bar at the right edge covers part of the Spend / Cache switch while
  it is open, as it does on hover.
- `/dashboard/overview` first load: 540,922 bytes of 542,720, with the three other
  changes in the same pull request.

## Verification

- `overview/__tests__/spend-trend-panel.test.tsx`: each list item is its own trigger; a
  touch `pointerdown` opens the day and a second closes it; keyboard focus opens it;
  alternate dates are hidden at phone width. With `spend-trend-panel.tsx` from main, 3 of
  the 6 tests fail.
- Headless Chrome against a local server seeded with 14 days of spend: at 1280 px a
  mouse read a day at 40 of 40 positions across the chart; at 390 px with touch
  emulation, taps read a day at 40 of 40 positions through the bars, 40 of 40 along the
  bottom edge and 40 of 40 along the top edge. The seven visible date labels at 390 px
  were whole ("10/31" … "11/10", "今天").

Not checked on a real phone.
