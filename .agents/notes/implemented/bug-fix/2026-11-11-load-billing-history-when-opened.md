# Agent Note: Load billing history when its dialog opens

Status: implemented

## Problem

The wallet always renders `BillingHistoryDialog`, and `useBillingHistory` fetched
`/api/user/topup/self` once when the wallet mounted, not when the dialog opened. An order
is created when the customer clicks pay, after the mount, so opening Order History from
the "still waiting" banner showed a list without the order just placed.

## Decision

- `useBillingHistory` takes `enabled`; the dialog passes `open`. Closed, it does not fetch.
  Each time it opens, it clears the previous opening's list and fetches the current page
  afresh.
- While a page change, page size change or search is loading, the rows already on screen
  stay; the skeleton shows only when there are no rows yet.

## Alternatives considered

- **Move the hook to react-query** with `enabled: open`, `staleTime: 0` and
  `placeholderData`. Same behavior, but a rewrite of an upstream hook that every sync
  would conflict with; a flag and a guard in the existing effect are enough.
- **Refetch when a payment is handed off.** Covers only that path, and keeps the request
  on every wallet visit.

## Consequences

- Opening the wallet makes one request fewer. Opening the dialog always makes one.
- Reopening shows the skeleton for a moment instead of the old list.

## Verification

- `bunx vitest run src/features/wallet/__tests__/billing-history.test.tsx src/features/wallet/__tests__/copy.test.tsx`:
  6 pass. With the hook and dialog restored to `origin/main`, all three new tests fail.
- `bun run typecheck`, `bun run lint:check`, `bun run format:check`, `bun run test`
  (308 files, 3143 tests), `bun run build` and `bun run first-load:check` all exit 0.
