# Agent Note: Ask before the key drawer discards unsaved edits

Status: implemented

## Problem

The drawer that creates and edits an API key closed on an overlay click, on
Escape and on its Close button, and dropped whatever had been entered: name,
group, Auto order, quota, expiry, model and IP limits. Nothing asked first.

## Decision

- **A close that would drop edits asks first.** `useUnsavedChangesGuard`
  takes the form's dirty state and the drawer's `onOpenChange`. It returns the
  handler the sheet uses and a `ConfirmDialog` that the drawer renders. A clean
  form closes at once. The drawer's own closes after saving or creating call
  `onOpenChange` directly and are not asked about.
- **The form is dirty only after it is initialized.** The drawer passes
  `isFormInitialized && form.formState.isDirty`. Initialization goes through
  `form.reset`, and the group fallback uses `setValue` without `shouldDirty`,
  so neither counts as an edit. The lazily loaded Auto order editor calls
  `onChange` only when the customer changes the order.
- **The dialog reuses strings the core locale already has**: "Unsaved
  changes", "You have unsaved changes. Are you sure you want to leave?" and
  "Leave". The model drawer's "Discard unsaved changes?" set lives in the rest
  part. Moving it into the core part added 96 bytes, and `/dashboard/overview`
  had 101 bytes of room.

## Alternatives considered

- **Blocking route changes and page unloads too**, as the system settings'
  `FormNavigationGuard` does. The drawer covers the page, so its own closes are
  the common loss; a router blocker on `/keys` would also add to a first-load
  budget page.
- **Saving a draft instead of asking.** It keeps edits across closes, but a
  stale draft would reappear on the next key opened.

## Consequences

- The guard covers this drawer only. Other customer forms (profile, security)
  can take the hook later.
- The guard adds about 0.15 KB (brotli) to `/keys`, which leaves 31 bytes of its
  budget.

## Verification

- `api-keys-mutate-drawer.test.tsx`, with the Auto order editor loaded before
  each close: an untouched form closes on Escape without the dialog; an edited
  form asks on Escape and stays open, with its value, after Cancel; an edited
  form closes from Close once Leave is pressed. With the sheet back on the
  unguarded handler, the two edited-form tests fail. The existing
  editing-session test still closes an untouched update form from Close.
- `bun run test` (309 files, 3156 tests), `bun run typecheck`,
  `bun run lint:check`, `bun run format:check`, `bun run build`,
  `bun run first-load:check` (`/dashboard/overview` 526.9 of 527 KB, `/keys`
  607.0 of 607 KB), all with exit status 0.
