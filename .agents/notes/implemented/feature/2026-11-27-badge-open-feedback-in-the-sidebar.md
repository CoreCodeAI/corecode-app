# Agent Note: The sidebar badges open feedback reports

Status: implemented, pending merge

## Problem

The sidebar's 反馈审核 (`/feedback-admin`) entry gave no sign of reports
waiting on an administrator. Unhandled reports were noticed only when someone
opened the page. 发票管理 already shows a badge with its waiting count.

## Decision

- **Open means pending or processing.** A report counts until an
  administrator marks it resolved or invalid. Processing counts too, because
  it still needs a reply.
- **A new endpoint, `GET /api/feedback/admin/open-count`,** under the existing
  `AdminAuth` feedback group, returns `{count}`. No existing endpoint changes.
- **The console polls it the way it polls the invoice count:** every 60 s,
  administrators only, no error toast. The hook lives in
  `features/feedback-admin/hooks/` and calls `api` directly, so the layout
  chunk does not take in the feedback API module. Its query key sits under
  `['feedback', 'admin']`, which the review dialog already invalidates after a
  save, so the badge drops as soon as a report is closed.

## Verification

- `TestFeedbackFlow` asserts the count: 2 after two submissions, still 2 after
  one report moves to processing, 1 after it is resolved. Counting resolved
  reports as open makes the test fail.
- `bun run first-load:check` passes. `/keys` has 185 bytes left.
