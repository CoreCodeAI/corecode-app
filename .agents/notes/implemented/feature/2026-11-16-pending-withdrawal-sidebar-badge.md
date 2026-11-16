# Agent Note: Show pending commission withdrawals on the sidebar

Status: implemented

## Problem

A promotion channel's withdrawal request sends no notice. Root learned of one only by opening Invitation program → Withdrawals, so a request could wait unseen. Invoice management already shows a count of applications waiting for review on its sidebar item.

## Decision

- **`GET /api/affiliate/admin/withdrawal-count`** returns `{count}`, the withdrawals in `pending`. It sits with the other withdrawal routes under `RootAuth`, and a personal access token needs `billing:read`, as for the withdrawal list.
- **The Invitation program sidebar item shows the count** when it is above zero, like Invoice management. `features/affiliates/hooks/use-pending-withdrawal-count.ts` polls it every 60 seconds, for root only, the role that sees the item.
- **The hook does not import `features/affiliates/api`.** The sidebar renders on every page, and that module would bring the affiliate API and its messages into the layout chunk.
- **Its query key sits under `['affiliate']`**, which the withdrawals tab invalidates after a payout or rejection, so the badge updates at once.

## Alternatives considered

- **Read `pending_withdrawals` from `/api/affiliate/admin/overview`.** The overview sums commission over every affiliate and counts recent sign-up gifts; polling it every minute from every root page costs more than one indexed count.
- **A Feishu notice on each request.** It reaches root away from the console, but needs its own delivery path and failure handling. The badge covers the case the operator asked for.

## Consequences

- One small request per minute per open root console.
- The badge links to the program's first tab; the count is on the Withdrawals tab.

## Verification

- `TestAffiliateCommissionDatabaseMatrix` (SQLite) checks the count is 2 with two requests pending and 0 after one is rejected and one paid. With the status filter removed, it fails at the second count.
- `go test ./router ./middleware ./controller` passes, including the access-token rule coverage in `router`.
- `bun run typecheck`, oxfmt and oxlint on the changed files, `bun run lint:check`, and `bun run test src/hooks src/features/affiliates src/components/layout` (46 tests) pass.
- `bun run first-load:check` passes. Against a build of `origin/main` on the same machine, `/dashboard/overview` grows 38 bytes (317 left) and `/keys` 25 bytes (797 left), with the same file lists.
