# Agent Note: GitHub sign-in links to an existing account by a confirmed address

Status: implemented

## Problem

GitHub sign-in was switched on on 2026-11-11 so that V2EX visitors could register with
it and receive the channel gift. The owner then signed in with GitHub and was refused
with "Email address is already in use".

The GitHub provider copied the user endpoint's `email` into `OAuthUser.Email` and never
set `EmailVerified`. That field is the public profile address, and it carries no
confirmation status. So `linkAccountByVerifiedEmail`
([Google note](../feature/2026-10-23-google-sign-in-and-verified-email-linking.md)) never
ran for GitHub. Registration then found the address taken and refused. Every existing
customer whose GitHub address matched their account hit the same wall. A customer whose
GitHub address was private got a new account with no address at all.

## Decision

`GitHubProvider.GetUserInfo` reads `/user/emails`, which the sign-in's `user:email`
scope already allows. It marks an address confirmed only when GitHub lists it as
`verified`:

- The public address is used when the list confirms it, so a customer who registered
  with that address reaches that account.
- Otherwise the primary confirmed address is used. An account whose public address is
  hidden then gets an address, and it links if a CoreCode account holds it.
- If the list cannot be read, or confirms nothing, the public address is kept
  unconfirmed, as before. The sign-in does not fail because of the extra request.

The linking rules are unchanged and shared with Google: exactly one holder, no
overwriting of an existing GitHub binding, accounts with TOTP or a passkey are sent to
settings, and every link sends the security mail and writes an audit row.

`GetVerifiedEmails`, which the legacy GitHub binding path uses, now reads the same list
through `listEmails`. The API root is a package variable so that tests can serve it.

## Alternatives considered

- **Use only the public address and confirm it against the list.** This fixes the
  owner's case, but a customer with a hidden address would still get an account with no
  email, which cannot receive the sign-in link or any mail.
- **Always use the primary address.** A customer who registered with their public,
  non-primary address would get a second account instead of their own.
- **Fail the sign-in when the list is unavailable.** Before this change GitHub sign-in did
  not depend on the list, so an outage of that one endpoint would newly block it.

## Consequences

- New GitHub accounts may carry the primary address where they used to carry none.
- An existing customer who signs in with GitHub for the first time is linked to their
  account and receives the "login linked" mail. They are not a new invitee, so no channel
  gift is given.
- Each GitHub sign-in makes one more request to GitHub.

## Verification

Run on 2026-11-11 in a worktree at `fix/github-oauth-verified-email`.

- `go vet ./oauth/` is clean. `gofmt -l oauth/ controller/` prints nothing.
- `go test ./oauth/` passes. `TestGitHubProvider_GetUserInfoConfirmsEmailFromTheEmailList`
  covers five cases: the public address confirmed, a hidden address with a confirmed
  primary, an unconfirmed primary, an unconfirmed public address, and a list that returns
  403. It fails when `EmailVerified` is forced to false.
- `go test ./controller/` passes. It includes the provider-independent linking cases in
  `controller/oauth_verified_email_test.go` and the legacy GitHub binding cases.
- No database, schema or console code changed.

OWASP references: ASVS 5.0 V10 (OAuth and OIDC), which says an identity-provider address
is used only when the provider asserts it as verified; the OWASP Authentication Cheat
Sheet on account linking. Not yet verified end to end against GitHub before production.
