# Agent Note: Let an administrator exempt one account from the plan address check

Status: implemented

## Problem

`CheckSubscriptionPurchaseFrom` refuses a one-per-user plan when another buyer of it used the purchasing address in the last 30 days. Its error tells the customer to contact support. The note that added it, `bug-fix/2026-11-08-newcomer-plan-one-per-address.md`, expected an administrator to bind the plan for a second person in one household, which gives it away.

On 2026-11-10 customer #2582 (feedback "第一次用这个购买新人福利包") could not buy the ¥29.9 newcomer plan. Their only address was 203.10.98.186, a GSL Networks node in Tokyo. Six unrelated accounts, five Gmail and one QQ, had signed in from it between 11-01 and 11-09. Buyer #542 had sent 543 requests from it on 10-31 and 11-01, alongside three other addresses. The shared-exit rule counts only requests in the last 7 days, and in that window the node carried none. So it was not a shared exit, and the check refused #2582. The customer wanted to pay, and the owner wanted them to.

## Decision

- **An exemption is a row per account.** The new table `subscription_address_exemptions` has `user_id` as its primary key, plus `created_by` and `created_at`. `CheckSubscriptionPurchaseFrom` reads it only after the address check has found a match and the address is not a shared exit, so purchases with no match cost no extra query. Every payment path and the balance purchase already call this one function.
- **It lifts only the address check.** The per-user limit (`CheckSubscriptionPurchase`) runs first and still holds, so an exempt account can buy the newcomer plan once.
- **It is not in `users.setting`.** Customers write that JSON through their own settings endpoints. A separate table can only be written by an administrator.
- **Administrators set it in the user's subscription drawer.** The drawer gets a switch, backed by `GET`/`PUT /api/subscription/admin/users/:id/address-exemption`. The `PUT` checks `canManageTargetRole` and writes a `user.manage` audit entry with action `allow_plan_from_shared_address` or `deny_plan_from_shared_address`. Access tokens need `billing:read` / `billing:write`, the same scopes as the drawer's other routes.

## Alternatives considered

- **Count sign-ins toward the shared-exit threshold.** Six accounts is far below the 20 the rule needs. Lowering the threshold would also let through the farms the rule was built for, which used one home address.
- **Bind the plan for free.** That was the existing remedy. It gives away a plan the customer was ready to pay for.

## Verification

- `TestNewcomerPlanOnePerAddressDatabaseMatrix` (SQLite locally) covers:
  - an exempt account buys from the shared address;
  - granting twice is harmless;
  - the per-user limit still refuses a second purchase;
  - another account on the same address is still refused;
  - revoking restores the refusal.
- Disabling the exemption read makes that test fail.
- `user-address-exemption.test.tsx` checks the drawer switch: it reads the saved state and saves a change for the right user.
- Checks run:
  - `go test ./common/... ./controller/... ./middleware/... ./model/... ./service/... ./router/...` passes with the proxy variables unset.
  - The console's `typecheck`, `lint:check`, `format:check`, `test`, `build` and `first-load:check` each pass.
