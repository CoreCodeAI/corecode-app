# Agent Note: Administrators file invoice applications for customers

Status: implemented

## Problem

An enterprise customer paid ¥5000 by bank transfer, the 4% invoice tax
included, and asked for an invoice through WeChat. The payment is recorded as
an `offline_backfill` order ([recording offline payments](2026-11-17-record-offline-payments.md)),
and offline orders are invoiceable ([invoicing offline orders](2026-11-18-invoice-offline-orders.md)),
but only the customer can apply: `POST /api/invoice` files under the signed-in
account. Applying from the customer's account would also charge the tax a
second time, from the balance, and an administrator would then have to add it
back by hand.

## Decision

- **An administrator files the application.** `GET /api/invoice/admin/orders?user_id=`
  names the account and lists its invoiceable orders, and `POST /api/invoice/admin`
  takes `user_id` and the customer's form without `payment_method`. The title,
  tax number, category, email and orders are checked as a customer's are, and
  `model.CreateInvoice` claims the orders in the same transaction.
- **The tax is recorded as collected offline.** The new tax method `offline`
  stores the tax at the current rate, a paid time and no balance quota, and the
  application goes straight to review. Nothing is deducted.
  Since 2026-11-27 the filing can deduct it from the balance instead; see
  `2026-11-27-file-invoices-with-the-tax-from-balance.md`.
- **Rejecting returns no tax.** `RejectInvoice` skips the refund for `offline`,
  because the tax never reached the balance. The rejection email then omits the
  tax-returned line, and the review dialog says the tax is not returned.
- **A customer cannot choose `offline`.** `invoiceTaxMethodAvailable` still
  accepts only the balance and the epay methods, and the console's customer
  types exclude it.
- **Each filing writes an `invoice.admin_create` audit entry** naming the
  application, the account, the amounts and the method. The routes are
  session-only for personal access tokens, like the other invoice routes, and
  need no step-up proof: like issue and reject, filing moves no money.
- **Console.** 发票管理 gets a 代用户申请 action. Its dialog finds the account by
  ID and reuses the invoice center's order list and form; the form, given
  `onFile`, hides the tax payment and the amount to pay.

## Alternatives considered

- **File from the customer's account and add the tax back by hand.** Rejected:
  it needs the customer's session, moves the balance twice, and leaves a
  hand-added credit that the funds view counts as gifted.
- **Let the administrator choose a balance-paid tax as well.** Rejected for now:
  a customer who pays from the balance can apply in the console.
- **A column for the filing administrator.** Rejected: the audit entry names
  the operator without a schema change.

## Trade-offs

- An `offline` application records the tax at the configured rate whether or
  not the money was collected; waiving it is outside new-api.
- The customer receives no notice when an application is filed; it appears in
  their invoice center, and the issue email reaches the address on the form.

## Verification

- `go test ./controller -run TestInvoice` against SQLite, MySQL 5.7.44
  (utf8mb4) and PostgreSQL 9.6.24 (`TEST_MYSQL_DSN`, `TEST_POSTGRES_DSN`): all
  six suites pass on each. `TestInvoiceFiledByAnAdministrator` covers the order
  lookup, an unknown account, an invalid email, another account's order, the
  filing (review status, ¥4.00 tax, no quota moved, order claimed), the audit
  entry, the reject without refund, and a customer refused `offline`.
- Each of three mutations made that test fail: refunding an offline tax on
  reject, leaving the application awaiting payment, and letting a customer
  choose `offline`.
- `go test ./controller ./model ./router ./middleware ./service` passes.
- Console: `bun run typecheck` (a planted error fails it), `bun run lint:check`
  (no new findings), `bunx vitest run` on the invoice features, and the new
  form test, which fails when the balance check applies to a filing.
