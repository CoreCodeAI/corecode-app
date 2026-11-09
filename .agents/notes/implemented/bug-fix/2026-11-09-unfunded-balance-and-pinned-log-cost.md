# Agent Note: Word a never-funded balance neutrally, and keep log cost in view

Status: implemented

## Problem

A new account has a zero balance before its first top-up. `useBalanceStatus` called that
`empty`, so the overview's balance card and the sidebar said "余额已耗尽" in the alarm colour
next to the first-run checklist that was meant to replace the alarm.

On the admin's common-log table at 1440 px the table is about 1570 px wide in a 1190 px pane.
Cost is the eighth of ten columns, so it scrolled out of view behind Timing and Details. The
column count, not the token cell, causes the overflow: the token cell is about 195 px.

Two branches that each added "Create an API key" to every locale merged without a conflict,
because git saw the additions on different lines. Each locale file then held the key twice, and
JSON.parse kept the later value.

## Decision

- `BalanceHealth` gains `unfunded`: no spendable credit on an account with no requests and no
  usage, the same test `isFirstRun` uses for the checklist. It reads "Not topped up yet" with a
  muted dot. The sidebar and alert colours apply only to `low` and `empty`, so an account that has
  spent still reads as depleted in red.
- The common-log table pins `quota` (Cost) to the right edge through the shared `pinnedColumns`.
  Sticky positioning has no effect when the table fits, so the narrower customer view is unchanged.
- The duplicate key is removed, keeping the value the console already served, and
  `locales.test.ts` fails when a locale file repeats a key.

## Alternatives considered

- **Shorten the token cell.** It would not fit ten admin columns into 1190 px.
- **Hide Timing or Details for admins.** Both are used when investigating a request.
- **Detect a first-time account from the balance alone.** A long-time customer at zero would lose
  the depleted warning.
