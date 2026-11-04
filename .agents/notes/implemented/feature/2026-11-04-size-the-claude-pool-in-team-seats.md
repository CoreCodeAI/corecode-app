# Agent Note: Size the Claude pool's additions in Team seats

Status: implemented

## Problem

`2026-11-02-pool-capacity-by-provider.md` sizes the accounts the Claude pool needs in
Max 5x, the plan the owner chose then. On 2026-11-04 the pool held no Max 5x account:
4 Team Tier 1 seats (measured median about $1,404 a week at official prices) and 6
Team Standard seats (about $287). `addition` needs a measured account of its plan, so
it was null and the capacity card read "需增加 Max 5x -".

## Decision

- **`runwayAddPlans`** lists the plans additions are sized in, preferred first: Team
  `team_tier_1`, then Team `team_standard`. Each one with a measured account gets the
  same sizing as before (median measured weekly capacity up to its group's 7-day
  budget line, `for_load`, `for_trend`, `for_week`).
- **`additions`** carries them in that order. `addition` stays as the first of them,
  so a console older than the server still shows a count.
- **The console names the plan it sizes in**: the card reads "需增加 Team Tier 1", the
  advice sentence uses the same name, and the hint adds the alternative ("或 10 个 Team
  Standard"). Without a measured Team seat it says so and gives no count.

## Alternatives considered

- **Team Standard only.** Per dollar the two are within a few percent (14.7× and 14.4×
  their monthly price on 2026-11-04), and a Tier 1 seat brings about five Standard
  seats' capacity, so Tier 1 gives the smaller count to buy and manage. Showing both
  leaves the choice to the owner.
- **The cheapest plan per dollar, chosen automatically.** The ranking flips with each
  week's measurements, so the card's unit would change without anyone choosing it.

## Verification

- `service/engine_runway_test.go`: Team Tier 1 sizing closes the gap as Max 5x did;
  both Team tiers are sized, Tier 1 first; a pool with only Max 5x gets no addition.
- `pool-tab.test.tsx`: the card, advice and hint name Team Tier 1 and the Team
  Standard alternative.
