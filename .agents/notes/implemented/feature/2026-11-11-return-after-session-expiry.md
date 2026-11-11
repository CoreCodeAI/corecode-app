# Agent Note: Return to the page after a session expires mid-use

Status: implemented

## Problem

When a request got a 401 and the refresh failed, `redirectToSignIn` in
`web/src/lib/http-client.ts` (upstream code changed by CoreCode) did
`window.location.replace('/sign-in')`. The customer landed on sign-in with no target, so
signing in again took them to `/dashboard`, not the page they were on.

`sanitizeAuthRedirect` also returned a protocol-relative path for a target whose dot
segments normalize to one: `/.//host` and `/%2e//host` parse as the same-origin path
`//host`. Every caller hands the result to TanStack Router's `navigate`, which keeps a
schemeless `href` on the current origin, so no open redirect was shown, but the function's
contract (a same-origin relative path) did not hold.

## Decision

- **Reuse sign-in's `redirect` parameter.** `redirectToSignIn` replaces the page with
  `/sign-in?redirect=<encoded path and search>`. The fragment is left out.
- **The target is checked where it is used, as before.** Sign-in's `beforeLoad`,
  `handleLoginSuccess`, the OTP handoff and the OAuth callbacks run `sanitizeAuthRedirect`,
  and the magic-link endpoint runs `model.SafeMagicLinkRedirect` on the server. The
  interceptor does not check again: anyone can type `/sign-in?redirect=...`, so a check
  where the address is built adds no control.
- **`sanitizeAuthRedirect` rejects a normalized path that starts with `//`**, closing the
  dot-segment case for every caller.
- The cross-tab sign-out in `__root.tsx` still goes to `/sign-in` without a target: the user
  signed out on purpose in another tab, and it is an upstream file.

## Alternatives considered

- **An inline "Your session expired. Please sign in again." notice on sign-in, via
  `reason=expired`.** It was built and tested, and does not fit the first-load budget. The
  sign-in route imports its page directly, so the page, its forms and the route's search
  schema ride in the entry bundle every page downloads. With the notice, `/sign-in`,
  `/dashboard/overview` and `/keys` all went over (by 124 to 199 bytes after the redirect).
- **A helper module building the address, with its own `sanitizeAuthRedirect` check.** It
  cost about 110 bytes on `/keys` against 22 for the inline template.

## Consequences

- First load after this change, in bytes: `/sign-in` 361,408 of 361,472,
  `/dashboard/overview` 540,601 of 540,672, `/keys` 622,569 of 622,592.
- The "Session expired!" toast raised before the navigation still disappears with the
  page, so the user is not told why they are on sign-in. The notice above is the fix once
  the budget has room.
- Changes to `sanitizeAuthRedirect` reach every sign-in and OAuth path.

## Verification

- `bunx vitest run src/features/auth/lib/auth-redirect.test.ts`: the new dot-segment case
  failed before the `//` check (`'/.//attacker.example/path'` returned
  `'//attacker.example/path'`) and passes after it.
- `bunx vitest run src/lib/__tests__/session-expiry.test.ts
  src/features/auth/lib/auth-redirect.test.ts`: 13 passed. The interceptor tests drive a
  real 401 with a failed refresh: on `/usage-logs?type=2&q=prod` the page is replaced with
  sign-in carrying that path; a page address of `//host`, `/.//host` or `/\host` never
  yields a target after sign-in's check; `/%2F%2Fhost` stays a same-origin path. With
  `http-client.ts` and `auth-redirect.ts` reverted, three tests fail.
- `bun run typecheck`, `bun run lint:check`, `bun run format:check`, `bun run build` and
  `bun run first-load:check` pass in `web/`; the byte counts above come from the same
  script printing bytes.
