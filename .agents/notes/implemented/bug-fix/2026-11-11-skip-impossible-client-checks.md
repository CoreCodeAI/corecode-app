# Agent Note: Skip impossible client checks without copying the conversation

Status: implemented

## Problem

On ordinary Claude CLI requests in a Claude-Code-only group, `clientCheck`
first copied every top-level JSON value into a raw-message map, including the
conversation's images and tool results. The regular client detector then
parsed the body again. The earlier [pre-channel decision](2026-11-03-shrink-pre-channel-work-on-big-bodies.md)
records the other body-processing costs.

## Decision

For in-memory JSON from a Claude CLI User-Agent, a scan may rule out the fixed
connectivity check when it finds a top-level field outside its existing
allowlist (`clientCheckFields`). The scan follows nested arrays and objects and
JSON string escapes, and decodes escaped field names before comparing them. It
stops at the end of the first JSON value.

The scan only returns "not a check". Whenever it does, the previous code also
returned "not a check": the field it found is a key of the decoded map, or the
body is not one JSON object and the map decode fails. So the scan cannot admit
a request, and cannot refuse one the previous check admitted. The ordinary
client detector still runs the full parse and the existing prompt, header,
metadata, version, size and error checks. Other User-Agents, non-JSON bodies,
disk-backed bodies and bodies with no extra field keep the previous check.

The change ports uncommitted work from 2026-11-04 onto current main, where
`enforceClaudeCodeOnlyGroup` became `enforceClientOnlyGroups` (it now also
serves Codex-only groups). `clientCheck` and `detectClaudeCodeClient` had not
changed.

## Alternatives considered

- **Cap the probe's body size or trust Content-Length.** Legal checks may have
  long unused fields or repeated keys, and Content-Length is not the received
  size. Either option can change admission or limit handling.
- **Admit by User-Agent or by `max_tokens`.** These are not proof of the fixed
  connectivity-check shape; ordinary requests must still pass the detector.
- **Read the detector's three fields with one `ojson.GetManyBytes` pass.**
  Typed decoding has duplicate-field, type-error and case-matching semantics
  that the detector's verdicts depend on; replacing it would broaden the
  change. Disk-backed JSON keeps the streaming decoder for the same reason.

## Consequences

The fast path removes the probe map and its copies only for in-memory Claude
CLI requests in a gated group. It does not remove the detector's full parse or
the request-body read. This is an admission optimization, not a stronger proof
of client identity: the client headers and prompt remain client-supplied.

## Verification

- `go test ./middleware -count=1`: ok.
  `TestClaudeCodeAdmissionPreservesClientCheckSemantics` pins 24 bodies with
  their expected status (200, 400 or 403): large and escaped checks, duplicate
  keys whose last value decides, an escaped `system` key, extra fields on
  ordinary CLI requests, malformed bodies before and after an extra field, and
  a trailing second JSON value. `TestClaudeCodeAdmissionBodyRemainsReusable`
  requires the body to replay unchanged from memory and from disk.
  `TestClaudeCodeOnlyGroupAutoCandidates` and `TestClaudeCodeOnlyGroupUnreadableBody`
  gained a malformed auto-group body, an aborted upload after an extra field,
  and an oversized body from another client. All of them passed against the
  previous `clientCheck` before the scan was added.
- With the scan's nesting checks removed (a comma at any depth starts a key,
  and any key is compared), seven of those cases fail. With only the
  `depth == 1` condition on the key comparison removed, none fail: in valid
  JSON `expectingKey` is set only at depth 1 and cleared by the first string
  after it, so the condition matters only for malformed bodies, where any "not a
  check" agrees with the failing map decode. It stays as a guard.
- Benchmark, same machine (Apple M4 Pro, darwin/arm64) and flags before and
  after:
  `go test ./middleware -run '^$' -bench '^BenchmarkClaudeCodeAdmission$' -benchmem -benchtime=10x -count=3`.
  Medians of three runs:

  | Body | Before | After | Before B/op | After B/op |
  |---|---|---|---|---|
  | 1.0 MB | 2.73 ms | 1.62 ms | 3.27 MB | 2.26 MB |
  | 4.0 MB | 9.76 ms | 4.68 ms | 13.9 MB | 9.88 MB |
  | 12.0 MB | 30.1 ms | 14.1 ms | 37.1 MB | 25.1 MB |
  | 25.0 MB | 73.9 ms | 29.1 ms | 79.3 MB | 54.2 MB |

  Other agents were building on the machine during both runs, so single runs
  vary by up to a third; every run after the change was faster than every run
  before it at the same size.
