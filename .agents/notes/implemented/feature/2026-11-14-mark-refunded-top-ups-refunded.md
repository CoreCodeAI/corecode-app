# Agent Note: Mark refunded top-ups refunded

Status: implemented

## Problem

On 2026-11-14 the operators refunded all 35 Stripe card payments of one fraud
case (¥8,492.9, about 30 farmed cards) from the Stripe dashboard. new-api knew
nothing of it: the orders stayed `success`. Every paid total reads
`status = success`, so the refunded money still counted as top-up revenue in
the top-up report and site insights, as the user's paid total, as invoiceable
orders, and as payments in the affiliate program. Top-up statuses were only
pending, success, failed and expired, so there was no correct state to move
them to.

## Decision

- **A `refunded` status (`common.TopUpStatusRefunded`).** Every paid total
  already filters on `success`, so a refunded order drops out of all of them
  without touching those queries. The order funnel counts refunded orders in a
  new additive `refunded` field rather than letting them vanish.
- **A plan order moves with its top-up row.** A paid plan has a row in both
  `top_ups` and `subscription_orders` under one order number, and revenue,
  invoices and the funnel read plan orders from `subscription_orders`, so
  `model.MarkTopUpsRefunded` updates both in one transaction.
- **An admin action, `POST /api/user/topup/refund`.** It takes up to 100 order
  numbers and needs a step-up proof under the new scope
  `admin.user.topup.refund`, bound to the normalized (trimmed, de-duplicated,
  sorted) set, so a proof for one selection cannot mark another. Only `success`
  orders change; already-refunded ones are counted and left alone, so a retry
  is harmless; any other order, or a missing one, fails the whole batch. One
  `user.topup_refund` audit entry per affected user records the orders, their
  sum and the verification method. A personal access token needs
  `billing:write`, like completing an order.
- **Balances are not touched.** Whether to claw back credit, and how much, is
  the operator's call (in the fraud case the balance had already been zeroed),
  so the confirmation says to adjust balances separately.
- **Stripe `charge.refunded` marks the order automatically.** Only a full
  refund (`refunded: true`) counts; a partial refund is logged and the order
  stays paid. A charge carries its PaymentIntent but not our order number, so
  the handler lists Checkout Sessions by PaymentIntent with the existing API
  key and reads `client_reference_id`. That also finds orders created before
  this change. Any failure is logged and the webhook still answers 200.
- **No schema change.** Who marked an order, when and why lives in the audit
  log; the status is a string column.

## Alternatives considered

- **Reuse `failed`.** Rejected: it misstates what happened (the payment
  succeeded, then went back), and the funnel would count a paid checkout as a
  failed one.
- **Delete the rows.** Rejected: it destroys the order history support and
  invoicing need, and the trade numbers Stripe still references.
- **A direct database update for the one case.** Rejected by the operators: no
  audit entry, and the next refund would need the same hand edit.
- **Record the PaymentIntent on fulfillment.** Would avoid the Stripe lookup
  for new orders, but needs a column and still could not map older orders.

## Trade-offs

- The webhook path depends on the Stripe dashboard endpoint subscribing to
  `charge.refunded`, and on the API key being allowed to list Checkout
  Sessions. Until then, operators mark refunds by hand.
- The top-up watch (`service/topup_watch.go`) sums successful card top-ups,
  so refunded orders stop counting toward its rules. Its card rules read
  Stripe charges, which still show refunded charges.

## Verification

- `TestAdminRefundTopUpsDropsOrdersFromPaidTotals`: without a proof, or with a
  proof for another selection, nothing changes; a batch holding a pending order
  changes nothing; with a proof, the two top-ups and the plan (both rows) become
  refunded, and `AffiliatePaidMoney`, `ListInvoiceableOrders` and
  `GetTopUpStats` drop to zero while the balance is unchanged; one audit entry
  carries the orders and the method; a second call reports three already
  refunded and writes no audit.
- `TestStripeChargeRefundedMarksOnlyFullRefunds`: a partial refund and an
  unknown PaymentIntent change nothing; full refunds mark the top-up and the
  plan; a repeated event is harmless.
- Each guard was removed in turn (plan-order update, proof check, the
  paid-only rule, the full-refund check, the already-refunded skip) and the
  tests failed each time.
- The console test selects only paid rows, and checks that the request carries
  the proof for exactly the selected orders.
