# Agent Note: Stop forwarding a customer's client checks after five refusals in a day

Status: implemented

## Problem

`2026-11-01-keep-client-check-refusals-uncounted.md` records a refused client
check, a `<transcript>` turn such as Claude Code auto mode's check before a
tool call, as `client_check` and holds its conversation. The hold does not stop
the next check: each one carries a longer transcript, so its conversation key
is new and it goes upstream again. On 2026-11-03 user 621 sent eight such
checks between 20:44 and 21:24 Beijing time; every one went to the same pool
subscription account (engine credential 8) and was refused as
`reasoning_extraction`. The pool account takes each refusal, and the customer
gains nothing from a check that is refused every time.

## Decision

- **`ClientCheckLimit`** (`violation_guard_setting.client_check_limit`,
  default 5, 0 turns it off): once the upstream has refused this many of a
  customer's client checks within `ClientCheckWindowSeconds` (24 hours), the
  guard stops the customer's next client check before any channel is used,
  with 403 `violation_client_check_blocked`. The message says the checks do
  not count as violations and names the client settings that cause them.
- **`clientCheckRequest`** recognizes a check before it is sent: its latest
  human message starts with `<transcript>`, the same excerpt shape
  `clientCheckRefusal` matches after a refusal. A request carries no refusal
  category, so the shape alone decides. Only customers whose checks were
  already refused are affected, and only those requests; every other request
  of theirs passes.
- **The count lives with the guard state**: loaded from `client_check` records
  of the last 24 hours on first use, appended when one is recorded, cleared by
  `ForgiveViolations`. Exempt administrators' records do not count. Observe
  mode only logs.
- **Nothing is recorded for a stopped check**: it never reached the upstream,
  so there is no refusal. The risk gate records it as a `refusal_cache` hit
  with rule `client_check`, as it does the guard's other verdicts.

## Alternatives considered

- **Count over the strike window (30 days).** A customer who removes the
  setting stops sending checks either way, but one who does not would lose
  auto mode's separate checks for a month after a bad afternoon. A rolling day
  caps what one customer costs the pool at five refusals a day.
- **Hold the session, not the conversation.** Claude Code's checks carry no
  stable session field the guard reads today; the transcript grows, so neither
  the conversation key nor the excerpt repeats.
- **Stop every `<transcript>` request outright.** Most checks are answered;
  only the refused ones cost the pool account.

## Consequences

- A capped customer's auto mode gets a 403 for each separate check until the
  oldest refusal in the window is a day old. How Claude Code shows that error
  was not tested; the fix stays the same: remove
  `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` and `CLAUDE_CODE_AUTO_MODE_SERVER=0`
  so the server reviews actions, or leave auto mode.
- corecode-infra's customer docs describe the 403 and the limit; they ship
  after this change.
- The count is in process memory like the rest of the guard state; a
  restart reloads it from the records.

## Verification

- `go test -race -p 1 ./service/ -run 'TestViolation|TestRiskGate'` on SQLite
  3.50.4, MySQL 5.7.44 and PostgreSQL 9.6.24 (throwaway containers through
  `TEST_MYSQL_DSN` and `TEST_POSTGRES_DSN`). The new case, with a limit of 3:
  two refused checks still forward the next check; the third stops it with
  `violation_client_check_blocked` while the customer's other requests pass and
  all three records stay `client_check`; the count survives a reload; observe
  mode and a limit of 0 forward; forgiving clears it live and on reload; checks
  refused before the window do not count; the customer's own lenient refusals
  do not count. With the count forced to 0 the case fails.
- `go build ./...`, `go vet ./service/ ./model/ ./setting/... ./i18n/`, and
  `go vet ./types/` in `relaykit`.
- Console: `bun run typecheck`, `bun run format:check`, `bun run lint:check`,
  `bunx vitest run src/features/system-settings src/i18n` (247 tests) and
  `bun run build`; `bun run i18n:sync` changes nothing further.
