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
- **The read is bounded: 32 MiB and 30 seconds** (`Gate.BodyDrainLimit`,
  `Gate.BodyDrainTimeout`). The client being read may have been turned away
  for having no credential. Without bounds, it could hold a connection and a
  handler, counted as active by the Gate and so delaying a release's drain, for
  as long as it trickled a large declared body; new-api's server has no read
  timeout. In the week to 2026-11-04, 14 of 146,513 bodies exceeded 32 MiB.
  Past either bound the response sets `Connection: close`.
- **The time bound is a read deadline on the connection, cleared after a
  complete read.** Left in place, it would fire in the server's background read
  during a long response, cancel the request's context and cut an SSE stream.
- **A body the handler closed counts as read.** Its reads fail with
  `http.ErrBodyReadAfterClose` whether or not it was read to the end. The server
  already tracks what is left of it and closes the connection if it must.
  Treating it as unread would close every keep-alive connection whose handler
  closed its body.
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
- A body larger than 32 MiB, or one still uploading after 30 seconds, that is
  rejected early still leaves bytes unread. Its response closes the connection,
  so the edge may see a 431 or a reset as before.
- A client without a credential can make new-api read up to 32 MiB, for up to
  30 seconds, per request it sends. Before this change it got its 401 without
  the body being read. The edge and the relay set no request body size or read
  timeout of their own; an authenticated client could already hold a
  connection with a slow upload.
- The relay's Caddy still keeps a connection with unread bytes open when the
  backend answers early. Any future backend behind it needs the same rule.

## Verification

- `go test -race ./pkg/deployment` passes. New cases check that:
  - a 3 MB body is fully read before an early 503's status goes out;
  - a body over the limit stops one byte past it and gets `Connection: close`;
  - the Gate's own draining 503 reads the body;
  - a handler that read the body is unaffected;
  - the wrapped writer still asserts as `http.Flusher`, `http.Hijacker` and
    `io.ReaderFrom`, and `http.ResponseController` and `Hijack` work through it;
  - over a real connection, a client that stops sending gets its 503 at the
    300 ms test timeout, with `Connection: close`;
  - after a complete read, the connection serves another request sent after
    the timeout, and a body the handler read and closed keeps the connection;
  - a response that outlasts the timeout is not canceled.
- Mutations: with the drain disabled, the first three cases fail. Without the
  deadline, the stalled client waits until the test gives up. Without clearing
  the deadline, the long response's context is canceled. Counting a closed body
  as unread closes the connection.
- End to end, the local Caddy 2.11.7 edge and relay in front of a backend built
  from this package, answering 503 before reading:
  - a 1 MB, 3 MB or 20 MB request answered early, followed by another request
    on the same connection, gave the second request its normal response in
    every run. A 40 MB one, over the limit, still gave 431 or a reset, as
    expected;
  - two 90-second runs, 24 parallel uploads at 1 MB/s with the early 503
    toggled, made 4,508 requests with no 431, no 502 and no proxy error at the
    edge. The same load against a backend without the drain gave 431s and 502s;
  - a 1 MB upload throttled to 2 KB/s and rejected early got its 503 after
    32 s, having sent 65 KB;
  - a 45-second SSE stream completed with every event;
  - the median time to first byte of a served 1.2 MB request was 0.129 s, as
    before, measured before the bounds were added.
- `go vet` and `go test` pass for pkg, router, middleware, controller and
  common.
