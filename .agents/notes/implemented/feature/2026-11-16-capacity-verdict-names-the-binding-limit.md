# Agent Note: Name the binding limit in the capacity verdict

Status: implemented

## Problem

Read on production on 2026-11-15 over the 7-day range, the dashboard gave three capacity verdicts that did not agree:

- The capacity tab said "号池峰值 27 / 100 个槽位（27%）", plenty of room.
- The account-pool tab's outlook said the next 7 days were tight: demand US$28,360 against supply US$32,936, 86%, and four Team Tier 1 accounts to add.
- The funds tab said the pool used 119.7% of its measured capacity, and that more accounts were needed before it filled.

The binding constraint was the weekly quota, not the concurrency slots. The capacity tab, the one named for capacity, did not say so, and the overview's "需要关注" list had no line for it: its pool signals fire only when the quota left falls under 25% (`REMAINING_WARNING`) or accounts run low.

The capacity tab also called 37 of 169 hours anomalous, "failed at least 3× their usual rate". A rule that flags a fifth of the hours says nothing about which hour to look at.

## Decision

- **One definition of the quota's binding window.** `quotaBinding(outlook)` in `components/outlook.ts` reads the outlook under the forecast the account-pool tab opens under (`smart`) and returns the window nearest to binding: short, else tight, else the largest share of supply taken. It uses `coverage()`, which the pool tab already uses, so the 0.8 "tight" line and the short rule are not repeated. The capacity verdict and the overview both call it.
- **The capacity verdict leads with the nearer limit.** A tight or short quota becomes the first sentence, at least a warning (`short` is danger), followed by the accounts to add and a pointer to the account-pool tab. When the quota has room and the peak is at or past 80% of the slots, the slots lead. When both have room, one sentence says neither limit binds. Without an outlook, or with one that failed or is not configured, the wording is today's.
- **The overview gets a finding for a tight or short quota.** `overviewQuotaSignals` adds a `pool-quota` finding linked to the account-pool tab, with the same lead as its title and the accounts to add as its detail. Its `impact` is the window's demand in dollars, so it ranks among the other warnings by size of what it touches.
- **The outlook is shared, not duplicated.** `index.tsx` enables the one `pool-outlook` query on the capacity and overview views as well as the pool tab. It refreshes every 30 seconds there, as the capacity view does. Its error toast stays off. The capacity tab uses the outlook only for all providers or Claude; a view of one other provider keeps its own slots.
- **The anomaly rule.** An hour is flagged when it has at least `SMALL_SAMPLE` (100) requests and at least `SPIKE_FLOOR` (20) failures, and its failure rate is beyond chance (Wilson 95% lower bound) above both `SPIKE_FACTOR` (3) times the range's usual rate and `FAILURE_WARNING_RATE` (2%). The usual rate is the median rate of the range's rated closed hours. The previous period's same hour is shown for reference and no longer sets the threshold.
- **The panel's wording follows the rule.** The description names the worst few flagged hours as before. When none qualifies it says "Failures were steady". The help names the rule's thresholds.
- **Funds and pool sentences are not unified.** The funds tab's "used X% of measured capacity" and the outlook's demand over supply measure the same thing differently. Both keep their maths. The capacity verdict states the conclusion, and a comment at each sentence points to it.

## Why the old rule flagged a fifth of the hours

The old test was errors ≥ 20, rate ≥ 3 × baseline, and the Wilson lower bound above the baseline. The baseline was the previous period's same hour when that hour had at least 20 requests, and the range's median otherwise.

- A single previous hour is noisy, and often has no failures. A baseline of 0 makes "3 × baseline" always true and "above the baseline" true for any failure. Any hour with 20 failures then flags, whatever its rate.
- With a median near 0.1%, blips of 2% (20 of 1,000) flag, though 2% is a rate a reader would not act on.
- No request floor applies beyond the rate existing (20 requests), so an hour of 20 requests that all failed flags too.

These are the mechanisms in the code. The 37-of-169 count was read from the production panel; the database is not reachable from this checkout, so I did not reproduce that count.

## Alternatives considered

- **Compare with the previous period's same hour, with a larger minimum.** It keeps the baseline noisy, and the range with no previous period still falls back to the median. The median of the range is the robust measure the spec asks for.
- **A MAD-based z-score.** Failure rates are skewed and often 0, so the MAD is 0 on a quiet range. The multiplicative rule with a floor is what the quality tab already uses (`hourFlags` in `quality-analysis.ts`), so the two tabs judge an hour the same way.
- **Unify the funds sentence with the outlook.** Rejected: the two use different denominators and both are shown on their tabs. Changing one would move a figure its reader already trusts.
- **Port the outlook rule to the Feishu digest.** Not done. The digest mirrors the thresholds of the console's signals in Go, and the outlook has no digest rule. Porting it would need a Go change and a new digest line, which is a separate decision.

## Consequences

- The overview's first-load room on `/dashboard/overview` is 340 bytes, against 303 on `origin/main`, measured in the same session. The new strings are all in the `rest` part of the locale, so the overview's `core` part is unchanged.
- The two strings the rewording left unnamed (`No hour failed far above its usual rate.` and the old help) are deleted from all eight locale files. No other key changed its part.
- The overview fetches the outlook on its own view now. It is cheap, and the server shares one computation for 5 seconds.
- The verdict's lead depends on the smart forecast. A reader who picks another forecast on the pool tab sees that forecast's figures there, and the capacity verdict keeps reading the smart one. The two agree whenever the smart forecast is the one picked, which is the default.
- The anomaly rule now flags fewer hours. An hour under 100 requests is never flagged, however high its rate, so a quiet hour's failures are not named as a spike. The bars of the rate panel are drawn as before; only the flag and the description change.
- The Feishu digest is unchanged.

## Verification

Tested:

- `bun run typecheck` printed "✓ No type errors in 1,916 files across 2 projects" and exited 0.
- `bunx oxfmt -c .oxfmtrc.json --check src/features/site-insights` printed "All matched files use the correct format" and exited 0.
- `bun run lint:check` printed "check-lint-baseline: no new lint findings" and exited 0.
- `bunx vitest run src/features/site-insights src/i18n`: 50 files, 548 tests passed.
- New tests: the verdict in each state (tight, short, slots near, both fine, no outlook or a failed one), the overview finding firing and not firing, and the anomaly rule on a series with a near-zero baseline and blips (none flagged), one real bad hour (flagged), and a low-volume hour with a high rate (not flagged).
- The old rule, replicated outside the repository on the same series: 10 of 40 hours flagged on the blips, 11 of 40 with the bad hour, 11 of 42 with the low-volume hours. The new rule flags 0, 1 and 0.
- `bun run build` exited 0. `bun run first-load:check` gave `/dashboard/overview` 340 bytes left on the branch and 303 on `origin/main`. Both builds list 38 files on that page, and the only differing file is the entry bundle's hash.
- Locale partition (`localeParts` on `zh.json`, on the branch and on a detached `origin/main`): 9,494 keys on main, 9,500 on the branch. No existing key changed its part. The eight new keys are `rest`, so none is an orphan.

Assumed, not checked:

- The production count of hours the new rule flags on the 7-day range. The database is not reachable from this checkout.
- That the smart forecast's default reading matches what the account-pool tab shows on production. It is the same function on the same outlook, and not compared on a live page.
- That the translations read naturally in each language. They were written here, not reviewed by a native speaker.
