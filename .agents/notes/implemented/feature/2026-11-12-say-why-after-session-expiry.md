# Agent Note: Say why the customer is on sign-in after a session expires

Status: implemented

## Problem

`2026-11-11-return-after-session-expiry.md` made an expired session return to its page
after signing in again. The customer was still not told why they were on sign-in: the
"Session expired!" toast is raised just before the page is replaced and goes with it.
The notice was built then and held back, because it did not fit the first-load budget.
The budget has since gone up 2 KB a page
(`../process/2026-11-12-raise-the-first-load-budget-by-2-kb.md`).

## Decision

- `redirectToSignIn` adds `reason=expired` to the address it already builds:
  `/sign-in?redirect=<page>&reason=expired`. The value is `SESSION_EXPIRED_REASON` in
  `lib/session-expiry.ts`, which the interceptor writes and the sign-in page reads.
- The sign-in page shows "Your session expired. Please sign in again." (登录已过期，请重新
  登录。) under its heading, as a `role="status"` line, when the address carries exactly
  that reason. It stays when the customer switches to the password form.
- The page reads the reason from the location, not from the route's search schema, so
  the schema in the entry bundle does not grow.
- The reason selects a fixed sentence. It is never rendered, stored or sent anywhere,
  and it has no part in where sign-in goes afterwards: that is still the `redirect`
  target after `sanitizeAuthRedirect`.

## Alternatives considered

- **Add `reason` to the route's `validateSearch`.** Route options ride in the entry
  bundle; reading the location costs the entry nothing.
- **Show the notice for any `reason`.** Anyone can type the parameter, so only the one
  known value shows the one known sentence.

## Consequences

- Typing `/sign-in?reason=expired` shows the notice to someone whose session did not
  expire. It claims nothing more than "sign in again".
- First load, in bytes, with the three other changes in the same pull request:
  `/sign-in` 361,634 of 363,520, `/dashboard/overview` 540,922 of 542,720, `/keys`
  623,193 of 624,640.

## Verification

OWASP ASVS 5.0.0 V3 (unvalidated redirects) and the Session Management Cheat Sheet apply
to the path; no session, token or cookie handling changed.

- `auth/__tests__/session-expired-notice.test.tsx`: the notice shows for
  `reason=expired` and not for `reason=forged` or no reason.
  `lib/__tests__/session-expiry.test.ts`: a 401 whose refresh fails replaces the page
  with an address carrying `reason=expired`. With `sign-in/index.tsx` and
  `http-client.ts` from main, 2 of those 8 tests fail.
- Headless Chrome against a local server, signed in as a customer: with every API
  request and the refresh answered 401, opening the usage logs landed on
  `/sign-in?redirect=%2Fusage-logs%2Fcommon&reason=expired` with the notice shown;
  `/sign-in?reason=forged` and `/sign-in` showed none; signing in with the password form
  went to `/usage-logs/common`.
