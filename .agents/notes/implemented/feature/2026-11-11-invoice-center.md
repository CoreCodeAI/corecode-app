# Agent Note: Invoice center for paid orders

Status: implemented

## Problem

Customers ask for 增值税普通发票 for what they paid. The console had no way to
request one, so each request went through support by hand. The owner wanted a
self-service flow like zzshu's: general VAT invoices only, a company or
individual title, one category (软件开发服务), and a 4% surcharge that the
customer pays from balance, Alipay or WeChat Pay.

## Decision

- **Only money that came in from outside can be invoiced.** An order qualifies
  when it is a top-up or a plan order with status `success`, paid through
  epay, Stripe or NOWPayments (USDT/USDC), within `order_days` (default 365)
  of its creation. Plans bought with balance and redemption codes are
  excluded: the money behind them was already invoiceable as a top-up, or never
  came in. The invoice amount is the order's own price (`top_ups.money`, the
  plan order amount), converted to cents as the payment request formats it
  (`FormatFloat(money, 'f', 2, 64)`), so an amount ending in half a fen is
  invoiced at what was charged.
- **Stripe orders are invoiced at what Stripe collected.** The webhook
  writes an `invoice_order_amounts` row, keyed like a claim, before it marks
  the order paid: when a promotion code took money off, the price scaled by
  `amount_total / amount_subtotal`; when a plan was charged at its Stripe
  Price (subscription mode, in the Price's currency), zero, so it is not
  invoiceable. Stripe plan orders whose plan has a Stripe Price are left out
  even without a row, which covers orders paid before this change. A failure
  to write the row is logged and the order is still credited.
- **An order is held by a nullable unique `claim_key`** on `invoice_items`
  (`topup:<id>` or `subscription:<id>`). Two concurrent submissions for the same
  order cannot both insert it, on any of the three databases. Cancel, expiry,
  reject and delete set it to NULL, so the order is free again. NULL is never
  unique-checked on SQLite, MySQL or PostgreSQL, so released rows stay as
  history.
- **The tax is `round(order cents × rate / 100)`**, with the rate a percent of at
  most two decimals. Paid from balance, it is charged in the submit
  transaction at the quota price of the cents, rounded up; the application goes
  straight to review. An application with zero tax skips payment entirely.
- **Alipay and WeChat Pay go through epay, never Stripe.** Stripe's own Alipay
  and WeChat Pay need at least HK$4 and charge HK$2 a payment, more than most
  taxes. epay is offered only when payment compliance is confirmed and its
  webhook is configured, the same gate the wallet uses.
- **Tax payments are not top-ups.** They live in `invoice_tax_payments`, so they
  never count toward commission, paid-total tiers or the top-up report, and an
  invoice tax can never itself be invoiced. Each epay attempt gets a fresh
  trade number `INV<id>N<rand>` + unix time; a unique ledger row per trade
  number makes the notification idempotent. A payment that arrives when the
  application no longer waits for it (paid already, cancelled, expired,
  rejected, deleted, or a different amount) is credited to the balance and
  logged, never lost.
- **Unpaid applications expire** `payment_timeout_minutes` (default 30) after
  submission or after the latest payment was started, whichever is later:
  starting a payment sets `updated_time`, and nothing else changes it while
  the tax is unpaid. A customer who pays near the deadline is not cancelled
  mid-payment.
  The master node's one-minute task cancels each with a conditional update on
  its status, so a payment landing in the same instant wins or loses cleanly.
- **Reject refunds exactly what was charged** (the stored quota for balance,
  the paid cents converted back for epay) and emails the reason. Issue requires
  an uploaded file and emails the customer. Delete is for finished
  applications only: it records a reason, frees the orders, removes the file
  and soft-deletes the row.
- **Invoice files live in the database** (`invoice_files`, longblob/bytea),
  at most `file_max_kb` (default 2 MB): PDF, OFD, PNG or JPEG, checked by
  content, not by name. The relay's GCS bucket deletes objects under a
  lifecycle rule, and an issued invoice must outlive it. A customer can
  download only an issued invoice of their own.
- **All `/api/invoice` routes are session-only** for personal access tokens.
  The epay notify routes are anonymous and checked by signature.
- **The feature is off by default** (`invoice_setting.enabled`). Settings sit
  in 计费设置 → 发票; the 开票中心 entry under 个人 appears only while it is
  on, and 发票管理 under admin shows how many applications wait for review.
- **The console's first load grows by under 1 KB.** The sidebar's review-count
  hook calls the API directly instead of importing the invoice API module, the
  invoice server messages are listed in `static-keys.ts` so they leave the core
  locale part, and the new layouts reuse existing utility classes.
  `/sign-in` stays under budget (352.9 of 353 KB). The settings section and
  sidebar labels still ride in the authenticated layout and core locale, which
  took `/dashboard/overview` from 526.8 to 527.95 KB and `/keys` from 606.5 to
  607.7 KB; both budgets go up 1 KB on purpose.

## Alternatives considered

- **Tax through Stripe.** Rejected for the minimums and fixed fees above.
- **Recording the tax as a top-up.** It would earn commission, raise tiers,
  appear in the top-up report and become invoiceable itself.
- **Excluding Stripe orders while promotion codes are on.** It would also
  drop full-price orders, and the setting can change after an order is paid.
- **Files in GCS.** The bucket's lifecycle rule would delete issued invoices.
- **Checking "already invoiced" with a query before insert.** It races two
  concurrent submissions; the unique key cannot.

## Verification

- `go test ./controller/ -run TestInvoice` against SQLite, MySQL 5.7.44 and
  PostgreSQL 9.6.24 (`TEST_MYSQL_DSN`, `TEST_POSTGRES_DSN`): the four suites
  pass on each, covering the balance and epay paths, duplicate claims,
  idempotent and late notifications, expiry and its restart on a new
  payment, cancel, issue, reject refunds, delete, cross-user isolation, and
  gateway amounts (half-fen rounding, promotion codes, Stripe Prices).
  `TestStripeWebhookCreditsAmountAndBonusOnce` covers the webhook writing the
  discounted amount, and crediting the order when it cannot.
- Each fix from review was reverted once to see its test fail: rounding,
  amount overrides, the Stripe Price exclusion, the expiry clock, a `NaN` tax
  rate, the status refresh after saving the switch, the pager after the last
  page empties, and the selection cap after orders leave the list.
- Upgrade check on each database: the merge-base binary starts on a fresh
  database, then this branch's binary starts twice. Every start reached its own
  ready line on a port proven free, and logged no errors. Tables, the unique
  `claim_key` and `trade_no` indexes and the file column type match on all
  three.
- An API run on the built binary (SQLite): enable, submit with balance (¥150.50
  of orders, ¥6.02 tax, 412,329 quota charged), duplicate and pending orders
  refused, issue refused without a file, PDF upload, issue, download with the
  original bytes and file name, another user refused, reject refunding exactly
  547,946 quota, delete freeing the order.
- Console: `bun run typecheck`, `bun run lint:check` (no new findings),
  `bun run format:check`, `bun run test` (3,144 tests), `bun run build` and
  `node scripts/check-first-load.mjs` all exit 0.
