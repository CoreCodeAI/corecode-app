# Agent Note: Report the vendor's failure when a task retry finds no channel

Status: implemented

## Problem

On 2026-11-11 a video vendor had no capacity and answered every submission with 503 `{"error":{"message":"No eligible … accounts", …}}`. new-api retried the same channel, the only one serving the model in the `auto` group, twice more (`retry: 10->10->10`). Its next channel selection found nothing. The client then got this answer:

```
500 {"code":"get_channel_failed","message":"分组 auto 下模型 wan-3.0-480p 的可用渠道不存在（retry）"}
```

The message blamed routing. It did not say the vendor was out of capacity, or that the submission had been refunded. A customer could not tell whether to wait, change models, or report a fault.

Each attempt also rebuilt the request body. A file placeholder with `encoding: "url"` uploaded the same file to the bucket once per attempt, three times for one request.

## Decision

- **Keep the cause.** In `executeTaskSubmissionWith`, a channel selection that fails after an attempt keeps the previous attempt's error. The client gets the vendor's status and body, not `get_channel_failed`. A selection that fails before any attempt still reports `get_channel_failed`.
- **Explain a vendor 5xx.** `respondTaskSubmissionError` rewrites the message of a non-local 5xx submission error. It becomes `relay.task_upstream_unavailable`: 「生成服务暂时不可用，本次未扣费，请稍后重试」 in zh-CN, with matching text in en and zh-TW. The vendor's `error.message` (or `message`, or the plain text) follows in parentheses, capped at 200 characters. "Nothing was charged" holds because a submission that fails before its task row is written refunds its reservation before answering. Local errors and 4xx answers keep their message: a 4xx is the client's to fix, and its message says how.
- **Upload once per request.** `inlineJSONFilePlaceholders` keeps a per-request map in the gin context, from file reference and media type to uploaded URL. An attempt that rebuilds the body reuses the URL. Size and total-budget checks still run on every attempt.

## Alternatives considered

- **Exclude a channel that failed from the retry's selection.** It changes routing for every relay mode. A multi-key channel can succeed on a retry with another key, so a blanket exclusion would cost real retries. Keeping the cause fixes what the client sees without touching selection.
- **Stop retrying a 503.** `AutomaticRetryStatusCodes` is an operator setting that covers chat as well. A 503 from a gateway that load-balances its own accounts can succeed a second later.
- **Map vendor error types to messages in the task plugin.** The plugin host has no hook for a non-2xx submit reply, and a generic message covers every vendor.

## Consequences

- A failed video or image-task submission now answers with the vendor's status (for example 503), not 500.
- The client-facing message for a vendor 5xx is localized, and the vendor's own text is shown in parentheses. A vendor whose error text names itself would show its name. Our current vendor's text names the model family only.
- A request still makes `RetryTimes + 1` attempts against a single failing channel, but each file is uploaded only once.

## Verification

- `controller/relay_task_retry_error_test.go`:
  - A 503 attempt followed by a failed selection returns `fail_to_fetch_task` with 503 and the vendor body, and refunds once. Before the change it returned `get_channel_failed` with 500; this was checked by reverting the change and rerunning.
  - A selection that fails before any attempt still returns `get_channel_failed`.
  - The rewritten message, plain-text 5xx bodies, and the untouched 4xx and local errors.
- `relay/channel/task/jsplugin/adaptor_test.go`: two body builds on one request store the file once and send the same URL; another request uploads again.
- `go test ./controller/ ./relay/... ./i18n/... ./service/... ./pkg/... ./plugins/...`: 5030 pass. The two failures are `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails the same way on `main` behind a local proxy that rewrites DNS errors.
