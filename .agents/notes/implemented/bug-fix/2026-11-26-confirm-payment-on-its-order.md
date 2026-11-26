# Agent Note: Confirm a payment on its order, and keep the checkout tab open

Status: implemented

## Problem

- The wallet decided a payment had landed when `user.quota` rose by more than the balance
  before the payment. Any other movement of the balance in that window, such as a spend
  or a credit from another order, could confirm the wrong payment or hide the right one.
- Stripe and Creem checkouts for top-ups and plans were opened with `window.open` after
  the order request had been awaited. Safari and iOS block that popup. The popup note
  (`2026-11-11-open-the-checkout-when-the-popup-is-blocked.md`) fixed the fallback; this
  note moves the open into the click.
- The plans card hid its whole section after one failed plans request, Refresh reloaded
  only the subscription, and billing preference changes could roll back a newer choice.

## Decision

- Each payment that opens a hosted checkout reports its order number: `trade_no` for
  Stripe and epay top-ups and plans, NOWPayments and Dodo, `order_id` for Creem and
  Waffo. The fields are added to the create responses only; nothing is renamed or
  removed, so an older console ignores them during a release.
- `GET /api/user/topup/order?trade_no=` (wallet read scope, caller-scoped) returns
  `{trade_no, kind, status, credited_quota}` for one order. Another user's order and an
  unknown trade number both return 404. `credited_quota` is set only when the order
  succeeded. It is read-only and needs no migration.
- `usePaymentConfirmation` takes a target: `{ tradeNo }` polls that order until it
  succeeds and toasts the amount it credited; `{ baselineQuota }` keeps the balance
  comparison, used only by chain deposits, which have no order.
- Stripe, Creem, NOWPayments and Dodo top-ups and the Stripe and Creem plan purchases open
  the tab with `openPendingPage` before the request, then navigate it once the URL
  arrives, or close it when the request fails. This replaces the open-after-await of
  `openPaymentPage` at these call sites. `openPaymentPage` has no caller left; it is kept
  because its tests still cover it, and removing it is a separate change.
- Plans: a failed plans fetch keeps the last good plans; with none, it shows an error with
  Retry. Refresh refetches the plans and the subscription. Each billing preference change
  takes a sequence number; only the newest may update the state, and a failure reloads the
  server value instead of restoring the previous one.

## Alternatives considered

- **Keep the balance comparison and read the balance fresh before each payment.** A spend
  or credit during the wait still changes the result. Rejected.
- **Open a blank tab before the request and never close it on failure.** That is what
  the popup note rejected; here the tab is closed on failure, so no empty tab remains.
- **Disable the billing select while a change is pending.** It blocks the user from
  correcting a wrong choice; the sequence guard keeps the newest choice without that.

## Consequences

- A payment that was opened in the same tab (Waffo Pancake, Stripe methods on plans, epay
  forms, NOWPayments plan purchases) reports no order to the wallet; no confirmation
  starts for those, as before.
- The wallet keeps only the order number in memory; a reload drops the wait, as before.
- The order endpoint is read-only and needs no migration. Ship the server first: a console
  that reaches a server without it gets 404 on each order check, and its wait ends at the
  timeout with no toast.
