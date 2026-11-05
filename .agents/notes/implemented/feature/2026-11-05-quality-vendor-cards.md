# Agent Note: Quick-select the quality tab by vendor from cards

Status: implemented

## Problem

The quality tab's model filter selected nothing by default, so its headline TTFT merged every vendor. On 2026-11-05 GPT models carried 58% of the morning's streamed requests, and the site-wide p50 doubled to 3.4 s while each Claude model stayed within 0.2 s of its earlier p50. The per-vendor shortcuts sat inside the filter's dropdown, and nothing on the page showed a vendor's figures before one was picked.

## Decision

A row of cards above the filter: one for every model and one per vendor with traffic in the range. Each card shows TTFT p50 and p95, requests and the failure rate. A click selects that vendor's models, through the same `models` search parameter the dropdown sets; the all-models card clears it. The card whose models equal the selection is pressed.

- `GET /api/site-insights/quality` gains `vendors` (vendor, its models, requests, errors, failure rate, TTFT p50 and p95) and `all_models` (the same figures over every model). Both merge the per-model histograms the response already reads, so the percentiles are exact, and both ignore the filter, as `models` does, so the cards keep their figures while one is selected.
- The vendor of a model is `ModelVendor`, the classification the finance tab and the dropdown's shortcuts use.

This builds on [the model filter](2026-11-03-quality-model-filter.md).

## Alternatives considered

**Computing the cards in the browser from the per-model rows.** Percentiles do not combine from per-model p50 and p95.

**Selecting Claude by default.** It hides the GPT traffic the headline is meant to count, and a bookmarked URL without `models` would change meaning.

## Consequences

- The response grows by one row per vendor. Older consoles ignore the two fields; the cards do not render without them.
- The headline figures still follow the selection; the cards are the unfiltered comparison.

## Verification

`TestSiteInsightsDatabaseMatrix` asserts the vendor rows and the all-models figures, and that a selection leaves both unchanged. `quality-tab.test.tsx` covers a card's figures, the pressed state, and a click selecting a vendor's models and clearing them.
