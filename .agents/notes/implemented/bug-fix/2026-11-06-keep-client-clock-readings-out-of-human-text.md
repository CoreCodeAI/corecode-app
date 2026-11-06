# Agent Note: Keep DeepSeek Harness's clock readings out of human text

Status: implemented

## Problem

On 2026-11-06 the upstream refused three requests from `deepseek-harness`
clients: violation records 155 (user 827, `cyber`), 156 (user 1042,
`reasoning_extraction`) and 157 (user 1042, `cyber`). Records 155 and 157
suspended the user. In all three the excerpt, the text an operator reviews and
relay-watch quotes in its 🚫 alert, was the harness's clock reading:

```text
Time sampled while preparing turn 2, step 1: 2026-11-06T13:32:05+08:00[Asia/Shanghai]
Browser time zone for this request: Asia/Shanghai. Interpret otherwise-unqualified dates and times in this zone.
Elapsed since the preceding model-visible message: 18m 24s.
```

The harness's time-context plugin
([`renderText`](https://github.com/deepseek-ai/deepseek-harness/blob/fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159/packages/context/time-context/src/index.ts))
appends this reading to a turn as a user message of its own, at most every ten
minutes by default. `humanMessages` took it for the person's latest message.
For records 156 and 157 the excerpt was only the reading. For 155 it was the
person's `<acp>` text followed by the reading. So the review had nothing to
judge, and the reading also went into the conversation keys, the refusal
similarity set and the risk gate's latest message.

## Decision

`humanMessageText` removes a clock reading wherever it appears as complete
lines in a text block, with the same effect as a `<system-reminder>` block.
The match is `clientClockReading`. Its only variable parts are numbers, an
ISO timestamp, a zone name of at most 64 characters (or the quoted zone list of a
`mixed` reading), and a duration, following the plugin's three wordings
(`resolved`, `mixed`, `unavailable`). Removing a match therefore removes
nothing a person could have written. A reading with any other text inside it
does not match and stays in the message.

## Alternatives considered

- **Skip only a text block that is exactly a reading**, the way
  `clientCaptions` works. Record 155 shows the reading in the same message as
  the person's text. Whether the harness sends it as a separate block or
  inside the same block depends on its provider adapter. Matching complete
  lines covers both.
- **Mark the reading with `riskgate.ClientTemplate`.** That only keeps a
  refusal out of the similarity set. The excerpt, the alert and the
  conversation keys would still carry the reading instead of the person's
  text.

## Consequences

- The keys of the three refused conversations above were computed with the
  reading included. A resend of one of them after this release no longer
  matches its block. The suspensions are unaffected.
- The excerpts already stored for records 155 to 157 keep the reading until
  they expire after 30 days. Similarity matching is off in production
  (`risk_gate_setting.similarity_enabled=false`), so they block nothing now.
- If the plugin changes its wording, the reading stops matching and returns to
  the excerpt, as before this change.

## Verification

- `TestViolationConversationKeys` covers the three shapes: a reading as a message of its own, a
  `mixed`/`unavailable` step reading after an `<acp>` block, and a reading on
  the lines after the person's text. It also checks that a reading padded with
  other text is kept whole. With the filter removed, the test fails on the
  first of these.
- `go vet ./service/...` and `go test ./service/...` pass.
