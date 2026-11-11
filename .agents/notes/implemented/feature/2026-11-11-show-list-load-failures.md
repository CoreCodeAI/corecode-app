# Agent Note: Show a list's load failure instead of its empty state

Status: implemented

## Problem

`DataTablePage` (`web/src/components/data-table/layout/data-table-page.tsx`, upstream code)
knew only `isLoading` and `isFetching`. When a list query failed on its first load, the
page passed `data?.items || []`, so the table rendered its empty state. On `/keys` that
reads "No API Keys Found ... Create your first API key" with a create button: a customer
who has keys could take a failed request for deleted keys and create another. The only
sign of the failure was a toast that disappears after five seconds.

## Decision

- **`DataTablePage` takes optional `isError`, `onRetry` and `errorTitle`.** When the query
  failed and is not loading:
  - with no rows, the existing `components/error-state.tsx` (title and a Retry button)
    replaces the desktop table and the mobile list, whether the default `MobileCardList`
    or a custom `mobile` node, so phones are covered without changing each list;
  - with rows from an earlier load still in the query, the rows stay and a one-line
    `role="alert"` line with a Retry button sits above them.
- **The new rendering lives in a new file**, `layout/data-table-load-error.tsx`; the
  upstream page gains three optional props and one call site. A caller that passes none
  of them renders exactly as before.
- **Wired into `/keys` and the usage logs only**, with the query's `refetch` as the retry
  and the existing "Failed to load API keys" and "Failed to load logs" strings as titles.
  The other 19 `DataTablePage` lists can opt in the same way.
- While a retry is in flight on `/keys` the error state stays (TanStack keeps
  `status: 'error'` during the refetch); hiding it would flash the create prompt again.
  The usage logs already show the skeleton while they fetch with no data.

## Alternatives considered

- **Adding error props to `MobileCardList` and `DataTableView` as well.** The two pages in
  scope pass custom mobile lists, so the props would not reach them; handling the state
  once in `DataTablePage` covers every mobile variant with fewer upstream edits.
- **Keeping the previous page's rows through `placeholderData` when a page change fails.**
  TanStack only applies placeholder data while a query is pending, so a failed page has
  no rows and gets the full error state, which is the honest answer for that page.

## Consequences

- The error state adds about 320 bytes to `/keys`' first load (622,227 to 622,547 bytes of
  622,592 on top of the toast change), leaving the page almost no room.
- `data-table-page.tsx` is an upstream file: a sync that reshapes its props or the
  `mobileNode` / `desktopNode` lines conflicts here.

## Verification

- `bunx vitest run src/components/data-table/layout/__tests__/load-error.test.tsx
  src/features/keys/components/__tests__/api-key-listing.test.tsx`: 37 passed. With
  `data-table-page.tsx` reverted, the four new tests fail (error state, phone list, kept
  rows with alert, and the `/keys` first-load failure with retry).
- `bun run typecheck`, `bun run lint:check`, `bun run format:check`, `bun run build` and
  `bun run first-load:check` pass in `web/`; the byte counts come from the same script
  printing bytes.
