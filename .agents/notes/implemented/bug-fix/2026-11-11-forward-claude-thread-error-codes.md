# Agent Note: Forward a Claude message-thread error code to the client

Status: implemented

## Problem

[Forwarding message threads](2026-11-06-forward-claude-message-threads.md) lets Claude
Code continue a thread. When Anthropic no longer holds it, the engine answers 404 with
`error.details.error_code: "thread_not_found"`. `RelayErrorHandler` read only `type` and
`message`, and `ClaudeError` had no `details`, so the client saw a bare 404. Claude Code
2.1.322 reads a bare 404 as a missing model ("There's an issue with the selected model");
with the code it replays the whole conversation instead. User 1077 hit this twice on
2026-11-11, each time after 7 to 12 idle minutes on the same account.

## Decision

- `ClaudeError` gains `details.error_code`.
- `RelayErrorHandler` keeps `error.details.error_code` when it is a `thread_*` code.
- `ToClaudeError` returns `details` for a `thread_*` code only. Other codes are dropped,
  so no new upstream text reaches clients.

## Alternatives considered

- **Passing Anthropic's error body through.** It would forward every field, including
  ones the rebuilt body exists to keep out.
- **Relying on the engine's message.** corecode-engine's matching change also puts the
  code in the message, which Claude Code reads; that covers today's engine, while
  `details` is the field Anthropic defines.

## Verification

- `TestRelayErrorHandlerForwardsClaudeThreadCode` checks a thread code reaches the Claude
  body and other codes do not. It fails with the `service/error.go` change reverted.
- `go vet` on `service` and `relaykit/types`; `go test ./service/ ./relay/... ./controller/`
  and `relaykit`'s `go test ./types/ ./dto/` pass. `TestUpstreamAddressesMaskOnlyConfiguredAddresses`
  fails when the shell exports `*_PROXY`, with or without this change, and passes without them.
