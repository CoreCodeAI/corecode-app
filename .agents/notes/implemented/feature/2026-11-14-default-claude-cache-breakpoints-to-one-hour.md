# Agent Note: Give a long Claude prompt's cache breakpoints one hour unless the client chose

Status: implemented

## Problem

Claude Code marks its cache breakpoints `{"type":"ephemeral"}` with no `ttl`,
which Anthropic keeps for 5 minutes. All 109 recorded Claude Code bodies of
2026-11-13 without the 1-hour setting look like this. A customer who waits on a
long task and replies every 6 to 21 minutes rewrites the whole context on each
reply.

On 2026-11-13, user 3486 had 12 such rewrites of 117K to 138K tokens in one Opus
5.5 session, $15.86 in all. The session's affinity binding lasts an hour, so
every one of those requests reached the account holding the cache, but the
cache itself had expired. Customers can set `CLAUDE_CODE_PROMPT_CACHE_TTL=1h`,
and few do. Those prompts are below the 200K default threshold, so this rule
would not have covered that session; see the replay for why the threshold
still sits there.

## Decision

- **1 hour from an estimated 200K prompt tokens; fill the default, never
  replace the client's choice.** The rule applies to a streamed request to an
  Anthropic channel (type 14), not passed through. If new-api's prompt estimate
  (`info.GetEstimatePromptTokens()`, the one billing reserves on) is at least
  `claude.default_prompt_cache_ttl_min_tokens`, `relaycommon.DefaultPromptCacheTTL`
  adds `"ttl":"1h"` to every `cache_control` object. A `ttl` on any breakpoint
  leaves the whole body as sent. Anthropic rejects a 1h breakpoint after a 5m
  one, and production shows that 400 (six in seven days, all from clients that
  mixed the two themselves), so filling only the bare breakpoints next to a
  client's `5m` could fail a request that works today.
- **Why a threshold, not every request:** see the replay below. A 1-hour write
  costs 2x input against 1.25x, on every turn. The saving only exceeds that
  premium when a missed rewrite is large.
- **Only where the Messages API reads breakpoints:** the top level, `system`,
  `tools`, message content blocks, and the blocks inside a `tool_result`. A
  `cache_control` key inside a tool's input is conversation content and stays.
- **Byte insertion, not re-encoding.** The fields are inserted at offsets gjson
  reports. Every other byte, including tool schema property order, is the
  client's, so the prefix stays identical from turn to turn. If an offset does
  not match or the result is not valid JSON, the original body goes out
  unchanged.
- **Streamed requests only.** Claude Code's auto mode checks are non-streamed
  and their cache writes are never read back (`/docs/cache#auto-mode`).
- **The `extended-cache-ttl-2025-04-11` beta is added** when the relay filled a
  breakpoint. This is the header Claude Code sends with its own 1-hour setting.
  61,372 recent 1-hour writes arrived without it, so it is not required.
- **Switches:** `claude.default_prompt_cache_ttl` (default `1h`; `off` or empty
  turns the rule off) and `claude.default_prompt_cache_ttl_min_tokens` (default
  200000; 0 applies the rule to every streamed request). Both are option rows,
  changed without a release. `PUT /api/option/` rejects other values, because
  the config loader drops a value it cannot parse without reporting it.
- **A rejected rewrite is resent as the client sent it.** If the upstream
  answers a rewritten request with a 400 whose first 64 KB mention
  `cache_control` or the extended cache ttl beta, `ClaudeHelper` closes it and
  sends the body from before the rewrite once more, without the beta, on the
  same channel. Any other response reaches the error handler with its body
  intact. The rule can then cost one extra upstream call, but it never fails a
  request the client's own body would pass. new-api's error logs carry
  Anthropic's message through the engine: the six mixed-ttl 400s of the last
  week read `... status 400: Top-level cache_control has ttl='5m' ...`.
- **Logged per request:** `admin_info.default_cache_ttl` is `1h` when the rule
  rewrote the request and `rejected` when the upstream refused the rewrite
  and the client's body went out instead.
- **The beta is decided per attempt.** The flag that adds it is reset at the
  start of each `ClaudeHelper` call, so a retry on another channel, or one below
  the threshold, does not inherit it.
- **After the param override.** The rewrite runs on the body the operator's
  param override produced, so a ttl an override writes counts as the client's
  choice and can never sit behind a 1h breakpoint.

## Replay of seven days

Source: channel 1 consumption logs from 2026-11-07 to 2026-11-14 (264,479
requests, 755 users, $56,763).

- **Pricing:** each request's unit price was solved from its actual charge, so
  group ratios and tiered expressions carry over. The writes of requests the
  rule covers were repriced at the 1-hour ratio.
- **Recovering a miss:** a miss is turned into a read when the conversation's
  previous turn in the same session (user, affinity key, model) ended 5 to 60
  minutes earlier and the prompt only grew since. Any newer, larger prefix
  stops the search: it means a compaction, a rewind or another thread. Any
  matching turn within 5 minutes also stops it: the miss was not the ttl's.
- **Checked against user 3486:** with no threshold, the replay recovered that
  user's 12 hand-identified expiry misses and a Sonnet miss after a 5.3-minute
  pause, and none of the compaction or account-switch misses. From a 150K
  threshold it recovers none of them, since their prompts are 117K to 138K.
- **Independent check:** a second replay, written separately in review,
  found the same totals (+0.49% with no threshold, -0.83% at 100K, -1.44% at
  200K).

| Rule | Customers' total | Users who save | Users who pay more |
|---|---|---|---|
| Every streamed request | +0.52% (+$296) | 60, $868 | 252, $1,164 |
| Prompt ≥ 100K | -0.80% | 54, $1,034 | 131, $577 |
| **Prompt ≥ 200K** | **-1.42% (-$805)** | **49, $1,038** | **69, $232** |
| Prompt ≥ 300K | -1.54% | 38, $985 | 32, $110 |
| 1h only after the session's first 5-minute pause | -0.37% | 49, $883 | 121, $673 |

At 200K:

- **Saved:** 403 recovered misses save $1,721.
- **Turns that hit the cache:** 23,153 such turns pay $323 more, 6.7% of
  their cost. Only the few thousand tokens added per turn are written.
- **Misses the ttl cannot prevent:** compactions, account switches and new
  threads (162 turns, +$280), pauses over an hour (85, +$222), and session
  starts (41, +$91) pay about 59% more on the whole prompt.

Where the change lands at 200K: wallet charges fall $770 and subscription plan
usage falls $35. At 100K, wallet charges fall $508 and plan usage rises $52.
Plan usage is quota the subscriber has already paid for, so it decides how long
a plan lasts, not what is charged.

A looser bound recovers every real miss after a 5..60 minute pause regardless
of thread. It gives -1.69% with no threshold and -2.31% at 200K. Most of what it
adds comes from sessions that had a newer matching prefix within 5 minutes, so
those misses were not caused by the ttl. The strict figures above are the
estimate.

Effects the replay does not model:

- A client sending an explicit `5m` cannot be told apart from Claude Code's
  bare breakpoints in the logs. Such a client is unaffected in reality.
- Pool subscription usage is not modeled.

## Switching ttl keeps the cache

Over the same seven days, clients that changed ttl between turns at most 5
minutes apart read the previous prefix in full:

- 5m to 1h: 103 of 137 switches.
- 1h to 5m: 92 of 103 switches.

The rest are concurrent threads under one session key or Haiku side requests.
After a 5m-to-1h switch followed by a pause of 5 to 60 minutes, 60 of 70 turns
read the whole prefix that had been written under 5m. The switching turn's 1h
entry covers the whole prefix up to its breakpoint. So crossing the threshold
costs one turn's increment at the 1h price, not a rewrite. A compaction that
drops the prompt below the threshold returns to 5m the same way.

## The estimate is close enough

The estimate was backed out of the subscription reservation: pre-consumed
quota divided by the pre-consume multiplier (2), the model ratio and the group
ratio. Compared with actual prompt tokens on 45,985 streamed subscription
requests:

| Actual prompt | Median estimate/actual | p05 to p95 |
|---|---|---|
| under 100K | 1.00 | 0.78 to 1.09 |
| 100K to 200K | 0.97 | 0.74 to 1.08 |
| 200K to 300K | 0.94 | 0.70 to 1.06 |
| from 300K | 0.93 | 0.42 to 1.05 |

The effects at the threshold:

- 1,663 of 6,838 prompts between 200K and 300K are estimated under 200K and
  switch some turns later.
- 254 prompts between 100K and 200K switch early.

Given the section above, early or late switching changes only which price one
turn's increment is written at. With `CountToken` off, the estimate is 0 and
the rule never applies above a 0 threshold. The estimate the rule reads also
includes the context a Claude thread continuation keeps upstream
(`claudeThreadKeptTokens`), which the reservation back-out above includes too.

## Evidence that forwarding is unaffected

- Over the three days before 2026-11-14, all 16 Claude pool accounts served
  1-hour writes. 26,351 streamed requests carrying the 1-hour beta succeeded,
  with an error share (0.5%) no higher than requests without it (0.4%). None of
  their 400s concerns `ttl` or `cache_control`.
- The engine verifies thinking signatures over everything except
  `cache_control` (`internal/requestredact/signature.go`).
- The rewrite costs 3.5 ms on a 1.5 MB body
  (`BenchmarkDefaultPromptCacheTTL`, Apple M4 Pro).

## Rollout and rollback

Every server reads options at start and syncs them within
`SYNC_FREQUENCY` (60 s), and the current release stores an unknown
`claude.*` option row as it is. So the rule can ship dark:

1. Before merging, set `claude.default_prompt_cache_ttl` to `off` through
   `PUT /api/option/`.
2. Merge. `release-app.yml` builds the image and releases it blue/green.
3. With the new color serving, set the option to `1h`.
4. Watch the first hour (queries in the pull request):
   - new-api logs with `admin_info.default_cache_ttl` of `1h` against
     `rejected`;
   - engine 400s mentioning `cache_control` or `ttl`;
   - the overall error share and relay-watch alerts;
   - 1h writes on prompts from 200K.

Rollback, fastest first:

- **Option `off`.** Takes effect within a minute and needs no release.
- **Raise the threshold.** For example, set
  `claude.default_prompt_cache_ttl_min_tokens` to 1000000 to narrow the rule.
- **Image rollback.** `set-image-tag.sh new-api <previous srv tag>`, only if
  the server itself misbehaves.

## Tests

- `relay/common/prompt_cache_ttl_test.go`: the Claude Code shape gets 1h on
  every breakpoint, and removing the inserted fields gives back the original
  bytes. A client `5m` or `1h` on one breakpoint leaves the body as sent. Top
  level and empty objects are filled; bodies without breakpoints are left
  alone.
- `relay/claude_handler_test.go`
  `TestClaudeHelperDefaultsStreamedBreakpointsToOneHour`: through
  `ClaudeHelper`, the upstream receives 1h breakpoints and the beta on a
  streamed request estimated at the threshold. It receives the body as sent
  one token below the threshold, on a non-stream request, or when the client
  set a ttl. `TestClaudeHelperDefaultCacheTTLFollowsEachAttemptAndTheOptions`
  runs four attempts on one request context: a rewrite, a retry below the
  threshold that must drop the beta, the option `off`, and a 0 threshold with
  no estimate. Without the per-attempt reset the retry case fails.
- `relay/claude_handler_test.go`
  `TestClaudeHelperResendsTheClientBodyWhenTheDefaultTTLIsRejected`: a 400
  about `cache_control` on the rewritten request leads to a second upstream
  call with the client's breakpoints and no beta, and the log records
  `rejected`. An unrelated 400 is returned after one call with its message
  intact. With the detection disabled the first case fails.
- `setting/model_setting/claude_cache_ttl_test.go`: the option validator
  accepts `1h`, `off`, empty and non-negative integers, and rejects `1H`, `5m`,
  negative, fractional and padded values.
