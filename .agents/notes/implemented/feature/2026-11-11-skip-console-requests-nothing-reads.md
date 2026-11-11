# Agent Note: Skip two console requests whose result is not shown

Status: implemented

## Problem

- **`/keys`**: `ApiKeysDialogs` calls `useSetupClients(currentRow)` to title the setup
  dialog. While the dialog is closed `currentRow` is null, and the hook still requested
  `/api/user/models` for the account's own group on every visit to the page. That was the
  untitled `/api/user/models` request in the page's first round of requests.
- **Overview**: the "recent 100 requests" query, and the matching request `index.html`
  sends before the bundle loads, call `GET /api/log/self`. That handler always runs
  `countUpTo(10000)` over a year of logs. The overview reads only `data.items`, never
  `total`.

## Decision

- **`useSetupClients(key, enabled = true)`**: `enabled: false` sends neither request and
  answers from the cache. `ApiKeysDialogs` passes `open === 'setup'`. When the dialog
  opens, the row's own hook has already loaded the models of that key's group under the
  same query key, so the title is right on the first frame, as before.
- **`skip_count=1`** goes on the overview's recent-logs request and on the prefetch URL in
  `index.html`, which must stay the same string (`src/lib/boot-requests.test.ts`). The
  server side is another change. A server without it ignores the parameter, so either
  can ship first.

## Alternatives considered

- **Request each row's models only when its menu or setup button is used.** The row
  menu does not read the models. The setup button's tooltip and `aria-label` ("Connect
  Claude Code", "Connect Codex", "Connect a client") do. Loading on hover or focus would
  give a screen reader the fallback label at focus, and could show the wrong tooltip on a
  slow network, so the per-group requests stay.
- **Disable the hook for every null key.** The guide on the overview renders with no key
  for a new user and fills its snippet with the account group's models, so it needs the
  null-key request.

## Consequences

- `/keys` sends one request fewer on each visit, unless a key on the page has an empty
  group, in which case the row requests the same thing anyway.
- The per-group `/api/user/models?group=…` requests on `/keys` remain, one for each
  distinct group on the page.
- The overview's recent-logs response no longer carries a usable `total` once the server
  honours `skip_count`. Nothing in the overview reads it.

## Verification

- `keys/components/__tests__/api-keys-dialogs-requests.test.tsx`: the closed dialog sends
  no `/api/user/models` request (it sends one with the hook change reverted); opening it
  for a key in group `gpt` shows the heading "Connect Codex" and requests
  `/api/user/models` with `group: 'gpt'`.
- `src/lib/boot-requests.test.ts`: the overview's requests are all answered by the
  `index.html` prefetch, including
  `/api/log/self?p=1&page_size=100&type=2&skip_count=1`. With the query change reverted
  and `index.html` kept, it fails.
- `bun run first-load:check`: `/dashboard/overview` 526.9 KB of 527, the same as before
  the change.
