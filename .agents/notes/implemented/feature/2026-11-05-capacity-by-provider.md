# Agent Note: Split the capacity tab by provider

Status: implemented

## Problem

The capacity tab merged Claude, Codex, Grok and Gemini into one peak, one request count and one set of rejections. They are separate pools: Claude holds 10 accounts and Codex 1, so a site-wide peak against the site-wide slot total said nothing about whether one provider was full. The pool tab already switches by provider; the capacity tab did not.

## Decision

The capacity tab gets the pool tab's provider switch, plus an "All providers" item that keeps today's view. The choice is the `vendor` search parameter; absent means all.

- `GET /api/site-insights/capacity?vendor=<provider>` narrows the summary to that provider. The vendor of a request is `ModelVendor` of its model. The parameter takes only `service.PoolProviders`; anything else reads as all.
- Each cached hour keeps a per-vendor summary (requests, errors, peak concurrency, peak RPM, engine rejections, upstream rate limits, failure categories). The peak is rebuilt from that vendor's request intervals, counting requests already in flight when the hour opens. `insightHourVersion` rises to 3, so stored hours are rebuilt from the logs.
- Slots and in-flight counts come from the engine groups of that provider. The pool line and the verdict use them.
- Per-user figures stay in the all view only: the per-user limit answers before a provider is chosen and never reaches the logs, and the per-user tables span every provider.
- Only Claude's upstream names the limit it hit, so other providers label that series "Upstream rate limit".

## Alternatives considered

**Filtering by model, as the quality tab does.** Capacity is held per provider pool, not per model, and the per-hour peak cannot be summed from per-model peaks.

**Computing per-provider peaks on request.** The capacity tab reads up to 30 days; the hour cache exists so that read does not rescan the logs.

## Consequences

- The first read after the release rebuilds the hour cache, as each version bump does.
- A provider's view has no per-user limit figures, and says so by leaving them out.

## Verification

- `go test ./model/` covers `TestCapacitySplitsByVendor`: requests, peaks spanning an hour boundary, and failure categories per vendor.
- `capacity-tab.test.tsx` covers the switch and the per-provider slots, labels and hidden per-user panels.
