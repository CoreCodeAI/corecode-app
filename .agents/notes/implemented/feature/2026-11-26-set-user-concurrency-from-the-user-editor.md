# Agent Note: Set a user's concurrency limit from the user editor

Status: implemented

## Problem

A per-user concurrency override (`2026-10-27-per-user-concurrency-limits.md`)
is set only in the root-only panel on the dashboard's capacity tab, or by
`PUT /api/option/`. An operator handling one customer works in the user
editor at `/users`, which shows the group and quota but neither the override
nor the limit the customer actually gets.

## Decision

- **The user editor has a concurrency field** in its group and quota
  section. Empty means the group limit and paid tiers apply; a whole number
  sets the override; 0 lifts the limit. Under the field the editor shows the
  limit in effect now, which is what an empty field resolves to.
- **`GET /api/user/:id` adds two fields:** `concurrency_limit`, the override
  or `null`, and `concurrency`, the controller's existing `UserConcurrency`
  (limit, source, group limit) for that user.
- **`PUT /api/user/` takes an optional `concurrency_limit`.** Absent leaves
  the override as it is, so the console in production, which does not send
  it, changes nothing; `null` removes the override; a whole number of at
  least 0 sets it. Anything else is rejected before the user row is written.
  A change is recorded in the `user.update` audit entry.
- **`model.SetUserConcurrencyLimit` edits the stored option row under a row
  lock,** not the in-memory map. Two servers run during a release, and the
  in-memory copy of the server that takes the edit may lag one the other
  wrote since its last sync; a write built from memory would drop it. It
  writes only when the value changes, then bumps the options sync topic.
- **Any administrator who may manage the user may set it,** the permission
  `PUT /api/user/` already checks. The same administrator can already move
  the user to another group, which changes the limit as much; the capacity
  panel stays root only.

## Alternatives considered

- **Save from the console with `PUT /api/option/`.** That route is root
  only, and the console would write the whole map from what it last read,
  the race the capacity panel already has.
- **A column on users.** Rejected for the same reasons as in the 2026-10-27
  note; the limiter reads the option map in memory on every request.

## Consequences

- The capacity panel still saves the whole map, so a save there from a page
  opened before an edit in the user editor undoes that edit.
- The user's other fields are written before the override, in a separate
  transaction; if the override write fails, the request fails with the other
  fields already saved.

## Verification

- `TestAdminSetsUserConcurrencyLimitThroughUserEdit` stores the option row
  with another user's override that the server's memory lacks, then sets 20,
  omits the field, sends -1 and `"20"`, sets 0 and sends `null`, checking
  the stored map, the in-memory override and `GET /api/user/:id` after each.
  With the map built from memory instead of the stored row, it fails on the
  missing user 7.
- `go vet ./...` and `go test ./...` pass on SQLite.
- Console: `bun run typecheck`, `bun run lint:check`, all 4,623 vitest
  tests, `bun run build` and `bun run first-load:check` pass; oxfmt reports
  none of the changed files. The two new strings fall in the `rest` locale
  part, so no core page loads them.
