# Agent Note: Drop the top-up refund controls from the console

Status: implemented

## Problem

The top-up report offered "Mark refunded" on every paid row and in a bulk bar
behind a checkbox column. The operators do not mark refunds by hand: a full
Stripe refund already marks the order through `charge.refunded`
([the endpoint's note](2026-11-14-mark-refunded-top-ups-refunded.md)), and any
other case is a script's job. A button that spends a step-up proof on a
revenue-affecting action stayed one misclick away on every paid order.

## Decision

- **The console shows no refund control.** The row button, the bulk bar, the
  checkbox column, the confirmation dialog and the step-up request are removed
  from `features/topup-records`. Selection is off, because the refund was its
  only use.
- **The interface stays.** `POST /api/user/topup/refund`, its
  `admin.user.topup.refund` proof scope, its audit entries and `refundTopups`
  in `topup-records/api.ts` are unchanged, so a script can call it with a
  personal access token (`billing:write`) and a proof exactly as before.
- **Locale keys only the removed UI named are deleted** from all eight locale
  files: `Mark refunded`, `Mark orders refunded`, the confirmation text, the two
  verification strings, `Orders marked refunded` and `orders`. The error and
  server-sent messages stay.

## Alternatives considered

- **Hide the row button and keep the bulk bar.** Rejected: the bar is the same
  action, and the checkboxes would remain only to reach it.
- **Keep the controls behind a flag.** Rejected: nothing would turn it on, and
  the dead dialog and mutation would stay in the bundle.

## Trade-offs

- Marking an order refunded needs the API, so an operator without a script has
  no way to do it from the console. Restoring the controls is a revert of this
  change; the endpoint does not move.

## Verification

- `topup-records-page.test.tsx` now asserts that a page with two paid orders
  has no "Mark refunded" button and no checkbox, and that the pending order
  keeps "Complete Order".
- On the built page against stub data in headless Chrome at 1280 px, paid rows
  showed only their status and the pending rows showed "补单"; the table had no
  checkbox column.
