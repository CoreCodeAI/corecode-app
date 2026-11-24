# Agent Note: Quality, capacity and risk tabs open on charts, with findings folded last

Status: implemented

## Problem

The quality tab was about 7,900 px and 16 panels tall, and opened on a findings list. The
capacity and risk tabs opened on prose and cards with no trend that answered "is this getting
worse". Per-vendor failure over time did not exist as data, and neither did blocks or
violations per day.

## Decision

Charts come before words on all three tabs; nothing was removed. Moved or folded content stays
in the DOM.

- **Quality.** Vendor cards stay on top. A per-vendor daily failure-rate line chart
  (`VendorFailureTrend`, with a dashed all-models line and a 5 % reference) sits beside the
  TTFT p50/p95 trend. The findings list is folded to the bottom behind a one-line summary
  (`AttentionSummary` / `AttentionPanel`; the first three red findings still show). Failure
  owners get a stacked bar with the category table in a fold; status codes and reasons show the
  top five with the rest summed and the full table in a fold; cache mix is a ring beside the
  daily bars; the by-model table gains a thin failure-rate bar; image and video tasks get a
  stacked bar and per-model bars with the table folded.
- **Capacity.** The first chart row is demand over supply for the next 7 days (a gauge),
  daily requests, and daily peak concurrency; the per-user limit rejection card now has an
  hourly trend. The gauge reads `components/outlook.ts` (line A) and shows only for the
  all-providers and Claude views, because the outlook is the Claude pool's. The account pool is
  untouched.
- **Risk.** New cards for requests blocked by the risk gate and for violation incidents, and a
  daily block chart stacked by gate stage beside the sign-up chart. `withoutStaffRows` and the
  shared-address list are unchanged.
- **Backend, additive only.** `quality.vendor_trends` (per vendor, daily and hourly requests and
  errors, following the model filter) is a by-product of the loop that already builds the
  vendor figures. `risk` gains `gate_blocked`, `gate_block_series`, `violations` and
  `violation_series`. Each field is optional in `types.ts`; a panel is omitted when an older
  server lacks it.
- **Meaning of "blocks" and "violations".** Blocks are `RiskGateEvent` rows that blocked a
  request, observe-mode hits and staff excluded, matching `refusals.risk_gate`. Violations are
  `ViolationRecord` incidents with action warn, strike, suspend or ban and a mode other than
  exempt; observe-mode records count as what enforcing would have done.
- **Components.** `StackBar`/`MiniBar`, `TrendLines` (hand-rolled SVG, hover and keyboard
  readout, gaps, dashed partial days), and the fold helpers are new, with no chart library
  because the console's first-load budget is nearly spent. Non-component helpers live in
  `.ts` files (`attention.ts`, `risk-gate-stages.ts`, `capacity-supply.ts`,
  `quality-trend-analysis.ts`) for the lint rule on exports.

## Alternatives not taken

- **Refund count in the task bar.** The brief asked for succeeded / failed / refunded; the
  tasks payload carries no refund count. The bar shows succeeded, failed, timed out, running.
- **Showing the gauge on Codex, Grok and Gemini.** The outlook only models Claude.
- **`shared.tsx` changes.** Line B owns the verdict.

## Verification

- `go test ./model/` (661 passed; the mysql and postgres subtests skip without those servers),
  `gofmt`, `go vet`. `ViolationRecord` joined the migrate list of the insights tests.
- `bun check -b`, `bun run lint:check`, `vitest run src/features/site-insights` (642),
  `bun run build`, `bun run first-load:check`.
- `bun run copyright:check` fails on files this change does not touch; none of the new files
  is listed.
- Looked at in a browser against synthetic responses (no real customer data): light and dark
  at 1440, and 390 wide, before and after.
