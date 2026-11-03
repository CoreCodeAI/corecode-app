# Agent Note: Filter the service-quality tab by model

Status: implemented

## Problem

The quality tab's TTFT p95 merged every model's first-response times. Claude sits near 7 s at p95 and the GPT models near 18 s, so a rise in GPT traffic moved the site-wide figure with no change in either model's latency.

## Decision

`GET /api/site-insights/quality` takes an optional `models` query parameter, a comma-separated list of model names. The route's `models` search parameter carries the selection, so a filtered view has a URL.

- `GetQualityInsights(r, only)` keeps reading the same per-hour, per-model histograms. It skips the unselected models when it sums the headline figures (requests, failure rate, TTFT p50 and p95, cache read share) and the daily series. An empty or absent list selects every model.
- `models` is not narrowed. It lists every model in the range with its own figures and a `vendor`, and it is where the filter's options and the "All Claude" and "All GPT" shortcuts come from, so the options do not shrink as the selection does. The table fades the models outside the selection.
- Status codes, failure reasons and stream ends stay unfiltered. They are counted per hour, not per model, in the stored hour summary. The tab says so beside the filter.
- The controller trims names, drops blanks and duplicates, and rejects more than 100 names or a name over 128 bytes. A name the range has no traffic for matches nothing and yields zeros.
- The previous period is read with the same selection, so the deltas compare like with like. The overview reads the quality view unfiltered, so a selection made on the tab does not change the overview's figures.

## Alternatives considered

**Filtering in the browser from the per-model rows.** Percentiles do not combine from p50 and p95, and the daily series is not per model, so the cards and charts would need the histograms the server holds.

**Making the per-model breakdown of failure reasons and status codes.** That changes the stored hour summary and its schema for a figure nobody asked to filter.

## Consequences

- The response gains `vendor` on each model row. Older consoles ignore it.
- A filtered range reuses the cached hours; no new log scan is added.

## Verification

`TestSiteInsightsDatabaseMatrix` selects one model and asserts the headline counts, the zeroed TTFT, the daily series, the unfiltered table and the unfiltered status codes. The console's typecheck, lint baseline, format check and test suite pass.
