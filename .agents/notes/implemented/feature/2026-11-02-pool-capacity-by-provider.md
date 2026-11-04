# Agent Note: Split the pool tab by provider and size the Claude pool in Max 5x accounts

Status: implemented

The Max 5x sizing was superseded on 2026-11-04 by `2026-11-04-size-the-claude-pool-in-team-seats.md`:
the pool holds no Max 5x account, so additions are sized in Team Tier 1 and Team Standard.

## Problem

The owner asked whether the pool's capacity is enough and whether to add accounts. The
pool tab answered part of it:

- It showed the dollars left in the 5-hour and 7-day windows.
- The Claude supply panel (`2026-11-02-pool-runway.md`) set gpt-load's demand against
  what the weekly resets bring back.

Three parts were still missing:

- **How fast the site uses quota.** Nothing showed use over the last 1, 3, 5 or 24
  hours or 7 days, or new-api's charge beside gpt-load's spend. new-api charges in
  quota dollars that customers pay ¥1 each for, so it is in yuan. The pool's quota is
  in gpt-load dollars at official prices.
- **A forecast in the pool's unit** for the next 5 and 24 hours.
- **A count of accounts to add.** The supply panel gave the shortfall in weekly
  dollars only.

The tab also mixed providers. Its summary counted Codex, Grok and Gemini accounts with
Claude's, and the only way to tell them apart was a per-table group filter.

## Decision

- **One provider at a time.** A switch at the top of the pool tab (Claude, Codex,
  Grok, Gemini) sets `?provider=`; Claude is the default.
  - The summary, groups and accounts show that provider's groups only.
  - Each pool group now carries `provider`, from `service.ChannelProvider`. gpt-load
    serves Gemini through its `antigravity` channel. The console falls back to the same
    mapping for a server that does not send it yet.
  - The 5-hour and 7-day dollars, the verdict and the supply panel are Claude's only.
    The engine estimates quota for Claude subscription groups only
    (`groupSupportsQuotaBudget`), and the other tabs say so.
- **`GET /api/site-insights/pool-usage?provider=`** (`service/pool_usage.go`, scope
  `ops:read`) returns one provider's use on both sides.
  - **Windows** of 1, 3, 5 and 24 hours and 7 days. The 5-hour window, at first 6,
    matches the 5-hour quota window and the 5-hour forecast.
    - new-api's charge comes from `quota_data` through the existing
      `HourlyQuotaWithPrefix`, over every model prefix the vendor sells under
      (`model.VendorPrefixes`). It is root included, as on the funds view. `quota_data`
      is hourly and written up to 5 minutes late, so a window shares each hour's use
      evenly across the part of the hour inside it.
    - gpt-load's spend is the engine's `/usage` summary for each of the provider's
      channels. It is exact, because the engine reads request details for the partial
      hours at either end.
  - **The conversion**: gpt-load's spend per yuan new-api charged over the last 7 days
    (about $0.50 for Claude on 2026-11-02, or 3.4× per new-api dollar at ¥6.8). The
    table shows each window's charge converted at that rate beside gpt-load's own
    spend. A measured-over-converted ratio near 1× says the conversion holds.
  - **The last 48 hours**, hour by hour, on both sides.
  - **The forecast** for the next 5 and 24 hours. It uses the same model as the Claude
    runway, generalized per vendor (`vendorDemandProfile`, cached 10 minutes per vendor):
    - the last 24 hours' use is the level;
    - the shape of the last week's hourly use moves it through the day;
    - the band is the 10th to 90th percentile of how past forecasts compared with the
      use that followed;
    - the trend carries growth on, damped.

    The dollar figures take gpt-load's level and the yuan figures new-api's.

  A read is shared for a minute per provider, because the pool tab refreshes every 15
  seconds. The console refetches it every minute.
- **Sizing in Max 5x.** The Claude runway gains `addition`, sized in the owner's chosen
  plan. One added account brings the median measured Max 5x account's weekly capacity,
  up to its group's 7-day budget line: about $1,458 on 2026-11-02 (one account measured
  at $1,487, line 98%). It reports:
  - `for_load`: accounts for a weekly load of 100% at today's demand;
  - `for_trend`: the same at the trend's demand 7 days on;
  - `for_week`: the fewest accounts, each starting a full week now, that leave the
    next 7 days without a gap in the existing projection, up to 30.

  Without a measured Max 5x account, `addition` is null and no count is given.
- **The verdict panel**, "Is capacity enough?", leads the Claude tab.
  - One sentence says enough, tight or not enough, then what to add.
  - Its cards show the Max 5x count (the larger of `for_load` and `for_week`, with all
    three in the hint), the next 5 hours against the 5-hour windows' remainder, and the
    next 24 hours with its band.
  - Beside each gpt-load forecast, new-api's forecast charge over the same hours: in
    dollars at the site's rate, with the yuan and its conversion to gpt-load spend.
    The owner asked for both sides in one place; the two gpt-load figures, one
    forecast directly and one converted, check each other.
  - It does not repeat the supply panel's weekly load or dollar shortfall.

## Alternatives considered

- **Putting the use on the funds view.** That view answers whether the site makes
  money, in yuan, over days to weeks. The capacity it would be compared with lives
  here.
- **Forecasting from new-api's charge converted by the rate.** gpt-load measures the
  same requests in the pool's unit directly, so the forecast takes its level, and the
  conversion is shown as a check.
- **Reading new-api's `logs` for exact short windows.** That needs a new aggregate query
  and the three-database verification it requires. Prorating the hourly table is close
  enough beside gpt-load's exact figure.
- **Sizing in the cheapest plan per dollar.** The owner chose Max 5x.

## Consequences

- No new SQL. `quota_data` is read through the existing hourly query.
- The 1-hour new-api figure is approximate: its hour may be up to 5 minutes behind.
- Codex, Grok and Gemini have no verdict until the engine measures their quota.

## Verification

- Go: tests cover the windows' proration, the channel mapping, the forecast's shape
  and growth, a full read against an in-memory `quota_data` and a fake engine, and the
  Max 5x sizing, including that `for_week` accounts close the 7-day gap and one fewer
  does not. `go test` passes for `service`, `controller`, `middleware`, `router` and
  `model`.
- Console tests cover:
  - provider filtering, including `antigravity` read as Gemini;
  - the switch;
  - the verdict's advice and cards;
  - the conversion arithmetic.

  `bun run typecheck`, `format:check`, `lint:check`, `test`, `build` and
  `first-load:check` pass.
- In the browser, the dev build read production through the read-only proxy. The
  pool-usage endpoint and the runway's `addition` were synthetic, because neither is
  released yet.
  - At 1280 px and 375 px the page does not overflow.
  - The 48-hour chart read out 40/40 by mouse, with no dead point in a 0.25 px scan,
    and 40/40 by touch.
  - The switch moved to Codex and the URL followed.
