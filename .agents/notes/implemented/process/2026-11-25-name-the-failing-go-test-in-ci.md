# Agent Note: Name the failing Go test in CI, and stop the large-body wait test from flaking

Status: implemented

## Problem

The `check` job piped `go test` through `tail -40`. When a test failed, the last 40 lines ended at `FAIL github.com/QuantumNous/new-api/middleware` and never named the test. The middleware package failed on main on 2026-11-22, 2026-11-24 and 2026-11-25 (the last one blocked the release of PR 395 until a re-run), and none of those logs said which test failed.

Running the package's test binary 80 times in parallel reproduced one failure: `TestLargeBodyWaitsUntilAnEarlierOneFinishes` recorded a wait of 199 ms where it requires 200. The gate measures the wait from the moment the second request reaches it. The test started its 200 ms "not admitted" timer right after starting that request's goroutine, so on a loaded runner the request reached the gate a few milliseconds late and recorded less than the test waited.

## Decision

- **CI keeps the whole output in a file.** On success it prints the last 40 lines as before. On failure it prints every `--- FAIL`, `panic:` and `FAIL` line with the 30 lines after it, up to 400 lines, and fails the step. Checked with a planted failing subtest: the output names the test, the subtest and the message.
- **The test waits until the second request is queued** before it starts the timer (`requireQueued`). `golang.org/x/sync/semaphore` admits waiters in order, so `TryAcquire(1)` fails while a request waits even with room left; the helper polls that and releases the byte when it succeeds.

## Verification

- With a 50 ms delay injected before the second request reaches the gate (not committed), the old test failed (150 ms recorded) and the new one passed.
- Under CPU load, 240 runs each: the old test failed once, the new one never.
- `go test ./middleware` and `go vet ./middleware` pass.

Other failures seen with `go test -count=40` (`TestRedisFailurePolicies`, the redis case of `TestModelRateLimitStreamFailuresDoNotConsumeSuccessLimit`, `TestTaskArtifactAccessRejectsTamperedAndEmptyCapabilitiesAsNotFound`) come from state kept between repeats in one process; none failed in 80 fresh runs. If CI names one of them later, it is a separate fix.
