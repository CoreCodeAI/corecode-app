# Agent Note: Make the site insights tabs read by the hour, count a request once, and show what they left out

Status: implemented

## Problem

The owner opened `/site-insights` at a 24-hour range and asked for every tab but the account pool to go deeper. An audit of the tabs (137 findings, each checked against the code by one or two reviewers told to refute it; none was refuted) found three kinds of defect.

- **A short range said little.** A rolling 24 hours splits into two partial calendar days, so every daily chart drew two bars. The hourly data was already in memory on the server; only the capacity view returned it. The previous period's detail was fetched and only its totals were used.
- **Several figures were not what their label said.**
  - The hourly rollup counted log rows. A request that failed on one channel and was served by the next counted as two requests and one failure, so a failover that worked read as a failure rate.
  - Peak concurrency counted every channel and was divided by the engine pool's slots.
  - Only one of the engine's own 429 messages was recognised; the rest read as upstream rate limits. An upstream's 401, 402 or 403 read as the customer's error.
  - Cached prompt tokens were counted twice for usage that already includes them, so GPT's cache read share read about half its true value.
  - `gpt-image-*` matched the `gpt-` prefix and counted as Codex.
  - Refunds of failed image and video tasks never left consumption.
  - Activity counted root. Shared addresses ignored sign-in addresses and ranked proxy exits first.
- **Key data was missing.** Image and video task outcomes, requests refused before any channel was tried, what running plans still owe, a plan book, checkout completion, upstream bills in the gross margin, and consumption by price group appeared nowhere.

The page also printed a missing figure as zero: a card whose query was loading or had failed showed `¥0.00 ▼100%`, and a table said "none".

## Decision

### A short range reads by the hour

At three days or less (`HOURLY_MAX_DAYS`) the quality, funds, activity, growth and upstream views return an `hourly` series, aggregated in Go from rows each view already read. The console draws it in place of the daily chart and falls back to the daily chart when the field is absent. The hour still filling is drawn faded, reads "in progress", and is left out of every peak, baseline and anomaly. The partial-day marking from the note of the same date applies wherever a daily chart still draws.

Each tab sets a breakdown against the same part of the previous period: the same hour, model, channel, vendor, segment, customer or payment method. When a headline figure moved, the verdict names the one or two parts that explain most of the change (`contributions`, `dominant` in `analysis.ts`).

Thresholds live in `lib.ts` so a tab and the overview agree. A rate over too few events is neither coloured nor ranked: 100 requests for a rate, 20 for an hourly rate, 5 orders before a revenue change is a percentage, 20 sign-ups before a conversion rate is coloured, 7 days before a promotion channel's return is judged.

### Rollup version 5

`insightHourVersion` goes from 4 to 5 once. No table changes; new figures go in the hour's JSON summary.

- **A request is counted once.** Logs are folded by request id. A request succeeded when any consume log shares its id, and otherwise failed once under its last error's category. It belongs to the hour of its earliest start and holds one concurrency interval. `attempts` and `attempt_errors` keep the per-try counts, and the per-channel rows behind the upstream tab still count attempts, as their labels say. An hour reads five seconds past each end and folds before it counts, so a request whose tries fall either side of an hour boundary is seen alike by both hours.
- **The pool's own peak.** `pool_peak` counts requests served through an engine channel. A request the engine refused never held a slot. The site peak keeps its meaning. Everything the capacity tab compares with slots uses the pool's peak.
- **Whose failure.** `engine_limit` (the engine's group, global and key caps), `engine_budget` (its request rate, quota budget and missing quota observation) and `upstream_auth` (401, 402, 403 an upstream returned) are categories of their own. Only the remaining 429s are `upstream_rate_limit`.
- **Cache share.** The consume log records whether its prompt tokens include cached tokens, by the expression billing uses. Uncached input is prompt less cache read and write for such a log.
- **Media is a vendor.** Image and video models are `media`, matched before `gpt-` and `grok-`. The pool's demand forecast and the engine cost share-out no longer count them as Codex.
- **Async tasks.** A task refund lowers the user's and the channel's consumption in the refund's own hour and is no request. An hour may store a negative figure; a view stops at zero only after summing what it shows. Task logs now record what paid for the task, as request logs do. That is log metadata: no charge, reservation or refund amount changed.
- **Nothing reads zero because of the bump.** A stored hour of an older version is served as it is. The master task rebuilds such hours newest first while their logs last. An hour whose logs are gone keeps its old row for good. Every view returns `stale_hours`, and each tab says when part of its range is still on the earlier definition. Figures only version 5 has (`pool_peak`, `attempts`) are omitted while the range holds an older hour.

### New data

- **Service quality:** task outcomes by model and channel from the tasks table (submitted, succeeded, failed, timed out, running, stalled, time to finish). A request that finds no channel now writes one error log (`no_channel`, channel 0), behind the switch that gates error logs. Risk-gate refusals are read from the table that already records them.
- **Funds:** what running paid plans owe (the price share of the time not yet run, by the order matching revenue recognition uses, and the quota left), a plan book, checkouts by payment method and status, upstream bills by vendor, and consumption by price group. Revenue counts an order when it was paid.
- **Activity** leaves root out and returns root's consumption apart.
- **Risk:** shared addresses also come from sessions, sign-in audit logs and plan orders; an address the purchase check treats as a shared exit is marked and ranked last; clusters are ranked by risk before the cut to 50. Sign-ups that spent only given credit and never paid are listed, so a gift farm shows without a shared address.
- **Promotion channels:** overlapping fee entries no longer add up, commission sits on the row of the account that paid, and a fee channel still earning commission is reported.

### Missing is not zero

A card whose source is loading or failed shows a dash and no change; a table says it is loading or could not be read; a failed side query is named where its figures would be. The overview does not say nothing needs attention until every source and comparison has loaded. Requests, failure rate, revenue and peak each state what they count.

### After the release

Reading the released page on production data turned up four label defects, fixed in a console-only follow-up:

- The quality verdict printed the service failure rate under the name "failure rate", beside a card of that name showing the raw rate, and gave the raw rate's change. It now says "service failure rate" and compares it with the same rate of the previous period.
- Payment methods Stripe added (`stripe_alipay`, `stripe_wechat_pay`, `stripe_card`) and `nowpayments` printed as their keys. `paymentMethodLabel` in `lib.ts` names them.
- The overview's pool signal printed an account's status key. It uses the account pool tab's names.
- The quality tab's request trend did not mark the open hour as in progress.

Left as they are: stream-end names (`eof`, `client_gone`) and risk-gate stage names (`hard_regex`, `refusal_cache`) print as the identifiers the help text and the risk-gate settings use. Growth counts 9 fewer sign-ups over 7 days than risk and the overview, because risk counts accounts deleted since and growth does not; each tab's help says which. The model map does not answer a tap on a phone.

### Decisions the owner made

- Currency symbols stay. One quota dollar sells for one yuan, so the audit's findings about `¥` against `$` were skipped and no conversion was added.
- A channel paid a fee is still not charged its commission (2026-11-06). Commission accruing on such a channel is shown as a warning and not subtracted.

## Alternatives considered

- **Compute verdicts and drivers on the server.** The thresholds sit beside the cards that colour by them, as the verdict note records. The console already holds both periods.
- **Soft-delete plans so a deleted gift plan stays a gift.** The consume log now records that the plan was a gift at billing time, which holds whatever happens to the plan row and changes no other query.
- **Redefine the peak as the pool's.** Hours whose logs are gone could not be rebuilt and would stop being comparable. The site peak is kept and the pool's is added.
- **Clamp a refund at zero in its hour.** A refund landing in an hour with no other traffic would be dropped, and the range would read high by the whole charge.

## Consequences

- An hour stored before this release whose logs are gone stays on version 4: requests there count attempts, and it has no pool peak. Views over long ranges mix both and say so through `stale_hours`.
- **Release order.** A server of the release before this one treats a version 5 row as missing and stores the hour again as version 4. The rebuild therefore waits until this process has run 15 minutes and no older-version row was stored in the last 30. A rollback to the earlier server would recompute every version 5 hour of a range on each dashboard load, up to 200,000 logs an hour; roll forward instead, or accept a slow dashboard until the next release.
- The vendor of a model is decided when a view is read, so `gpt-image-*` use from before 2026-11-10, when the Codex pool served it, also reads as media.
- A request refused for want of a channel is logged only when some channel lists the model, so made-up model names cannot grow the logs table. Without the channel cache that check is one count on the abilities table per refusal.
- The new views scan `top_ups`, `subscription_orders` and `user_sessions` by time, and the risk view reads every user with an email to group inboxes. None of those columns is indexed. The tables are small today; an index needs its own migration, built concurrently on PostgreSQL.
- Advice is held back where the sample is small: the Claude pool recommendation needs 7 days the engine reported, a channel verdict 3 new payers, a cause for engine rejections 20 of them, and activation is judged over sign-ups at least 6 hours old.
- Not built, because each needs a change to billing or refund flows or is large: recording cash refunds, recording how debt arises and shortfall-cap refusals, a view by API key, a moving-average wallet price for earned revenue, pool cost by plan, and the media supplier's bill.
- The first-load budget counts locale keys no source names as part of the dashboard's and the keys page's first load. Rewording a sentence orphans its old key. This change removed 71 such keys from the locale files; a later change that rewords help text has to do the same.

## Verification

- Server, proxy variables unset: `gofmt -l model controller service middleware relay` listed nothing; `go vet ./...` passed; `go test ./common/... ./controller/... ./middleware/... ./model/... ./service/... ./relay/... ./router/... -count=1` passed in 28 packages on SQLite.
- Every test in `model/site_insights*_test.go` and `model/shared_address_test.go` ran on SQLite, MySQL 5.7.44 and PostgreSQL 9.6.24 in local containers (utf8mb4 database, URL-form DSN, a fresh database for the run): 19 dialect legs passed on each, none failed or skipped. The same command on `origin/main` before the change passed too.
- Each fix from the two review rounds was confirmed to fail without it: a request retried across an hour boundary, a refund in an hour with no other traffic, the row cap cutting a request's serving log, a violation fee counted as served, an older-version hour served and then rebuilt, the rebuild held while an older-version row is recent, and a refusal naming an unlisted model.
- Console, from `web/`: `bun run typecheck`, `lint:check`, `format:check`, `build` and `first-load:check` passed (353.2 KB of 355, 528.3 of 530, 608.7 of 610). `bun run test` passed: 340 files, 3515 tests.
- The dev server was run against production through a read-only proxy that forwards GET requests only. The overview at 24 hours and 1600 px drew production figures with no console error and no `NaN` or `undefined`. The access token expired before the other tabs, the pointer sweeps and the phone width were checked, so those were not checked before the merge.
