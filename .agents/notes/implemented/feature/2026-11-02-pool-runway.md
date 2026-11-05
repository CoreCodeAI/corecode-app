# Agent Note: Show the Claude pool's supply against its demand on the pool tab

Status: implemented

## Problem

The pool tab shows the dollars the pool has left in its 5-hour and 7-day windows, but
the owner asks how long the pool lasts. Dollars left divided by spend is misleading:
each account refills at its own weekly reset, and what it has not spent by then is
lost.

The first version (PR 154) answered with the first moment the projection found no
quota left. On production data that read as unreliable:

- It jumped from 4.2 to 7.6 days within half an hour. With demand 25% above supply,
  the remainder nearly reaches zero just before account 13's weekly reset. When the
  projection ends a few minutes before that reset, it reports 4.2 days. When it reaches
  the reset first, the next gap is days away.
- "Weekly load 125%" beside "lasts 7.5 days" read as a contradiction, because nothing
  showed the remainder covering the difference.
- "5-hour quota lasts 13 hours" means nothing, because a 5-hour window resets within
  five hours.

A third issue came from the curve (PR 160): it drained at one flat rate, but use on
2026-11-02 ran from about 3% of the daily mean at 05:00 to nearly twice it at 16:00
(Beijing time). Use was also growing about 8% a day, so a forecast at the last day's
average fell short of what followed.

## Decision

- **The pool response's `runway`** for the Claude channel is computed in
  `service/engine_runway.go` from figures the response already carries, plus each
  account's 5-hour capacity, which the app now reads from the engine's estimate. The
  engine is unchanged.
- **Demand** is every Claude account's `burn_usd_per_hour`, its logged spend over the
  last 24 hours, including accounts paused now: their traffic moves to the others.
  `week_to_date_usd_per_hour` checks it: what each counted account has used since its
  weekly reset, per hour, or its last day for a window under 12 hours old.
- **Hourly demand.** `service/engine_demand.go` reads the console's own `quota_data` for
  the Claude models, hour by hour over the last 21 days. From it, it builds:
  - the shape: each hour's use over the mean of the 24 hours around it, averaged by UTC
    hour of the day over the last week, so growth stays out of it;
  - the growth: a line through the log of the last seven days' use, bounded to 15% a
    day;
  - the band: forecasts made over the last week whose 72 hours have passed, each from
    the week before it. The 10th and 90th percentiles of actual over forecast use are
    widened to include 1.
    Superseded on 2026-11-05 by `2026-11-05-size-the-pool-by-expected-demand.md`: the
    band is scored against the trend forecast, and `low` and `high` scale the trend.

  `quota_data` is billed at the customer's price, about twice the upstream cost, so it
  supplies only the shape. The engine's spend still sets the level. The profile is
  cached for 10 minutes within the hour. A failed read, or under three days of use,
  projects flat demand, as before.
- **Scenarios.** The projection steps from one UTC clock hour, reset, or curve sample to
  the next, at that hour's demand.
  - `trend` carries the growth on, each day keeping 80% of the last day's growth.
  - `low` and `high` scale demand to the band's ends.
  - `headroom_scale` is the largest multiple of demand the pool serves for 7 days
    without a gap, found by bisection up to 4×.
  - `peak_hour_usd_per_hour` is demand in the busiest hour. The panel sets it against
    peak throughput.
- **Supply** is counted only for an account that meets all of these:
  - its group is enabled;
  - it is not suspended, disabled, blacklisted, or awaiting reauthorization;
  - the estimate gives its weekly remainder, capacity, and reset time.

  An account that could serve but lacks one of those figures is reported as `unknown`.
  `sustainable_usd_per_hour` is what the counted accounts' weekly capacity, up to each
  group's 7-day budget line, brings back per hour. `week_load` is demand over it. These
  two figures do not move with reset timing, so the panel leads with them, along with
  how much weekly capacity would close the gap.
- **The 7-day projection** spreads demand over the accounts in proportion to what each
  has left, which is close to the engine's headroom routing. A reset replaces an
  account's remainder with its full budget; with nothing left, demand goes unserved
  until the next reset. It reports:
  - `short_hours` without quota and `served_share`;
  - the first gap's start (`week_hours`) and length (`first_short_hours`), so a
    gap of a few minutes reads as a few minutes;
  - `lowest_usd` and `lowest_hours`, the tightest point. It moves smoothly where the
    first gap jumps.
- **`curve`** is the projected weekly quota left at each whole hour of the horizon, 169
  points. The panel draws it as an area under a dated axis, shades hours with nothing
  left, and reads out the hour under the pointer. The figures say when the pool runs
  short; the curve shows why: how each reset lifts it and how fast demand draws it down.
  A reset on the hour reads as refilled, and a gap shorter than an hour between two
  samples does not show on it.
- **One gap reads once.** When the first gap is the only one, the description gives its
  start and length without repeating the length as the total.
- **`peak_usd_per_hour`** replaces the 5-hour runway. It is the counted accounts' 5-hour
  capacity up to the budget line, over five hours: the most a burst can draw.
- **The panel**, "Claude pool supply", states demand against sustainable supply and the
  week's tightest point or first gap in one description. Its cards show weekly load,
  hours without quota, the tightest point, peak throughput, and demand with the
  week-to-date check.
- **Compatibility:** the fields the first console reads stay. `week_hours` keeps its
  meaning within the 7-day horizon, and `five_hour_hours` stays though nothing new reads
  it. The new console hides the panel when the server sends no `sustainable_usd_per_hour`.

## Alternatives considered

- **Holt-Winters with a damped trend.** Backtested on 2026-10-17 to 11-02, it did no
  better than the shape times the last day's level: 59% hourly error over 24 hours,
  against 50%. It also needs fitted parameters.
- **The same hour last week.** With use growing this fast it fell short by 67%.
- **The engine's hourly `usage_stats`.** These are upstream cost per account and are
  kept indefinitely, but they need a new engine endpoint. The console's own hours give
  the same shape.

- **Remainder over spend.** It ignores resets and halves the answer for this pool.
- **Earliest-reset-first draining.** It is the most the pool could serve, but the
  engine does not route that way, so it overstates the supply.
- **A 14-day horizon.** The first version used one. A day's spend says little about the
  week after next, and the load already says whether the pool keeps up.
- **All channels together.** Codex, Grok and Gemini quota cannot serve Claude
  requests, and only Claude carries calibrated capacities today.

## Consequences

- Spend the pool turned away is not in the demand, so a saturated pool needs more than
  shown. The panel's help says so.
- A 24-hour average hides daytime peaks; peak throughput is the figure for those.
- The figures move with calibration: a capacity the engine revises moves them.
- Remove `five_hour_hours` and `five_hour_remaining_usd` once no released console reads
  them.

- With 16 days of history, the band comes from the site's growth phase: past forecasts
  at the current level almost always fell short. A weekday shape needs three or four
  weeks of history.

## Verification

- `engine_runway_test.go`:
  - running out before any reset;
  - a reset that discards a remainder;
  - a pool that keeps up, with its lowest point;
  - channel and status filtering, with unknown accounts;
  - no spend;
  - gaps measured to the next reset across a week;
  - a six-minute grazing gap read as six minutes;
  - peak throughput and the week-to-date rate;
  - the hourly curve through gaps and resets.
- `pool-tab.test.tsx` reads the curve hour by hour from the keyboard.
- `TestFetchEnginePool` checks the field is joined.
- Production data from 2026-11-02, read through a read-only proxy and run through
  `poolRunway`, gave these figures. The peak figure here uses 5-hour capacities backed
  out of each account's remainder, because the production server does not send them
  yet.

  | Figure | Value |
  |---|---|
  | Demand, last 24 hours | $41.6/h |
  | Demand, week to date | $44.4/h |
  | Sustainable supply | $33.2/h |
  | Weekly load | 125% |
  | Hours without quota, next 7 days | none |
  | Tightest point | $50, at hour 100, just before account 13's reset |
  | Peak throughput | $136/h |

  The same snapshot projected from 30, 60 and 120 minutes later gave the same figures.
  Each card's help opened on hover, and the page did not overflow at 390 px.

  The curve, on production data later the same day: $1,829 now, a gap of 5.8 hours from
  11/6 10:09, and a rise at each weekly reset. A pointer swept across it at 40 positions
  read out an hour at every one, at full width and at 390 px. It was also checked in the
  dark theme.

- `engine_demand_test.go` checks:
  - the daily shape, and how it moves with the first hour;
  - growth and its bound;
  - the damped trend;
  - the flat fallback.
- `engine_runway_test.go` checks:
  - demand moved through the day;
  - quiet hours inside a gap;
  - the scenarios;
  - the band holding demand as now;
  - the headroom.
- `HourlyQuotaWithPrefix` is tested on SQLite.
- On production data for 2026-11-02 at 16:24, the model read:

  | Figure | Value |
  |---|---|
  | Demand | $47.7/h |
  | Busiest hour | $94/h, 64% of peak throughput |
  | Growth | 8% a day |
  | Band | 1.0× to 1.9× |
  | First gap | 11/3 23:41, 19.5 hours in all |
  | With growth | 11/3 22:28 |
  | Headroom | −15.4% |

  The curve read out a value at all 40 positions at full width and at 390 px. It
  stayed inside the page and was checked in the dark theme.
