# Agent Note: Every Auto key follows the operator's group order

Status: implemented

Superseded on 2026-11-11 by `2026-11-11-per-key-auto-group-order.md`: a key
may set its own Auto order again; an empty order follows `AutoGroups`.

## Problem

Upstream new-api lets each API key on the `auto` group pick and reorder its own
Auto groups (`tokens.auto_groups`, capped by `MaxTokenAutoGroups`). The console
showed this as a drag-to-reorder editor in the key drawer.

CoreCode's operator sets the order once in `AutoGroups`:
`["Claude 满血（可外接）","GPT","Grok","Gemini"]`. Claude requests on an Auto
key must go to 可外接, the Claude group that admits clients other than Claude
Code. A key that put another group first, or left 可外接 out, would route
differently from what the site documents and supports. The owner asked that
customers not be able to change the order.

On 2026-10-28 production had 5 Auto keys and none stored an order, so no data
needs migrating.

## Decision

- `controller.setTokenAutoGroups` refuses a create or update that names any
  Auto groups ("The Auto group order is set by the operator and cannot be
  changed") and otherwise clears the stored value. Every update of an Auto key
  clears it, so an order stored earlier disappears the next time the key is
  saved.
- `middleware.SetupContextForToken` no longer reads `tokens.auto_groups`. An
  Auto key resolves its groups from `AutoGroups` like a key with no override,
  whatever the column holds. `ContextKeyTokenAutoGroups` is still set by the
  Claude Code gate, which narrows the candidates of a non-Claude-Code request.
- The key drawer replaces the editor with a read-only list of the global order
  (`GET /api/token/auto-groups`) and always sends `auto_groups: []`.
  `auto-group-order-editor.tsx` and the translations only it and the removed
  validation used are deleted.
- The `tokens.auto_groups` column, `MaxTokenAutoGroups` and the cross-group
  retry switch stay. Dropping the column would be a schema change for no
  behavior gain, and retry is a separate choice the owner did not restrict.

## Alternatives considered

- **Hide the editor only.** The API would still accept an order from a script
  or the console already in production. The server has to refuse it.
- **Accept an order and ignore it.** A client would believe its order was
  saved. Refusing says what happened.
- **A new option to switch per-key orders on or off.** CoreCode has one
  operator and no case for turning it back on; a switch adds a setting nobody
  sets.

## Consequences

- A create or update with a non-empty `auto_groups` now fails. During the
  release window, the console still in production shows that error only to a
  customer who picks a custom order, in English, because the old console has no
  translation for it.
- Changing `AutoGroups` changes the routing of every Auto key at once.

## Verification

- `go test ./common/... ./controller/... ./middleware/... ./model/... ./service/... ./router/...`
  and `go vet ./...`: pass.
- `TestAddTokenRejectsAnyAutoGroupOrder` covers the global order itself, a
  reordered list, and the earlier invalid cases. `TestUpdateTokenClearsAStoredAutoGroupOrder`
  seeds a stored order and checks that omitting, null and `[]` clear it, and that
  naming one is refused. `TestSetupContextForTokenIgnoresStoredAutoGroups`
  checks a stored order, `[]` and malformed JSON all leave the context unset.
- From `web/`: `bun check -b`, oxlint and oxfmt on the changed files, and
  `bunx vitest run src/features/keys` (9 files, 91 tests): pass.
