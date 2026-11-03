# Agent Note: List each customer's use on the funds view, with gpt-load's cost shared out to them

Status: implemented

## Problem

The owner wants to see which customers used the most over the last 1, 5, 12 or 24 hours
or 7 days, from the funds view, and for each one: name, id and email; new-api's charge
and what the same use cost gpt-load at official prices; everything they have paid; and
their balance now. The activity view's top customers table reads only whole days, and
it follows the page's range. The owner wants this table to switch its own window.

gpt-load cannot say what one customer cost. Every request reaches it through new-api's
one channel key, so its request logs and `/api/usage` know channels, groups and models,
not new-api users.

## Decision

- **`GET /api/site-insights/user-spend?hours=1|5|12|24|168`** (root, PAT scope
  `billing:read`) returns the window ending now. The server shares one read per window
  for a minute.
- **new-api's charge comes from the consume logs**, summed by user, model and group in
  SQL. A one-hour window then ends at the second, not at the hour. Root is counted apart:
  root's share of the cost is reported, and root is not listed.
- **gpt-load's cost is shared out by model.** The server reads `/usage` for each channel
  the pool has groups in. That gives the channel's total and its five most expensive
  models, grouped by the provider the channel serves. A named model's cost goes to that
  model's users in proportion to their charge, with the group ratio
  (`GroupRatio[log.group]`) taken out. Otherwise the same use in a dearer group would take
  a larger share. A provider's remaining cost goes the same way over its models the
  engine did not name, or over all its models when it named every one. A provider that
  no one was charged for in the window, such as an idle Grok pool, stays
  `unattributed_engine_usd`. Customers, root and unattributed sum to the engine's total.
- **Paid is all-time and in the payment currency**: wallet top-ups, and plans apart, from
  successful orders. Orders paid from the wallet are left out, as in the rest of the funds
  view. The balance is `users.quota`.
- **The console adds a panel at the bottom of the funds tab.** It has its own window
  toggle, defaulting to 24 hours, kept in component state, and it refetches every minute.
  It lists the 100 customers with the most new-api value, 10 a page. `SimpleTable` gained
  an optional `card` render. Below `sm` it draws each row as a card instead of a table
  that scrolls sideways; existing callers are unchanged.

## Alternatives considered

- **Exact attribution per request.** new-api's logs keep `upstream_request_id`, and the
  engine keeps a request id per request, so the two could be joined. The engine has no
  per-user aggregate, though, and a join over a week of requests needs engine work. The
  owner chose to ship the per-model share now and replace it with the exact figure later.
- **Read `quota_data` instead of the logs.** It is hourly, which blurs a one-hour window,
  and it has no group, so the group ratio could not be taken out.
- **Follow the page's range.** The owner asked for the table to switch on its own; the
  page's ranges are whole days.

## Consequences

- The gpt-load column is an allocation, not a measurement. Within a model it is exact
  when new-api's model ratios mirror official prices, which they do (`model ratios are
  official prices` in the infra runbook). It is shifted by a request new-api did not bill
  but gpt-load served, such as a failed attempt, because that cost is shared over the
  window's users.
- The seven-day window aggregates a week of consume logs through the
  `(created_at, type)` index, at most once a minute per window.
- The response is new; the released console does not read it, so the server and console
  can release in either order.

## Verification

- `TestUserSpendDatabaseMatrix` covers the log sum by user, model and group, the window
  edges, the root ids, and the paid totals against SQLite 3.50.4, MySQL 5.7.44 and
  PostgreSQL 16.15. No schema changed.
- `TestShareEngineCost` and `TestShareEngineCostWhenEveryModelIsNamed` cover the group
  ratio, a named model, the remainder over unnamed models, a model the engine names but
  new-api never sold, and a provider no one was charged for.
- `user-spend.test.tsx` covers the rows, the summary, the window switch, an engine error
  and the phone cards.
- The local build was run on a seeded SQLite database with a stub engine. Customers,
  root and unattributed summed to the engine total in the 1-hour, 24-hour and 7-day
  windows. In ego-browser at 360, 390 and 1280 px the page did not overflow, each window
  button switched the panel and left the page range alone, the help icon opened on a
  tap, and the column hints opened on hover.
