# Agent Note: Limit a per-user plan per network, by the addresses the buyer sends requests from

Status: implemented

## Problem

The newcomer plan (id 2, ¥29.9, one per user) is the main acquisition offer. On 2026-11-19 a production read found a studio on 117.150.5.21: 35 accounts, all with batch-pattern names, all on one client version, each holding plan 2 once. A smaller one, 119.130.130.69, had 5. The 11-08 rule (`CheckSubscriptionPurchaseFrom`, one buyer per address, `bug-fix/2026-11-08-newcomer-plan-one-per-address.md`) did not stop them, for two reasons:

- **The order address differs per order.** The studio buys through changing exits, so `subscription_orders.ip` and the sign-in address never match the requests' address. no order address was shared by more than two of the 35 accounts.
- **`sharedExit` calls the studio a proxy node.** 117.150.5.21 carried requests for 20 or more accounts in a week, which `sharedExit` reads as a shared exit. Twenty accounts that all bought the same plan is the opposite of a proxy node.

Order IP was not empty for the paths that matter. Every payment controller already writes `Ip`. The wallet purchase (`PurchaseSubscriptionWithBalance`) wrote none. The rows empty since 11-09 (88 of 474 successful plan 2 orders in the last 14 days) are all from before 11-09, when the column began to be filled. `top_ups` has no `ip` column.

## Decision

`CheckSubscriptionPurchaseFrom` keeps the 11-08 check and adds `checkLimitedPlanAddressFarm` for a plan with `max_purchase_per_user > 0`:

- **Addresses of the buyer:** the client IP of this purchase, plus the distinct `logs.ip` of the buyer's last 200 `type = 2` requests in the last 30 days (`idx_user_id_id` order, no scan).
- **Others:** for each address, accounts that used it in 30 days (sign-in, order or request, `addressUsers`) and hold the plan with a source other than `admin`.
- **Shared exit:** an address is skipped when at least `sharedExitBystanders` (5) of its accounts never took a plan limited per user and they are no fewer than the plan's holders there. `sharedExit`'s seven-day requester count is not used here, for the reason above.
- **Refuse** with `ErrSubscriptionAddressShared` when the distinct holders over the remaining addresses number at least `threshold`.
- **Setting:** options `limited_plan_address_setting.enabled` (default true) and `.threshold` (default 2; below 1 counts as 1), in `setting/operation_setting/limited_plan_setting.go`. Two lets one household or office through.
- **Exemption:** the existing per-account `subscription_address_exemptions` row lifts this check too.
- **Message:** "This discounted plan is limited to one per person, and accounts on your network have already bought it. Regular top-up is available", in all seven console locales. It reaches the console through the same `ApiError` path as the other purchase refusals. Top-up has no gate.
- **Audit:** each refusal logs `subscription: refused user U plan P, N other accounts holding it on M addresses` (Chinese text in `log_text.zh-CN.json`).
- **Order address:** the wallet purchase now records the client IP on its order.

## What the replay found (production, read-only, 2026-11-19)

All SQL ran in `BEGIN READ ONLY` through `gcloud compute ssh`; plan 2 buyers of the last 7 days, 257 subscriptions.

- **Evaluated at the moment of purchase, the rule refuses 0 of 257.** The studio's accounts buy before they send a request: 35 of 35 first requests come after the purchase, 32 of 35 purchases within 10 minutes of signup (median 49 s). A buyer has no request address yet, and the order and sign-in addresses vary. Counting sign-in and order addresses as well would have reached only 6 of 35 (2 with two or more earlier holders).
- **Evaluated now (each buyer's current addresses and everyone who holds the plan), it refuses 65 of 257:** 25 on 117.150.5.21, 5 on 119.130.130.69, 35 elsewhere. `sharedExit`'s requester test would have excused 4 more. In the shared addresses I listed (24 addresses with three or more holders), every requester was a plan holder. Some are likely small studios; at least 203.10.98.186, where an unrelated customer was refused on 11-10, is a VPN node with six holders. These are the accounts to read before widening the rule.
- **Cost:** the heaviest address (117.150.5.21, 20,284 rows in 30 days) reads in 32 ms; the buyer's last-200 read takes 0.7 ms.

So the rule does what it was asked and is safe on last week's purchases, but it would not have stopped this studio's purchases. It stops a studio account that sends requests before it buys, and a second purchase attempt after the accounts start working. Stopping the first purchase needs a signal that exists at signup: batch-pattern email or username, or the payer's identity at the payment provider. That is left open.

## Verification

- `TestLimitedPlanOnePerNetworkDatabaseMatrix` runs on SQLite, MySQL 8.0 and PostgreSQL 16: two holders refuse a third account whose order comes from another address; one holder with threshold two allows; a different address, an older request, no address, an exempt account, the setting off, threshold three, three administrator-bound holders, a proxy node, and a plan without a limit all allow; twenty holders on one address refuse. A top-up has no gate to test.
- Mutations: returning early from the new check fails the refusals; replacing the exit test with `false` or with the seven-day requester count fails the proxy-node or the studio case.
- `TestNewcomerPlanOnePerAddressDatabaseMatrix` and the affiliate tests still pass, and a wallet purchase's order carries its address.
