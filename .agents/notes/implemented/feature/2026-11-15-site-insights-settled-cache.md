# Agent Note: Cache the site insights reads of settled ranges and drop the risk view's unused balance reads

Status: implemented

## Problem

The root dashboard asks for six views at once, each over the current period and
the period before it, and every tab asks again on refresh. Each request reran
the whole read, including ranges whose logs could no longer change. Two reads in
the risk view were not needed: `GetRiskInsights` called `fillBalances` for its
debtor list, and `fillBalances` also read every customer with a positive balance
and the ten largest balances, then discarded both, since the risk view takes
only `Debtors`. Its unpaid-liability value was multiplied by a nil price map, so
it was zero and unused.

## Decision

### Settled ranges

`model.InsightsRangeSettled(r, now)` holds when the last hour the range covers
is final, by the rule the hourly rollups already use (`insightHourFinal`): that
hour started at least `3600 + insightHourLookahead + insightHourSettle` seconds
before now. Its logs cannot arrive after that, so every hour before it is final,
and the raw-table reads bounded by `r.End` are settled too, because the range
ends more than an hour before that hour's end.

For the previous period, `[start - span, start)`, the condition holds two hours
and ten minutes after the current period starts. The current period is never
settled.

### What is cached

`cachedRead` wraps the model read of each view (`settledRead` for the views
served directly, and the model call inside the handler for capacity, finance,
activity and channels). The key is the view, the resolved `start`, `end` and
offset, and the query parameters the read depends on: `models` for quality,
`vendor` for capacity. Each element is quoted, so different lists never give
the same key.

- A settled range's answer is kept for `insightsSettledTTL`, five minutes from
  the start of its read. The console already treats the previous period as fresh
  for five minutes. The views also read tables that are not logs (balances,
  debts, orders, plans) and the rollup rebuilds an out-of-date hour, so a copy
  can differ from a fresh read for up to five minutes.
- An open range is never kept. Concurrent identical reads, open or settled, share
  one computation, so a joiner can receive an answer computed up to one read
  earlier. An error reaches the callers that shared the read and is not kept.
- At most 256 entries and 32 MiB of marshalled JSON are kept. The oldest expiry
  goes first.

Live figures are read on every request, outside the cache: capacity's in-flight
requests and users, the limit rejections, the engine pool, the engine's cost and
the exchange rate. The engine's own usage reads were already cached in the
service package, and an engine error in a response is not kept.

The two operator writes this page reads, channel costs and upstream fees, drop
every kept answer on the process that handles them, and a read that was running
keeps nothing. Another server keeps its copy for up to the TTL.

The response shape does not change. `logs_since` is still added per request.

### Risk view

`readDebtors` is the debtor list alone, used by the balances view and by risk. It
drops the aggregate, the positive-balance read and the top-ten read from the risk
path. The debtor query is unchanged.

## Alternatives considered

- **Cache the whole HTTP response.** This would freeze in-flight counts and
  engine figures, and it would cache engine errors. Only the model read is kept.
- **Cache open hours in the view layer.** Open hours already have their own
  one-minute cache in `model/site_insights_hours.go`; a view cache over an open
  range would add staleness without removing a scan.
- **Remove the balance list from the risk view instead of reading it once.** The
  view reports debtors, so the list stays.
- **Memoise `limitedPlanBuyers` between `fillSharedIPs` and `sharedExits`.** Both
  read plan buyers, with the same window only for a settled range, and the
  saving is one query per 500 addresses. `sharedExits` has no other caller, but
  the change would alter its signature for that saving, so it is left out.

## Consequences

- Refreshing a tab over a settled range does not rescan logs for five minutes.
- A balance, debt or order change reaches a settled range's figures within five
  minutes, not at once.
- A stale-row rebuild by `FillInsightHours` reaches a settled range within five
  minutes.
- A channel-cost or upstream-fee save is seen at once on the process that saved
  it, and within five minutes elsewhere.
- Two servers during a release each keep their own copy, within the bounds above.
- Capacity's limit rejections are read on every request. They are one read of
  the hourly rejection rows, so they are not cached.

## Verification

Risk query count, on SQLite, with 2,000 seeded customers (1,000 with a positive
balance, 500 in debt, 500 at zero) and three sign-ups in the range, counted by
`TestRiskReadsCustomerBalancesOnlyForDebtors`:

- Before: 6 statements read `users`, returning 1,514 rows (sign-ups 3, the
  aggregate 1, positive balances 1,000, top ten 10, debtors 500).
- After: 3 statements, 503 rows (sign-ups 3, staff IDs 0, debtors 500).

Cache behaviour is covered by `TestCachedInsightReads`: a settled range is read
once until the TTL passes, an open range is read each time, concurrent calls
share one read, parts and offsets do not share, an error is not kept, and the
bounds hold. A write drops the kept answers, and a read running across the write keeps none,
both in `TestCachedInsightReads`. `TestInsightsRangeSettledWaitsForTheLastHour`
pins the boundary.

No production timing was measured for this change.
