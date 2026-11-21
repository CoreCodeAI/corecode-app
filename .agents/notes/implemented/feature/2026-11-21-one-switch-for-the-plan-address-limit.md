# Agent Note: One switch turns off the plan address limit

Status: implemented; the farm check has its own switch since [the split](2026-11-21-split-the-plan-address-switches.md)

## Problem

A plan limited per user (the newcomer plan) has two address checks in
`CheckSubscriptionPurchaseFrom`: one buyer per address (`checkSharedAddressOfBuyer`,
[2026-11-08](../bug-fix/2026-11-08-newcomer-plan-one-per-address.md)) and the per-network
threshold (`checkLimitedPlanAddressFarm`,
[2026-11-19](2026-11-19-limit-a-plan-per-network-by-request-addresses.md)). Only the
second read `limited_plan_address_setting.enabled`, so turning the option off left the
first check in force. On 2026-11-21 a customer was refused with "This plan has already been
bought from your network", and the owner decided the plan should be limited per account
only, with no address limit.

## Decision

- **`limited_plan_address_setting.enabled` gates both checks.** `CheckSubscriptionPurchaseFrom`
  returns after the per-user check while it is off. The default stays on, so this change
  alone alters nothing; production turns it off through `PUT /api/option/` after the
  release.
- **The rest stays.** The threshold, the per-account exemption, the order address column,
  the risk view's shared-address reading, and the commission rule for invitees on the
  inviter's address are unchanged. Turning the option back on restores both checks without
  a release.

## Consequences

- With the option off, one person can buy the newcomer plan on as many accounts as they can
  register. The 11-08 and 11-19 notes record the farms the checks were written against.

## Verification

- `TestNewcomerPlanOnePerAddressDatabaseMatrix` now pins the setting on, then turns it off
  and expects the three addresses that were refused (sign-in, request, order) to pass, while
  the first buyer's second purchase is still refused by the per-user limit. On
  `origin/main` the new assertions fail with `ErrSubscriptionAddressTaken`. Gating only the
  threshold check again (the old shape) fails them too.
- The address and commission matrices pass on SQLite, MySQL 8.0.46 and PostgreSQL 16.15;
  `go test ./common/... ./controller/... ./middleware/... ./model/... ./service/...` passes.
