# Agent Note: Site insights shows what each campaign cost and what the newcomer-plan gate did

Status: implemented

## Problem

The owner gave away quota in several ways (invite gift plans, the ¥29.9 newcomer plan,
hand-added $3 and $5, redemption codes) and paid for channels, but nothing said what each
cost against what its recipients paid afterwards, or whether the newcomer plan recruits
customers or only loses money. The newcomer plan's address gate, which moves studio
accounts' requests to their wallets, wrote its work only into `logs.other`, so what it
caught, saved and got wrong was read by hand.

## Decision

Two new additive reads, each on its own endpoint so the tabs' existing reads never wait on
them. Both sit under `siteInsightsRoute`, go through `settledRead`, and are declared in the
access-token scope table (`user:read`).

- **Campaign payback** (`GET /api/site-insights/campaigns`, channels tab, after the verdict).
  A cohort is the accounts that received in the range, followed from the moment they
  received to now, whatever the range's end. Kinds: invite gift plan
  (`affiliate_gift`), newcomer plan (`max_purchase_per_user > 0 AND price_amount > 0`, bought),
  plans bound by an administrator, redemption codes, paid channel fees (the channel's fee over
  the range against the accounts it brought), and hand credits from the audit log
  (`user.quota_add`, mode `add`), told apart by amount: 1,500,000 quota is the forum-ID $3,
  2,500,000 the raffle $5, any other is "other hand credits (compensation)", listed and left
  out of the total. Cost is the quota given at $1 = ¥1, as the funds tab counts it, except
  the newcomer plan, which is sold: its cost is the quota its buyers used, and its own price
  is part of what it brought in. An account in two kinds is in both rows and once in the total.
- **Newcomer plan gate** (`GET /api/site-insights/gate`, risk tab, appended after the
  existing panels). Requests the gate moved to the wallet, refused or paid with another plan,
  by day, with accounts; the shared exits it let through, by reason; the accounts whose remark
  starts with `新人包多号 `, the quota of the plans they bought, what they had used and what
  they could not spend (the money the plan did not lose); and the accounts in
  `subscription_address_exemptions` as the known mistakes, with what was moved to their wallets
  before the exemption and what administrators added back after. One sentence states caught,
  saved, mistaken and the mistake rate.
- **Real gate values.** The task text named `deny`; the code writes `refused`, `wallet` and
  `other_plan` (`limited_plan_gate.go`), so the view uses those.
- **Error rule.** A panel whose read failed shows its error line; a panel still loading shows
  placeholders. Neither shows a zero.

## Limits stated in the interface

- Hand credits carry no remark, so the kind is the amount. A $3 or $5 added for another
  reason counts as a forum ID or raffle.
- "Still unspent" for a balance credit is the smaller of the credit and what the wallet still
  holds: a wallet does not remember which credit it spent.
- The exemption table has no date per request, so an exemption made for another reason
  counts as a mistake. The rate is the accounts exempted among those the gate acted on.
- Enterprise backfills (`offline_backfill`) pay for quota added by hand: both the credit and
  the payment are left out. Staff (`role >= 10`) are left out.
- Payments after receiving exclude the newcomer plan's own orders (found by trade number,
  looked up from a day before the plan starts, since a wallet-paid order precedes it).

## Alternatives not taken

- Reading the gate from a new table or column: the marker already exists on every log, and a
  schema change on `logs` is not worth a read-only dashboard.
- Two scans of the logs, one per marker: it was the first version, and cost three times the
  single pass (below).
- Putting both reads into the existing `channels` and `risk` views: it would have slowed
  views the owner opens often for panels that sit below their first screen.
- A chart library: both panels are hand-rolled bars; the first-load budgets are spent.

## Verification

- Go: `model/site_insights_campaigns_test.go` runs both views on SQLite, MySQL 8 and
  PostgreSQL 16 (throwaway containers). CI runs SQLite only. The first draft read no
  `created_at` from the audit log, which silently gave every hand credit time 0; the
  pre-grant payment case in the test guards that.
- Gate scan cost, synthetic data of 900k log rows (about 250 bytes of `other`, 3 % carrying a
  marker) and 3,000 users, uncached: PostgreSQL 16 takes 0.14 s for 1 day, 0.71 s for 7,
  1.11 s for 14 and 2.48 s for 31; MySQL 8.4 takes 0.29 s for 7 and 0.31 s for 14. The first
  version scanned twice (one pass per marker) and took 2.0 s, 3.4 s and 7.2 s on
  PostgreSQL. The view is capped at 14 days (`InsightsMaxGateDays`), reads from a primary-key
  lower bound, and groups by account, kind and hour in the database, so only groups arrive.
  Cost grows with log rows in the range; production is PostgreSQL.
- Live after release (11-24): `/gate` took 2.9 to 6.8 s for the 7-day range on production, over
  the 2 s target, because a range that ends now is not settled, so `settledRead` never kept it
  and every load scanned all seven days. The scan now goes day by day: a day that ended more
  than an hour ago is kept in process (`gateDayCache`, at most 56 days, keyed by log database
  and day), so a range ending now scans only the running day on every load after the first.
  The first load after a restart is still the full scan. Logs of an ended day do not change.
- Campaign cost on the same data: 51 to 89 ms on MySQL, 47 to 159 ms on PostgreSQL for 7 to
  90 days.
- Console: typecheck, `lint:check`, vitest (745 tests in site-insights and i18n), build and
  `first-load:check` (all three budgets kept). Eight locales filled.
- The full `go test ./model` against MySQL and PostgreSQL fails on a clean `origin/main` too:
  some earlier test leaves tables behind and the next matrix test refuses a non-empty database.
  Targeted runs of the matrix tests pass. CI is SQLite only and is unaffected.
