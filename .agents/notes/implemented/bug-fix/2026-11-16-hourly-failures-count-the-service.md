# Agent Note: Count the failures the service caused in the hourly rule

Status: implemented

## Problem

The capacity tab's hourly failure panel flagged 26 of 169 hours on the 7-day range in production
with the rule of `2026-11-16-capacity-verdict-names-the-binding-limit.md`. That rule counts every
failed request. Of 4,354 failed requests in the range, 2,654 were "no channel" refusals, one user
alone making 1,605 of them, and about 740 were the customers' own 4xx. Neither is an hour in which
the service failed, and 29 hours had 100 or more requests, 20 or more failures and a rate above 2%.

The quality tab's hourly flags had the same weakness and a second one. The baseline was the same
hour of the previous period, so a previous hour with no failures made "times the baseline" trivial.

## Decision

- **One definition of a service failure.** A request the service could have served is a request
  less the ones no channel could take (`no_channel`) and the customers' own errors (`client_error`,
  4xx; an upstream's 400 is one). Service failures are the failed requests less the same
  categories. The server's hourly figures, the console's range rate (`serviceFailureRate`,
  `serviceRow`, `unservedOf`), the overview's quality signal and the Feishu digest's mirror
  (`digestServiceRate`) all use it.
- **Hourly rows carry the counts.** Each hourly row of the capacity and quality views sends
  `service_requests` and `service_errors`, derived at read time from the hour's stored categories.
  The rollup version does not change and no data is stored. An hour with failures stored before
  categories were kept (version 4 or older, `insightHourCategories`) omits both fields. An hour
  without failures reports its requests and zero.
- **No per-hour refusal field.** The flags and panels do not need one. The range keeps its refusal
  count (`refusals.no_channel`), and the capacity rows already carry the engine's own refusals.
- **One rule on both tabs.** `failure-hours.ts` holds it. The usual hour is the median rate of the
  range's closed hours with 20 or more requests, so one bad hour cannot move it. An hour is flagged
  when it has 100 or more requests and 20 or more failures, and its rate is beyond chance (Wilson
  95% lower bound) above both three times the usual rate and 2%. The previous period's same hour is
  shown for reference and sets no threshold.
- **The series falls back as a whole.** When every hour of a series carries the counts, the rule
  reads them. Otherwise it reads the logged requests and failures for the whole series, so a stored
  hour's refusals never read as an outage beside hours that have counts.
- **Wording follows the rule.** The capacity panel says what is counted, and states "failed far
  above their usual rate" rather than "at least three times", since the rule also needs 2% and the
  sample floors. When no hour qualifies it says failures were steady. The quality tab's headline
  help and hint name the requests they leave out.

## Alternatives considered

- **Keep the logged counts and change only the flag.** The bars, the tooltip and the flag would
  disagree, and the range rate would not match the hourly rows.
- **Derive the flag's baseline from the previous period's same hour, with a floor.** A single
  previous hour is noisy, and a zero baseline still makes every failure beyond it. The median of the
  range is robust without a previous period.
- **Subtract refusals from failures only.** The rate's denominator would still count requests the
  service could never have served.
- **Mix counted and logged hours in one series.** An older hour's refusals would read as an outage.
- **A new rollup version that stores service counts.** Each failed request already has one stored
  category, so the counts can be read exactly. The version and the stored data stay as they are.
- **Split the quality hourly categories by model.** The categories are kept per vendor, not per
  model. A model filter narrower than a vendor therefore gives an approximation, as the range's rate
  already does. Changing the stored categories would need a new rollup version.

## Consequences

- The quality headline's service failure rate, the overview's quality signal and the Feishu digest
  now exclude no-channel refusals. Their values fall wherever refusals were a large share, and the
  digest's threshold is unchanged. Its note's table names the new definition.
- The quality flags need 100 requests and 20 failures, where they needed 20 requests. The flagged
  hours fall; a zero baseline no longer flags anything. The first-token p95 flag still reads the
  previous period's same hour, as before.
- Until the rebuild clears the older hours that have failures, a capacity or quality range that
  contains one reads the logged counts, as before this change. The fallback is per series, so the
  panel changes its basis together.
- Deploy the server before the console. A console without the fields reads the logged counts, and
  a server without the console's change only adds fields.
- Locales: nine old keys are deleted (their text is named by no source) and twelve are added in all
  eight files. No key changed its partition.
- Not built: a range-level `service_requests` field (the console derives it from the categories),
  and a per-hour no-channel series.

## Verification

Run on branch `fix/site-insights-hourly-service-failures` in `web/` and the repository root,
proxy variables unset, on SQLite:

- `go test ./model/ -run 'TestServiceFailure|TestInsightHourCountsRequestsOnce'` passed on SQLite.
  The MySQL and PostgreSQL subtests of the new tests skip without those databases, as the
  neighbours' do here.
- The new tests: `TestServiceFailureCounts` (the counts, absent and clamped cases),
  `TestServiceFailuresLeaveOutRefusalsAndClientErrors` (30 refusals, 5 upstream 502s, a 400 and 20
  served requests give 25 service requests and 5 service failures, on a stored hour and on the hour
  still filling), and `TestServiceFailuresAbsentOnAnHourWithoutCategories` (version 4 with failures
  reports absent, version 5 reports its counts).
- Existing struct expectations in `site_insights_test.go` and `site_insights_round3_test.go` now name
  the fields.
- Console: `bun run typecheck` passed. `bunx vitest run src/features/site-insights src/i18n` passed
  577 tests. The new ones are the production-shaped series of the capacity and quality rules, the
  fallback and the mixed series, the zero baseline, and the panel's steady wording.
- On that production-shaped series (30 quiet hours, 10 hours of refusals, one outage), yesterday's
  capacity rule flags 11 hours and the new rule flags 1 (the outage). The old quality rule, worked
  out by hand from the code and not run, flags the 10 refusal hours. The new rule flags none.
- `bun run lint:check`, `bunx oxfmt -c .oxfmtrc.json --check src/features/site-insights` and
  `bun run build` passed.
- First-load bytes left, same session: branch `/sign-in` 641, `/dashboard/overview` 374, `/keys` 841;
  `origin/main` 624, 357, 824. The first-load file lists match except the entry bundle, whose
  lazy-chunk hash references differ; the entry is 17 bytes smaller by brotli.
- Locale partition (`localeParts` on `en.json`, branch against `origin/main`): no key present on
  both sides changed its part. Nine keys left, twelve came, all `rest`.

Not verified: production counts for the 7-day range (the database is not reachable from this
checkout), and MySQL and PostgreSQL behaviour of the new tests.
