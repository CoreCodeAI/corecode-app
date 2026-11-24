# Agent Note: Margin by model on the funds tab; how many days each upstream balance lasts on the upstream tab

Status: implemented

## Problem

The funds tab's margin was one figure per vendor and one per group. The owner's operations review needed it per model: which models earn and which only bring traffic. The overview said "90.9% of confirmed, upstream ¥1,021", and that covers only the revenue that can be matched to a bill. On the upstream tab the cards showed each channel's balance but not how long it lasts: on 2026-11-24 the usdj.zzshu.cc account held about $209 and spent about $122 a day, and nothing on the page said that was under two days.

## Decision

### Margin by model (funds tab)

- **The group allocation is reused with the model in the group's place.** `allocateModelMargins` (`model/site_insights_model_margin.go`) re-keys the customer rows of `allocationUsage` from group to model and calls `allocateGroupMargins` unchanged. A bill is therefore split by the use of the channel and model it came from, a monthly fee and an unmatched bill by the vendor's revenue share on the channel, and a pool account's cost by use on the pool's own channels. `FinanceInsights.ModelAllocations` is added beside `GroupAllocations`; nothing is renamed.
- **Revenue is the customers' own, from `quota_data`.** `UpstreamModel.RevenueUSD` includes staff use (11% of consumption), so it would overstate margin; the allocation reads `quota_data`, as the group panel does, and keeps a staff row and an unattributed row apart from the models.
- **A model's cost is known only where it was served on a channel with a cost basis.** `allocationUsage` gained `requests`. `costed_revenue_usd` is the part of a model's charge served on a channel whose `CostSource` is not `none`, or on an engine channel. The margin rate is over that part, so a model half served on an unpriced channel is not shown cheaper than it is. A model with under half its charge costed (`MODEL_MIN_COVERAGE`) shows "Cost unknown" and is left out of every total; the panel states how much of the charge was left out and the share with a known cost ("X of ¥Y charged with a known cost (Z%)").
- **The cost of the account pool comes from the console's account prices**, as in the vendor margin panel (`financeMargins(...).accountCost`), so the pool's models are priced the same way on both panels.
- **Charged is list price, not cash.** The revenue column is what customers were billed at the groups' prices. Cash received averages about 78% of it (`recognized_per_usd`), so a margin rate here reads higher than the cash margin. The help text says so; the number was not rescaled, since the vendor panel already shows recognized revenue.
- **The chart is hand-drawn SVG.** One bubble per model: x is charge on a log axis (four decades at most, so a model charged cents sits at the edge), y is margin rate (from 100% down to the lowest rate in steps of 25%, never below -100%), size is requests, color is the vendor, a destructive outline marks a loss, a dashed line marks 20% (`THIN_MARGIN_RATE`). Labels are placed greedily (losses first, then the largest charges) and skipped when they would overlap one already placed. Beside it, bars show each model's margin and its share of the total, and a table lists charged, cost, margin, margin rate, requests, charge per request and margin per request. No chart library is imported, so first-load is unchanged.
- **"Brings traffic" is a defined test.** A model with a margin rate under 20% and at least 5% of the counted requests (`trafficModels`). A thin model with a smaller share is simply small.

### Upstream runway (upstream tab)

- **An account is a host, not a channel.** `GetUpstreamRunway` (`model/site_insights_upstream_runway.go`) groups the listed channels (enabled or auto-disabled) of one public host and takes the freshest balance read on any of them. Channels 7 and 13 are one usdj account, and 9 and 12 one sub account; on 2026-11-24 channel 7 read $319.70 and channel 13 $208.59 for the same account, and the older read is stale. Internal hosts (`PublicUpstreamHost`, gpt-load) are not accounts.
- **Spend is the upstream's own bill, not our charge.** There is no balance history to difference, and our charge times a multiplier is the very estimate the bill replaces. Request-level costs (`UpstreamCost`) are bucketed into seven rolling 24-hour blocks ending now; for a supplier that reports only day totals (`UpstreamBillDay`, sub2api) the seven whole UTC+8 days before today are used. `basis` says which ("request", "day", "none"). `days_left` is the balance over the daily average, and is absent when the basis is "none" or the average is zero, never zero or infinite.
- **The Claude pool is listed apart.** The gpt-load channel's balance is the pool's weekly remainder in reference cost, not money, so it gets a card with no days (`pools`).
- **Red under 3 days, yellow under 7** (`runwayTone`), the owner's thresholds. Cards sort by fewest days first.
- **A lumpy bill moves the average.** usdj's last week included one day of about $291, so its 7-day average ($122) is above its typical day (about $90). The cards show the seven daily bars so the reader can see it. The average was not trimmed.
- **The endpoint takes no range.** `GET /api/site-insights/upstream-runway` (RootAuth, `billing:read` for access tokens, like the finance view) reads live balances and a window ending now, so it has no `settledRead` cache. It reads the channels, the last seven days of per-request upstream costs, and the day bills; the live latency is in the PR.
- **The overview gets one red signal.** `overviewRunwaySignals` (appended to `overview-signals.ts`) raises one finding listing every account under three days, linked to the upstream tab. An account with no spend is never red.

## Alternatives considered

- **Per-group and per-model on one panel.** The group panel exists; a toggle would blur two different allocations. Models are a second panel.
- **Estimate spend as our charge divided by the upstream multiplier.** It is a guess where the bill exists. It is not used; an account with no bill shows no days instead.
- **Difference the balance.** There is no stored series. Adding one is a larger change (a poller and a table) than this tab needs; the bill is what the balance falls by.
- **Scale list charge to cash in the margin.** It would make the model rows disagree with the vendor panel's recognized-revenue basis. Left as a stated caveat.

## Consequences

- Revenue not served on a priced channel (for example GPT use on a channel with no channel row, about 17% of GPT's charge in the 30-day read) shows as "cost unknown" and its charge is listed as left out. The coverage line is the reader's guard; it is not hidden when it falls below 99.95%.
- An upstream bill for failed attempts or for a model name we do not sell (the video channel's mis-named `TTseadanco` rows, 61.8% failure) is real money out, and it is spread over the models served on that channel by use. The video margin is therefore lower than a hand figure that counts only successful requests.
- `ModelAllocations` is absent on a server before this release; the panel renders nothing then.
- New i18n keys: 36, in all eight locale files.

## Verification

- `go test ./model ./controller ./router ./middleware` passed (3,450 tests), including the model allocation (a channel's bill split by the model's own use with staff apart, a fee, the pool's share, revenue on an unpriced channel kept out of the costed part) and the runway (a shared host counted once on the freshest balance, a missing bill giving no days, the request and day bases and the pool listed apart on sqlite, mysql and postgres) tests.
- `bun run typecheck`, `bun run lint:check`, `bun run build` and `bun run first-load:check` passed (699 bytes left on the tightest route; the panels live in the lazy tab chunks). `vitest run src/features/site-insights src/i18n` passed with the new analysis, signal and render tests, which cover empty data, an absent allocation, partial coverage, a loading state and a failed read.
- The built console was served beside a stub replaying the production responses read in the administrator's own browser session (writes swallowed, no database touched), with the model split approximated from the upstream table. At 1440 and 390 px, light and dark, the funds tab shows the panel after the profit waterfall and the upstream tab opens on the runway cards: usdj about 1.7 days (red), sub about 18 days. After the release the same screens were captured on production.
- Not checked: Safari; the model panel's figures against a hand total on production data before release, which needs the new endpoint field. The comparison with the owner's 30-day hand figures is in the PR.
