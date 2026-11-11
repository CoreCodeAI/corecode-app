# Agent Note: A key may set its own Auto group order

Status: implemented

## Problem

Since 2026-10-28 every Auto key followed the operator's `AutoGroups` order and
the key drawer showed it read-only. The owner now wants customers to choose and
reorder the groups each key tries, with the site order as the default.

## Decision

- Revert `0a2d4e282`, which restores upstream new-api's behavior:
  `controller.setTokenAutoGroups` stores a non-empty list after checking it
  against `MaxTokenAutoGroups`, duplicates, and the owner's usable groups, and
  clears the column for an empty one. `SetupContextForToken` reads the stored
  list into `ContextKeyTokenAutoGroups`, and the key drawer brings back
  `AutoGroupOrderEditor`.
- An empty list still means "follow `AutoGroups`", so existing keys and new
  keys created without touching the editor route as before.
- The editor is lazy-loaded and prefetched when the page is idle, like the
  expiry calendar, so its code stays out of `/keys`'s first load. Its strings
  and the server's validation messages still land in the core locale part,
  which `/keys` loads first; that adds 0.5 KB, and the `/keys` budget in
  `first-load-budget.json` goes from 606 to 607 KB.
- `ko.json`, added after the revert's target, gets the editor's strings and
  loses the two read-only ones.

## Alternatives considered

- **Reorder only, without dropping groups.** Upstream's editor already lets a
  key choose a subset, and a key that wants fewer groups otherwise needs a
  named group instead of Auto. Keeping upstream's shape also keeps upstream
  merges clean.

## Consequences

- The Claude Code gate is unchanged. It reads `GetRequestAutoGroups`, which
  now returns the key's own list, and still drops Claude Code only groups for
  other clients. A key that lists only such groups is refused for other
  clients, as a key on that named group is.
- A custom list is filtered on every request against the owner's current
  usable groups and `MaxTokenAutoGroups`; it does not fall back to
  `AutoGroups`. Groups added to `AutoGroups` later do not reach a key with a
  custom list.
- `MaxTokenAutoGroups` is 5 in production while `AutoGroups` has 6 groups, so
  a custom list cannot hold every group until the operator raises it.

## Verification

- `go test ./controller/... ./middleware/... ./service/... ./model/... ./setting/...`:
  pass, except `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails
  only with the local shell's proxy variables set and passes without them.
- From `web/`: `bunx tsc -b`, `bun run lint:check`, `oxfmt --check` on the
  changed files, `bunx vitest run src/features/keys` (10 files, 132 tests), and
  `bun run build` then `bun run first-load:check` (`/keys` 606.5 of 607 KB):
  pass.
