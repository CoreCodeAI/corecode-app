# Agent Note: Tell the customer the newcomer plan is paused

Status: implemented. Display only; the judgment of
[the gate](2026-11-21-gate-the-newcomer-plan-by-network-and-account.md) is unchanged.

## Problem

Feedback #52 (2026-11-22): a customer bought the $50 newcomer plan, the gate judged
their network shared, 92 requests were charged to the wallet, and the console showed
nothing. They saw the balance fall and asked for the plan to be converted. A gated request
ends in one of two outcomes: with balance it is billed to the wallet; without, it is
refused with a 4xx. Neither told the customer why.

## Decision

**Log field.** `limited_plan_gate` was already a public log field (`wallet`, `other_plan`)
on consume logs; `admin_info` stays stripped for customers. The refusal wrote the marker
only to the admin side, so `RecordRelayErrorLog` now also sets the public
`limited_plan_gate = refused` on the error log. No field is renamed; the customer's log API
only gains the key on refused requests.

**Notice endpoint.** `GET /api/subscription/self/plan-gate` (scope `wallet:read`) returns
`LimitedPlanNotice`: the counts of the last 24 hours by outcome (`wallet`, `other_plan`,
`refused`), `last_at`, and the customer's active plans the gate guards. It is `null` for a
customer holding no such plan, whatever their logs say. It reads the customer's own logs
only, names no address and no other account, and changes no data. The query finds the first
log id of the window, then reads the customer's rows from that id through `idx_user_id_id`,
the same trick as the other per-user log summaries; ClickHouse skips it.

**Console.**

| Place | Shows |
|---|---|
| Usage log list | A warning badge beside the cost, with the explanation as tooltip |
| Usage log detail | A "Newcomer Plan Limit" section: billing row, explanation, link to `/feedback` |
| Overview and Wallet | A dismissible banner (24 hours, per user, `localStorage`) when the customer holds an active limited plan and the notice counts a wallet charge or refusal |
| My subscriptions | "Paused (shared network)" badge and the explanation on the plan card |
| Refusal text (`quota.limited_plan_gate`) | Says the plan is paused and points to Feedback with its URL |

The banner counts `wallet + refused`: a request moved to another plan cost nothing extra.

**Budget.** Overview's first-load budget had about 66 bytes of room, so nothing the banner
needs is in the core part. The overview mounts it behind a text-free gate
(`features/plan-gate/lib/mount.ts`: the active-plan test and the dismissal read) and loads
the banner with `lazy(() => import(/* webpackChunkName: "plan-gate-banner" */ ...))`. The
comment before the path keeps `i18n-locale-split-loader.mjs` from following the import, so
the twelve new keys stay in the `rest` part and the banner calls
`loadLocaleParts(['core', 'rest'])` before it renders. Measured by bytes against the base:
overview room 1,257 -> 1,028, sign-in 1,286 -> 1,224, keys 1,329 -> 1,267; no key changed part.

## Consequences

- A customer whose plan the gate pauses sees the pause within a minute of the first
  charged request (the query is cached for 60 seconds).
- The banner shows on a paid, active limited plan only. A plan that ended, a monthly plan
  and a customer with no plan get `null` and no banner.
- Unreadable counts (the endpoint fails) show nothing rather than a wrong number.
- The explanation says "the network is shared"; it does not say which accounts.

## Verification

Go: the notice matrix on SQLite (counts, window, an admin-only marker not counted, another
user's logs, a holder with zero counts, a monthly plan, an expired plan, an empty window),
the refused error log carrying the public marker and no `admin_info`, and the new zh
refusal text. Console: field mapping, label and detail conditions, banner conditions
(active plan, count, dismissal, the lazy mount on the overview). Browser check against a
local stub API (zh, 1280 and 390 px): overview and wallet banners, paused plan card, log
list badges, detail dialog.
