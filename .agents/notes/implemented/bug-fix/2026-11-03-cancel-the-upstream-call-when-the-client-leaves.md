# Agent Note: Cancel the upstream call when the client disconnects

Status: implemented

## Problem

`DoApiRequest` and `DoFormRequest` built the upstream request with
`http.NewRequest`, which carries no context. A client that disconnected did not
cancel the call. A stream stopped anyway, when a write to the client failed, so
the engine recorded `client_canceled`. A non-streaming call ran to the end and
was billed.

On 2026-11-03 a Claude Code user's stream was cut, and the client retried it as
a non-streaming request three times, each starting about six minutes after the
last while the earlier one was still running (body 281,109 bytes each). Two of
them ran 564 s and 587 s, produced 57k and 59k tokens, and were charged to the
customer's subscription (1,198,756 and 1,239,038 quota), though the client had
already moved on. The third hit the 600 s limit.

## Decision

- `newUpstreamRequest` builds the upstream request with
  `http.NewRequestWithContext(c.Request.Context(), …)`, and both
  `DoApiRequest` and `DoFormRequest` use it. A client that leaves now cancels
  the upstream call; the engine stops the provider and records
  `client_canceled`, and new-api refunds the pre-consumed quota through the
  ordinary error path.
- When `relayClient.Do` fails because the client's context is done,
  `doRequest` returns the error with `ErrOptionWithSkipRetry` and
  `ErrOptionWithNoRecordErrorLog`. No other channel can serve a client that
  left, and the channel did nothing wrong, so the relay loop neither retries
  nor writes an error log, and `ShouldDisableChannel` returns false for a
  skip-retry error before it looks at the status.

## Alternatives considered

- **Watch the client in a goroutine and close the upstream body.** It covers
  only the body read, not the wait for headers, which is where a
  non-streaming call spends its time.
- **Keep running and settle the result.** The client has gone and will send
  the turn again; finishing the first copy only bills the customer twice.
- **Change every `http.NewRequest` in `relay/channel/`.** The other call
  sites are provider-specific helpers (token fetches, uploads, Ollama
  management) that CoreCode does not route customer traffic through. The two
  functions changed here carry every relay request.

## Consequences

- An abandoned non-streaming request stops costing the customer and the pool
  the moment the client leaves.
- A stream that loses its client now also ends through the request context, as
  well as through the failed write; its billing is unchanged (`client_gone`).
- Any caller that passes a gin context whose request context ends before the
  upstream call should finish would now be cut. The channel test builds its
  request on the context its caller passes (the operator's request, or the
  health check's), so an operator who closes the page stops the test; task
  relays already used `NewRequestWithContext`.

## Verification

- `TestUpstreamRequestStopsWhenClientDisconnects` cancels the client context
  50 ms into a call to a test server that waits 10 s, and requires the server
  to see its request canceled, `doRequest` to fail, and the error to skip retry
  and the error log. With `http.NewRequest` restored the test fails.
- `go vet ./relay/channel/` is clean; `go test ./relay/... ./controller/...`
  passes. `go test ./service/...` fails only
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails on
  `origin/main` too.
