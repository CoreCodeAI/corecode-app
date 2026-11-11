# Agent Note: Run the Claude pool forward under a forecast the reader picks

Status: implemented

## Problem

The pool tab answered "is there enough quota?" in four places that did not agree, and the
owner asked for the page to be rethought on 2026-11-11 after two rounds of explanation:

- "5-hour left $695" stood beside a 5-hour forecast of $1,062 and turned the card red. The
  $695 is what the running 5-hour windows hold now; nine of them restart inside the 5 hours.
- "7-day left $6,603" is a stock with no reset in it, set beside flows over 24 hours and
  7 days.
- "Unused at reset $736" stood above "add 17 × Team Tier 1". Both were right: one holds each
  account at its own rate, the other asks about the pool.
- The runway models only weekly windows, so its curve could not show the hours when every
  account with weekly quota has spent its 5-hour window.

No figure said which resets it counted, and no figure carried a 5-hour reset at all.

## Decision

`GET /api/site-insights/pool-outlook` (scope `ops:read`) returns one `EngineOutlook` for the
Claude channel, computed in `service/engine_outlook.go` from the pool `FetchEnginePool`
already shares. The pool tab shows it as two panels and drops the figures they replace.

### Supply: what the pool can spend in 5 hours, 24 hours and 7 days

`outlookRemaining` gives each window the most the accounts can spend in it if demand were
unlimited, split into what is held now and what resets add. Each account is two windows
(`outlookAccount`): a week and a 5-hour window, each with what is left below its group's
budget line, its full size, and its reset. A reset of 0 means the window is not running;
it starts with the account's next spend and restarts full 5 hours, or 7 days, later.

"Held now" follows one rule: **a window as long as the horizon, or longer, does not reset.**

| Horizon | Held now | Resets counted when the switch is on |
|---|---|---|
| 5 hours | running 5-hour windows, bounded by the weekly remainder | 5-hour and weekly |
| 24 hours | weekly remainder, as far as the 5-hour windows let it through | weekly |
| 7 days | weekly remainder | weekly |

The rule keeps "held now" a figure a reader can check against the account table, and makes
the three cards differ by one thing each. `drawable` is greedy: spend all an account may
at once, and again after each reset. Spending at once starts each window as early as it can
start, and nothing held at a weekly reset is lost, so no other order spends more.

`resets` lists each running window's next reset with what it adds if the account spends
nothing more before it: a reset replaces what the account held, so it adds the used part.

### Demand: five models, one unit

Every model's level comes from the engine's per-account burn, the pool's own dollars
(`calibrate-in-a-unit-the-traffic-mix-does-not-move`). Other series set only ratios.

| Model | Rate |
|---|---|
| `linear_24h` | the burn, held flat |
| `linear_12h`, `linear_1h` | the burn × gpt-load's rate over that window ÷ its 24-hour rate |
| `history` | each hour of the day at its mean over the last 7 days, at the last day's dollars per unit |
| `smart` | level × hour-of-day shape × damped growth × momentum |

`smart` is the runway's trend forecast plus momentum: the last two whole hours over what the
forecast expected of them, bounded to 1.5× either way, fading with a 2-hour half-life.
Backtested over the last 10 days of production hours (mean absolute log error, 5 hours /
24 hours / 7 days):

| Model | 5 h | 24 h | 7 d |
|---|---|---|---|
| smart with momentum | 0.257 | 0.208 | 0.277 |
| smart without | 0.278 | 0.211 | 0.277 |
| linear, 24 hours | 0.586 | 0.219 | 0.509 |
| history | 0.449 | 0.405 | 0.907 |
| linear, 1 hour | 0.654 | 0.744 | 1.102 |

So `smart` is the default, and the panel says it is the closest. The linear and history
models stay because the owner asked for them and because they bracket it: on the snapshot
below they call for 2 to 19 accounts.

### Projection: the pool under a model

`projectOutlook` steps from one clock hour, curve sample, reset or return from cooling to
the next. Demand in a step is spread over the accounts in proportion to what each can spend
at once, which is how the engine's headroom routing behaves in aggregate. A reset is applied
before the sample at the same moment, and a window closes before the resets due as it
closes, so a window's supply is quota a reader could spend inside it.

Each model reports, per window, demand, what was served, what was not, the hours with
nothing to spend, the first such moment, and the least spendable at once. A window is short
when demand went unserved, which happens while supply exceeds demand when quota arrives
after it was needed. The curves hold 281 points: every 5 minutes to 5 hours, every 15 to
24 hours, hourly to 7 days. `smart` also runs at the 10th and 90th percentile of how its
past forecasts compared with the use that followed.

Additions are sized per plan by its median measured account: `keep_up` brings the weekly
load to 100% at the model's average demand, and `cover_week` is the fewest that leave the
7 days without unserved demand, found by bisection up to 30.

### The page

- **Quota left**: three cards and a "Count resets" switch, each with a stacked bar and the
  parts listed, and the resets it counts folded below.
- **Supply and demand**: Linear / History / Smart, the linear window, three window cards
  with a coverage badge, the accounts to add, the curve of the window picked, and the five
  models side by side. Supply always counts resets here.
- The summary keeps its four operational tiles. "5-hour left", "7-day left", "Unused at
  reset", "Is capacity enough?" and "Claude pool supply" are removed, with 78 locale keys.
- The usage table no longer forecasts Claude: its rows used the conversion from new-api's
  charge, a second level beside the outlook's.
- "Quota that will expire unused" shows only while the smart forecast is served. It used to
  print a sentence when the pool ran short; the forecast above now says that.

Every dotted label, bar, meter and curve reads out on hover, focus and tap.

## Alternatives considered

- **Extend the runway.** Its accounts have one window, and the console in production reads
  its fields, which a server release must keep meaning what they mean. The runway stays as
  it is; the outlook reuses its plan list and demand profile.
- **"Without resets" as no reset of any window.** Simpler to state, but the 24-hour and
  7-day figures would collapse to the 5-hour one: an account spends its 5-hour window and
  stops.
- **Simulating routing account by account.** The engine's choice depends on sessions and
  affinity the console cannot see; proportional spread matches it in aggregate and keeps
  the projection at 15 ms.
- **Computing in the console.** It would ship the account windows and the demand series to
  the browser and fork the arithmetic from the server's tests.
- **A blend of linear and history with fixed weights.** Backtested worse than the level,
  shape and trend model at every window; momentum is the part of "recent rate" that helps.

## Consequences

- A server before this change answers 404. The console then shows "The pool's quota ahead
  could not be read" where the panels would be and reads the engine's runway to decide
  whether to list unused quota, so the server ships first and either order is safe.
- `PoolUsageWindowHours` gains 12, which the pool usage table now lists.
- The server still sends `runway`, `supply_windows` and `usage.forecast`. Once this console
  is released, the pool tab reads `runway` only until the outlook arrives, and nothing
  reads Claude's `usage.forecast`; removing them is a later change.
- The engine's per-account burn reads about 3% above gpt-load's exact 24-hour spend,
  consistent with hourly buckets; every model inherits it.
- Accounts without a weekly remainder or capacity are unknown and add no supply; the panel
  says how many.
- A 5-hour window is limited only when the engine reports both its remainder and capacity.

## Verification

- `engine_outlook_test.go`: the most an account can spend under each reset flag, an idle
  window starting on first spend, a weekly reset dropping what was held, cooling; the split
  of each horizon; the reset list; a week that runs out, a 5-hour gap with weekly quota
  left, proportional spread; each model's rate; momentum's bound; counting by group and
  status; `keep_up` 16 and `cover_week` 17 on a fixed pool; `readPoolOutlook` end to end
  against an `httptest` engine and sqlite.
- Console tests: `outlook.test.ts`, `pool-remaining.test.tsx`, `outlook-chart.test.tsx`,
  `pool-forecast.test.tsx`, and `pool-tab.test.tsx` for loading, the 404, the engine's own
  error, a failed refresh keeping the last figures, and the unused-quota rule.
- On a production snapshot of 2026-11-11 20:53 (14 accounts): 5 hours $695 held + $1,526
  from 5-hour resets; 24 hours $5,859 + $1,363 weekly; 7 days $6,603 + $17,144. Smart:
  $1,217, $4,852 and $43,256 of demand, first dry at 42.8 hours, $19,664 unserved, add 18.
- In a browser against production reads through a local read-only proxy, with the outlook
  served from that snapshot: desktop in light and dark, 390 px in dark; the curve read out
  at 40 of 40 pointer positions for each window and at 20 of 20 taps on the 7-day one; each
  bar and meter across its width, edges included, and by tap; every help label opened by
  tap inside the viewport; each tap on the switch's row toggled it once; no overflow at 390
  or 360 px; the 404 message.
- `go vet ./...`, `go test ./service/... ./middleware/... ./controller/... ./router/...`,
  `bun run test` (315 files), `bun run typecheck`, `bun run lint:check`, `bun run build`
  and `bun run first-load:check`: the overview's first load is 3 bytes under the commit
  before, because the panels use utility classes the stylesheet already carried and three
  keys no source names any more left the core locale part.
- Not checked: the endpoint on production, which runs the server before it.
