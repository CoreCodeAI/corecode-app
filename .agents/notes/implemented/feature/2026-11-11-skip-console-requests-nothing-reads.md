# Agent Note: Skip the closed setup dialog's models request

Status: implemented

## Problem

`ApiKeysDialogs` called `useSetupClients(currentRow)` to title the setup dialog. While
the dialog is closed `currentRow` is null, and the hook still requested
`/api/user/models` for the account's own group on every visit to `/keys`. That was the
ungrouped `/api/user/models` request in the page's first round of requests.

## Decision

The title is its own component, `SetupDialogTitle`, which calls `useSetupClients` and is
passed to the dialog as `title`. The dialog mounts its content only while it is open, so
a closed dialog runs no hook and sends no request. When the dialog opens, the row's own
hook has already loaded the models of that key's group under the same query key, so the
title is right on the first frame, as before.

`useSetupClients` itself is unchanged.

## Alternatives considered

- **An `enabled` argument on `useSetupClients`.** It was the first version of this
  change. The hook is shared with the setup guide on the overview, so the argument's
  bytes landed in a chunk the overview's first load counts, and CI's build of that page
  has no room left under `first-load-budget.json`.
- **Request each row's models only when its menu or setup button is used.** The row
  menu does not read the models. The setup button's tooltip and `aria-label` ("Connect
  Claude Code", "Connect Codex", "Connect a client") do. Loading on hover or focus would
  give a screen reader the fallback label at focus, and could show the wrong tooltip on a
  slow network, so the per-group requests stay.
- **Disable the hook for every null key.** The guide on the overview renders with no key
  for a new user and fills its snippet with the account group's models, so it needs the
  null-key request.
- **Send `skip_count=1` on the overview's recent-logs request**, so the server skips a
  count the overview never reads. Left out: the parameter adds bytes to the overview's
  chunk, which fails the first-load check in CI, and the count it would skip takes about
  12 ms for the account with the most logs.

## Consequences

- `/keys` sends one request fewer on each visit, unless a key on the page has an empty
  group, in which case the row requests the same thing anyway.
- The per-group `/api/user/models?group=…` requests on `/keys` remain, one for each
  distinct group on the page.

## Verification

`keys/components/__tests__/api-keys-dialogs-requests.test.tsx`: the closed dialog sends
no `/api/user/models` request (it sends one on main); opening it for a key in group
`gpt` shows the heading "Connect Codex" and requests `/api/user/models` with
`group: 'gpt'`.
