# Agent Note: Read the pool's demand level from four days, weighted to the latest hours

Status: implemented

## Problem

The owner asked whether the pool tab's capacity estimate is accurate. Every Claude forecast
started from one level, the last 24 hours' spend per hour:

- the runway;
- the Team seat count;
- the 5- and 24-hour cards.

On 2026-11-06 the afternoon ran at twice the day before's (gpt-load $1,276 against $637
from 13:00 to 18:00). That raised the question of whether a level read from fewer, later
hours would follow demand better.

The 5- and 24-hour cards also held the level flat while the headline count grew it by the
trend. On the same afternoon the 24-hour card read exactly the last 24 hours' spend, while
the count assumed 11% growth a day.

## Decision

- **The level is a weighted mean of the last four days.** Each hour counts half as much as
  the one 12 hours after it. It is read over the shape's multiples for the same hours, so a
  busy hour that the shape expects does not move it (`demandLevel`). The console's own
  `quota_data` gives it as a multiple of its last 24 hours' mean (`demandProfile.recent`).
  The engine's 24-hour spend is scaled by that multiple, so both sides stay in their own
  units.
- **The runway's `burn_usd_per_hour` is that level.** The raw 24-hour figure moves to
  `last_day_usd_per_hour`. The projection, the weekly load and every addition count read
  the level.
- **The band is rescored with the same level.** Each past forecast starts from the level
  read at its own origin.
- **The 5- and 24-hour forecasts carry the trend.** `next_24h_trend_usd` now equals
  `next_24h_usd` and stays for older consoles.
- **The console help texts say what the level is**, in every locale.

## Evidence

The model was backtested on the Claude models' hourly `quota_data` from 2026-10-19 to
11-06 18:00 CST, re-implemented in Python. The Go build matched it on production data:
growth 0.1123 a day and a level multiple of 1.016.

Origins are every hour from 10-26, the first with a week behind it. Each figure is the mean
absolute log error of actual over forecast use; in brackets, the median of actual over
forecast.

| Level | 24 h | 72 h | 168 h |
|---|---|---|---|
| Last 24 hours' mean (before) | 0.209 (1.02) | 0.163 (1.04) | 0.114 (1.01) |
| Four days, 12-hour half-life (chosen) | 0.183 (1.02) | 0.139 (1.06) | 0.078 (1.00) |
| Four days, 24-hour half-life | 0.165 (1.06) | 0.115 (1.09) | 0.076 (1.07) |
| Last 12 hours over their shape | 0.286 | 0.254 | 0.208 |
| Last 6 hours over their shape | 0.372 | 0.366 | 0.369 |

The 12-hour half-life beat the 24-hour mean in both the earlier and the later half of the
origins, at every horizon.

Without growth, the 24-hour forecast's median was 1.08 against the trend's 1.02, which is
why the cards now carry the trend.

On 2026-11-06 the change raises the expected week's demand by about 1.6%. It narrows the
band from 0.75–1.29 to 0.81–1.26.

## Alternatives considered

- **Following the latest hours.** A level from the last 6 or 12 hours would have read the
  afternoon's doubling at once. Over these weeks it was the least accurate at every
  horizon. The chosen level weighs a doubling over the last 12 hours at about half, no
  faster than the 24-hour mean.
- **A 24-hour half-life.** It had the smallest errors, but its median ran 6–9% short on a
  growing site. Sizing the pool short is worse than sizing it noisy.
- **A sturdier growth fit.** Theil–Sen over the seven daily totals and week-over-week
  growth scored within 0.003 of the current least-squares fit. Without growth, the errors
  doubled or tripled. The 11% growth is the site's own: daily use rose from 599 on 10-22
  to 2,722 on 11-05.
- **A different damping.** At 0.7 or 0.9, the week-long median moved 5–9% off 1 either
  way. It stays at 0.8.

## Consequences

- A step change such as a launch or the end of the Double 11 sale on 11-12 still reaches
  the level over about a day. The band, scored on weeks without one, does not cover it.
- The origins overlap. With 2.5 weeks of history, the 168-hour row rests on about four
  days of origins. Rerun the comparison once there are six weeks.
- Older consoles read `burn_usd_per_hour` as the level, which is the figure they project
  with.

## Verification

- `engine_demand_test.go` checks two cases:
  - a profile that ends on its own busy hour keeps a level multiple of 1;
  - a doubling over the last 12 hours weighs `1 + 0.5/(1 − 2⁻⁸)`.
- `engine_runway_test.go` checks that a multiple of 1.5 projects $15/h from $10/h of
  logged spend.
- `go test ./service/ ./controller/ ./router/` passes, except
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails on `origin/main` too.
- `bun run typecheck`, `format:check`, `lint:check` and the site-insights tests pass.
