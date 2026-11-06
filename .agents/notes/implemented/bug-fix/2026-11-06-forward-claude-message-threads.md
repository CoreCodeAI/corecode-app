# Agent Note: Forward Claude message threads, and estimate a continuation with its kept context

Status: implemented

## Problem

From 14:33 on 2026-11-06, `claude-opus-5-5` failures rose from about 0% to 1.4–2.5% an
hour, and to 10–12% at 19:00 and 20:00. 333 of the 368 failures in those hours were one
400:

```
messages.0.content.0: unexpected `tool_use_id` found in `tool_result` blocks
```

All of them came from one Claude Code session (user 1129). Its requests carried the
`message-threads-2026-08-12` beta. With that beta, Claude Code sends each later turn as
a continuation: only the new messages, plus
`"thread": {"type": "continue", "previous_message_id": "..."}`. Anthropic rebuilds the
rest of the conversation from the thread.

The Claude channel does not pass the body through. new-api rebuilds it from
`dto.ClaudeRequest`, which had no `thread` field, so the field was dropped. Anthropic then
read a lone `tool_result` and refused it. Claude Code answers an unrecognised 400 by
resending the turn without the thread, so the user kept working. Each turn still cost a
failed round trip and lost the thread's faster first token.

The wire shape was confirmed with Claude Code 2.1.318 against a local stand-in for the
Messages API, with `CLAUDE_CODE_TETHER_LIVE=1`:

- the first request carries `{"type":"create"}`;
- the next carries `{"type":"continue","previous_message_id":"msg_…"}` and one `tool_result`.

That version still sends `system` and `tools` on a continuation. The production session's
continuations carried one system block and no tools.

Forwarding the field opens a billing gap. new-api estimates a request from its own body,
so a continuation of a 200,000-token conversation is estimated at a few hundred tokens,
while Anthropic bills the whole context. `max_shortfall_usd` refuses a request whose
estimate a nearly empty balance cannot cover. A continuation's estimate is too small to
reach that limit, so it would settle up to a full context below zero
(`reservation-multiplier-and-shortfall-cap`).

## Decision

- **`ClaudeRequest.Thread`** (`json.RawMessage`, `thread`) carries the field upstream
  unchanged.
- **The kept context is remembered.** After a response to a request with a thread, the
  Claude handlers record its whole context under the user and the response id:
  - input tokens, including cache reads and writes, plus output tokens;
  - stored through `cachex.HybridCache` (Redis, or memory without it) for an hour, the
    longest Anthropic keeps a thread.

  A continuation's estimate in `PrepareRequestBilling` adds the context remembered for its
  `previous_message_id`. The continuation is then reserved like the full request it
  replaces. An unknown id adds nothing and is logged. Anthropic most likely no longer
  holds that thread either, and answers 404.
- **Order.** corecode-engine's `fix/claude-thread-errors` ships first. It returns
  Anthropic's `thread_*` refusals with their code and does not retry them on other
  accounts. Claude Code replays the full conversation only when it reads that code.
  Without the engine change, a continuation that reached an account without its thread
  would fail the user's turn.

## Alternatives considered

- **Turning on `pass_through_body_enabled` for the Claude channel.** It would forward
  `thread`, and every field Anthropic adds later. It would also skip the model mapping,
  reasoning suffixes and disabled-field filtering the channel relies on.
- **Stripping the beta header.** Claude Code decides to thread on its own side. A
  continuation would still arrive, with its context missing.
- **A fixed minimum estimate for a continuation.** It would be wrong in both directions.
  Each thread's real size is known from its last response.

## Consequences

- A thread whose previous response came from the other blue/green color is found in
  Redis. Without Redis, it is estimated from its new messages only until the next
  response.
- Settlement does not change: it reads Anthropic's usage, which covers the whole context.

## Verification

- `adaptor_test.go`: `thread` survives the conversion and `RemoveDisabledFields`, for a
  create and for a continuation with an unknown member.
- `thread_context_test.go`: the non-streamed and streamed handlers remember 1,080 tokens
  for a threaded response (10 input, 1,000 cache reads, 50 cache writes, 20 output), and
  nothing without a thread.
- `request_billing_thread_test.go`: a continuation adds its previous response's context,
  only for the same user.
- `claude_thread_context_test.go`: per-user keys, and parsing of `previous_message_id`.
- Each new test fails with its change reverted.
- `go test ./relay/... ./service/ ./middleware/ ./controller/` and relaykit's tests pass,
  except `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails on `origin/main`
  too.
