# Agent Note: Size the Claude pool by the demand expected over the next week

Status: implemented

The level was changed on 2026-11-06 by `2026-11-06-read-the-demand-level-from-four-days.md`: forecasts start from four days weighted to the latest hours, not from the last 24 hours alone.

## Problem

The capacity card's headline count kept the weekly load at 100% at today's demand: the last 24 hours' spend, held flat. Backtested on the Claude models' hourly `quota_data` from 2026-10-17 to 11-05, a flat forecast from the last 24 hours fell short of the use that followed. Over the last week of forecast origins, actual over forecast had a median of 1.24 over 72 hours, and over every origin with seven days ahead, 1.61. The same level grown by the damped trend landed at 1.03 and 1.10. The card showed the trend only as a side figure at the end of the week, and the band of past errors was scored against the flat forecast, so it measured mostly the missing growth.

## Decision

- The demand band is scored against the trend forecast. Each past forecast grows its level by the growth read at its own origin (`demandGrowth` over the series before it), so the 10th and 90th percentiles measure the trend's error. The `low` and `high` scenarios and the 24-hour forecast's range scale the trend, not the flat level.
- `expected_usd_per_hour` is the trend's demand averaged over the next week: the weekly quota is what has to cover it.
- Each addition gains `for_expected`, the accounts for a weekly load of 100% at the expected demand, and `for_low` and `for_high` at the band's ends. `for_week` runs the next 7 days at the trend rather than at today's demand. `for_load` and `for_trend` stay.
- The card's headline is the more of `for_expected` and `for_week`. The line below gives the range, the 7-day count, and the count at today's demand. The sentence above gives the growth, the expected demand, and the range.

On 2026-11-05, with $66.3/h of demand growing 8.6% a day, this moves the headline from 3 Team Tier 1 seats (today's demand) to about 4, with a range of 2 to 7.

The burn and the capacities are in Opus-equivalent dollars: the engine weights Sonnet's cost by 1.3 (`quotaWeightedNanoUSD`). That is why the burn reads about 10% above gpt-load's list-price spend. It is deliberate and is left alone.

## Alternatives considered

**A smoother level: the mean of the last 48 or 72 hours, an exponentially weighted mean, or the 7-day mean.** Each is older than the last day, and on a growing site each fell further short: over every origin, a median of 1.44 to 1.84 over 72 hours, against 1.39 for the last day.

**The level fitted by the growth line.** Over 72 hours from the last week's origins it was the tightest (mean absolute log error 0.098 against 0.173). Over seven days it did worse (0.307 against 0.140). Those 98 origins all predate the current growth, too few to choose on. Revisit with more history.

**Selecting the level by backtest at run time.** There is too little history to choose stably, and the choice would move the headline from one hour to the next.

## Consequences

- The growth since 2026-11-02 includes the Double 11 top-up sale, which ends on 11-12. The trend carries it on until the 7-day line catches the drop, a few days after it. The range does not cover a step change like that.
- The band is still scored over 72 hours, not a week. A week-long horizon has too few past origins until about three weeks of history.
- Older consoles ignore the new fields. A console against an older server falls back to `for_load`.

## Verification

`engine_demand_test.go` checks a steadily growing site's band against the trend: just above 1, not the flat forecast's 1.17. `engine_runway_test.go` checks that the band rides the trend, that without growth the expected demand is the burn, and that `for_expected`, `for_low` and `for_high` close the gap at their demands with `for_week` run at the trend. `pool-tab.test.tsx` checks the card's sentence and line.
