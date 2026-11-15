# Agent Note: Served value by plan beside the account cost

Status: implemented

## Problem

The funds view's account-cost table prices each plan's accounts per month, but it says
nothing about what those accounts served. The owner cannot see, for each plan, whether
its accounts returned more official-price value than they cost. The engine can report
that per credential, and the view can join it to plan and tier by credential id.

## Decision

- **The server reads the engine's per-credential usage.** `service/engine_usage.go`
  `FetchEngineCredentialUsage` reads `GET /api/usage/credentials` for the range in
  milliseconds, with the daily reader's auth, 8-second timeout and envelope. The app
  accepts at most 366 days and the engine at most 367, so one read covers every range.
- **The join is by credential id.** `service/engine_value.go`
  `EnginePlanUsageByCredential` maps each credential to the plan and tier of the pool's
  account. A credential in two groups is summed once. Every pool plan and tier is listed,
  with zeros when it served nothing.
- **Two extra groups keep the total whole.** Usage of credentials no longer in the pool
  is `removed`. Usage with credential 0 is `unattributed`. Plans, removed and unattributed
  add up to the engine's total for the same window.
- **`FinanceResponse` adds `plan_usage` and `plan_usage_error`.** Both are additive.
  `plan_usage` is absent when the engine is not configured or predates the endpoint (HTTP
  404 is read as "unsupported", not an error). `plan_usage_error` carries a failed read,
  or the pool's own error when the pool did not read, since the join then cannot be made.
- **The read is live, outside the settled-range cache.** It is started beside the pool
  read and added after `cachedRead`. It has no cache of its own: only the finance view
  asks for it, once per load.
- **The console joins it to the account-cost table.** `planServed` in
  `finance-analysis.ts` gives each costed plan its served value, served ÷ cost and share
  of the range's total. Removed and unattributed use, and any plan with no cost row (Codex,
  which the table does not price), are muted rows at the end. A ratio is colored under 1×
  only from `PLAN_MIN_REQUESTS` requests, the funds tab's floor for a rate. A line names
  the plan that returns the most and the least per dollar.

## Alternatives considered

- **Prorate accounts added inside the range.** Their creation time is known only from the
  usage read, and an account with no usage has none. A prorated cost would be a guess, so
  the view names the count instead.
- **Join usage to plans on the server in SQL.** The engine owns the usage, and the app owns
  the pool; the join is two small reads keyed by credential id.
- **Show served value in a second table.** The served columns sit beside the cost they are
  divided by, so the ratio and the share read against the same row.
- **Put the request floor on the server.** The other rate floors on the funds tab live in
  the console, next to the rates they judge.

## Release order

The engine's endpoint ships first, then this change. The console change is also safe
before the engine: against an engine that answers 404, the view shows no served columns
and no error, as before.

## What can make the figure wrong

- **List price may not be what was paid.** Costs use `ACCOUNT_PRICES`. Discounts, promotions
  and a plan billed differently from its list price move the cost, not the served value.
- **Cost uses today's pool for the whole range.** An account added inside the range is
  charged for all of it, so its served ÷ cost reads low. The view names how many accounts
  that served were created inside the range; accounts with no usage in the range are not
  counted, because the usage read carries no account of its own without requests.
- **Seats bought but not in the pool are invisible.** A Team seat that is paid for and not
  listed in the pool has no cost row and no served value here.
- **Served value by plan follows the router, not the customer.** Which account a request
  reached depends on scheduling and affinity. A plan's served figure is what its accounts
  carried, not what a customer used on that plan.
- **Removed accounts keep their served value and lose their cost.** Their usage appears
  under "Accounts removed", with no cost row, because the table costs today's pool.
- **The pool is read up to two minutes stale.** The plan join uses `RecentEnginePool`,
  as the table does.
- **The request floor is borrowed.** `PLAN_MIN_REQUESTS` reuses `MIN_CHECKOUTS` (10). It is a
  judgement about how many requests make a ratio readable, not a measured threshold.

## Verification

- `go test ./service/ -run 'EngineCredentialUsage|EnginePlanUsage'` covers the reader
  against a stub engine: query string and auth, nano-USD strings past 2^53, a 404 as
  unsupported, a 500 and an invalid cost as errors, and the join (one credential in two
  groups, a credential with no usage, a removed credential, credential 0, and the
  account added inside the range).
- `plan-served.test.ts` covers `planServed`: the join, shares that add up to one, the
  judged-plan pair, and a plan with no cost.
- `plan-usage-table.test.tsx` covers the columns, the coloring floor, the muted rows after
  the plans, the most-and-least line, the added-accounts note, the hidden state and the
  error line.
- Not covered: the handler's wiring (`GetFinanceInsights`) is checked by the build only, and
  nothing has been run against production's engine.

## Production check after both releases

- The plan rows should list each plan and tier the pool holds (Max 5x, Pro, Team Standard,
  Team Tier 1 and any other), and Codex or another tier-less plan as a muted row.
- The served values across plans, removed and unattributed should add up to the engine's
  all-model total for the same window, which is `/api/usage/daily` without `model_prefix`
  (the activity view's total). The funds tab's own engine figure is Claude only, so it
  matches only the Claude part of that total.
- A plan with an unexpectedly low ratio should be checked against its accounts' cost
  before the price table is blamed.
