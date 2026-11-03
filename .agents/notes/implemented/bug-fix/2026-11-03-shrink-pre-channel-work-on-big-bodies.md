# Agent Note: Shrink the pre-channel work on big request bodies, and time it

Status: implemented

## Problem

Claude Code requests of 4 to 30 MB, mostly base64 screenshots in the history,
spent 0.4 to 1.4 s in new-api before a channel was chosen (p50 of
`request_policy` `elapsed_ms` at `channel_selected`: 414 ms at 4-8 MB, 749 ms
at 8-16 MB, 1403 ms above 16 MB). The time roughly doubled when the risk gate
went live on 2026-10-28 20:00 CST. Nothing recorded where it went. The risk
gate's regexes were not the cost: the policy reads text, and images are not
text.

A Go benchmark of the real path (`relay.BenchmarkPreChannel`: body read,
`GetAndValidateRequest`, `GenRelayInfo`, `CheckRiskGate` in enforce mode with
distillation and hard regex on, and the billing token estimate) on synthetic
Claude Code bodies, 85% base64 PNG, found three repeated whole-body walks:

- **gjson lookups over the images.** `readRiskGateRequest`, the client
  recognition and `riskpolicy` make about a dozen `Get` and `ForEach` calls
  on the body. Claude Code writes `messages` first, so each lookup of a later
  key (`system`, `tools`, `metadata`, `max_tokens`) and each walk of
  `messages` crosses every screenshot byte by byte. It was over half of the
  gate's CPU at 25 MB.
- **`ClaudeMessage.ParseContent` and `ParseMediaContent`.** Both marshal the
  decoded content to JSON and decode it again (`kitutil.Any2Type`), copying
  and scanning each image several times. `humanMessages` calls it once per
  user message, `GetTokenCountMeta` once per message and once more per
  tool result.
- **`countTopLevelJSONKey`**, the duplicate-`model` check in `Distribute`,
  stepped through the body one byte at a time.

The verdict cache key was not a cost. It hashes the extracted texts (system
prompt, latest human text, hard document), not the body, and `sha256` does not
appear in the profile. The base64 decode in the token estimate was also small
(under 1 ms per MB of images).

## Decision

- **`riskpolicy.Slim` empties long image payloads before the gate parses the
  body.** A string of 2 KB or more that is the value of `data`, `url`,
  `image_url` or `file_data` becomes `""`. Strings are crossed with
  `bytes.IndexByte`, so the scan runs at memory speed, and the copy keeps the
  structure, keys and text. `readRiskGateRequest` parses the slim body. The
  policy and the client recognition read only `text` and `content` values,
  `role`, `type`, `model`, `system`, `instructions`, `input`, `tools`,
  `tool_choice`, `metadata.user_id`, `thinking`, `reasoning*`, `n` and token
  limits, so a payload under those four keys never changes a verdict.
- **`parseClaudeMedia` sets long `data` strings aside around the JSON round
  trip.** `ParseContent` and `ParseMediaContent` swap each string of 2 KB or
  more under a `data` key for a short stand-in, round-trip, and put the
  original strings back into `Data`, `Source.Data`, `Content` and `Input`. A
  stand-in is a string, so the typed fields decode exactly as before. If the
  count of restored strings differs from the count set aside (a payload under
  a raw field, or dropped as an unknown field), the plain round trip runs.
  Strings that are not valid UTF-8 stay inline, since `Marshal` would repair
  them. The stand-in carries a per-process random value.
- **`arrayLength` and the `tools` check count with `ForEach`** instead of
  building `Array()` slices of every message. `resultLength` keeps the old
  count for a `tools` value that is an object or string (one).
- **`countTopLevelJSONKey` finds a string's end with `bytes.IndexByte`.**
- **The log records where the time goes.** `other.admin_info.pre_channel_ms`
  holds `{"parse", "risk_gate", "billing_estimate", "billing_reserve",
  "select", "total"}` in milliseconds, to 0.1 ms, each stage's first run
  only (a retry's second selection does not replace the first). `total` is
  the sum. It is admin-only, like the neighbouring `request_body`
  (the body-read measurement). A request that fails early records the stages
  it reached. `parse` covers `GetAndValidateRequest` and `GenRelayInfo`;
  `billing_estimate` is the token meta and estimate; `billing_reserve` is
  pricing and the quota reservation. Query p95 per stage from `logs.other`.

## Alternatives considered

- **Reuse one parsed body across the gate, billing and the relay.** The gate
  reads raw JSON through gjson, billing and the relay read the `dto` tree.
  Sharing needs one representation for all three, which changes far more
  code than the round trips cost once the images are out of them.
- **Whitelist-decode content parts directly from `[]any`.** It avoids the
  round trip, but has to reproduce which malformed parts the typed decode
  rejects (and the case-insensitive key matching). Setting payloads aside
  keeps the decoder in charge.
- **Decode only the head of each base64 image for its size.** It would save
  little (the decode is under 1 ms per MB) and would stop rejecting a
  truncated or invalid tail at billing.
- **Presize the body buffer from `Content-Length`.** `io.ReadAll` allocates
  about twice the body, but a client can claim a large length and send
  nothing, so each connection could hold up to the body limit of memory under
  `mem_limit: 768m`. Not done.
- **Key the verdict cache on less.** It already keys on the extracted texts.
  Whether Claude Code's `<system-reminder>` text blocks change between tool
  steps, and so miss the cache, needs production data; the extraction runs
  before the lookup either way.

## Consequences

- Verdicts, the strikes, the excerpt, `bare` and `official` are unchanged.
  Billing quantities are unchanged: images are still sized from their real
  bytes, and none is counted as text.
- `ParseContent` returns strings that share storage with the content tree it
  was given, where the round trip returned copies. Strings are immutable.
- A body that is not valid JSON, or has an unterminated string, is parsed
  as before (`Slim` returns it unchanged).
- Not changed, and still on the path: `GetAndValidateClaudeRequest` decodes
  the whole body (about 40 ms at 25 MB locally; `ClaudeRequest.UnmarshalJSON`
  reads it twice), `clientCheck` and `detectClaudeCodeClient` each decode it
  in a Claude-Code-only group, and the body read allocates twice the body.
  The `pre_channel_ms` field shows whether they matter in production.

## Verification

Local, Apple M-series, 20 iterations, Go 1.27, synthetic bodies with generic
rules (the production rules are private). Milliseconds per request, before
then after:

| body | body read | parse | risk gate | billing estimate | total |
|---|---|---|---|---|---|
| 0.6 MB, 2 images | 0.1 / 0.1 | 0.8 / 0.8 | 4.9 / 0.8 | 1.4 / 0.5 | 7.4 / 2.5 |
| 4.0 MB, 12 images | 0.4 / 0.4 | 5.5 / 5.4 | 26.9 / 2.7 | 8.4 / 2.6 | 41.6 / 11.5 |
| 12.0 MB, 33 images | 0.9 / 1.0 | 17.8 / 17.3 | 80.6 / 11.4 | 26.4 / 9.9 | 126 / 40 |
| 25.0 MB, 67 images | 2.0 / 1.9 | 38.4 / 36.1 | 173.7 / 27.0 | 56.8 / 22.8 | 271 / 88 |

Allocation per request at 25 MB: risk gate 81 to 20 MB, billing estimate 115
to 34 MB, total 281 to 138 MB. Production runs on a 2 vCPU host shared with
gpt-load, several times slower than this machine.

- `TestSlimKeepsVerdicts` evaluates 600 random Claude, Responses and chat
  bodies with images in every position, under three stage switches and
  official on and off, against the full and the slim body, and requires the
  same `Hit`. It requires bodies that hit each rule kind. `TestSlim` covers
  escapes, near-miss keys and unterminated strings.
  `TestReadRiskGateRequestIgnoresPayloads` compares `official` and `bare`.
- `TestParseClaudeMediaMatchesRoundTrip` compares `parseClaudeMedia` with
  `Any2Type` on 4000 random contents (payloads in typed, raw, unknown and
  wrongly typed fields, invalid UTF-8, multibyte text) for equal results and
  equal error status. It covers every statement of the parser.
- `TestCountTopLevelJSONKeyMatchesByteScan` compares the new scanner with the
  old one on 20,000 random strings of JSON punctuation.
- `TestPreChannelTiming` checks first-run-only recording, the total and the
  admin-only placement.
- `go test ./service/... ./pkg/riskpolicy/... ./relay/... ./controller/...
  ./middleware/... ./internal/...` and `go test ./...` in `relaykit/` pass,
  except `TestUpstreamAddressesMaskOnlyConfiguredAddresses` in `service`,
  which also fails on `origin/main` (it expects a masked proxy host name
  that this machine's proxy settings change). `go vet` is clean.
- The benchmarks stay in the tree: `go test ./relay -run xxx -bench
  PreChannel -cpuprofile cpu.out` and `go test ./middleware -run xxx -bench
  RelayBodyChecks`, on bodies from `internal/claudebody`.
