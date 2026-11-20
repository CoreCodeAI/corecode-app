# Agent Note: Let a client keep the 5-minute cache with a request header

Status: implemented

## Problem

The relay gives the bare cache breakpoints of a streamed Claude request one
hour ([2026-11-14 note](2026-11-14-default-claude-cache-breakpoints-to-one-hour.md)).
A client that writes a `ttl` keeps its own, but Claude Code cannot write
`"ttl":"5m"`: it writes the field only for `1h`, so
`CLAUDE_CODE_PROMPT_CACHE_TTL=5m` and `FORCE_PROMPT_CACHING_5M=1` send the
same bare breakpoints as no setting (checked in 2.1.316 and 2.1.325). A Claude
Code user who wants the cheaper 5-minute writes had no way to ask for them.

## Decision

- **The client asks with `X-CoreCode-Cache-TTL: 5m`.** When the default rule
  would apply and the request carries that header, `ClaudeHelper` leaves the
  body as sent and adds no beta. One hour stays the default: only a client
  that sets the header gets 5 minutes. Claude Code sends it through its
  documented `ANTHROPIC_CUSTOM_HEADERS`, for example in the `env` block of
  `~/.claude/settings.json`.
- **Only `5m` counts.** Surrounding spaces are trimmed; any other value leaves
  the default in force, so a typo never changes billing.
- **The relay leaves the breakpoints bare instead of writing `"ttl":"5m"`.**
  Real Claude Code never sends an explicit `5m`, and the request should reach
  the upstream as the client sent it. A bare breakpoint is 5 minutes at
  Anthropic; an upstream that applies its own default to bare breakpoints
  still can.
- **The header never goes upstream.** It is in `passthroughSkipHeaderNamesLower`,
  so a channel's `*` or regex passthrough rule does not forward it.
- **Logged per request:** `admin_info.default_cache_ttl` is `client_5m` when
  the header kept the breakpoints bare.

## Alternatives rejected

- **A per-token console setting.** It is not a client choice: the same key on
  another machine would change too.
- **A model name suffix.** It would leak into routing, pricing and the logs'
  model names.

## Tests

- `TestClaudeHelperDefaultsStreamedBreakpointsToOneHour`: with the header at
  ` 5m ` the body goes out without a ttl or the beta and the log reads
  `client_5m`; with `1h` the default applies. The `5m` case fails with the
  header check removed.
- `TestProcessHeaderOverride_PassthroughKeepsTheCacheTTLSwitchHere`: `*` and a
  regex rule forward `X-App` but not the header. It fails with the skip entry
  removed.
