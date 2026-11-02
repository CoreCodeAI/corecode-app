# Agent Note: Read the activity tab's spend in new-api dollars, yuan and gpt-load value

Status: implemented

## Problem

The activity tab printed new-api's charge as US dollars, for example "US$2,509.97" as the
busiest day. new-api charges in quota dollars that customers pay ¥1 each for, so the
figure is yuan. The funds view and the pool tab already convert it at the site's
exchange rate (`useChargeFormat`). The owner asked for the daily consumption chart to
show three measures:

- new-api in dollars;
- new-api in yuan;
- what gpt-load's requests were worth at official prices.

## Decision

- **The activity response gains `engine_total` and `usd_exchange_rate`.**
  - `engine_total` is the engine's `/usage/daily` without `model_prefix`: every model
    gpt-load serves, so it covers the same use as new-api's charge for every model. The
    existing `engine_cost` stays Claude-only for the official-cost panel. Both are read
    in parallel.
  - `EngineDailyCost` gains `unpriced_requests`, the engine's `unpriced_request_count`.
    The chart notes those requests, because they are left out of the value.
- **The daily consumption chart has a measure switch**: US$, ¥, gpt-load. Each bar's
  readout gives the other two measures and the request count. The description gives
  the range's totals in all three and the busiest day in the chosen measure. gpt-load is
  disabled until the server sends `engine_total`, or while the engine is unreachable.
- **Every new-api amount on the tab is converted**, so no figure contradicts the chart:
  - the consumption card shows dollars, with the yuan and gpt-load's value below;
  - the per-active-user card, the official-cost panel's charged figures and the top
    customers table read `$x (¥y)`, as on the funds view.

## Alternatives considered

- **Three bars per day.** The three measures are the same use in different units, not
  parts of a whole. Stacked bars would add them, and grouped bars would set dollars
  beside yuan on one axis.
- **Converting the chart only.** The consumption card above it would then still print
  yuan as dollars, about 6.8 times the chart's figure.

## Consequences

- One more engine read per activity request, of the same size as the Claude one.
- An older console against the new server ignores the new fields. The new console
  against the old server falls back to the exchange rate in the status config and
  disables the gpt-load measure.

## Verification

- Go: `FetchEngineDailyTotal` sends no `model_prefix` and sums unpriced requests.
  `go test ./service` passes.
- Console tests cover:
  - the three measures in each bar's readout;
  - the switch;
  - the totals sentence;
  - the unpriced note;
  - the card;
  - the gpt-load option disabled without `engine_total`.
