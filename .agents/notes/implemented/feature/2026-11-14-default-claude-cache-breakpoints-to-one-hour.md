# Agent Note: Give a long Claude prompt's cache breakpoints one hour unless the client chose

Status: implemented

## Problem

Claude Code marks its cache breakpoints `{"type":"ephemeral"}` with no `ttl`,
which Anthropic keeps for 5 minutes. A customer who waits on a long task and
replies every few minutes rewrites the whole context on each reply.
Customers can set `CLAUDE_CODE_PROMPT_CACHE_TTL=1h`, and few do.

## Decision

- **1 hour from a prompt-size threshold; fill the default, never replace the
  client's choice.** The rule applies to a streamed request to an Anthropic
  channel (type 14), not passed through. If new-api's prompt estimate
  (`info.GetEstimatePromptTokens()`, the one billing reserves on) is at least
  `claude.default_prompt_cache_ttl_min_tokens`, `relaycommon.DefaultPromptCacheTTL`
  adds `"ttl":"1h"` to every `cache_control` object. A `ttl` on any breakpoint
  leaves the whole body as sent. Anthropic rejects a 1h breakpoint after a 5m
  one, so filling only the bare breakpoints next to a client's `5m` could fail
  a request that works today.
- **Why a threshold, not every request:** a 1-hour write costs 2x input
  against 1.25x, on every turn. The saving only exceeds that premium when a
  missed rewrite is large, which means a long prompt.
- **Only where the Messages API reads breakpoints:** the top level, `system`,
  `tools`, message content blocks, and the blocks inside a `tool_result`. A
  `cache_control` key inside a tool's input is conversation content and stays.
- **Byte insertion, not re-encoding.** The fields are inserted at offsets gjson
  reports. Every other byte, including tool schema property order, is the
  client's, so the prefix stays identical from turn to turn. If an offset does
  not match or the result is not valid JSON, the original body goes out
  unchanged.
- **Streamed requests only.** Claude Code's auto mode checks are non-streamed
  and their cache writes are never read back.
- **The `extended-cache-ttl-2025-04-11` beta is added** when the relay filled a
  breakpoint. This is the header Claude Code sends with its own 1-hour setting.
- **Switches:** `claude.default_prompt_cache_ttl` (default `1h`; `off` or empty
  turns the rule off) and `claude.default_prompt_cache_ttl_min_tokens` (0
  applies the rule to every streamed request). Both are option rows, changed
  without a release; the operator sets the production threshold. `PUT
  /api/option/` rejects other values, because the config loader drops a value
  it cannot parse without reporting it.
- **A rejected rewrite is resent as the client sent it.** If the upstream
  answers a rewritten request with a 400 whose first 64 KB mention
  `cache_control` or the extended cache ttl beta, `ClaudeHelper` closes it and
  sends the body from before the rewrite once more, without the beta, on the
  same channel. Any other response reaches the error handler with its body
  intact. The rule can then cost one extra upstream call, but it never fails a
  request the client's own body would pass.
- **Logged per request:** `admin_info.default_cache_ttl` is `1h` when the rule
  rewrote the request and `rejected` when the upstream refused the rewrite
  and the client's body went out instead.
- **The beta is decided per attempt.** The flag that adds it is reset at the
  start of each `ClaudeHelper` call, so a retry on another channel, or one below
  the threshold, does not inherit it.
- **After the param override.** The rewrite runs on the body the operator's
  param override produced, so a ttl an override writes counts as the client's
  choice and can never sit behind a 1h breakpoint.

## Switching ttl keeps the cache

A cache entry is matched by prefix, not by ttl. A turn that switches from 5m
to 1h reads the prefix the earlier 5m turns wrote, and its 1h entry covers the
whole prefix up to its breakpoint. So crossing the threshold costs one turn's
increment at the 1h price, not a rewrite. A compaction that drops the prompt
below the threshold returns to 5m the same way. With `CountToken` off, the
estimate is 0 and the rule never applies above a 0 threshold.

## Rollout and rollback

Every server reads options at start and syncs them within `SYNC_FREQUENCY`
(60 s), so the rule can ship dark: store `claude.default_prompt_cache_ttl` as
`off`, release, then set it to `1h`. Watch `admin_info.default_cache_ttl`
(`1h` against `rejected`), upstream 400s mentioning `cache_control` or `ttl`,
and the overall error share.

Rollback, fastest first: set the option `off` (effective within a minute, no
release); raise the threshold; roll the image back only if the server itself
misbehaves.

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
