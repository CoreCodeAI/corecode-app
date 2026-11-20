# Agent Note: Stop retrying an upstream that has no channel

Status: implemented

## Problem

From 2026-11-20 17:00 UTC no request to the `GPT 福利` group succeeded. Its only channel, #13, is
another new-api gateway, and every attempt came back as:

```
503 {"error":{"code":"model_not_found","message":"No available channel for model gpt-6.2-astra under group GPT福利 (distributor)", …}}
```

`RetryTimes` is 2 and the group had no other channel, so each request asked #13 three times
within about 200 ms (`use_channel` `["13","13","13"]`) and wrote three error logs. In the
hour to 19:46 UTC the group logged 1,584 errors from three users. User 3719's own gateway
retried without backoff, about eight requests a minute, and one sampled request body was
582 KB, so each failed request sent it upstream three times.

Same-channel retries do recover from other failures. Over the seven days to 2026-11-21, 59
requests succeeded only on a retry to the channel that had just failed them: 403
`permission-denied` from the Grok pool, transport 500s, 451 and 502. None of the 2,926
same-channel retries after an upstream 503 `model_not_found` succeeded.

## Decision

- **Exclude the channel after an upstream "no channel" answer.** `service.UpstreamHasNoChannel`
  matches a 503 with code `model_not_found`. When that attempt is to be retried, the relay
  loop in `controller/relay.go` adds a `FilterExcludedChannel` filter for the channel to the
  request's channel constraints. The retry picks another channel of the group, or another
  auto group. When none remains, the request stops.
- **Keep the cause.** A retry whose channel selection fails now returns the previous
  attempt's error, not `get_channel_failed`. This matches what
  `2026-11-11-report-the-vendors-failure-when-a-task-retry-finds-no-channel.md` did for task
  submissions. A selection that fails before any attempt still reports `get_channel_failed`.

This gateway's own "no available channel" (also 503 `model_not_found`) is decided in the
distributor before the relay loop, so the match only sees upstream answers.

## Alternatives considered

- **Never retry the channel that just failed.** It would have cost the 59 recovered requests
  above. A pool or multi-key channel serves the next attempt from another account.
- **One error log per request instead of per attempt.** It removes the extra logs but still
  sends every attempt upstream. Per-attempt rows are also what attributes a failover's
  failure to the channel that caused it.
- **Turn on `AutomaticDisableChannelEnabled` with a keyword.** It is global, so it would also
  disable Claude and pool channels on their own errors. It also does not re-enable the channel
  unless automatic channel tests run.

## Consequences

- A request to a group whose upstream is empty makes one attempt and writes one error log,
  where it made `RetryTimes + 1` attempts and wrote as many.
- The client gets the upstream's 503 and message. The `request_policy` trail still shows
  `retry` for the last attempt, with no attempt after it.
- Other upstream errors retry as before, including other 503s.
- Retries after any failure that end in a failed selection, for example an `auto` request
  whose last group is used up, now report the upstream's error instead of
  `get_channel_failed`.
- The Responses WebSocket and task retry loops are unchanged: the first retries only dial
  failures, and the second already keeps the cause.

## Verification

- `router/upstream_no_channel_retry_test.go` runs requests through the relay router against a
  fake upstream with `RetryTimes` 2:
  - With one channel answering 503 `model_not_found`, the upstream receives one request, the
    client gets 503 with the upstream's message, one error log is written, and nothing is
    charged. On `main` the same test sees three upstream requests and three error logs.
  - With a second, lower-priority channel, the retry goes to it and the request succeeds.
  - A 503 with another code is still sent three times.

  CI does not run `./router/...`, so this test runs only locally.
- `controller/upstream_no_channel_retry_test.go`, which CI runs:
  - `UpstreamHasNoChannel` matches the upstream's answer, but not another 503, a 404
    `model_not_found`, or nil.
  - With and without the channel cache, a retry at the top priority skips an excluded
    channel and finds nothing once both channels are excluded. Without the filter's case in
    `model/channel_constraint.go` both assertions fail.
- CI's Go steps (`go vet ./...`, `go test ./common/... ./controller/... ./middleware/...
  ./model/... ./service/...`) pass. `go test ./router/... ./relay/... ./dto/...` passes except
  `TestAccessTokenRouteRulesCoverEveryDashboardRoute`, which fails the same way on `main`.
