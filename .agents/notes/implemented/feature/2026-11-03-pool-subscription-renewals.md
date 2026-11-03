# Agent Note: Show when each pool subscription renews

Status: implemented

## Problem

The operators renew the pool's Claude subscriptions by hand and had no place that said when
each one next bills. The engine now reports a period end per account on
`GET /api/group-concurrency`: estimated monthly from the subscription start for Claude, and
reported by the provider for Codex and Devin. Its reasoning is in corecode-engine's
`2026-11-03-estimate-claude-subscription-renewal.md`.

## Decision

- **`EngineAccount` passes the engine's fields through**: `organization`,
  `subscription_state` and `subscription_period_end_ms`. The console does no date arithmetic;
  the engine owns the estimate, so both consoles agree.
- **An email inside the organization is masked like the account's.** A personal Claude
  organization is named after its owner's email, and the panel shows masked emails
  everywhere else.
- **The pool tab gains a Subscription renewals panel** for the selected provider: one row
  per organization, because a team's seats share one subscription, sorted soonest first, with
  the days left in red within seven days. An estimated date is labeled as such.
- **Days left count from the pool's `observed_at_ms`**, the instant the engine computed the
  estimate, not the browser clock.

## Alternatives considered

**One row per account.** Team-AlphaFox alone would list the same date four times.

**Compute the renewal in new-api from the subscription start.** It would duplicate the
engine's rule and drift from the engine console the operators also read.

## Consequences

- Against an engine without these fields, every account has no date and the panel is
  hidden, so either side can be released first.
- The estimate shares the engine's limits: an annual plan or a cancelled subscription is not
  detected.

## Verification

- `TestFetchEnginePool` reads the three fields, masks the email in the organization, and
  leaves an account without an observation at no date.
- `subscription-renewals-panel.test.tsx`: two seats of one team are one row, rows sort by
  date, an estimated date is labeled, the seven-day warning names the subscription, and the
  panel is absent without dates.
- `go test ./service/ ./controller/` (one failure, `TestUpstreamAddressesMaskOnlyConfiguredAddresses`,
  also fails on main), `bun run typecheck`, `bun run lint:check`, `bun run format:check`,
  `bun run test src/features/site-insights`, and `bun run i18n:sync` with no missing keys.
