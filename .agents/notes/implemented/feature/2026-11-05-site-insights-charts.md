# Agent Note: Add a week heatmap, a model map, a funnel and a payment donut

Status: implemented

## Problem

The site insights tabs drew time as bars and everything else as tables or ranked lists. Three questions took reading many rows to answer: which hours of the week fill the pool, which models are both slow and failing, and where sign-ups drop out. The finance tab listed payment methods as a table only.

## Decision

Four charts, each from data the tab already reads:

- **Capacity: peak concurrency by weekday and hour.** The hourly series folds into a 7 × 24 grid. Each cell is the highest peak that slot reached on any matching day, shaded in one hue against the busiest slot or the slots, whichever is higher. A slot past the slots is ringed red. It follows the provider switch, so one provider's rhythm reads against its own slots.
- **Quality: model map.** A bubble per model: TTFT p50 across, failure rate up, area by requests, color by vendor. Dashed lines mark the 2% and 5% failure thresholds the tabs color by. The five busiest are labelled, and hovering names any. Models under 20 requests are left out, and the count left out is printed.
- **Growth: sign-up funnel.** Registered, activated, paid and paid again, each a bar against the first step, with the share that went on from the step before.
- **Finance: revenue by payment method** as a donut above the existing table.

Series colors are now CSS variables (`--series-1` to `--series-4` in `corecode-brand.css`, stepped per mode) applied as inline styles. Tailwind classes would add to the one global stylesheet that the sign-in page loads first. The arbitrary color classes from the overview's charts cost the sign-in page its last 0.1 KB of first-load budget; the variables take that space back.

## Alternatives considered

**Raising the sign-in first-load budget.** These pages are admin-only. The budget guards what every visitor downloads, so the cost goes to inline styles instead.

**A line chart per model over time.** The quality response has no per-model daily series, and the map answers which model to look at first.

## Consequences

- A new utility class anywhere in the console still grows the sign-in page's CSS. The sign-in page sits 0.1 KB under its budget after this change.
- Payment methods take series slots in name order, as on the overview.

## Verification

- `advanced-charts.test.tsx` covers folding hours into weekday slots, the busiest slot and the limit legend, leaving small models out of the map, and the funnel's conversions.
- `bun run first-load:check`: `/sign-in` 349.9 KB of 350 KB.
