# Agent Note: An administrator's invoice filing can take the tax from the balance

Status: implemented

Changes the tax bullet of [filing invoices for customers](2026-11-24-file-invoices-for-customers.md).

## Problem

An administrator's filing always recorded the tax as collected offline and
deducted nothing. That fits a transfer that included the 4%, but enterprise
customers pay the amount alone. Without a way to charge the tax, it was netted
into the bonus instead: 申德盈瑞's ¥5000 on 2026-11-24 was credited 6% rather
than its 10%, and the invoice was issued outside the system. The bonus then no
longer read as the contract's rate, and the tax was paid whether or not the
customer invoiced. Customers who apply themselves already pay the tax from
their balance.

## Decision

- **`tax_from_balance` on `POST /api/invoice/admin`.** With it, the
  application is created with tax method `balance` and `model.CreateInvoice`
  deducts the tax from the customer's balance in the same transaction, as a
  customer's own balance payment does: `tax_quota` records it, a balance short
  of the tax files nothing, and rejecting the application returns it. Without
  it the tax is recorded as collected offline, as before, so the console
  already in production keeps its behavior.
- **The audit entry `invoice.admin_create` adds `tax_quota`.**
- **The console's filing dialog has a switch, on by default:** "Deduct the tax
  from the user's balance". Off is for a transfer that included the tax. The
  form's note under the amounts follows the switch.
- **The working rule:** the bonus is the contract's rate, the tax is taken when
  the invoice is filed, and every invoice, even one issued outside the system,
  is filed against its orders here so an order cannot be invoiced twice.

## Alternatives considered

- **Subtract the tax by hand (`user.quota_subtract`).** The deduction would not
  be tied to the invoice, and rejecting would not return it.
- **Net the tax into the bonus at top-up.** What happened on 2026-11-24; see
  Problem.

## Verification

- `TestInvoiceFiledByAnAdministratorTakesTheTaxFromTheBalance` passes on
  SQLite, MySQL 8.4 and PostgreSQL 16: one quota unit short files nothing and
  leaves the order invoiceable; with enough balance ¥100 deducts ¥4 (2,000,000
  quota), recorded on the invoice and in the audit entry; rejecting returns it.
  With the flag ignored, it fails. `TestInvoiceFiledByAnAdministrator` still
  passes unchanged.
- `file-invoice-dialog.test.tsx`: the default sends `tax_from_balance: true`,
  the switch off sends `false`, and the note follows. With the default off,
  both tests fail.
