# Agent Note: Show Stripe receipts in billing history

Status: implemented

## Problem

A customer who paid through Stripe had no proof of payment in the console.
Overseas customers and companies asked for one, and the console's only
document, the invoice center, issues Chinese tax invoices on request and
review.

## Decision

- **Stripe's receipt page, not a Stripe Invoice.** Stripe creates a receipt
  for every successful charge at no cost, older orders included. A
  post-payment Checkout invoice costs 0.4% of the payment (up to US$2 each)
  and exists only for orders created with `invoice_creation` on, so the owner
  chose receipts only on 2026-11-14.
- **In billing history, on each order.** The wallet's billing history lists
  one card per top-up order, so a paid or refunded Stripe order gets a
  Receipt button there. The credit history card reads usage logs, which do
  not carry the order. The invoice center keeps its single purpose; when it is
  on, billing history says a receipt is not a VAT invoice and links to it.
- **`GET /api/user/topup/receipt?trade_no=`, read fresh on every call.**
  Stripe's receipt links expire after 30 days, so nothing is stored. The
  order keeps only its reference, which Stripe holds as the Checkout
  Session's `client_reference_id` and cannot filter by, so the handler lists
  complete sessions created from ten minutes before to one minute after the
  order, takes the one with that reference, and lists its PaymentIntent's
  charges for the paid one's `receipt_url`. This also serves orders paid
  before this change, with no schema change.
- **Owner or administrator only.** Administrators see every user's orders in
  the same dialog. Another user's order, a missing one, an unpaid one and a
  non-Stripe one get the same answer, "This order has no Stripe receipt", so
  the endpoint does not reveal which order numbers exist. A per-user critical
  rate limit bounds the Stripe calls; a personal access token needs
  `wallet:read`.
- **The tab opens on the click.** The link is known only after the request,
  and Safari and iOS block a popup opened after an await, so
  `openPendingPage` opens a blank tab during the click, shows "Opening the
  Stripe receipt…", clears `opener`, and sends the tab on; it closes the tab
  when the request fails. Where the popup is still blocked, the page opens in
  this tab.

## Alternatives considered

- **Stripe Invoices through Checkout's `invoice_creation`.** Rejected for the
  fee and because past orders would have none.
- **Store the session or PaymentIntent id on the order.** Avoids the session
  listing for new orders, but needs a column, and older orders would still
  need the listing.
- **Return a redirect from the endpoint.** The console authenticates with a
  bearer header, which a plain link cannot carry.

## Trade-offs

- The live key `corecode-live-newapi` needs **Charges and Refunds: Read** on
  top of its Checkout Sessions, Customers, Prices and Products write
  permissions; it was added in the Stripe dashboard on 2026-11-14. Without it
  the endpoint logs the Stripe error and answers "Failed to load the
  receipt".
- An order completed by an administrator without a Stripe payment shows the
  button, and the click answers that it has no receipt.
- "This order has no Stripe receipt" is sent only by the server, so it sits
  in the core locale part, about 6 to 15 bytes on the first-load pages.

## Verification

- `go test ./controller/ ./middleware/ ./router/` passes.
  `TestTopUpReceiptReadsTheOrdersCharge` runs against a stub Stripe API: it
  checks the session filter (status and created window), skips another
  order's session and an unpaid charge, answers the owner and an
  administrator, makes no Stripe call for a stranger, a missing, a pending or
  an epay order, and makes no charge call when no session matches. With the
  ownership check removed the test fails.
- From `web/`: `bun run typecheck`, oxfmt and oxlint on the changed files,
  `bun run lint:check`, `bun run test` (386 files, 4017 tests), `bun run build`
  and `bun run first-load:check` pass. The new console tests check that the
  tab opens on the click with its opener cleared, that the button is busy
  and disabled until the link arrives, that the tab is sent to the receipt or
  closed on failure, and that the invoice-center link shows only when the
  center is on. Loosening the receipt condition fails them.
- In a browser against a stub API, at desktop width and at 390 px in light
  and dark: the tab showed the waiting text and then the receipt URL; a
  failed order closed the tab and showed the server's message; the button
  kept its width while busy; with a coarse pointer a touch 6 px above the
  button still reached it. The order number now truncates inside the card at
  390 px, where it used to push the status and copy button out of view.
