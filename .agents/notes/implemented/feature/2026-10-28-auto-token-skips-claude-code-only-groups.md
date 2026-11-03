# Agent Note: An auto token skips Claude Code only groups for other clients

Status: implemented

## Problem

An `auto` token was refused outright when any of its candidate groups accepted
Claude Code only and the request did not look like Claude Code. The group is
chosen later, during channel selection, so the gate could not tell whether the
request would have landed in the restricted group.

The operators are adding GPT, Grok and Gemini groups beside the two Claude
groups and want an `auto` token to reach all of them. With the old rule a
customer's `auto` token, whose candidates include `Claude 满血（仅限CC）`, could
not call GPT from any client but Claude Code.

## Decision

- **A non-Claude Code request drops the restricted candidates.** The gate writes
  the remaining candidates to `ContextKeyTokenAutoGroups`, which
  `service.GetRequestAutoGroups` and so channel selection and cross-group retry
  read. A Claude model request then lands in the next Claude group, such as
  `Claude 满血（可外接）`, at that group's ratio. This matches the relay the
  operators benchmark against, where a non-Claude Code request falls into the
  open group.
- **The request is refused only when no candidate remains**, with the same 403
  and message as before.
- **A version outside the configured bounds counts as not Claude Code** for an
  `auto` token, so it also falls through instead of being refused.
- **An unreadable body is still refused**, as Distribute would refuse it.
- A token on a named Claude Code only group is unchanged.

## Alternatives considered

Not recorded when the change shipped.

## Verification

`TestClaudeCodeOnlyGroupGate` now expects an `auto` token with an open candidate
to pass and one whose only candidate is restricted to be refused.
`TestClaudeCodeOnlyGroupAutoCandidates` checks that Claude Code keeps every
candidate and another client keeps only the open ones.
