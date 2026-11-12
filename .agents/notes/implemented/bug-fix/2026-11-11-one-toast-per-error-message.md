# Agent Note: One toast per error message

Status: implemented

## Problem

`handleServerError` (`web/src/lib/handle-server-error.ts`, upstream code) reports a failure
once per error object, following its `cause` chain. Pages such as the overview run several
queries at once; offline or during a 5xx burst each query fails with its own error object
and the same text, so sonner stacked several identical toasts ("Network Error") over the
top of the page. A 401 burst is not affected: the interceptor navigates to `/sign-in`.

## Decision

- Every toast raised by `handleServerError` uses its message as its id. Sonner replaces a
  toast with the same id and restarts its timer, so identical messages show as one toast;
  different messages still stack. The id carries no prefix: `handle-server-error.ts` is in
  the entry bundle, and `/dashboard/overview` and `/keys` had a few dozen bytes of
  first-load budget left. The only other toast id in the console is
  `feedback-reply`, which no error message equals.
- The per-object deduplication is unchanged, and `toast.error` is still called once per
  independent failure, so callers and tests that count reports see the same calls.
- `web/AGENTS.md` section 3.9 now says identical messages share one toast.

## Alternatives considered

- **Deduplicating in `handleServerError` with a time window.** It would drop calls, change
  what the reporting tests observe, and need a clock; the toast id gives the same screen
  result inside the library.

## Consequences

- Two different operations that fail with the same text in the same five seconds show one
  toast. The text is the same, so nothing the user could act on is lost.

## Verification

- `bunx vitest run src/lib/__tests__/server-error-toast-stacking.test.tsx` failed before the
  change (three "Network Error" toasts rendered, one expected) and passes after it, with
  `src/lib/__tests__/server-error-notifications.test.ts` (23 tests in both files).
- `bun run typecheck`, `bun run lint:check` and `bun run format:check` pass in `web/`.
