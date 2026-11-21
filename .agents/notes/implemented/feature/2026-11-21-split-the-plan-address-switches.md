# Agent Note: Split the plan address switches and refuse with a way out

Status: implemented

## Problem

[One switch turned off both address checks](2026-11-21-one-switch-for-the-plan-address-limit.md)
of a plan limited per user, after the strict one-buyer-per-address check refused a real
customer. With both off, a studio buys the newcomer plan on a new account every day: from
2026-11-06 to 11-21, 44 accounts that sent 63% to 100% of their requests from one address
(117.150.5.21) each bought the plan once and were dropped near the end of its quota.

## Decision

- **Each check has its own switch.** `limited_plan_address_setting.enabled` gates the strict
  check (`checkSharedAddressOfBuyer`) only. The new `limited_plan_address_setting.farm_enabled`
  (default on) gates the per-network check (`checkLimitedPlanAddressFarm`), with the existing
  `.threshold`. Both are options, so `PUT /api/option/` changes them without a release.
- **Production runs the farm check alone, with threshold 3.** The strict check refuses a
  customer who merely shares an order address with one buyer; the farm check reads the
  addresses the buyer's own requests came from, plus the order address, and needs
  `threshold` other holders there.
- **The refusal says what to do.** `ErrSubscriptionAddressShared` now reads "…If this is a
  mistake, contact support and we will unlock it for you; regular top-up is always
  available", translated in the eight console locales. Support unlocks the account with the
  existing address exemption; top-up has no gate.

## Replay on production data (read-only, 2026-11-21)

Each limited-plan purchase of the last 14 days (478 accounts) was judged as of its purchase
time with the farm rule:

| Threshold | Refused | Who |
|---|---|---|
| 2 | 3 | 109502630 (11-08), oidc_2190 (11-10), korbingo (11-21) |
| 3 | 1 | korbingo: registered and ordered in one minute from 103.135.100.188, an address 7 other holders of the plan had sent requests from and no account without the plan had used |

Threshold 3 refuses no customer who bought. Threshold 2 would also have refused two
accounts from the earlier studio period that cannot be told apart from two people sharing
an address. 117.150.5.21 and 103.135.100.188 carry no bystanders (accounts that never took a
limited plan), so neither passes as a shared exit.

**The farm check does not stop the 117.150.5.21 studio.** Every one of its 44 accounts had
sent no request before buying and ordered from a different address (proxy and VPS exits
that differ per order), so at purchase time nothing links the new account to the studio's
request address. The replay refuses none of them. The 117.150.5.21 accounts are therefore
marked and watched after the purchase: `users.remark` holds the studio and date, and
corecode-infra's relay-watch raises an alert when three accounts that bought a limited plan
send requests from one address.

Judged on the accounts active in the last 24 hours that never held the plan (174), the
farm check counts other holders across all of an account's request addresses: at threshold 3
seven accounts reach it, long-time users who rotate through proxy pools (the largest sent
more than 55,000 requests). They are refused only if they try to buy the newcomer plan, and
support can exempt them. Counting holders per address, not across addresses, would leave one
of the seven at threshold 3; it was not changed here.

## Consequences

- A customer behind a shared or rotating address who reaches the threshold sees the refusal
  and needs support to buy the newcomer plan.
- The studio's accounts keep buying; the farm check only stops an account whose own requests
  or order address already sit on a studio address.

## Verification

- `TestLimitedPlanAddressSwitchesAreIndependent` (SQLite, MySQL, PostgreSQL) covers each
  switch alone and both, the threshold (2, 3, below 1), the exemption, the refusal text, and
  a brand-new account with its own address passing, the case above. The existing address
  matrices pass with the farm test running the strict switch off.
