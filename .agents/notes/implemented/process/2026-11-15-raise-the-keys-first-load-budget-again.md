# Agent Note: Raise the keys page's first-load budget by another 1 KB

Status: implemented

## Problem

The WeChat-only Dodo Payments change
([2026-11-15-dodopayments-wechat-only](2026-11-15-dodopayments-wechat-only.md))
adds eight locale keys: the settings tab's copy and the server's two refusals.
They put `/keys` 252 bytes over its 616 KB budget in CI.

Every one of them lands in the `core` locale part, which `/keys` and
`/dashboard/overview` load before they render. Server messages belong there by
design. The settings copy is there because the core routes reach 149
system-settings modules through `components/layout/config/system-settings.config.ts`,
so `i18n-locale-split-loader.mjs` files every settings string as `core`. The
NOWPayments settings strings are there for the same reason.

CI's `first-load:check`, same pinned Bun:

- main `f8ba8875f`: `/keys` 615.9 KB of 616 KB, 128 bytes left; `/dashboard/overview` 685 left.
- this branch: `/keys` 252 bytes over; `/dashboard/overview` 305 left.

The change costs about 380 bytes on both pages.

## Decision

`/keys` goes from 616 to 617 KB, approved by the owner on 2026-11-15.
`/dashboard/overview` still fits its 535 KB and does not move.

## Alternatives considered

- **Shorten the copy.** Main left 128 bytes; cutting enough to keep 100 bytes of
  room would leave the cap and method fields unexplained.
- **Drop the two fields from the tab and set them through the option API.**
  Administrators could not see what limits the checkout.
- **Stop the layout config from reaching the settings modules.** It would move
  every settings string out of the first load, but it is a change of its own.

## Consequences

- About 0.4 KB more on a cold visit to `/keys`, under 1 ms at 600 KB/s.
- `/keys` keeps about 770 bytes of room. `/dashboard/overview` keeps about
  300, so the next settings string may need the reachability fix above rather
  than another raise.

## Verification

CI's `first-load:check` on this branch after the raise.
