# Agent Note: Sort the pool's accounts, show the engine's schedule order, and set an account's schedule weight

Status: implemented

## Problem

The pool tab's account table listed accounts in the engine's order, with filters by group
and by "not schedulable" but no way to sort. An operator could not see which account the
engine would pick next, or line accounts up by quota left, reset time, spend or failures.
Nor could they move new conversations toward an account: under `quota_balanced` nothing an
operator sets did that.

## Decision

- **Schedule order.** `pool-sort.ts` mirrors corecode-engine's `QuotaHeadroom`
  (`internal/state/quota_balance.go`) and the first quota_balanced keys of its comparison:
  - schedulable first;
  - then `(sessions + 1) / headroom`, ascending;
  - then requests in flight.

  The Claude table gets a "Schedule order" column, showing each schedulable account's place
  in its group as `n / total`. It is also the default sort. Ranks restart in every group,
  so in this order `SimpleTable`'s `section` puts a heading row before each group ("name ·
  n of m accounts schedulable") and one before the accounts the engine would not pick; a
  page that starts inside a group repeats its heading. Affinity, the avoided
  organization and the round-robin tie-breaks depend on the request, so they are left out
  and the help says it is an estimate. Other providers have no column and default to the
  account id.
- **Capacity weight.** The engine already sends `capacity_weight` per credential on
  `/api/group-concurrency`. `EnginePool` passes it through, null when the engine does not
  know it. It feeds the headroom, and the account line shows it as "Size ×n".
- **Sorting.**
  - `SimpleTable` takes `sort` and `onSort`. A sortable header gets its own arrow button
    beside the label, because the label is already a button that opens the column's help.
    The header carries `aria-sort`, and a new order returns to the first page.
  - The caller sorts the rows.
  - A select next to the group chips offers keys no column has: 5h/7d left in dollars,
    5h/7d reset, projected unused, size, sessions, failures, renewal date. A button beside
    it reverses the order.
  - A missing figure sorts last in either direction, and ties fall back to the id, so a
    15-second refresh does not reshuffle rows.

- **Schedule weight.** corecode-engine now scales an account's headroom by its manual
  weight over the default of 50 (engine note
  `2026-11-25-manual-weight-scales-headroom.md`). The pool table gets a "Schedule weight"
  column with ×0.5, ×1, ×1.5 and ×2. A choice goes through
  `PUT /api/site-insights/pool/groups/:group_id/credentials/:credential_id/weight`
  (root only) to the engine's audited `PUT /groups/:gid/credentials/:cid` as
  `{"weight_manual": n}`.
  - ×1 sends null, so the account follows the engine default rather than a stored 50.
  - A weight set in the engine console that is not a preset stays listed.
  - Every engine reports `weight`, but only one with the scaling moves traffic by it, so the
    engine ships first.
  - The schedule-order estimate multiplies by the weight too.

## Alternatives not taken

- **Sorting on the server.** The table already holds every account of the pool, and the
  sort is a view choice.
- **Remembering the sort in the URL.** The group and attention filters are not kept there
  either.
- **A confirmation before saving a weight.** It takes effect only for new conversations
  and is undone by picking ×1.

## Verification

- `go test ./service -run 'EnginePool|EngineCredentialWeight'`:
  - the pool fixture covers a known capacity weight, a missing one, and the account
    weight;
  - the weight request sends only `weight_manual`, null to clear, and drops the cached
    pool.
- Web:
  - typecheck;
  - the full vitest suite, including a new `pool-sort.test.ts` (headroom cases, ranks,
    null and tie order) and pool-tab tests for the default order, header clicks and the
    direction button;
  - `weight-cell.test.tsx` covers a preset save, ×1 clearing, a non-preset weight and an
    old server;
  - `lint:check`;
  - oxfmt on the changed files.
