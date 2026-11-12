# Agent Note: A root user can let one inviter earn commission on their own network

Status: implemented

## Problem

User #9 is a partner. The owner agreed to discount their spending by letting them invite their own second account, #19, and earn their 30% distributor rate on what #19 pays for. Since 2026-11-08 [no commission is paid on an account that shares the inviter's address](../bug-fix/2026-11-08-newcomer-plan-one-per-address.md). #9 and #19 sent requests from the same six addresses, so #9's last commission from #19 was on 11-07. Up to 2026-11-12, ¥450 of #19's paid use settled without commission, which is ¥135 at 30%. Settlement still moves the referral's marks when it skips a credit, so the skipped commission never arrives later.

## Decision

- **The exemption belongs to one inviter.** `affiliate_address_exemptions` holds one row per exempted user, with who granted it and when, following `subscription_address_exemptions`. `SettleAffiliateReferral` skips the shared-address check for a credit whose earner has a row. Every other rule still applies: the rate, the paid-use cap, a disabled account earning nothing, and the newcomer plan's one-per-address limit.
- **A root user grants it in the user's invitation settings.** `PUT /api/affiliate/admin/users/:id/address-exemption` with `{"exempt": bool}` writes it, records a `user.manage` audit entry, and returns the admin view, which now carries `address_exempt`. A personal access token needs `user:write`. The console shows a switch beside the channel tier.
- **The commission #9 missed is restored once, by hand, after this ships.** One transaction adds an `affiliate_commissions` row with source #19, level 1, rate 30%, and a base equal to the referral's settled base minus the commissioned base. It adds the same amount to #9's `balance` and `earned`, so the ledger still sums.

## Alternatives considered

**Exempt every promotion channel.** The 11-08 farm was nine accounts behind one inviter that took commission on the others. A distributor's invitees also receive a gift plan, and distributors have the highest rate, so the tiers that most need the rule would lose it.

**Give the partner a lower price instead.** A group ratio or top-up discount would discount #9 without a second account. The owner had already set up the partner arrangement through the invitation program, and the console reports the commission there.

## Consequences

- An exempted inviter who invites real strangers is treated as before. The exemption only changes the outcome when an invitee shares their address.
- Revoking the exemption stops commission on later use only. Commission already paid stays.

## Verification

- `TestSelfInvitedCommissionDatabaseMatrix` covers granting the exemption, granting it twice, and revoking it. It ran on SQLite 3.50.4 and PostgreSQL 18.6, alongside the other affiliate and shared-address matrices. MySQL was not run: the local Docker engine returned 500 and no MySQL was installed.
- Mutation check: ignoring the exemption fails the test.
- Upgrade: a database migrated by origin/main was migrated twice by this branch on PostgreSQL 18.6 and SQLite. The second run kept the exemption row and the existing `affiliates` row.
- `go test ./model ./controller ./router ./middleware ./service`. The console's `typecheck`, `lint:check`, `format:check`, and `user-affiliate-dialog.test.tsx` passed.
