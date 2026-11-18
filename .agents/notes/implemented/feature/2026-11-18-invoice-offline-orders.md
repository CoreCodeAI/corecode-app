# Agent Note: Invoice offline orders in the invoice center

Status: implemented

## Problem

An enterprise customer paid ¥10,000 by bank transfer in two payments. An
administrator added the quota by hand and recorded both payments as
`offline_backfill` orders ([recording offline payments](2026-11-17-record-offline-payments.md)).
The customer then asked for an invoice, but the invoice center lists only the
orders whose provider is in `invoiceableProviders`, and the offline providers
were left out. The customer could not apply.

## Decision

- **Offline payments are invoiceable.** `invoiceableProviders` lists
  `offline` and `offline_backfill` beside epay, Stripe and NOWPayments. Both
  record money the business received: `offline` credited the wallet when
  recorded, and `offline_backfill` paid for quota already added by hand. The
  customer applies for them as for a gateway order: the same window
  (`order_days`), tax surcharge, review and one live application per order.
- **The order's money is the invoice amount.** Every order in production,
  offline ones included, records `money` in CNY at ¥1 per quota dollar, which
  is what `moneyToCents` assumes.
- **A refunded offline order drops out.** Marking it refunded changes its
  status, as for any other order.

## Alternatives considered

- **Issue enterprise invoices outside the invoice center**, as the offline
  payments note first decided. Rejected by the owner: the customer cannot
  apply on their own, and the invoice leaves no record beside its order.

## Trade-offs

- `money` on an offline order is in the payment currency. A payment received
  in another currency must be recorded with its CNY value, or the customer
  could apply for an invoice at the wrong amount.
- The console lists the orders without their payment method, so it needs no
  change.

## Verification

- `TestInvoiceOfflineOrders` lists a ¥5000 backfill and a ¥3000 credited
  offline order with their amounts, leaves out a refunded one, and submits the
  backfill with ¥200 of tax paid from the balance. With the two providers
  removed from `invoiceableProviders` it fails: both amounts are 0 and the
  submission is refused. It ran on SQLite; MySQL and PostgreSQL were skipped.
- `go test ./controller ./model` passes.
