# Agent Note: Show each customer API key on the activity tab

Status: implemented

## Problem

The root dashboard reads customers by user, model and channel, not by API key. The owner cannot see which keys drive requests, failures or spend. `quota_data` cannot serve the view: it holds served requests and spend only, and refunds are never subtracted. The request logs carry `token_id`, but the hourly rollups did not keep it.

## Decision

- Rollup version 7 adds `InsightKeyHour`, one row per hour, token, staff flag and model. It holds the requests, failed requests, customer-caused failures (`customerFault`), quota net of refunds, the owner and the token name. `computeInsightHour` fills it from the folded requests and charges, and `save` writes it in the same transaction as the hour.
- An hour keeps a customer key when it is in the top 200 by quota or the top 200 by requests. The other customer keys of that hour fold into one row per model under token id -1, so totals stay whole. Token 0 (no key) is always kept. Staff keys are not bounded: staff are few and the view lists them apart.
- `GET /api/site-insights/keys` (`billing:read`, the 92-day log bound, `settledRead`) sums the stored hours by SQL, joined to `insight_hours` at version 7 or later, and merges the open hours from memory. It returns the top 100 customer keys by spend, token 0 always, the other-keys row when keys were folded, the staff keys apart, each key's top three models by spend, and `stale_hours`.
- The activity tab shows a panel, "By API key", below the top customers. The panel is left out while the server does not send the view.
- The key figures use the same unit as the activity view's `quota_usd`: quota dollars, which are yuan.

### The requests no channel could take, by group, model and user

The same version also splits the customers' requests no channel could take. On production on 2026-11-15 they were 2,648 of 4,354 failed requests over seven days, the largest cause, and the page gave the count alone: 1,681 of the 2,521 failed media tries were `no_channel: no available channel in group auto`, so a media model read as failing 98% when its channels were never asked.

- Each hour's summary keeps `no_channel` (by group and model, the 30 largest, with the rest counted in `no_channel_other`) and `no_channel_users` (by user id, the 30 largest). They ride the version-7 rebuild, so the hours are rebuilt once.
- The group is the log's; a log without one takes it from the refusal's own text (`NoChannelErrorContent`).
- The quality view sends `refusals.no_channel_by`, `no_channel_users` and `no_channel_split`, how many of `no_channel` the split hours account for. The quality tab lists them under "Refused before a channel" and says when part of the range is not split.
- Only our own refusal counts. An upstream new-api site that answers "No available channel for model … (retry) (request id: …)" has failed as a channel, and stays an upstream error: `isNoChannelMessage` matches our texts whole, and `TestQualitySplitsNoChannelRefusals` pins it.

## Alternatives considered

- Reading `quota_data`: rejected, because it has no failures and no refunds.
- Scanning the logs at query time: rejected, because a 92-day range is what the rollups exist to avoid.
- No bound on keys per hour: rejected, because the row count would grow with every key a customer creates.
- Bounding by spend alone: rejected, because a key whose requests all fail has no spend and would drop out of the failure figures.
- Loading the key table in `loadInsightHoursStale`: rejected, because every view calls it and only this view needs the rows.
- An exact active-key count: needs a distinct set per hour. The view reports `keys_truncated` instead, and `active_keys` is a lower bound when keys were folded.

## Consequences

- At release every stored hour is version 6 until it is rebuilt. `FillInsightHours` rebuilds 200 hours per 10 minutes, about an hour for production's roughly 700 hours. Until then every tab shows its `stale_hours` note and withholds the figures it withholds for older hours. The keys view leaves those hours out, because a version-6 hour has no key rows.
- An hour whose logs were cleaned stays version 6 for good. Its keys never appear, and it stays in `stale_hours`.
- A version-6 server leaves version-7 rows alone. It skips every stored hour that is at its version or later, and it never writes `insight_key_hours`. Its own writes at version 6 leave key rows that the view ignores, because the view joins on the hour's version. A rebuild under version 7 replaces them.
- Within one hour, a key folded into the other-keys row reads low for that hour only. Its figures are exact in every hour where it was kept.
- Production checks after release: rows per hour in `insight_key_hours`; the rebuild's duration until `stale_hours` reaches zero for a 30-day range; and the per-key consumption summed over a range, which should equal the activity view's `quota_usd` for that range when no hour folded keys.

## Verification

- Go, SQLite and PostgreSQL 18.6: `TestKeyInsightsFoldsEachRequestAndCharge` covers the retried request, the failover, the customer's 400, the refund in the next hour, staff apart and token 0. `TestKeyInsightsStaleHourIsRebuilt` covers a version-6 hour. `TestKeyInsightsStoredAndOpenHoursAgree` checks the SQL sum and the in-memory merge on the same logs. `TestKeyHourKeepsTopKeysAndFoldsTheRest` checks the bound. `TestAccessTokenRouteRulesCoverEveryDashboardRoute` checks the scope rule.
- MySQL: not run. No MySQL server was available to the change.
- Console: `components/__tests__/api-keys-panel.test.tsx` covers the rows, the fade and tone for small samples, the hidden panel without the view, and the stale note.
