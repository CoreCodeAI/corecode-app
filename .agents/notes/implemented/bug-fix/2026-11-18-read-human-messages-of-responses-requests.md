# Agent Note: Read the human messages of Responses API requests

Status: implemented

## Problem

`humanMessages` read only Claude Messages and Chat Completions requests. A request to
`/v1/responses` had no human messages, so the violation guard recorded its refusals with an
empty excerpt and an empty conversation key.

Without a conversation key, a lenient refusal cannot hold its conversation, and a second
refusal of that conversation cannot merge into the first. Each refusal of one conversation
was judged as a new incident instead. User 15 on 2026-11-18 had four `reasoning_extraction`
refusals of one Claude Code session in nine minutes, all through `/v1/responses`. They were
recorded as warn, warn, merged and suspend (records 451 to 454), and the account was
suspended for three hours. Through `/v1/messages`, the same refusals would have been one
warning and one blocked conversation. The suspension alert also read "（无文本）", because the
excerpt was empty.

The risk gate reads the same function, so its hard rules, its held conversations, the
refusal cache and the decision model never saw the latest message of a Responses request.

## Decision

`humanMessages` reads `OpenAIResponsesRequest` and `OpenAIResponsesCompactionRequest`
through `responsesHumanMessages`. A string `input` is one user message. In an array, each
item with role `user` and type `message` or no type is one user message. Its `input_text`
parts pass through `humanMessageText` like Claude text blocks. Function calls, their
outputs, reasoning, and developer or system items are left out, as tool results are in a
Claude request.

## Alternatives considered

- **Convert the request with `ResponsesRequestToChatCompletionsRequest` and reuse the Chat
  Completions case.** That runs a full conversion, tools included, on every request the risk
  gate checks, only to read user text.

## Consequences

For a client that resends the whole history, as the one in records 451 to 454 does, a
Responses conversation gets the same keys as the same conversation sent as Claude
Messages. A client that sends only new items with `previous_response_id` gets keys for
only the messages it sends. A refusal is still recorded and judged, but a later request may
not reproduce the refused key.

The risk gate now checks the latest human message of Responses requests too. In the seven
days to 2026-11-18, 29 users sent 277 Claude requests through `/v1/responses`. Within 30
days, records 451 to 454 were the only refusals of a Responses request.

`systemText`, which the line-format distill rules read, still covers only Claude and Chat
Completions requests.

## Verification

- `TestViolationConversationKeys` builds a Responses request with a developer item, a
  reasoning item, a function call and its output, a reminder-only message and an image
  part. It gets the same human messages and keys as the Claude conversation in the test,
  and the same keys from a string input and from a compaction request. On the base
  revision the test fails, with nil messages.
- `go test ./service/... ./relay/... ./controller/...` passes.
