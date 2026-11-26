# Agent Note: Show the funds tab's margin on the overview

Status: implemented

## Problem

The overview's 毛利 card computed its own figure in `marginCard`
(`web/src/features/site-insights/components/overview-analysis.ts`): revenue
earned less pool accounts and upstream bills and fees. The funds tab's
`financeMargins` also takes off egress IP costs (app PR 404) and payment fees
(app PR 406), so the two pages showed different gross margins for the same
range, and the overview's read high. The overview also had no figure for what
is left after promotion.

## Decision

- The card's value is `financeMargins(...).margin`, the funds tab's gross
  margin, so the two pages cannot drift again when a cost is added there.
- The hint keeps the share of revenue and adds 「扣推广后」: the profit
  waterfall's `left`, after promotion-channel fees and commission (exempt
  accounts left out). A server without `channel_fee_usd` gets the old hint.
- `upstreamCost`, used only by the old card, is removed.

## Alternatives considered

- **A ninth card for the after-promotion figure.** The KPI grid is four by
  two; a ninth card leaves a row of one. The hint carries it instead.

## Verification

- `overview-signals.test.tsx` pins the card to 1000 less bills, fees, IP and
  payment fees (¥730) and the after-promotion figure (¥570). With
  `overview-analysis.ts` at origin/main it fails: ¥830, the IP and payment fees
  not taken off.
- `bunx vitest run src/features/site-insights`: 821 passed. `bun run
  typecheck`, `lint:check` and `first-load:check` pass; both new keys are
  `rest` in the locale split.
