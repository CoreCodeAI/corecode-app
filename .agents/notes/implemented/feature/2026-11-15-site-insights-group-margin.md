# Agent Note: Show revenue, cost and gross margin by customer group on the funds tab

Status: implemented

## Problem

The funds tab shows revenue by billing group, but cost only by vendor. The owner
wants to see which customer group earns and loses money. The data has no cost by
group: a pool's accounts, an upstream bill and a monthly fee each serve several
groups, and one channel can serve two groups.

## Decision

The funds response adds `group_allocations`, one row per billing group, plus a
staff row and an unattributed row. Each row carries:

- `recognized_revenue`, the recognized revenue of the users whose charge fell in
  the row. A user's revenue, wallet and plan together, splits by that user's
  charge across groups. The split uses the charge after the group's ratio, since
  that is what the customer paid for.
- `bill_usd` and `fee_usd`, the row's share of each upstream bill and fee. A bill
  of a channel and model goes by the row's use of that channel and model. A fee,
  and a bill's remainder, goes by the vendor's share of the channel's revenue, then
  by the row's use of the channel and vendor.
- `pool_share`, a fraction per vendor of that vendor's pool account cost. The
  console multiplies it by the account cost it already prices.

Use is quota from `quota_data` divided by the group's ratio (1 when the group has
no ratio), the rule `shareEngineCost` uses. Staff's use is its own row, so the rows
add up to the vendor totals. Each vendor's pool shares sum to 1 over the rows. A
cost with no use to split by goes to the unattributed row.

The console (`groupMargins` in `finance-analysis.ts`) computes each row's cost as
its pool shares times the account cost, plus its bill, plus its fee at the rate. It
shows the margin in the group panel on `/site-insights?tab=finance`, sorted by
revenue, with staff and unattributed rows muted at the end. A server without the
field shows the panel as before.

### Corrected on 2026-11-16: a pool's cost follows the pool's own channels

The first release shared each vendor's pool cost over every channel's use of that vendor. On production it read 「GPT 福利」 as losing 106.6%: revenue ¥13.50 against a cost of ¥27.89. The group is sold at 0.5× over an upstream billed at 0.04×, and its own bill was US$11.93 on ¥111.64 charged. The rest of its cost was 5% of the Codex pool's account, a pool no request reached (its channel is disabled), and its revenue was small because given credit paid for most of its use.

- **A pool's account cost is shared by use on the pool's own channels** (`EngineChannelIDs`). A group served by an upstream site carries that site's bill and no part of the pool. A pool that served nothing in the range is in the unattributed row, an idle cost.
- **A bill under a model name that maps to no vendor of ours, on a channel where that vendor earned nothing, is shared by the vendors that did earn there** (`unnamedBill`), in the vendor totals and in the rows. A supplier that bills by day names models its own way; on production ¥14.40 of the media bill read as a loss under "other models".
- **The panel judges a group by its cost over what it was charged** (`costShare`), shown under the cost. Under 100% the price covers the cost, whatever paid the charge. The description names the groups where cost takes the most and the least of the charge, or the group that sells under its cost. A negative margin is red only when the cost is over the charge; otherwise the column's hint says the use was paid with given credit.

## Alternatives considered

- **Split the pool by the groups' charge.** The price of an account does not
  depend on the price a group pays, so the ratio is taken out.
- **Compute the cost in Go.** The price book (`ACCOUNT_PRICES`) lives in the
  console, and the rows stay correct when a price changes.
- **Add a table for the pool's channel.** The pool is not a channel in the
  billing data; it has no bill or fee, only accounts.

## Consequences

What can make a group's figure wrong:

- It is an allocation, not a measurement. Revenue and cost by group are shares of
  the range's totals.
- The pool is priced as it stands now, the accounts listed today, and that
  monthly price is spread over the range's days. It is not the pool's cost in each
  part of the range.
- Today's group ratio applies to the whole range. A ratio changed mid-range moves
  the weights for the whole range.
- A group renamed mid-range shows as two rows, one under each name.
- `quota_data` does not subtract task refunds. Media tasks refunded after a charge
  still weigh their group, which distorts media's split.
- A used pool's spare capacity is carried by the groups that used it; only a pool
  nothing reached is unattributed.
- A bill is taken one supplier dollar for one quota dollar, as the upstream tab
  does. That is only right when the supplier's dollar is the quota dollar.
- A group with little revenue can show an extreme margin rate, since the rate
  divides by revenue.
- The unattributed row appears whenever a vendor has no use in the range, since
  its pool cost has no user to go to. The console hides the row when it has
  neither revenue nor cost.

What to check on production after the release:

- The real group-to-channel layout: which groups share a channel, and whether
  Claude's traffic also runs on billed channels.
- That the group rows add up to the funds tab's vendor margins, which
  `financeMargins` computes: the rows' revenue sums to the vendor revenue, and the
  rows' cost sums to the vendor cost plus the unattributed cost.

## Verification

- `model/site_insights_group_margin_test.go`: the rows reconcile with
  `vendorUpstreamCosts` (bills 30, fees 14, revenue 63, pool shares 1 per vendor);
  two groups on one channel split a bill by use, not by charge; a user in two
  groups splits revenue by charge; a fee stays in dollars; a group with revenue and
  no bill; staff apart. The database test runs on SQLite; MySQL and PostgreSQL
  subtests skip without an external database.
- `web/src/features/site-insights/__tests__/group-margin.test.ts` and
  `components/__tests__/group-margin-panel.test.tsx`: the margin maths, the muted
  rows, the description, and the hidden state.
