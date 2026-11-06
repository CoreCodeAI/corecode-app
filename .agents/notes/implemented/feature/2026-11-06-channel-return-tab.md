# Agent Note: Add a promotion channel tab to site insights

Status: implemented

## Problem

The owner pays two promotion channels a monthly fee: Magpie $1,000 and linux.do $600. They wanted to compare each channel's return against what it costs. The growth tab split sign-ups only into invited and organic. No view combined a channel's revenue, its fee, its commission, and the free credit its accounts used. The given credit includes the $3 and $6 top-ups granted to linux.do repliers by hand. Answering this took ad hoc SQL, and that SQL counted plan revenue twice: a plan order also writes a top-up row with the same trade number.

## Decision

- **A new `channels` view and tab** under Revenue & growth: `GET /api/site-insights/channels` (root, `billing:read`). There is one row for each channel, then one for other invitation codes and one for organic sign-ups. A channel is an affiliate account marked as a channel, or an account with a recorded fee.
  - **Funnel**: registered, activated, paid and paid again, for accounts created in the range, followed up to now, as on the growth tab.
  - **Money**: covers every account the source ever brought. Revenue is the money those accounts paid in the range, read with `readPaidOrders`, so a plan is counted once.
  - **Gift spent**: given credit used in the range. That is the hour cache's `GiftQuota`, plus the unpaid share of each wallet at its `walletPrice`, as on the funds view.
  - **Granted**: gift plans created in the range, plus administrators' balance changes in the range, read from the audit log.
  - **Unspent**: what is left now on running gift plans, plus wallets' unpaid share.
- **Fees are an option row, `ChannelCosts`.** It holds JSON entries `{user_id, monthly_usd, start, end, note}`. `PUT /api/site-insights/channel-costs` (root, `billing:write`) replaces the whole list after validating each entry. A fee counts a thirtieth of the month for each day of the range from `start` to `end`; an `end` of 0 runs until now. A changed fee is a new entry. The view reads the row from the database, not `OptionMap`, so both colors agree during a release.
- **The console computes net and ROI** (`channelEconomics`), all in yuan:
  - net = revenue − fee × site exchange rate − commission − gift spent. Commission and gift are quota dollars, which customers buy at ¥1 each.
  - ROI = net ÷ fee.
  - Fee per new payer = fee ÷ accounts that first paid in the range.

## Alternatives considered

- **A table for fees.** It would need a migration and the three-database upgrade check, for a list of a few entries that only this view reads. The option row needs neither.
- **Charging the pool's account cost to channels by their share of consumption.** The pool is a fixed monthly cost. Its share in a range depends on every other customer's use, so it would move a channel's ROI for reasons outside the channel. Gift spent at list price prices the capacity a channel took for free, which is the cost the owner asked to see.
- **Counting a monthly fee when it is paid.** A month paid on day one would make every shorter range read as a loss. Spreading it daily matches how the funds view spreads plans and account prices.

## Consequences

- The ROI of a channel that started recently covers only the days since its start, while its sign-up burst falls inside those days. Read a one-off channel over 30 days.
- Revenue counts payments by every account a channel ever brought, so a channel's later paying users keep crediting it.
- The tab label is 推广渠道, so it is not confused with upstream channels (渠道).

## Verification

- `go test ./model -run 'TestChannelInsightsDatabaseMatrix|TestSiteInsightsDatabaseMatrix'` passed on SQLite 3.50.4, MySQL 5.7.44 and PostgreSQL 9.6.24. It covers the mirror top-up row, gift plan and administrator credit, wallet gift share, commission, fee proration and validation. `go test ./model ./controller ./router ./middleware` passed.
- Console: `bun run typecheck`, `lint:check`, `format:check`, and `vitest run src/features/site-insights` passed. The vitest run includes `channelEconomics`.
- A local server with seeded Magpie-like and linux.do-like cohorts showed the tab at 1440 px and 390 px. Adding and deleting a fee from the tab worked, and a four-day fee of $200 a month read $26.67.
