# Agent Note: Show provider quota windows apart from Claude capacity estimates

Status: implemented

## Problem

The Codex pool account appeared to have used 0% in both a five-hour and a seven-day
window, without reset times. `service/engine_pool.go` read only the engine's
`credentials[].five_hour` and `seven_day`, which belong to Claude quota-budget
admission. The engine already returned Codex's provider observation under
`credentials[].account.windows`; the app discarded it. Missing admission samples
became zero usage through `percent`.

The production observation for account #5012 reported one window: `primary`,
label `7d`, account scope, utilization 0.02, resetting at 1794378753000 ms. A
primary window is therefore not necessarily five hours. The lack of a calibrated
Codex dollar capacity does not imply a lack of provider quota readings.

## Decision

- The pool response adds `accounts[].quota_windows`, preserving each provider
  window's ID, label, scope, utilization ratio, reset time, observation time and
  state. A missing observation produces an empty list; null utilization remains
  unknown, distinct from a reported zero.
- Non-Claude account rows display those windows under remaining quota, including
  scope-specific windows, the remaining percentage, reset time and observation
  time. Missing usage says there is no reading instead of implying a full quota.
- The existing `WindowCell`, meter and tap tooltip render these readings. The bar
  and tooltip still show used percentage, while the cell states remaining
  percentage. Claude keeps its admission budget lines, dollar estimates and
  five-hour/seven-day columns unchanged.
- The explanatory copy distinguishes provider percentages from calibrated dollar
  capacity. No Codex dollar estimate or pool-capacity verdict is invented.

## Alternatives considered

Mapping `primary` to five hours and `secondary` to seven days mislabels the live
Codex window and drops independently limited scopes. Changing the engine is not
needed: its existing `/api/group-concurrency` response contains these readings.

## Consequences

Only the app changes. Release the server before the console, as for other additive
pool fields. An older server gives the new console no quota reading for non-Claude
accounts; an older console continues reading its existing fields. No scheduling,
quota-budget policy, billing or upstream refresh behavior changes.

## Verification

- The backend regression fails before the fix because all four provider windows
  are lost. It then passes, including zero, null, exhausted and scoped readings,
  even when the dollar-estimate endpoint fails.
- The frontend regression fails before the fix because remaining percentages and
  the missing-reading state are absent. The site-insights suite passes all 79
  tests after the fix. Typecheck, lint baseline, format check, locale sync and
  production console build pass.
- A throwaway Go program runs `FetchEnginePool` against captured production engine
  responses with an isolated in-memory SQLite demand table. Account #5012 retains
  the seven-day window with 98% remaining and its reset timestamp.
- The local console, using that projected response through a read-only proxy,
  displays `7d`, 98% remaining and the reset time. Hovering the meter shows 2% used.
  The proxy never forwards authentication refreshes or writes to production.

## Lessons

`check-console-changes-against-production-through-a-read-only-proxy` supplies the
read-only preview and local refresh response. This is a direct projection bug,
covered by regressions; no new reusable lesson is needed.
