# Agent Note: One newcomer plan per address, and no commission on one's own accounts

Status: implemented

## Problem

From 2026-11-06 14:13 to 11-08 02:50 CST one person bought the ¥29.9 newcomer plan ($50, one per user) on nine Google accounts in turn. Each account used its $50 in two to five hours, then the next one signed up and paid. All nine sent every request from one China Mobile home address that no other account used, named their key `HL`, and signed in to the console from the same browser. The first account invited the second, which invited the other seven and took 10% commission on their use; they paid ¥399 for $663 of use. Two smaller groups did the same (four accounts on the older ¥9.9 plan, three on the newcomer plan).

The plan's per-user limit counts accounts, and an account costs a Google sign-up.

## Decision

- **A plan limited per user is limited per address.** `CheckSubscriptionPurchaseFrom` refuses a purchase when another account that bought the plan in the last 30 days used the purchasing address: a console sign-in (`user_sessions.ip`), a plan order (`subscription_orders.ip`, new), or a request (`logs.ip`). The error reads "This plan has already been bought from your network. Contact support if you need it": during the growth phase a second person in one household or office is let through by an administrator binding the plan, which this check does not cover. The owner chose this over a flat refusal because, with subscription seats paid monthly, a repeated newcomer purchase still earns more than it costs; the limit is about fairness, not loss. Every payment path and the balance purchase call it with the client address; every order now records it.
- **No commission on an account that shares the inviter's address.** `SettleAffiliateReferral` skips a credit when the earner and the invitee signed in, ordered or sent requests from one address in the last 30 days. The consumption still settles, so it is never paid later. Since 2026-11-12 a root user can exempt one inviter from this ([why](../feature/2026-11-12-affiliate-address-exemption.md)).
- **A shared exit is not evidence.** An address that carried requests for 20 or more accounts in 7 days is treated as a proxy or NAT exit and ignored by both rules. Since 2026-11-10, so is an address used by five or more other accounts that bought no plan limited per user ([why](2026-11-10-proxy-sign-ins-make-a-shared-exit.md)).

## Alternatives considered

**Limit per /24.** Replayed over the 239 newcomer buyers, matching a /24 refused 32 of them, many behind the same proxy providers' ranges; the exact address refused 17, of them 11 in the three groups and 2 clear paying customers.

**Payer identity.** The epay notifications carry no payer account, so payments cannot be linked.

## Consequences

- A second person in one household or office cannot buy the newcomer plan within 30 days of the first, and an inviter living with their invitee earns no commission on them. They can still top up at the normal rate.
- The rule only reads addresses; a farm that rotates proxies per account passes it, as it passes the per-user limit.
- Settlement runs hourly over the invitees whose use grew (a few hundred at most), with a few indexed reads each.

## Verification

- `TestNewcomerPlanOnePerAddressDatabaseMatrix` and `TestSelfInvitedCommissionDatabaseMatrix` on SQLite, MySQL 8 and Postgres 16, with the existing affiliate matrices. They cover each address source, another address, a plan without a limit, a shared exit, the 30-day window, and commission paid to a friend on another address.
- Mutation checks: never refusing, never treating an address as a shared exit, and ignoring the self-invited set each fail the tests.
- `go test ./model ./controller ./service ./router ./middleware`; the one service failure, `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, comes from the local proxy variables and passes without them.
