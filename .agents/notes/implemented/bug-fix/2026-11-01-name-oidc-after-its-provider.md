# Agent Note: Name the OIDC provider after the site's configuration everywhere

Status: implemented

## Problem

CoreCode configures Google sign-in through new-api's OIDC slot. The sign-in
page already labels the button with `oidc_display_name` ("Google") and shows
Google's mark when the authorization endpoint is Google's. The security page's
account bindings, the login-session and audit labels, and the OAuth callback
screen still said "OIDC", so a customer who signed in with Google saw an
unfamiliar protocol name where they expected Google.

## Decision

- `oidcProviderName(status)` and `isGoogleOIDC(status)` in `web/src/lib/oauth.ts`
  are the one rule: the configured display name, else "OIDC"; Google's mark
  only when the authorization endpoint starts with `https://accounts.google.com/`,
  never from the editable name.
- The sign-in buttons, account bindings and callback screen use them. The
  session and audit labels, which are plain functions, read the cached status
  (`readCachedStatus`) and fall back to "OIDC" when there is none.

## Alternatives considered

- **Show Google's mark from the display name.** The name is editable, so any
  provider named "Google" would carry Google's mark; the authorization
  endpoint is not.

## Verification

- Vitest: the binding row reads "Google" with no "OIDC" when the status names
  Google; a login method `oauth:oidc` reads "OAuth · OIDC" without a cached
  status and "OAuth · Google" with one. `src/features/security` and
  `src/features/auth`: 21 files, 188 tests passed.
- `bun run typecheck`, `bun run lint:check`, `bun run format:check`.
