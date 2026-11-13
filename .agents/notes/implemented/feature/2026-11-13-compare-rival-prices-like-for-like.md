# Agent Note: Compare rival prices like for like, weighted by our own traffic

Status: implemented

## Problem

The first rival board (`2026-11-13-rival-price-board.md`) ranked each site at its cheapest Claude group by input price. Read against 64 priced sites on 2026-11-13, that misled in three ways:

- **Cheapest is not the same product.** 23 of 32 sites with Opus 5.5 looked cheaper than us, but their cheapest groups were mostly Kiro quotas (median ¥2.32 per million input tokens) or reverse-engineered clients. Subscription-pool groups, what we sell, had a median of ¥7.75 against our ¥7.60.
- **Input price is not what a Claude Code customer pays.** Our traffic is mostly cache reads. A site that bills cache reads at 0.5, or states no cache ratio at all, can be cheap on input and dear in use: one site at ¥3.60 input costs more than us on our mix.
- **Some top-up prices are not prices.** 13 sites showed `price` 7.3, new-api's default, which sites that sell credit by redemption code never change; two showed 0.03.

## Decision

- **Channel kinds.** Each group is classed from its name (`service.ClassifyRivalGroup`): official API, cloud (AWS, Vertex, Azure), subscription pool, Kiro, reverse-engineered, default, other. The rules were checked against the 122 group names production held for Opus and Sonnet 5.5, and the more specific kinds match first ("kiro-max" is Kiro, "aws官转" is cloud). An admin can set a group's kind (`rival_group_kinds`), which wins over the name. Our own Claude groups are a subscription pool. The board compares within one kind, ours by default.
- **Blended price.** A price is weighed over a million tokens in our customers' mix of that model over seven days: uncached input, cache reads, cache writes and output, each at the site's own ratio. A site that states no cache ratio bills reads as input (new-api's default of 1), and one that states no write ratio, at 1.25. The official blended price uses our own ratios, which are set to the vendor's.
- **Output in the hourly rollup.** `InsightModelHour` had the three input counts but not output. It gains an `Output` column; the rollup version stays, since no existing reader changes. Rows stored before hold 0, so the mix reads only hours whose output is set, and all four counts always come from the same hours. A model with under a million tokens uses every Claude model's mix; with none, the board ranks by input and says so.
- **Trust.** A site whose top-up price is missing, 7.3, below ¥0.1 or above ¥20 per $1 is left out of the ranking and the figures unless the admin asks for it.
- **Price-drop alerts.** After each probe, a trusted site whose cheapest pool group now undercuts our cheapest pool group, or one already below us that cuts again by more than a tenth, becomes one line; a tick's lines go out as one Feishu message to `rival_price_setting.feishu_webhook` (validated as a Feishu or Lark bot address). A site's first price list is a baseline and alerts nothing, so the initial crawl stays quiet.
- **One row per price list.** A site added by hand and the same site from the directory read the same origin; the board shows it once, the hand-added entry first.

## Alternatives considered

- **Rank by input price and show the cache ratio beside it.** The reader would still have to do the blend in their head for every row; the ranking itself would stay wrong for Claude Code traffic.
- **A fixed, assumed mix** (for example 80% cache reads). Simple and available at once, but the point is what our customers would pay elsewhere; the rollup already counts three of the four figures.
- **Raising the rollup version to backfill output.** It would rebuild every stored hour from the logs while they last, the step a lesson records going wrong; reading only hours with output avoids it, at the cost of a mix that starts empty and fills over seven days.
- **Alerting on every price change.** The change log already has them; an alert is only worth sending when it moves us in the ranking of our own kind.

## Verification

- Go: `ClassifyRivalGroup` against real production group names, `RivalTrust`, `RivalBlended`, the alert rules (undercut, further cut, other kind, admin override, untrusted top-up), the rollup's output count, the mix query reading only hours with output, `SaveRivalProbe` returning what it replaced, overrides, and the board listing a doubled site once with its override applied.
- Console: vitest on the ranking by kind and metric, the untrusted filter, the fallback to input without a mix, and the stats; typecheck, lint, build.
- First load against main built on the same machine: +8 bytes on `/sign-in`, +18 on `/dashboard/overview` and `/keys`.
- A local server with the probe through an egress and a seeded mix (88% cache reads) ranked Opus 5.5 pools at 14% to 54% of the official blended price, ours at 28%, third of seven; overriding Packy's `cc` to Kiro moved its row to `cc-expensive`.
- Not run: the Go tests against MySQL and PostgreSQL; the new column is added by AutoMigrate on each.
