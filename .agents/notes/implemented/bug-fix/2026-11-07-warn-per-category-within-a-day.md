# Agent Note: Warn per category, several times a day, before striking a lenient refusal

Status: implemented

## Problem

A refusal in a lenient category was a warning only when the user had no
warning of any category in the 30-day counting window
(`2026-11-01-warn-before-striking-lenient-refusals.md`). The operator made
`cyber` lenient on 2026-11-06 at 15:05 (UTC+8). The production records from
2026-11-01 to 2026-11-07 showed two problems:

- **One warning covered every category.** User 1042 was warned for
  `reasoning_extraction` (record 156). Nineteen minutes later the user's first
  `cyber` refusal suspended the account (record 157).
- **The second incident suspended.** Users 1446 (records 168, 171) and 1050
  (172, 174) were suspended at their second `cyber` incident. The refused
  messages were "继续", a client's runtime notice, and questions about moving
  a desktop login to the CLI. User 959 (164, 175) was suspended the same way;
  that user's first refused message asked for a reverse shell.

A suspension cost these customers more than the refusal itself. The refused
conversation is already held, so a suspension does not protect the pool from
that conversation. Users 1042, 1136 and 1193, new accounts with 1 to 19
requests before their suspension, sent no request after it, even after the
operator lifted it. The operator lifted ten users by hand during that week.

## Decision

- **`violation_guard_setting.lenient_warnings`**, default 2: a lenient refusal
  that starts an incident is a warning while the user has fewer than this many
  incidents of the same category within 24 hours
  (`LenientWarningWindowSeconds`). The next incident of that category is a
  strike and follows the usual suspend and ban steps. 0 strikes the first
  incident.
- **An incident is counted, not a conversation.** `CountViolationIncidents`
  counts `warn`, `strike`, `suspend` and `ban` records of the category. The
  window starts at `forgiven_at` when that is later, so a lift starts the count
  over. A refusal within ten minutes of a warning merges into it, as before.
  One Claude Code action can produce several conversation keys: refusals 164,
  165 and 167 were one turn and its title side requests. Counting conversations
  would therefore suspend on one action.
- **`HasViolationWarning` is gone.** The incident count replaces it.
- **The console** shows a "Warnings per category per day" field. The
  "Warn-first categories" description no longer says "first refusal".

## Alternatives considered

- **Suspend a lenient category only when many users are refused at once.**
  From 13:32 to 14:48 on 2026-11-06 (UTC+8), four users were refused for
  `cyber` within an hour, an administrator included. The operator chose not to
  build this circuit breaker.
- **Keep one warning per 30 days, per category.** That fixes user 1042 but not
  users 1446 and 1050.
- **Judge the refused message with the decision model before striking.** This
  is deferred. One clear request, such as record 127's "要破解软件", now gets
  warnings first.

## Consequences

- Replaying the enforce-mode records under the default, with lifts ignored:
  user 959 is suspended at its third `cyber` incident in a day (16:13 on
  2026-11-07). Users 1042, 1050, 1136, 1193, 1195, 827 and 1446 are only
  warned.
- A customer can be refused in a lenient category twice a day without
  restriction. Each refusal still holds or blocks its conversation, and each
  costs a pool account a refusal. Setting `lenient_warnings` to 1 restores a
  single warning, now within a day and per category.
- A strike still counts toward `ban_strikes` for the whole counting window,
  while warnings restart every 24 hours. With `suspend_hours` 24, the
  suspension outlasts the warning window, so the incident after it is a
  warning again.
- The option row does not exist until it is saved, so production runs on the
  default 2 after the release.

## Verification

- `TestViolationStrikePolicy` passes on SQLite, MySQL 8.0.46 and
  PostgreSQL 17.11 under `-race`.
  - A new case replays user 1042's sequence with `lenient_warnings` 2:
    `reasoning_extraction`, then three `cyber` refusals 20 minutes apart, are
    recorded as warn, warn, warn, suspend, and the account is suspended.
  - The existing case now shows that a day later the warnings start over, while
    the earlier strike still counts toward the ban.
  - With `service/violation_guard.go` and `model/violation.go` reverted, both
    cases fail. The old code suspends at the first `cyber` refusal.
- `go vet` on model, service and setting is clean, and `go test` for common,
  controller, middleware, model, service and setting passes.
- Console: `bun run typecheck` (1,615 files), `lint:check`, `format:check`, and
  `vitest` on system-settings and i18n (29 files, 252 tests) pass.
