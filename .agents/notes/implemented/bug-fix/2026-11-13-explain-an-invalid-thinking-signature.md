# Agent Note: Explain an invalid thinking signature to the customer

Status: implemented

## Problem

A customer resumed a Claude Code session after continuing it on another provider. Messages
181–204 of that session carried `toolu_bdrk_` tool ids, which come from AWS Bedrock, and
thinking signatures in a different format from the pool's. Anthropic answered every turn
with `400 messages.17.content.0: Invalid signature in thinking block`. Two accounts gave the
same answer: account 13, which had served the session the day before, and account 10015.
The customer saw that English message, retried 15 times, and had no way to tell that the
session history was the cause.

This was not a fault in the relay. Every account rejects the signature, so neither
retrying nor switching accounts can fix it.

## Decision

- `RelayErrorHandler` appends a Chinese hint to an upstream message that reports an
  invalid signature in a `thinking` or `redacted_thinking` block. The hint names the cause
  and tells the customer to use `/clear` or `/rewind` to before the provider switch.
- The hint lives in `service/thinking_signature_hint.go`. `service/error.go`, an upstream
  file, gains only the two calls, so upstream syncs stay easy.
- The status code, error type, and Claude thread code are unchanged. Only the message
  text changes.

## Alternatives considered

- **Strip the earlier turns' thinking blocks and retry.** The API accepts that, but it
  rewrites the customer's history without telling them, and it invalidates the prompt
  cache of a multi-megabyte session, so the customer pays more for the next turn. The
  session would still mix providers.
- **Leave it alone.** The error is rare, about 10 sessions in 48 hours. But each of those
  customers is stuck until someone explains the cause.

## Consequences

- The hint also appears in the error log entry the console shows for the request.
- Anthropic's message is matched as text. If Anthropic rewords it, the hint stops
  appearing, and nothing else changes.

## Verification

`TestRelayErrorHandlerHintsInvalidThinkingSignature` covers `thinking`, `redacted_thinking`,
and a plain-string error body. It checks the Claude and OpenAI renderings, and that an
unrelated 400 gets no hint. `go test ./service/` passes except
`TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which also fails on an unmodified
`main` on this machine because of a local proxy.
