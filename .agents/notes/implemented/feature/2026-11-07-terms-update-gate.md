# Agent Note: Ask for the current terms in a dialog and record each acceptance

Status: implemented

## Problem

Sign-up and sign-in carried a consent checkbox that started checked
([2026-10-27](2026-10-27-legal-consent-default-checked.md)). A pre-checked box is weak evidence
that a customer agreed, nothing recorded which version of the terms an account accepted, and a
customer who signed in before the terms changed was never asked again. The owner wants the
pattern apikey.fan uses: the terms open in a dialog as soon as the page loads, and the forms stay
unusable until the visitor agrees.

## Decision

- **Option `legal.terms_version`.** A string, normally the terms page's last-updated date.
  Empty turns the whole gate off and leaves the 2026-10-27 checkbox as it was. `/api/status`
  exposes it as `terms_version`.
- **Sign-in and sign-up pages.** `TermsGate` wraps the forms. Until the visitor agrees, a dialog
  titled "Terms update notice" shows the version, links to the four sections of the terms page
  (`/user-agreement#service`, `#aup`, `#refund`, `#privacy`), and offers "Decline" and "Agree
  and continue". The forms sit in a disabled `fieldset`, which disables every input, the submit
  buttons, OAuth, magic-link and passkey buttons at once. Declining closes the dialog, shows a
  toast, and leaves a notice with a "View terms" button that reopens it. Agreeing stores
  `{version, accepted_at}` under `corecode_terms_consent` in localStorage; a stored consent for
  the current version skips the dialog. The checkbox is hidden while the gate is on.
- **`/user-agreement` forwards its anchor.** When the agreement is configured as a URL without
  an anchor, the route appends the one it was opened with, so the dialog's links land on the
  right section of `/docs/terms/`.
- **Server record.** `POST /api/user/terms/consent` with `{version}` stores a
  `user_terms_consents` row: user, version, time, client IP, and user agent (cut to 255
  characters). It refuses a version other than the current one, and accepting the same version
  again keeps the first row as the evidence (unique on user and version). The route is
  session-only: an access token cannot accept terms for a person. The self DTO used by
  `GET /api/user/self`, sign-in and refresh carries `terms_version`: the current version when
  the user has accepted it, otherwise empty.
- **Signed-in console.** `TermsConsentPrompt` in the authenticated layout compares the user's
  `terms_version` with the live status. When they differ and the browser holds a consent for
  the current version, it posts that consent without asking. Otherwise it shows the same dialog
  with no close button, no Escape and no outside click. Agreeing records the consent; declining
  signs the customer out.

## Alternatives considered

- **Keep consent in localStorage only, as apikey.fan does.** Least code, but it leaves no
  evidence on our side of who accepted which version. Rejected.
- **A `terms_version` column on `users`.** One read fewer, but upstream code saves whole user
  rows in places, which could write an empty value over it, and the column keeps no history.
  The consent table answers the same question with one indexed lookup.
- **Thread the version through every sign-in and registration request.** Password, magic link,
  OAuth and passkey would each need a new field and check. Recording from the signed-in console
  covers all of them, including a mailed link opened in another browser.
- **Refuse sign-in on the server until the terms are accepted.** It would lock out the
  automation that signs in by API or access token: `corecode-infra`'s `init-relay.sh` and deploy
  scripts (lesson `find-automation-that-signs-in-before-disabling-a-login-method`). The gate is a
  consent record, not an authentication control, so no server path waits on it.

## Consequences

- The terms dialog and the signed-in prompt load lazily, so `/dashboard/overview` keeps its
  first-load budget. The sign-in gate itself must disable the forms before the dialog arrives,
  so `/sign-in` carries it and its budget rose from 351 KB to 352 KB.
- API keys keep working for a customer who has not accepted new terms; the terms state that API
  use continues under the updated version. Only the console asks.
- An operator who sets a new version is asked on their next console load as well.
- The 2026-10-27 checkbox stays the behavior while `legal.terms_version` is empty.
- Release order: the server ships first (a console without the server field treats the gate as
  off), then the console, and `corecode-infra` sets `legal.terms_version` last, after the terms
  page carrying that date is live.

## Verification

- `TestAcceptTermsConsent` passes on SQLite, MySQL 8.0 and PostgreSQL 16 (containers): an empty
  option and a stale version are refused, the first acceptance stores IP and user agent, a repeat
  adds no row and keeps the first time, and a new version asks again.
- Removing the route's token rule fails `TestAccessTokenRouteRulesCoverEveryDashboardRoute`.
- `terms-gate.test.tsx` covers the disabled forms, decline and reopen, stored consent for the
  current and an older version, the gate off, the silent record after sign-in, the
  non-dismissible prompt, sign-out on decline, and an older server. Re-enabling the fieldset,
  making the signed-in dialog dismissible, or dropping the silent record each fails its test.
- `go build ./...`, `go vet` and `go test` on `controller`, `model`, `router`, `middleware` and
  `setting/system_setting`; `bun run typecheck`, `bun run format:check`, `bun run lint:check`
  and `bunx vitest run` (270 files, 2935 tests) pass.
