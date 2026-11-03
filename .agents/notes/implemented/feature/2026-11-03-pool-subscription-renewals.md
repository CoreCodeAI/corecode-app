# Agent Note: Show when each pool subscription renews

Status: implemented

## Problem

The operators renew the pool's Claude subscriptions by hand and had no place that said when
each one next bills. The engine reports a period end per account on
`GET /api/group-concurrency`: reported by the provider for Codex and Devin, and for Claude
either entered by an operator or estimated monthly from the subscription start. The first
release had only the estimate, and it showed 11-29 for a Max seat whose billing page says
Nov 9. Claude reports no billing date to the engine's OAuth tokens. The reasoning is in
corecode-engine's `2026-11-03-estimate-claude-subscription-renewal.md`.

## Decision

- **`EngineAccount` passes the engine's fields through**: `organization`,
  `organization_uuid`, `subscription_status`, `subscription_state` and
  `subscription_period_end_ms`. The console does no date arithmetic; the engine owns it, so
  both consoles agree.
- **An email inside the organization is masked like the account's.** A personal Claude
  organization is named after its owner's email, and the panel shows masked emails
  everywhere else.
- **The pool tab gains a Subscription renewals panel** for the selected provider: one row
  per organization, because a team's seats share one subscription, sorted soonest first, with
  the days left in red within seven days. An estimated date is labeled as such, and a
  subscription status other than active is shown beside the name.
- **The operator enters the date on the panel.** A calendar button on each row with an
  organization UUID opens a date input; saving calls
  `PUT /api/site-insights/pool/subscription-renewals/:organization_uuid` (root only, access
  token scope `ops:write`), which forwards to the engine's
  `PUT /api/subscription-renewals/:organization_uuid` and drops the cached pool. Clear
  removes an entered date.
- **Days left count from the pool's `observed_at_ms`**, the instant the engine computed the
  dates, not the browser clock.

## Alternatives considered

**One row per account.** Team-AlphaFox alone would list the same date four times.

**Compute the renewal in new-api from the subscription start.** It would duplicate the
engine's rule and drift from the engine console the operators also read.

**Enter the date in the engine's console.** The operators read renewals on this dashboard;
the engine's console would need a tunnel to reach.

## Consequences

- Against an engine without these fields, every account has no date and the panel is
  hidden, and without `organization_uuid` the calendar button is absent, so either side can be
  released first.
- An organization without an entered date still shows the estimate, which a plan change
  makes wrong.

## Verification

- `TestFetchEnginePool` reads the fields, masks the email in the organization, and leaves an
  account without an observation at no date. `TestSetEngineSubscriptionRenewal` checks the
  forwarded method, path, key and body, and that the cached pool is dropped.
- `TestAccessTokenRouteRulesCoverEveryDashboardRoute` covers the new route's scope.
- `subscription-renewals-panel.test.tsx`: two seats of one team are one row, rows sort by
  date, an estimated date is labeled, the seven-day warning names the subscription, a
  non-active status shows, only a row with an organization UUID offers the editor, saving
  sends the organization and date, and the panel is absent without dates.
- `go test ./service/ ./controller/ ./router/ ./middleware/` (one failure,
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, also fails on main), `bun run typecheck`,
  `bun run lint:check`, `bun run format:check`, `bun run test src/features/site-insights`,
  and `bun run i18n:sync` with no missing keys.
