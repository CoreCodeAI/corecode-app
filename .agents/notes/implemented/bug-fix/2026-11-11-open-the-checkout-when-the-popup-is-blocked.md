# Agent Note: Open the checkout in this tab when the popup is blocked

Status: implemented

## Problem

Stripe, Creem and Waffo top-ups, and Stripe and Creem plan purchases, opened the checkout
with `window.open(url, '_blank')` after awaiting the order request. The await spends the
click, so Safari and iOS browsers block the popup and `window.open` returns `null`. The
console still said it was redirecting, closed the confirm dialog and started waiting for a
payment that the customer could not make.

## Decision

- `openPaymentPage(url)` in `web/src/features/wallet/lib/payment.ts` opens the new tab and,
  when `window.open` returns `null` or throws, sends this tab to the checkout with
  `window.location.assign(url)`. All five call sites use it: `use-payment.ts` (Stripe),
  `use-creem-payment.ts`, `use-waffo-payment.ts`, and the Stripe and Creem handlers of
  `subscription-purchase-dialog.tsx`.
- When the popup opens, nothing changes: same tab, same toast, same wait.
- The helper lives in the existing `payment.ts`, not a module of its own. As a separate
  module shared by the wallet and the plans, a build measured the entry script about 70
  bytes larger, and `/dashboard/overview` has about 100 bytes left under its first-load
  budget; inside `payment.ts` it adds nothing there.

## Alternatives considered

- **Always redirect in this tab,** as Waffo Pancake, NOWPayments and the plan dialog's
  Stripe methods already do. That changes the flow for every browser where the popup
  works today, and it needs each checkout's return page to land where the payment can be
  confirmed. Out of scope for a defect fix.
- **Open a blank tab before the await and point it at the checkout afterwards.** It leaves
  an empty tab behind whenever the order request fails.

## Consequences

- In the fallback, the wallet's payment wait (`usePaymentConfirmation`) starts and is then
  dropped with the page; it lives in memory only. The checkout returns the customer to the
  wallet (Stripe's success and cancel URLs, Waffo's return URL; Creem uses its configured
  default), where the balance is read fresh on mount. The customer sees the new balance
  but not the "Payment received" toast, and no "still waiting" banner.
- The plan dialog's "Payment page opened" toast shows for a moment before this tab leaves.

## Verification

- `bunx vitest run src/features/wallet/hooks/use-payment.test.ts src/features/wallet/lib/__tests__/open-payment-page.test.ts`:
  passes. The Stripe hand-off test fails with `use-payment.ts` restored to `origin/main`
  (1 failed, 3 passed).
- `bun run typecheck`, `bun run lint:check`, `bun run format:check`, `bun run test`
  (308 files, 3143 tests), `bun run build` and `bun run first-load:check` (overview
  526.9 KB of 527 KB) all exit 0.
- Not checked on a real Safari or iPhone.
