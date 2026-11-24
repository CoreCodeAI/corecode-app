# Agent Note: Model behavior panel and per-vendor cache hit rate on the quality tab

Status: implemented

## Problem

Customers reported GPT padding its answers, a fingerprint test read gpt-6.1-sol as a
cheaper model, and an Opus swap was suspected on 11-19. The console had no way to say whether
a model's behavior changed: nothing kept output length, reasoning, first-token time or the
upstream errors per model and day. The quality tab's one cache figure (93.7 %) pools Claude's
long cached prompts with everyone else, so GPT's own hit rate was invisible.

## Decision

- **A "Model behavior" panel** (`quality-behavior.tsx`) on the quality tab. A metric switch
  (output length, reasoning, first token, total time, upstream errors, cache hit) and a model
  toggle drive one line chart (`TrendLines`). It opens on the GPT models plus
  `claude-opus-5-5`; every other model with 20 or more requests is selectable. The models with
  a flag on the last day are listed on top as chips; the last day's figures per model sit in a
  fold.
- **Flags.** A day's median is compared with the pooled median of the 7 days before it. More
  than ±40 % is yellow, more than ±60 % red, and only when both sides have at least 50
  requests. Upstream errors are judged on the failed-try rate and need a rise of at least 2
  rate points as well, so 0.5 % to 0.8 % is not "+60 %".
- **Stratified by input size.** Requests are put in four bands by input tokens (under 2k,
  2k to 16k, 16k to 64k, over 64k) and each band is compared only with its own earlier days.
  A day of longer prompts then cannot read as a model that got wordier. The baseline is the
  pooled 7-day histogram of the same band, not a mean of daily medians.
- **A table of its own.** `InsightBehaviorHour` holds one row per hour, model and band with
  histograms of output tokens, reasoning tokens, first-token and total time, failed tries by
  status and cache read. It is not a new `insightHourVersion`: the keys view reads only hours
  stored at the current version, so a bump would blank it until a full rebuild. Hours before
  the table are filled newest first, `FillInsightBehavior(24)` per tick, up to 35 days;
  `missing_hours` tells the panel how many are unread.
- **Reasoning tokens.** `logs.other` carried only `reasoning_effort`. `PostTextConsumeQuota`
  now also writes `reasoning_tokens`, so reasoning is empty before this release and the panel
  says so instead of drawing nothing.
- **Cache hit rate by vendor.** The cache-read count of every vendor is `logs.other.cache_tokens`
  (OpenAI format included); `uncachedPrompt` handles prompts that already contain it. The
  quality vendor figures gain `cache_read`, `cache_input` and `cache_share`, over every model
  the vendor sells whatever the model filter selects, and `CacheMixPanel` lists them as a bar
  per vendor under the ring, so GPT has its own row beside the site-wide figure.
- **Overview signal.** `overviewBehaviorSignals` adds one danger finding naming the models
  with a red reading on the last day; yellow stays on the quality tab.
- **Endpoint.** `GET /api/site-insights/model-behavior`, under `siteInsightsRoute` (RootAuth),
  read-only, through `settledRead`, with the `ops:read` access-token rule beside its siblings.
  Staff are excluded, as on the rest of the tab.
- **Palette.** Only four series colors are validated. A fifth line reuses one and is drawn
  dashed, so Opus is not mistaken for the first GPT model.

## Alternatives not taken

- **Normalizing output by input tokens.** A ratio hides the real shape (output is not
  proportional to input); bands keep the figure in plain tokens.
- **Bumping the rollup version.** It would have blanked the keys view until a rebuild.
- **Comparing with a mean of daily medians.** A thin day would weigh as much as a busy one.
- **Judging the first-token time of non-streaming requests.** They have none; they are left
  out of that histogram.

## Verification

- `go test ./model ./middleware ./controller ./router`, `gofmt`, `go vet`. The new tests cover
  banding, the thresholds, the sample floor, the error-rate gap, the fill and the vendor cache
  figures. `service` has `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails when
  proxy variables are set and passes without them; it does not touch this change.
- `bun check -b`, `bun run lint:check`, `vitest run src/features/site-insights` (731),
  `bun run build`, `bun run first-load:check` (all three budgets hold).
- Looked at in a browser against synthetic responses (no real customer data): light and dark at
  1440, and 390 wide, before and after.
- The companion daily canary lives in corecode-infra (`scripts/relay-watch.py`).
