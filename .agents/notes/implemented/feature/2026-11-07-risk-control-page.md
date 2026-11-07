# Agent Note: Put violation handling and the risk audit on one admin page

Status: implemented

## Problem

The two controls that restrict customers lived as sections of System Settings → Security:
`/system-settings/security/violation-guard` (the violation records and their settings) and
`/system-settings/security/risk-gate` (the risk audit's counters, its event log and its
settings). Both are read daily, not configured once, yet reaching either took three clicks
through a settings tree that is otherwise about rate limits and SSRF. The owner asked for one
panel beside Site Insights in the Admin group.

## Decision

- **Route `/risk-control`, root only.** The sidebar's Admin group lists "Risk Control"
  (风控中心) right after Site Insights, with `requiredRole: SUPER_ADMIN`, and the route's
  `beforeLoad` sends anyone else to `/403`, as `/site-insights` does. Saving either form writes
  `/api/option`, which is root-only on the server, so a lower role would see forms it cannot
  save.
- **One page, no tabs.** The page first shipped with a tab for each control. The operator asked
  for one screen, since the two are read together: the risk audit's counters and intercept log
  come first (`#audit`), the violation records next (`#violations`), and each control's form
  last, in collapsed panels titled "Usage policy violations · Settings" and "Risk audit ·
  Settings". Both tables page below themselves (`paginationInFooter={false}`); in the page
  footer their two paginations would share one bar.
- **The existing components move unchanged.** The page imports the forms, the records table and
  the dashboard from `features/system-settings/{violation-guard,risk-gate}`. Only the two
  `*-section.tsx` wrappers are deleted, along with the sections' registry entries, their keys in
  `SecuritySettings`, and their defaults in the security page.
- **Save buttons stay with their form.** The forms render their buttons through
  `SettingsPageFormActions`, which portals into a `SettingsPageProvider` container. The page
  gives each settings panel its own provider whose container is the panel's header, so a button
  appears beside the form it saves and leaves when the panel closes.
- **Defaults keep their identity.** Both forms call `form.reset` whenever `defaultValues`
  changes identity. The panel memoizes `getOptionValue(...)` on the options payload, so a
  re-render does not wipe an unsaved edit. A test types into a field, re-renders the page, and
  fails without the memo.
- **Old links still land.** The security route's loader redirects `violation-guard` to
  `/risk-control#violations` and `risk-gate` to `#audit`, as it already does for
  `sensitive-words`.

## Alternatives considered

- **A tab on Site Insights.** Site Insights is a read-only dashboard with a day-range control;
  these views carry editable settings and their own pagination, and Site Insights already has a
  "Risk" tab about sign-up abuse. A separate page keeps the two apart.
- **Settings on a page of their own.** The folded panels keep the forms out of the way without
  taking them away from the records they govern.
- **One merged timeline of both record kinds.** It reads best for one customer, but needs a new
  server endpoint that pages across two tables. The page order gives most of it without one.
- **Move the components into `features/risk-control/`.** A larger diff with no change in
  behavior; the import paths can move later if the settings tree stops using them.

## Consequences

- System Settings → Security now lists rate limiting, SSRF and token limits only.
- The page reads `/api/option/` once for both forms, through the same `system-options` query
  the settings pages use, so a save in either place refreshes the other.

## Verification

From `web/`: `bun run typecheck` (a planted error failed it first), `bun run format:check`,
`bun run lint:check`, `bun run test` (271 files, 2938 tests), `bun run build`, and
`bun run first-load:check`. First-load sizes against `origin/main`: `/sign-in` 351.0 → 351.1 KB,
`/dashboard/overview` 525.0 → 521.2 KB, `/keys` 605.1 → 601.3 KB.

In a browser, against production data through a read-only proxy (every non-GET answered
locally, none sent): `/system-settings/security/violation-guard` redirected to
`/risk-control?tab=violations`; the records listed 179 entries; the settings panel opened with
the live values and its "Save violation settings" button in the panel header; the audit tab
showed today's counters and 174 events.
