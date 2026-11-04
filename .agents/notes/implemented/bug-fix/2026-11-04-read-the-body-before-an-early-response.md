# Agent Note: Read the request body before an early response

Status: implemented

## Problem

Customers occasionally saw `API Error: 431 Request Header Fields Too Large`
from Claude Code. The Tokyo edge's access log had 20 in seven days, from
about nine client IPs, all on `POST /v1/messages`. new-api logged none of them.
Every one had:

- a 35-byte body, which is the text Go's `net/http` writes when a request's
  header section exceeds its limit;
- a single `Via: 1.1 Caddy`, where a response that new-api produced carries two
  (edge and relay), so the relay's Caddy produced the 431 itself;
- request headers of 1–2 KB, and often `bytes_read` 0 at the edge, answered
  within one Tokyo–us-west2 round trip.

They came in bursts, one of them during the 07:50–07:57 UTC release on
2026-11-04. In that burst, new-api answered a request with a 503 in 72 µs, and
two seconds later the edge recorded a 431 for the same client.

A local copy of the path, built from Caddy 2.11.7 for the edge and the relay
with the production proxy settings and 100 ms between them, reproduced it:

- When the backend answers before reading the body, the relay's Caddy passes
  the response on but keeps its keep-alive connection from the edge open with
  the rest of the body unread.
- The edge sends its next request on that connection. The relay parses the
  leftover JSON as that request's first line. Claude Code's body has no raw
  newline, so a remainder of a megabyte or more exceeds the 1 MB header limit
  (431), and a larger one resets the connection (502 at the edge).
- On one connection, a 1 MB request answered early, followed by a second
  request, gave 431 five times out of five. With 3 MB the second request got a
  reset or a 431 every time.

The 503s that the relay's Caddy answers itself (the `caddy/deploying` gate) did
not cause it; only early responses that came through `reverse_proxy`.

## Decision

- **`deployment.Gate` reads what is left of the request body before the first
  byte of any response.** The Gate is the outermost handler, so one wrapper,
  `bodyDrainingWriter`, covers the drain 503 and every early rejection behind
  it: authentication, rate limits, oversized bodies. Once new-api has read the
  body, the relay has forwarded all of it and its connection from the edge
  carries nothing extra.
- **The read stops at `MAX_REQUEST_BODY_MB`** (`Gate.BodyDrainLimit`, 128 MiB by
  default). Past it the response sets `Connection: close`.
- **The wrapper keeps the writer's interfaces.** Gin asserts `http.Flusher` for
  SSE and `http.Hijacker` for WebSocket upgrades. `io.ReaderFrom` keeps
  sendfile for static files, and `Unwrap` serves `http.ResponseController`. A
  hijacked connection is not drained.
- **A handler that already read or closed its body pays one empty read.**

## Alternatives considered

- **Buffer the request body in the relay's Caddy (`request_buffers`).** It fixed
  the reproduction too, with no measurable latency. But Caddy holds a fully
  buffered body until the request ends, because it may retry the request.
  Seven days of edge logs (146k POSTs, p99 13.7 MB, largest 35 MB) put the peak
  near 100 MiB with a 32 MiB cap, and up to twice that in allocated buffers.
  The proxy container had a 128 MB limit and peaks of 117 MB. Raising the limit
  in compose means replacing the proxy container. `deploy-relay.py` refuses to
  do that automatically, and replacing it cuts every open stream.
- **`Connection: close` on the relay's error responses.** The 431s became 502s:
  the relay closed while the edge was still writing the body, and the reset
  reached the edge before the response.
- **Stop reusing edge-to-relay connections for `/v1`.** Each request would pay a
  TLS handshake and slow start again, about a second per megabyte from Tokyo
  (corecode-infra `edge/README.md`).

## Consequences

- An early rejection now waits for the client to finish uploading. A large body
  that took about 0.1 s to reject can take as long as its upload, which the
  client was making anyway. Requests that are served pay nothing.
- A body larger than `MAX_REQUEST_BODY_MB` that is rejected early still leaves
  bytes unread; its response closes the connection, so the edge may see a reset
  as before.
- The relay's Caddy still keeps a connection with unread bytes open when the
  backend answers early. Any future backend behind it needs the same rule.

## Verification

- `go test -race ./pkg/deployment` passes. New cases check that:
  - a 3 MB body is fully read before an early 503's status goes out;
  - a body over the limit stops one byte past it and gets `Connection: close`;
  - the Gate's own draining 503 reads the body;
  - a handler that read the body is unaffected;
  - the wrapped writer still asserts as `http.Flusher`, `http.Hijacker` and
    `io.ReaderFrom`, and `http.ResponseController` and `Hijack` work through it.
- With the drain disabled, the first three assertions fail.
- End to end, the local Caddy 2.11.7 edge and relay in front of a backend built
  from this package, answering 503 before reading:
  - a 1 MB, 3 MB or 20 MB request answered early, followed by another request
    on the same connection, gave the second request its normal response in
    15 of 15 runs;
  - two 90-second runs, 24 parallel uploads at 1 MB/s with the early 503
    toggled, made 4,506 requests with no 431, no 502 and no proxy error at the
    edge. The same load against a backend without the drain gave 431s and 502s;
  - the median time to first byte of a served 1.2 MB request was 0.129 s, as
    before.
- `go vet` and `go test` pass for pkg, router, middleware, controller and
  common.
