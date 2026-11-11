# Agent Note: Draw the demand under the supply on the pool's forecast curve

Status: implemented

## Problem

The "Supply and demand" panel on `/site-insights?tab=pool` drew one line: the quota the
window is read by (spendable at once for 5 and 24 hours, weekly quota left for 7 days),
filled below, with the stretches that have nothing to spend shaded red. Demand appeared
only in the tooltip. The owner read the single line as the demand and asked on 2026-11-11
to see the supply's curve as well, told clearly apart from the demand.

## Decision

`OutlookChart` draws two panels on one time axis:

- **Supply**, above: the series the window is read by, as before. Brand color, solid line,
  its fill or the forecast's usual range, and the reset marks. Its scale is dollars.
- **Demand**, below: the model's demand at each point. Ink, dashed line, and the demand at
  the band's low and high scale (`model.low.scale`, `model.high.scale`) as a gray band. Its
  scale is dollars an hour, which the panel's title names.

The two series differ in color, stroke, and position, and each panel's title carries a
swatch of its line, so neither depends on color alone. The red stretches run through both
panels: the demand drawn there is the demand that goes unserved. One pointer area spans both
panels, so a hover, tap, or arrow key reads both at the same moment, each with its range.

## Alternatives considered

- **Both lines on one plot with a second y-axis.** Supply is a stock in dollars and demand a
  rate in dollars an hour. Two scales on one plot invite reading the crossing of the lines as
  the moment the pool runs short, which it is not.
- **Cumulative demand against cumulative supply.** One unit, but the supply curve would be
  "served so far plus spendable now", a figure no card or table shows.
- **A brand hue for demand.** The palette validator fails chart-4 against the primary for
  normal vision (ΔE 11.4) and chart-2 on chroma; chart-3 already marks weekly resets. Ink is
  apart from the terracotta in light and dark and under every color-vision deficiency.

## Verification

- `outlook-chart.test.tsx`: each panel names its series, the chart's name gives the demand
  now and its peak, and the readout gives the demand and its range.
- `bun run typecheck`, `lint:check`, `format:check`, `build`, and `first-load:check`. The
  stylesheet is shared by every page, so the chart uses only utility classes it already
  carried; two new ones had put `/sign-in` about 90 bytes over its budget.
- In a browser against a local mock of `/api/site-insights/pool-outlook` (281 points, a week
  that runs dry): desktop dark, 390 px light; the pointer read out at 80 of 80 positions
  across both panels in the 7-day and 5-hour windows, and 20 of 20 touch taps at 390 px; no
  horizontal overflow.
