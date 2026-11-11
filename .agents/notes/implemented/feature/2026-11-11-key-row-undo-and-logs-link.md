# Agent Note: Undo a key disable, and open a key's usage logs from its row

Status: implemented

## Problem

The power button in a key's row disables the key on one click. A running
Claude Code or Codex session that uses the key fails on its next request, and
the only way back was to notice and click the button again. The button sits
beside Edit, so it is easy to hit by mistake. Delete, in the same row, asks
first.

To see what a key spent, a customer copied its name, opened the usage logs,
expanded the filters and typed the name in full, because the server matches
`token_name` exactly.

## Decision

- **A disable's success toast carries an Undo action** that sends the same
  status-only update with `ENABLED`. Enabling shows a plain toast. The disable
  still happens at once: the owner asked for the action to stay one click.
- **The row menu gains "View logs"**, a router link to
  `/usage-logs/common?token=<name>`. It uses the same `scroll-text` icon as
  the Usage Logs entry in the sidebar.
- **Logs match keys by name**, so two keys with one name share their logs. The
  label says "View logs", not "this key's logs", and nothing in the menu claims
  more. The applied name sits in the token-name filter, which the filter bar's
  Expand toggle counts, and the page opens on its usual range, today.

## Alternatives considered

- **Confirm before disabling.** It stops the mistake but adds a step to every
  intended disable. Undo costs nothing when the disable was meant.
- **Filtering the logs by token id.** It would separate same-named keys, but the
  log list has no id filter, and the server was out of scope for this batch.

## Consequences

- Undo is offered only while the toast is on screen. A key whose disable was
  not undone is enabled again from its row, as before.
- `/keys` is a first-load budget page. The menu item and the toast action add
  about 0.2 KB (brotli) to its chunk. The icon was already loaded.

## Verification

- `api-key-listing.test.tsx`: Undo in a disable's toast re-enables the key with
  a second status-only update; enabling offers no Undo; the menu item links to
  `/usage-logs/common` with the key's name, spaces and slash included, as
  `token`. The Undo test failed before the change.
- `bun run test` (309 files, 3156 tests), `bun run typecheck`,
  `bun run lint:check`, `bun run format:check`, `bun run build`,
  `bun run first-load:check` (`/keys` 607.0 of 607 KB), all with exit status 0.
