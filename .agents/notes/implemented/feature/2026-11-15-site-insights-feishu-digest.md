# Agent Note: Post a daily digest of the root dashboard to Feishu

Status: implemented

## Problem

`/site-insights` only reports when someone opens it. The owner wants the day's headline figures and the signals that need attention in a Feishu group each morning, without opening the page.

## Decision

### The digest is a system task that reads the dashboard's own readers

`service/site_insights_digest.go` reads the reported Beijing day and the day before it with the readers the page calls (`GetFinanceInsights`, `GetQualityInsights`, `GetCapacityInsights`, `GetUpstreamInsights`, `GetGrowthInsights`, `GetActivityInsights`, `ReadUserConcurrencyRejections`), and the pool through `RecentEnginePool`. No figure is re-derived from raw tables, so staff exclusion and the other definitions in the earlier notes apply unchanged.

It is registered as a scheduled system task (`siteInsightsDigestHandler`, every ten minutes, enabled only when `site_insights_digest_setting` is ready). The task runner gives one run at a time across both release colors, and each run is one `system_tasks` row.

### Rules mirror a subset of the console's

The attention lines are a Go mirror of the console's rules. Each threshold in `service/site_insights_digest.go` names the TypeScript constant it copies (`web/src/features/site-insights`), so a change on one side is found by reading the other. The mirrored rules:

| Digest rule | Console rule | Threshold |
|---|---|---|
| Pool peak near its slots | `overview-signals.ts`, `peakTone` | 80% warning, 100% danger (`HEADROOM_SHARE`) |
| Pool full, budget refusals | `overview-signals.ts`, `capacity-engine`, `capacity-engine-budget` | any refusal |
| Upstream key refused (401/402/403) | `overview-signals.ts`, `upstream-auth` | any refusal |
| No channel for a request | `overview-signals.ts`, `quality-no-channel` | any refusal |
| Service failure rate | `overview-signals.ts`, `quality-rate` | over 100 requests; warning above 2%, danger above 5% (`SMALL_SAMPLE`, `failureTone`) |
| Image and video task failure | `overview-signals.ts`, `failingTasks` | 100 finished tasks, failure rate above 5% (`SMALL_SAMPLE`, `FAILING_RATE`) |
| Checkout completion drop | `overview-signals.ts`, `completionDrop` | 5 checkouts in both days; under half the day before (`MIN_ORDERS`, `COMPLETION_DROP_SHARE`) |
| Upstream channel failing | `overview-analysis.ts`, `failingChannels` | 100 attempts, failure rate above 5% |
| Upstream bill not read | `overview-analysis.ts`, `staleCostChannels` | channel earned, bill read over 30 minutes before the send time (`COST_STALE_SECONDS`) |
| Customer debt | `overview-tab.tsx`, `finance-debt` | balance below -1 (`DEBT_ALERT_USD`) |
| Per-user limit refusals | `overview-tab.tsx`, `capacity-limit` | any refusal |
| 5-hour and 7-day pool budget | `overview-tab.tsx`, `pool-five`, `pool-seven` | 25% warning, 10% danger (`REMAINING_WARNING`, `REMAINING_DANGER`) |
| Few schedulable accounts; accounts needing attention | `overview-tab.tsx`, `pool-eligible`, `pool-attention` | 2 or fewer; the `ATTENTION` statuses |
| Sign-up spike | `risk-analysis.ts`, `signupSurges` | 5 sign-ups, 3 times the day before; the day before stands in for the previous period's median day (`SIGNUP_SPIKE_FLOOR`, `SPIKE_FACTOR`) |

The message lists at most eight lines, danger first, and counts the rest.

### Once a day, claimed in the database

The digest for a report day is sent on the Beijing day after it, from the configured hour (default 9) until midnight. `model.ClaimSiteInsightsDigestDay` claims the report day in the option row `site_insights_digest.sent_day` with a conditional update: `UPDATE ... SET value = day WHERE key = ? AND value <> day` changes one row for one caller. Two servers, and a restart, cannot both own the same day.

- A run before the hour changes nothing.
- A server that was down at the hour sends when it comes up, as long as the Beijing day is still the send day. After midnight the report day moves on, and the missed digest is not sent.
- The claim is taken before the figures are read, so a run after the send reads only the option row.
- A reader or send error releases the claim (`ReleaseSiteInsightsDigestDay`), so the next run, ten minutes later, tries again until midnight. A partial digest is never sent, because a reader error fails the run before the send.
- A crash between the claim and the send loses that day's digest. The alternative, sending before the claim, can send twice. The owner prefers one missing digest to two.
- A Feishu answer that fails after the bot accepted the message releases the claim and can repeat the message. `SendFeishuBotText` cannot tell the two apart.

The option row is visible in the options list. It holds only a date.

### Settings

`site_insights_digest_setting` holds `enabled` (default false), `hour` (0 to 23, default 9), `feishu_webhook` (validated by `ValidateFeishuBotWebhook`) and `feishu_secret`. The digest is ready only when it is enabled and has a webhook. The settings open from a button on the overview's "Needs attention" panel (`web/src/features/site-insights/components/digest-settings.tsx`), read from `GET /api/option/` when it opens, and each changed setting is one `PUT /api/option/`. The signing secret is never sent back, so a blank field keeps the saved one. "Send test message" posts yesterday's digest to the saved webhook without using up the day's send. The settings are not under system settings: strings and option defaults there load with `/dashboard/overview` and `/keys`, and a section there put `/keys` 177 bytes over its first-load budget in CI; on the dashboard they load with the overview tab only.

## Alternatives considered

- **Claim in the system task result, as the top-up watch does.** The runner serializes a type, but the day would then depend on the last successful row surviving retention. A conditional update on a row does not.
- **A new table.** It needs a migration for one date.
- **Re-derive the figures in SQL.** The readers already define the figures; a second definition would drift.

## Consequences

- The digest makes one read of two days per run, the same readers the page uses. It adds no index or table.
- The pool figures come from the engine, read with the same two-minute staleness as the page. If the engine is unreachable, the pool rules stay silent and the message says nothing about the pool.
- Gross margin is not in the digest. The console computes it with a client-side plan price table (`accountMonthlyUSD`) that has no server mirror.

## Not ported

Left out on purpose:

- Hourly rules (the last full hour's drop, failures, pool-full and rate-limit spikes), because the digest is daily.
- The customer concentration rule, and the IP-cluster and sign-up-risk signals (the owner asked for no IP lists).
- Upstream channels that cost more than they earned (needs the plan price book).
- Per-model and per-vendor failure rules and time-to-first-token rules, which repeat the quality tab.
- Engine limit refusals (`engine_limit`) and the pool-outlook estimate beyond the 5-hour and 7-day budgets.
- Promotion-channel commission (the owner said it does not matter).

## Verification

Tests in `service/site_insights_digest_test.go`:

- The due boundaries at 08:59:59, 09:00:00, 23:59:59 and 00:00:00 Beijing, and 01:00 UTC.
- A golden message for a fixed day, and the nothing-to-report message.
- Every rule at its threshold, and just past it, as a table.
- The message cap and the danger-first order.
- The day claim with two concurrent callers, a restart later the same day, and a released day.
- The test send: it needs a webhook, goes out while the schedule is off, and leaves the day open for the schedule.
- Run paths: a send at 09:05, no second send at 09:15, 09:25 or 23:50, a late send at 18:40, a send error that leaves the day unsent and succeeds on retry, and a disabled or unset digest that sends nothing.

The claim test runs on SQLite. MySQL and PostgreSQL run only when `TEST_MYSQL_DSN` or `TEST_POSTGRES_DSN` is set, and the claim test does not run on them here.
