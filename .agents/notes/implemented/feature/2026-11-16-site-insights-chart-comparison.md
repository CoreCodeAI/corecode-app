# Agent Note: Compare trends with the previous period, keep a small channel off the failure axis, and print big counts short

Status: implemented

## Problem

Three chart problems on `/site-insights`.

- **Trends show the current period only.** Every comparison with the previous period is a "▲ 56%" figure, and no chart draws the previous period.
- **The upstream "Failure rate by channel" chart cannot be read for its main channel.** A channel with 269 attempts fails 68.7%. It shares the value axis with the main channel, which has 260,000 attempts at 0.1%, so the main line lies on zero.
- **Big numbers are printed whole.** The quality tab's cache chart labels bars "10,254,384,179" and its axis "15,000,000,000". Labels are cut off at the bar edges.

## Decision

- **A previous-period reference line.** `TrendPoint` and `BarPoint` take an optional `previous` value, aligned by position: day 1 with day 1, and an hour with the hour one range earlier. `Sparkline` draws it as a thin muted line, and `BarSeries` draws a total's reference as a line through the bar centres. The readout gives it after the value (for example "11/12 ¥6,300 · 上一周期 ¥4,100"), and a bar's tooltip lists it as a row. Absent without a loaded previous period, or where the previous period lies before the logs.
  - Applied to the overview's three headline sparklines (revenue, requests, sign-ups; daily and hourly), the finance tab's daily revenue bars, the growth tab's registrations, the quality tab's requests, and the risk tab's sign-ups.
  - A partial first or last day keeps its dashed drawing. The previous period's own first and last days are partial too, since its ends are floored the same way, so the reference is dashed at those positions and read out as "Previous period, part of a day". Both periods' edge days read low, so the comparison there is like with like.
- **Off-axis channels.** `offAxisSeries` (in `upstream.ts`) marks a channel under 5% of the range's attempts as off-axis. The busiest channel always sets the axis. An off-axis series' bars run to the top, its legend name reads "…, off scale", and its readout still gives its own rate. The help text says why. Applied to the daily and hourly failure-rate charts.
- **Compact figures past a million.** `useInsightsFormat().numCompact` wraps `formatCompactNumber` in the locale (10.3B in English, 102.5亿 in Chinese, matching the other compact figures). `BarSeries` uses it for its axis and bar labels once the axis reaches a million; the readout keeps the full figure. The quality cache chart and the upstream attempts charts set it explicitly.

## Alternatives considered

- **Split low-volume channels into their own panel.** This keeps the scale honest but makes the channel a second chart a reader must compare. Clipping keeps one chart and names the channel above it.
- **Hide the small channel.** Not allowed: a failing channel must stay named.
- **Full-width reference bars instead of a line.** Two colours of bars compete with the current period. A thin muted line reads as secondary.

## Consequences

- Charts without a loaded previous period, or whose previous period lies before the logs, draw exactly as before.
- Daily references depend on both periods' ranges having the same number of days. Where they differ by one, the extra position has no reference.
- The growth tab's registrations trend has no browser check: the local stub has no growth fixture that renders the full tab.

## Verification

- From the web tree: `bunx oxfmt --check` on site-insights, `bun run typecheck`, `bun run lint:check`, `bunx vitest run src/features/site-insights src/i18n` (53 files, 588 tests), `bun run build` and `bun run first-load:check` all exited 0. `git diff --check` was clean.
- First load, read in bytes: `/dashboard/overview` leaves 348 bytes on this branch and 357 on origin/main, a cost of 9 bytes. The entry chunk's raw size is unchanged; the difference is brotli noise from a renamed minified symbol.
- Browser, against a local stub API with fixtures, on a dev server on a free port (stopped afterwards):
  - Pointer sweep, 40 of 40 on each: overview revenue, requests and sign-ups sparklines (each read out a previous value at all 40 positions); finance daily revenue bars; quality cache bars.
  - Touch sweep at 390 px, 40 of 40 on each: the three overview sparklines, the finance bars, the quality cache bars, and the upstream failure chart.
  - Upstream failure chart: the small channel reads "超出刻度" (off scale) and the axis tops out at the busy channel's 0.1%.
  - Cache chart axis reads 50亿 to 200亿 (compact); the readout keeps the full figure.
  - No horizontal overflow at 360 and 390 px (scrollWidth equals innerWidth on the overview and on each tab measured).
- Not checked in a browser: the growth tab's registrations trend and the risk tab's sign-ups trend. The stub has a growth fixture but the risk trend was not swept; both are covered by the unit tests only.
- Touch emulation in the headless browser maps taps to 0.9 of the requested point; the sweeps corrected for it, and the pointer sweeps ran at the unscaled desktop width.
