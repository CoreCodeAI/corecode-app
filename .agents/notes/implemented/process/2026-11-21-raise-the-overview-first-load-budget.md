# Agent Note: Raise the overview's first-load budget by 1 KB

Status: implemented

## Problem

The setup guide now opens on Magpie and links its hint to
`https://usemagpie.ai/`, as the owner asked on 2026-11-21. The guide renders on
`/dashboard/overview` before it paints, so the link's markup lands in that
page's first load.

Local `first-load:check` after `bun run build`:

- main `origin/main` at branch point: `/dashboard/overview` 536.0 KB of 536 KB,
  10 bytes left.
- this branch: 69 bytes over 536 KB. The built CSS is byte-identical to main's.

## Decision

`/dashboard/overview` goes from 536 to 537 KB. The other budgets do not move.

## Alternatives considered

- **Trim the link.** Main left 10 bytes, so no visible change to the overview
  fits; the link is already a plain anchor with classes the console uses
  elsewhere.
- **Show the link only in the keys dialog.** The owner asked for it on the
  overview.

## Consequences

- About 60 bytes more on a cold visit to `/dashboard/overview`.
- The overview keeps about 950 bytes of room.

## Verification

`bun run first-load:check` on this branch after the raise: 956 bytes left.
