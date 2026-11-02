# Agent Note: Read the console's charts on a phone

Status: implemented

## Problem

On a phone, `/site-insights` and `/topups` drew their charts but answered nothing.

- **Bar charts, breakdowns, the retention grid and the pool's cells** explain
  themselves in Base UI tooltips. Base UI 1.6 opens a tooltip on mouse hover and on
  keyboard focus only (`TooltipTrigger` runs its hover hook with `mouseOnly: true`),
  so a tap opened nothing.
- **The sparkline** cleared its readout on `pointerleave`. A lifted finger fires
  `pointerleave` straight after `pointerup`, so a tap showed its point for no visible
  time.
- **The `/site-insights` tab bar** wrapped onto two or three uneven rows at phone
  width, and the group labels (`运维`, `经营`) broke away from their tabs, or broke
  into one character per line.
- **The `/topups` filters** stacked into five full-width rows above the records, the
  date range wrapped onto two lines, and the daily chart had no dates.

A mouse sweep across the hourly charts on `/site-insights?tab=capacity` also found
dead points in production: 36 of 40 positions read out on the rejections chart. Two
causes:

- The dashed line that starts a new day was a `border-l` on the `<li>`, outside the
  bar's trigger.
- Some `<li>` edges snapped half a pixel before their child trigger's, leaving a
  hairline that hit the `<li>` and no bar.

## Decision

- **`TapTooltip` / `TapTooltipTrigger`** (`web/src/components/tap-tooltip.tsx`)
  wrap Base UI's tooltip in controlled state:
  - A non-mouse `pointerdown` toggles it; a tap anywhere else closes it through Base
    UI's own outside-press dismissal.
  - `closeOnClick={false}` keeps the click that the same tap fires from closing it
    again.
  - A mouse behaves as before.

  Every value-bearing tooltip on both pages uses it. `components/ui/tooltip.tsx` is
  upstream's and stays untouched.
- **The sparkline** picks a point on `pointerdown` and ignores a touch
  `pointerleave`, so the point stays read until a tap elsewhere blurs the chart.
  `touch-pan-y` lets a sideways drag scrub through points while a vertical drag still
  scrolls the page. Focus no longer jumps to the latest point when a tap has already
  picked one.
- **Each bar's `<li>` is its own tooltip trigger**, in `BarSeries` and in the topups
  chart. The day divider is a border on that trigger. No element sits between a list
  item and its bar, so no sliver is left over.
- **The tab bar is one row that scrolls sideways** when it does not fit, using the
  console's `no-scrollbar` utility (as the client setup guide's tabs do). The open
  tab is scrolled into view, and group labels and separators do not shrink. The page
  grid uses a `minmax(0,1fr)` track; without it, the row's width widened the whole
  page.
- **The topups filter bar uses `LogsFilterToolbar`'s mobile mode**: the date range is
  pinned and the other four filters open in its drawer, as on the audit log. The
  compact date picker writes a range within one year as `MM/DD HH:mm – MM/DD HH:mm`
  on a phone.
- **The topups chart shows its first and last day** under the bars.

## Alternatives considered

- **Switch the charts to `Popover` with `openOnHover`,** as the help icons do.
  Hover-open popovers lose the tooltip provider's instant hand-off from bar to bar,
  which the hourly charts rely on.
- **Patch `components/ui/tooltip.tsx`.** Every upstream sync would conflict there,
  and the shared primitive also serves buttons, where a tap should act, not explain.
- **Replace the tab bar with a select on a phone.** That costs a tap to see the
  other views; a scrolling row keeps every tab one tap away.

## Verification

All checks below ran against production data, served through the read-only proxy (lesson
`check-console-changes-against-production-through-a-read-only-proxy` in
corecode-infra), with real CDP touch events at 375 px.

- **Tap sweep, 40 evenly spaced taps per chart**
  (lesson `hover-every-figure-before-calling-a-dashboard-readable`):
  - risk tab, sign-up bars: 40/40.
  - risk tab, sparkline: 40/40.
  - capacity tab, both 169-bar hourly charts: 40/40 each.
  - topups daily chart: 40/40.
  - A second tap on the same bar closes it.
  - A sideways drag scrubs the sparkline from 10/26 to 11/2.
  - A vertical swipe that starts on the sparkline scrolls the page by 252 px.
  - The retention cell and the pool's 5-hour window cell open on a tap.
- **Mouse sweep, capacity at 1280 px**:
  - Production: 40/40 and 36/40 (misses 2, 24, 26, 34 on both runs).
  - This change: 40/40 on both charts, and no position hits anything but a trigger
    in a 0.25 px scan across each.
- **Tab bar**: at 320, 375 and 1280 px, the open tab is in view and nothing
  overflows the page.
- **Tests**: tests for tap readouts, the sparkline after a lifted finger, and the
  bar-as-item structure fail on the old code and pass here. Typecheck, format, lint
  baseline, the full test suite, build and the first-load check pass.
