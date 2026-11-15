# Agent Note: Stop an unchanged resend of a held conversation

Status: implemented

## Problem

A lenient refusal holds its conversation, and a second refusal blocks it
(`2026-11-04-hold-a-lenient-refused-conversation.md`). The hold was meant to let the
customer continue the conversation at the cost of at most one more refusal. In
production, that one extra refusal was mostly not the customer continuing: it was the
same request sent again with no new human message, within seconds.

Production `violation_records` from 2026-10-16 to 2026-11-15, enforce mode, customers
only (266 refusals):

- 46 repeated a conversation key with the same excerpt and the same prompt token count
  as its first refusal, 43 of them under 60 seconds later. User 2919 on 2026-11-11 shows
  the pattern: records 225/226, 227/228 and onwards come in pairs two seconds apart, with
  distinct request ids and identical prompt tokens.
- Each such resend reached a pool account and was refused again. It also turned the hold
  into a block, so a customer who wanted to continue with a new message could no longer
  do so.

## Decision

- **`violationGuardVerdict` stops a request whose last conversation key is a held
  conversation.** The last key equals the held key only when the request carries no
  human message after the refused one; a continuation adds a message, changes the last
  key, and passes as before. The check reads the existing in-memory state, which is
  rebuilt from `violation_records` after a restart, so it needs no schema change.
- **The answer is 403 `violation_conversation_blocked` with the new message
  `violation.resend_blocked`**, which tells the customer to edit the last message or
  send a new one. The error code is reused so clients and dashboards that key on it keep
  working; the risk gate records the verdict as `refusal_cache` / `resend`.
- **The stopped resend is not a refusal**, so it records nothing and leaves the
  conversation held.

## Alternatives considered

- **Block the conversation at the first lenient refusal.** Removes the extra refusal
  and the continuation with it, which is what the hold exists to keep.
- **Compare the request size as well as the key.** The replay matched size and excerpt
  together; the key alone already implies no new human text, and tool results do not
  follow a refused turn, so the extra state was not needed.

## Consequences

- Replaying the 30 days above through the guard's rules, this removes about 45 of 248
  simulated refusals (18%) and adds no suspension or ban.
- A customer who retries the identical message by hand after a lenient refusal gets the
  403 rather than a second refusal.

## Verification

- `go test ./service/ -run TestViolation` passes; the new assertions in
  `TestViolationStrikePolicy` ("a lenient refusal holds its conversation…") fail against
  `origin/main`'s `service/violation_guard.go`. Only the sqlite dialect ran locally.
- `go test ./i18n/ ./controller/` pass. `go test ./service/` also fails
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails the same way on
  `origin/main` in this environment.
