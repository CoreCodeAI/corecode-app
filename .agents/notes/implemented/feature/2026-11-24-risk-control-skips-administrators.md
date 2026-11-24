# Agent Note: Risk control skips administrators and root

Status: implemented

## Problem

The risk gate and the violation guard ran for every account. An administrator's request could
be stopped by a hard rule, and each refusal of an administrator was written to
`violation_records` as `exempt`, so the 风控中心 pages listed staff next to customers
([risk gate](2026-10-28-risk-gate.md), [violation guard](2026-10-25-violation-guard.md),
[risk control page](2026-11-07-risk-control-page.md)). On 2026-11-24 the owner decided that
administrators and root are neither stopped nor recorded, and that their earlier rows are not
shown.

## Decision

- **`CheckRiskGate` returns first for role >= `RoleAdminUser`.** The role comes from the
  request context (`ContextKeyUserRole`, written with the rest of the cached user by
  `UserBase.WriteContext`), so the hot path reads nothing new. No stage runs, no event is
  written, no conversation is held, no strike is counted, and the request is not in the
  inbound or per-customer counts. A request whose context has no role is treated as a customer.
- **`applyViolationStrike` returns before writing for an administrator.** The upstream refusal
  still reaches the administrator; it just leaves no record and no in-memory conversation.
  `RecordUpstreamRefusal` keeps its check, so the refusal is not remembered for the
  similarity stage either.
- **History is hidden, not deleted.** `ListRiskGateEvents`, `GetRiskGateSummary` (events and
  hits) and `ListViolationRecords` drop rows whose user is an administrator or root
  (`withoutStaffRows`, a `NOT IN` subquery on `users`, deleted accounts included). Rows with a
  NULL or 0 user id stay. The hourly inbound counts are not per user, so the summary's inbound
  still includes what administrators sent before this release.
- **`ViolationModeExempt` stays** for the 84 `exempt` rows. The queries that exclude it still
  do, and a demoted administrator's old rows still show their label.
- The violation switch's description now says requests from administrators and root skip risk
  control and are not recorded.

## Verification

- `TestRiskGate` and `TestViolationStrikePolicy` cover: an administrator and root pass a hard
  rule and a distillation rule with no event, hold or inbound count while an ordinary customer
  is blocked; administrators' refusals leave no record and are not remembered; lists and the
  summary drop administrators and root and keep rows with no user. On `origin/main` the new
  cases fail.
- Both pass on SQLite 3.50.4, MySQL 8.0.46 and PostgreSQL 16.16.
