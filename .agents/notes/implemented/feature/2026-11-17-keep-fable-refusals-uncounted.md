# Agent Note: Keep Fable's lenient refusals off the customer's record, and pause Fable after three

Status: implemented

## Problem

On 2026-11-17, user 4089 paid $50 and edited a Chinese manuscript through
Hermes Agent (`OpenAI/Python`, `/v1/chat/completions`, a system prompt and
tools of about 31K tokens). Fable refused the first request of every new
conversation as `cyber`: records #424, #426 and #430 between 18:28 and 21:25
Beijing time, five refusals in all. The last one's only human text was
`test`. Opus 5.5 answered the same context in more than 40 requests. `cyber` is
a lenient category with two warnings a day (corecode-infra's
`.agents/notes/implemented/process/2026-11-06-warn-before-suspending-cyber-refusals.md`), so #430 suspended the customer for three hours, on every
model. An operator lifted the suspension and refunded the $11.56 the refused
requests had cost.

The excerpt shows only the latest human message, but the upstream judges the
whole request. Over the 14 days before this change, `cyber` records per request
were:

| Model | Records / requests | Rate |
|---|---|---|
| claude-fable-5-2 | 21 / 11,499 | 0.18% |
| claude-fable-5-1 | 4 / 2,499 | 0.16% |
| claude-opus-5-5 | 74 / 311,601 | 0.024% |
| claude-sonnet-5-5 | 12 / 91,559 | 0.013% |

Fable's other `cyber` excerpts were also a client's context or small talk:
`Reply exactly OK.`, `你好`, `继续`, a session-title prompt, and a runtime-context
snapshot. Fable's classifier refuses agent clients' context about seven times as
often as Opus's, so a Fable refusal says little about what the customer asked.

## Decision

- **`UncountedModels`** (`violation_guard_setting.uncounted_models`, default
  `claude-fable`) lists model name prefixes, compared case-insensitively. When
  one of these models refuses a request in a lenient category, the refusal is
  recorded as the new action `model_refusal`. Like `client_check`, it neither
  starts nor joins an incident, so it uses no warning and counts toward no
  suspension or ban. Its conversation is still held, and a second refusal of
  that conversation still blocks it. A category that is not lenient, such as
  `bio`, counts on Fable as on any other model. A `<transcript>` check stays
  `client_check`.
- **`ModelRefusalLimit`** (`violation_guard_setting.model_refusal_limit`,
  default 3, 0 turns it off) bounds what the pool account takes. Once the
  upstream has refused this many of a customer's requests to the uncounted
  models within `ModelRefusalWindowSeconds` (24 hours), the guard stops the
  customer's next request to any of those models before a channel is used,
  with 403 `violation_model_refusal_blocked`. The message names the model, says
  the refusals do not count, and suggests `claude-opus-5-5`. The customer's
  other models pass.
- **The count lives with the guard state.** It loads on first use from the
  last 24 hours of `model_refusal` records, through
  `GetRecentUncountedRefusals`, which now serves both uncounted actions. It is
  appended to when a refusal is recorded and cleared by `ForgiveViolations`.
  Exempt administrators are left out. Observe mode only logs. The risk gate
  records the stop as a `refusal_cache` hit with rule `model_refusal`.
- **The similarity set leaves `model_refusal` out**, in
  `GetRecentRefusedExcerpts` and when a refusal is remembered. Otherwise a
  refused `test` or `你好` would mark other customers' identical messages.
- **The console** shows the action as "Model refusal (not counted)" and adds
  both settings to System settings → Violations.

## Alternatives considered

- **Take `cyber` out of the guard for every model.** On Opus, Sonnet and Haiku,
  `cyber` still marks the requests worth reviewing, and their rates are a
  seventh of Fable's.
- **Raise `lenient_warnings`.** The setting has no model scope. It would also
  soften every other model, and on Fable it would only delay the suspension.
- **Uncount Fable refusals without a limit.** A customer whose client context
  Fable always refuses would cost the pool account a refusal for every new
  conversation, and would not learn why.
- **Store the start of the system prompt with the record.** Rejected earlier,
  for the retained customer content; this decision does not depend on it.

## Consequences

- A customer who really asks Fable for an attack is refused by the upstream up
  to three times a day without a strike, and then cannot reach Fable for the
  rest of the window. The same request to Opus counts as before.
- The 403 tells a Hermes-like client's user to switch models. Whether each
  client shows the message was not tested.
- corecode-infra's `relay-watch.py` words each action in its digest. Until its
  `VIOLATION_ACTIONS` names `model_refusal`, the digest prints the raw action.
  `model_refusal` is not in `VIOLATION_PUSH`, so it never pages.
- Rollback: set `violation_guard_setting.uncounted_models` to empty. The
  existing `model_refusal` records then stay uncounted, and later refusals count
  as before.

## Verification

- `go test -race -p 1 ./service/ -run 'TestViolation|TestRiskGate'` on SQLite
  3.50.4, MySQL 5.7.44 (utf8mb4) and PostgreSQL 9.6.24, with no skips. The new
  case replays user 4089:
  - Three Fable `cyber` refusals are `model_refusal`. Fable is forwarded after
    two and stopped after three, for both 5-2 and 5-1 and in any case.
  - Opus passes, and `test` stays out of the similarity set.
  - The count survives a reload. Observe mode and a limit of 0 forward.
    Forgiving clears the count, live and on reload.
  - A held conversation continues and is blocked on a second refusal.
  - The customer's first Opus `cyber` refusal still warns, and a Fable `bio`
    refusal still suspends.
  - With `modelRefusal` returning false, the case fails and the third Fable
    refusal suspends the customer, as on 2026-11-17.
- `go build ./...` and `go vet ./service/ ./model/ ./setting/... ./i18n/`, plus
  `go vet ./types/` in `relaykit`. `go test ./setting/... ./i18n/ ./model/
  ./controller/` passes.
- Console: `bun run typecheck`, `bun run format:check`, `bun run lint:check`,
  `bunx vitest run src/features/system-settings src/i18n` (291 tests) and
  `bun run build`. `bun run i18n:sync` changed nothing further.
