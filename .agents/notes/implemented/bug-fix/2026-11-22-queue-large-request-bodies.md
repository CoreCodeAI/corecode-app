# Agent Note: Queue large request bodies within a share of the container's memory

Status: implemented

## Problem

On 2026-11-21 from 11:15 to 11:50 Beijing time, new-api's overload guard answered every
relay request on the serving color with 503 `system_memory_overloaded` whenever its
working set stayed above 90% of the container limit. One user's Codex was sending
`gpt-6.2-astra` requests to `/v1/responses` with bodies of 93-95 MB
(`admin_info.request_body.bytes`), though each carried at most 247k prompt tokens.

Body bytes, not tokens or request count, drove the heap. A body is held about three times
while its response streams: the raw body in `KeyBodyStorage`, the decoded request, and the
outbound body. Four or five 94 MB bodies at once are over a gigabyte of live heap. From
17:00 to 17:30 Beijing time on 2026-11-20, the same color carried about six times the
in-flight prompt tokens and as many in-flight body bytes, in bodies of at most 16 MB, and
memory stayed flat.

corecode-infra lowered `GOMEMLIMIT` to 70% of `mem_limit` (`1792MiB` of `2560m`), so the
collector holds a heap of garbage further below the guard. That does not bound the live
set: once live bytes pass about 2 GB, the guard trips at any soft limit, and it then
rejects every user, not only the one sending the large bodies. Nothing limited how many
large bodies were in memory at once. `MAX_REQUEST_BODY_MB` caps one body at 128 MB, and
`UserConcurrencyLimit` counts requests of any size.

Over the 14 days to 2026-11-22, bodies of 16 MB and up were about 7,700 requests from 67
users; bodies of 64 MB and up came from 3 users.

## Decision

`middleware.LargeRequestBodyLimit` runs on the `/v1` and `/v1beta` relay groups after
`UserConcurrencyLimit` and before `Distribute`, which is the first reader of the body.

- **A body of 16 MiB or more takes a share of a budget**, equal to its size. The budget is
  1/8 of the container's cgroup memory limit, 320 MiB at 2560 MiB. A full budget is about
  1 GiB of heap at three copies, which keeps the rest of the traffic below `GOMEMLIMIT`.
- **The share is taken before the body is read** when `Content-Length` gives its size, so a
  queued upload is not yet in memory. A compressed body
  (`DecompressRequestMiddleware` marks it) or one without a length is read first and
  measured; its later copies still wait.
- **A request that does not fit waits**, in arrival order, and holds its share until the
  handler returns, after a streamed response ends. After 60 seconds it gets 503 with
  `Retry-After: 60` and a message naming its size; a client that leaves while waiting is
  not answered. A body larger than the budget waits until it can run alone.
- **The wait is recorded** as `request_body_queue_ms` in the request log's admin info, and
  a wait of a second or more is logged with the body's size.
- **Without a cgroup memory limit**, as on a developer machine, the gate admits everything.

The budget follows corecode-infra's `mem_limit`, so it changes with the limit and needs no
setting of its own.

## Alternatives considered

- **Lower `MAX_REQUEST_BODY_MB`.** It would reject the Codex requests outright rather than
  delay them, and they are legitimate.
- **Count large requests rather than their bytes.** A 16 MiB and a 128 MiB body would cost
  the same; bytes match what is held.
- **Judge overload from the Go runtime's live heap after GC.** It measures the risk better
  but still rejects every user when one user fills memory. It remains worth doing for the
  guard itself.
- **Turn on upstream's disk cache for bodies over 10 MB** (`performance_setting`). It moves
  only the raw copy to disk; the decoded request and outbound body stay in memory.

## Consequences

- A burst like 2026-11-21's runs three 94 MB bodies at a time and queues the rest, adding
  seconds to their latency instead of 503s for every user.
- The budget is per process. During a release both colors run, each with its own.
- The Responses WebSocket route (`GET /v1/responses`) carries its events outside this
  gate.
- A queued request keeps its connection and its `UserConcurrencyLimit` slot while it waits.
- `TokenAuth` already reads a `/messages` body in a Claude Code-only group, for the client
  check, so that raw copy is in memory while it queues; its later copies still wait. The
  gate stays after authentication: before it, a client without a key could hold the budget
  by declaring a large `Content-Length` and uploading slowly. A client with a key can still
  do that, up to its concurrency limit.

## Verification

- `go test ./middleware/ -run 'LargeBody|BodiesBelow|CompressedBody|BodyLargerThan|ClientLeaving'`
  covers waiting and release, bodies under the threshold, the 503 after the wait, a gzip
  body measured after decompression, a body larger than the budget, and a client leaving
  while queued.
- Each guard was broken on a copy of the file. Its test failed, and the copy was restored:
  the decompression mark, the share clamp, the release, the threshold, the wait bound and
  the recorded wait.
- After release, the serving color logs `large request body gate: 320 MiB budget for
  bodies from 16 MiB` when its routes are set up. Both relay groups share one gate.
