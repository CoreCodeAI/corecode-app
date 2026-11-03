# Agent Note: Users choose their own invite code, within reserved words

Status: implemented

## Problem

Only root could replace a user's four random characters with a readable code
(`2026-10-28-root-invitation-page.md`). The operators want every inviter to
choose their own code on the invitations page, but not one that reads as
CoreCode's own (CoreCode, official, support) or a lucky number (888, 666).

## Decision

- **`PUT /api/affiliate/self/code`** sets the caller's code, under the
  affiliate critical rate limit and the `wallet:write` access-token scope.
  Only a user the wallet shows a link to may call it, which is a user with an
  affiliate rate above 0, so the new code binds sign-ups. The invitations page
  opens it from a Customize button beside the link.
- **Reserved codes are refused to users, not to root.** Root's editor keeps
  setting any valid code, so an official channel can still carry the brand.
  A user's code is reserved when, lowercased and stripped of `-` and `_`, it
  equals a word from `affiliate_setting.reserved_code_words` (one per line,
  edited on the root invitation page). A code that only contains a word, such
  as `my-corecode`, is allowed: matching inside codes would also refuse
  ordinary words that happen to contain one (badminton holds admin). The
  default list is corecode, alphafox, anthropic, claude, official, guanfang,
  admin, support and kefu.
  The code is also reserved when it is a simple sequence: one character
  repeated (888, aaa), a consecutive run either way (123, 987, abc), or
  digits drawn from at most two values (6688, 1818). These rules are fixed in
  `AffiliateSetting.CodeReserved`; the word list is the operators' to change.
- **A code given up stays its owner's.** A code that changes is written,
  lowercased, to `affiliate_retired_codes`, and no other account can take it,
  root included. Without this, a user who left their random code behind would
  lose to whoever claimed it next every sign-up the old links still bring. The
  old code still stops binding, as before. The owner may return to it.
- **A user may give up at most five codes themselves.** Each retired code is
  held for good, so the cap stops one account from collecting codes. A change
  of case retires nothing and does not count. Root changes are not capped.

## Alternatives considered

- **Refuse codes that contain a reserved word.** It would also refuse
  ordinary words that hold one, such as badminton.
- **Free a code once its owner changes it.** Whoever claimed it next would
  take every sign-up the old links still bring.

## Compatibility

The new table is created by `AutoMigrate` and is empty on upgrade, so codes
changed before this release are not protected. The server ships before the
console: the console in production calls no new route, and the new console's
Customize button needs the new route.

## Verification

- `go test ./model -run 'TestAffiliate|TestSetUserInviter'` against SQLite
  3.50.4, MySQL 8.0.46 and PostgreSQL 16.15. `TestAffiliateAdminDatabaseMatrix`
  covers reserved and simple codes, a code that only contains a word, root
  bypassing them, retired codes refused to another account, the cap, and case
  changes.
- Startup twice on a fresh database and twice after the `origin/main` build
  created it, on all three; the table and its unique index exist and existing
  codes are unchanged.
- `go test ./middleware ./router ./controller`, `bun run typecheck`, vitest
  for the invitations, affiliates and user dialog features.
