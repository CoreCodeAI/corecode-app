# Agent Note: A proxy node's other customers make it a shared exit

Status: implemented

## Problem

On 2026-11-10 account #2582 was refused the ¥29.9 newcomer plan with "This plan has already been bought from your network". Its only address, `203.10.98.186`, is a GSL Networks data-center address in Tokyo, a proxy node. Account #542, which had bought the plan on 10-31, sent requests through that node on 10-31 and 11-01 while also using at least four other addresses. In the 30 days before the refusal, six other accounts signed in to the console from the node, but only #542 sent requests from it. `sharedExit` counted only request senders (20 in 7 days), so it treated the node as one person's home address.

[One newcomer plan per address](2026-11-08-newcomer-plan-one-per-address.md) has the full rule.

## Decision

An address is also a shared exit when five or more accounts other than the ones being compared used it in the last 30 days (sign-in, plan order or request) without buying a plan limited per user. `sharedExit` takes the compared accounts as parties: the purchaser in `CheckSubscriptionPurchaseFrom`, and both accounts in `SharesAddress`, so the commission rule uses the same definition.

Accounts that bought the limited plan do not count, because a farm's accounts all buy it; that is why they exist. The owner chose a threshold of five over four, and over keeping the rule and binding plans by hand.

## Alternatives considered

**Count every sign-in user.** Over the 30 days before the change, addresses with only sign-ins look the same as farms: the farm `103.142.140.53` had 6 sign-in accounts, all of them buyers, and `23.237.196.226` had 8 accounts, 5 of them buyers. Any user count that frees the proxy also frees these farms.

**Recognize data-center networks.** The app has no ASN data, and some farms run through proxies too.

## Consequences

- Over the 30 days before the change, the rule frees seven addresses. The three known farm addresses (`117.150.5.21`, `199.74.61.140`, `117.154.65.217`) and `103.142.140.53` have no bystanders and stay refused; `23.237.196.226` has three and stays refused.
- A farmer who also signs in five accounts that never buy gets past the rule. That costs five more sign-ups, and the per-user limit still applies.
- A check that does not reach the request threshold now reads the address's users from three tables, then the limited-plan purchases among them. Both reads are indexed on `ip` or `user_id`.

## Verification

- `TestNewcomerPlanOnePerAddressDatabaseMatrix` on SQLite, MySQL 8 and Postgres 16: four bystanders and four farmed buyers still refuse, a fifth bystander allows, the purchaser's own sign-in does not count, and a limited plan nobody bought is refused nowhere. `TestSelfInvitedCommissionDatabaseMatrix` and the affiliate matrices still pass.
- Mutation checks: counting buyers as bystanders, counting the purchaser, and ignoring bystanders each fail the test. Dropping the empty-list guard in `usedAddress` does not fail, because GORM returns an empty slice, not nil. The guard stays as a defense.
- A read-only replay of the rule against production on 2026-11-10: `203.10.98.186` has 6 bystanders other than #2582 and becomes a shared exit. Every address above stays refused.
