# Agent Note: Capture direct relay traffic for the session audit

Status: implemented, pending merge

## Problem

The session audit only has the engine's traffic: `corecode-engine` publishes a
v1 capture event for every request it serves. Requests that new-api sends
straight upstream — a channel the engine does not route — leave no audited copy
of the client body or the upstream response, so an audit cannot reconstruct
what a customer sent or what the vendor answered on those channels. The ingest
already accepts the engine's events; it must also accept new-api's, unchanged.

The cross-repository design is written in `corecode-infra`
`notes/workspace/proposed/architecture/2026-11-28-capture-direct-routes-in-new-api.md`.

## Decision

- **Port the engine's capture into `pkg/sessioncapture`.** The package is the
  same shape as the engine's `internal/sessioncapture`: a v1 envelope with
  `producer: "new-api"`, a budget charged for the request body and every
  response read, a non-blocking queue, and workers that gzip, upload and
  publish. Object names are
  `<env>/<yyyy>/<mm>/<dd>/<request_id>/{request.json.gz,response-<n>.json.gz,event.json}`,
  keyed by the UTC date of `completed_at`; the event is stored beside the
  objects it names so ingest can recover a lost message. Uploads go to GCS and
  events to Pub/Sub over REST with the instance's metadata-server token, like
  `pkg/gcsupload`, so the host holds no key file.
- **`session_capture_setting` is an option row** with `enabled`,
  `sample_percent` and `channel_ids`, registered in `operation_setting` like
  the other switches. Sampling is FNV-1a over the customer id modulo 100, so
  every request of a sampled customer is captured and every process agrees.
- **The tap is in `doRequest`.** After the transport answers,
  `sessioncapture.Tap(c, resp)` wraps `resp.Body` so the bytes the handler
  reads are copied, at `relay/channel/api_request.go:622`. The task adaptor's
  `DoTaskApiRequest` reaches the same function, so video submits are covered.
- **One capture per client request, completed once.** `controller.Relay`
  starts the capture after `GenRelayInfo` and completes it in a deferred call
  after the retry loop, with the status the client received. `RelayTask` does
  the same around the task retry loop with `RelayFormatTask`. Each retry opens
  an attempt before `submit` and closes it after; attempts on unlisted
  channels open nothing. The last attempt of a succeeded request is `served`;
  the others are not.
- **The request headers are an allowlist**, `user-agent`, `content-type`,
  `openai-beta`, `originator`, `session_id`, read through `Header.Values`. A
  credential header added later stays out until it is named there.
- **Capture never touches the response.** The audit copy is charged,
  compressed and uploaded on the workers; a budget, queue, upload or publish
  failure is counted (`session_capture.stats`, every five minutes) and the
  capture dropped. `main` installs the pipeline from `SESSION_CAPTURE_*` only
  when both a bucket and a topic are set and drains it for up to 30 seconds on
  shutdown.

## Alternatives considered

- **Reusing the engine's capture package.** It is not a module this repository
  can import, and the engine's ingest contract is the only thing shared; the
  wire envelope is reproduced instead, and the tests pin it.
- **Tapping in the relay handlers instead of `doRequest`.** There are many
  handlers and the task adaptors bypass them; one tap at the single transport
  point covers every protocol and every retry.
- **Buffering the whole response before copies.** A streamed response would be
  delayed until its end, which the capture must never do. The tee copies each
  read as it happens, and the attempt's response object ends up holding the
  bytes the client received.
- **Reading usage from the billing result.** Usage is read from the consume
  log the request already records (`cache_tokens`, `cache_write_tokens`,
  prompt/completion), which exists whether or not the customer keeps logs.

## Verification

`go test ./pkg/sessioncapture ./service ./relay/channel ./controller
./setting/operation_setting` with no database DSNs. The end-to-end tests in
`relay/channel/session_capture_test.go` drive `doRequest` against a fake
upstream and a fake object store and publisher: streamed and unary chat
objects decompress byte-identical to the client body and upstream bytes, the
allowlisted headers exclude `Authorization`, `X-Api-Key` and `Cookie`,
failover keeps both attempts in order with the last served, an unlisted
channel, a disabled switch, an unsampled customer and a missing pipeline copy
nothing, an exhausted budget drops the capture and still serves the client,
and a multipart body is stored raw. Breaking the tap fails the object tests;
adding a credential header to the allowlist fails the allowlist test.
