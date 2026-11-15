# Agent Note: Fit log columns to the type filter, and scope an admin's billing history

Status: implemented

## Problem

- **The common-log table kept every column for every type.** Filtered to
  top-ups, the admin view still had ten columns, 1,570 px wide. Channel,
  token, model, stream, tokens, cost and timing draw only on consume, error
  and refund rows (`DISPLAYABLE_LOG_TYPES`, `TIMING_LOG_TYPES`), so seven
  columns were blank. The details column, the only one with content, sat
  past the right edge of a 1,280 px window and was cut at 200 px besides.
- **An admin's billing history listed every user's orders.** The wallet's
  billing history called `/api/user/topup` for an admin, so the owner's own
  two Stripe orders were among 1,660, over a hundred pages from the first,
  and looked as if they had no Receipt button.

## Decision

- **Columns follow the committed type filter.** `lib/log-type-columns.ts`
  maps each usage column to the log types that draw in it and drops a column
  no selected type draws in. Top-up, management, system and login keep time,
  user and details; refund drops stream and timing; all types and consume
  keep every column, each of which has content there.
- **Details fills the row when the selected types carry only text.** The
  column's size becomes 400, its share of the row beside time (180) and
  user (150), which still fits the 774 px a 1,024 px window leaves; the
  button takes `w-0 min-w-full` so a long line truncates at the column's
  edge instead of widening the table.
- **Billing history opens on the admin's own orders.** An admin gets the same
  All / Only Mine tabs as the log pages, set to Only Mine, which reads
  `/api/user/topup/self`. The user ID badge shows only under All, and the
  invoice-center note follows the scope rather than the role.

## Alternatives

- **Hiding empty columns through column visibility.** Visibility is saved to
  `localStorage` per user, so a filter-driven hide would persist into the
  all-types view. The columns are removed from the definitions instead.
- **Dropping columns that are empty on the loaded page.** The columns would
  change from page to page and with each refresh; the filter is stable and
  the user sets it.
- **Narrowing the all-types view.** Every column there has content on
  consume rows; cost is already pinned to the right edge for that view.

## Trade-offs

- A column removed by the filter also leaves the column menu until the
  filter changes.
- The admin's scope resets to Only Mine each time the wallet mounts.

## Verification

- `lib/__tests__/log-type-columns.test.ts` covers the filter reading and the
  columns kept per type; a mutation returning every column fails two cases.
- `billing-history.test.tsx` checks that an admin first reads
  `/api/user/topup/self` without user IDs, and `/api/user/topup` with them
  after All; a mutation reading every order for an admin fails it.
- In a dev build against a stub API, filtered to top-ups with a 130-character
  row, the table measured 1,030 of 1,030 px at 1,280 and 774 of 774 px at
  1,024 (it was 1,570 px at both before); the all-types view is unchanged.
- `bun run first-load:check` matched a local build of main byte for byte,
  and no locale key changed part.
