# Agent Note: Raise the first-load budget by 2 KB

Status: implemented

## Problem

The three core pages sat within a few dozen bytes of `web/first-load-budget.json`:
`/sign-in` had 35 bytes left, `/dashboard/overview` 47 and `/keys` 290. Three changes
the owner asked for could not land under it:

- the key and usage-log interactions put `/keys` 70 bytes over;
- the list load-failure state put `/keys` 20 bytes over;
- four finished fixes were held back for lack of room: tap readings on the overview's
  spend chart, the Safari copy path for the setup snippet, autofill hints on the
  sign-in forms, and the session-expired message on the sign-in page.

## Decision

Each page's budget goes up 2 KB: `/sign-in` 353 to 355, `/dashboard/overview` 528 to
530, `/keys` 608 to 610. The owner approved the raise on 2026-11-12.

## Alternatives considered

- **Move other code off the first load to make room.** The two speed rounds already
  took what was cheap to move; the next candidates are the sign-in form and the
  overview's charts, each a change of its own.
- **Drop the changes.** They fix things customers hit: a list that reads as empty when
  its request failed, and a spend chart a phone cannot read.

## Consequences

- 2 KB is about 3 ms of download at 600 KB/s on a cold visit.
- The check still fails on a change that pulls a page into the entry: the one it was
  written for added 144 KB.
- The room is for the changes above. A later change that needs more raises the budget
  in its own commit, as before.

## Verification

`bun run first-load:check` on each branch that carries this commit, recorded in its
pull request.
