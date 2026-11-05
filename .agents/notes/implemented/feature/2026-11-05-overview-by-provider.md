# Agent Note: Show the overview by provider, with share charts

Status: implemented

## Problem

The overview tab showed site-wide totals and a list of signals. Nothing on it named a provider or a model: the pool figures merged Claude, Codex, Grok and Gemini, and a signal such as "2 models fail more than 5%" cut its model names off. The operator could not tell from it where requests, charges or failures came from.

## Decision

Three blocks below the signals, all read from queries the overview already makes, so it fetches nothing new:

- **By provider**: one row per provider with accounts or requests. Schedulable accounts, in-flight against slots (live, from the engine groups), then requests, failure rate, TTFT p50 and charge over the range (from the quality tab's `vendors` and the finance tab's `vendor_usd`).
- **Share charts**: requests by provider, charge by provider, and revenue by payment method, each a donut with a legend that prints every part's figure and share. More than five parts fold the smallest into a gray "Other".
- **Busiest models**: the top eight models by requests, a bar each in its vendor's color, with share, failure rate and TTFT p50.

Signal details now wrap instead of truncating. The capacity tab labels upstream rate limits and overloads without "Claude" when it shows another provider.

The series colors are the dataviz reference categorical slots, stepped per mode and checked with its validator against the card surfaces. The brand `--chart-*` colors failed its chroma and color-blind separation checks. A vendor keeps one color everywhere, and the slices stay in vendor order, not size order, so neighbouring slices are the pairs the validator checked.

## Alternatives considered

**Ranked bars instead of donuts.** Bars compare parts more exactly, and the busiest-models panel uses them. The operator asked for pie charts to read the split at a glance; each donut's legend carries the exact figures.

**A new overview endpoint.** The quality, finance and pool queries already carry every figure, and the tabs reuse them from the cache.

## Consequences

- Payment methods take colors in name order. A method's color can change when the set of methods paid with changes.
- `useVendorName` moved to `lib.ts` from the business panels, so both read GPT for codex.

## Verification

- `overview-charts.test.tsx` covers the provider rows, the share percentages, folding into "Other", hover naming a slice, and the model ranking.
