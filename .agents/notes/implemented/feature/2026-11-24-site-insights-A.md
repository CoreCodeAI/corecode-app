# Agent Note: Site insights overview answers the owner's questions on its first screen

Status: implemented

## Problem

The overview tab opened on a tall list of findings and per-tab paragraphs. The figures the
owner reads first (money in, money out, profit, volume, stability, how many items need
handling) sat below them, had no trend, and had no chart. The tab was a report to read, not a
board to glance at.

## Decision

Presentation only: no figure, definition or request changed, and the pool tab is untouched.
The order is now status bar, eight figure cards with a small trend each, two main charts, the
three share donuts, busiest models beside top customers, what changed, the live strip, the
provider table, one card per tab, and the findings folded last.

- **One series source for cards and charts.** `overview-series.ts` builds revenue, charge,
  earned revenue, requests, failure rate, sign-ups and active users once (hourly or daily,
  previous period aligned and gated as before). The cards' sparklines and the big charts read
  the same arrays, so they cannot disagree. `hourlyTrend` moved there from the tab.
- **Gross margin has a card and no daily line.** The server sends margin as one range-level
  figure; a daily margin would be a figure nobody computes. The revenue chart draws revenue
  (bars), consumption and earned revenue (lines) instead.
- **`ComboChart` is hand-rolled SVG**, like the sparkline, with no chart library: bars, lines
  on the bars' axis or a right axis (failure rate over requests), the previous period as a
  dashed line, hover / touch / arrow-key readout, faint partial days, gaps for days before the
  logs. A line whose length differs from the bars is dropped, never stretched.
- **Health per tab is the worse of its verdict and its findings** (`overview-health.ts`); a tab
  not yet read is grey. The status bar's dots open that tab.
- **Findings are folded, not removed.** The first three red ones show; the rest sit in a
  `hidden` block, so every finding stays in the DOM (tests and find-in-page still reach them).
  The status bar's count scrolls to and opens the panel.
- **Tab conclusions became cards** with a headline and the rest of the points in `<details>`,
  worst first, replacing the full-width digest rows.
- **Top customers** reads `activity.top_users` already in the response; it names users because
  the page is for administrators.
- `ShareDonut`'s legend list is a `grid-cols-1` flex child: its track grew to the longest
  label and clipped the share column at 1440 wide.

## Alternatives not taken

- A margin-by-vendor bar and a waterfall for "what changed" were optional in the brief; the
  existing three-column "what changed" already names the movers, so they are not built.
- A chart library: first-load budget for `/dashboard/overview` has under 1 KB left.

## Verification

- `overview-layout.test.tsx` (24 tests): axis, series alignment and projection rules, health,
  `ComboChart` (bars, right axis, pointer, arrow keys, partial, missing, mismatched line,
  previous line, too few points), top customers, tab order, folded findings, status bar.
- Typecheck, lint baseline, `vitest run src/features/site-insights src/i18n` (637 tests),
  `bun run build`, `bun run first-load:check` (overview 536.1 of 537 KB).
- Eight locales carry the 22 new keys. Looked at in a browser against captured read-only
  responses: light and dark at 1440, light at 390.
