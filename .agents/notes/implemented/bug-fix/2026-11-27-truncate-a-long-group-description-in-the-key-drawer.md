# Agent Note: Truncate a long group description in the key drawer, and name DeepSeek's groups

Status: implemented

## Problem

The group 「DeepSeek（官Key）」 opened on 2026-11-27 with a one-line description of about 110
characters. With it selected, the group trigger in the create and edit API key drawer grew
past the drawer's right edge, and the description ran off without an ellipsis. The trigger is
the grid item of `FormItem` (`grid gap-2`). A grid item's automatic minimum width is its
min-content width, and the description is `whitespace-nowrap`, so the single column grew to
the whole sentence. The inner `truncate` spans never got a narrower box to truncate in.

The console's group-to-vendor fallback in `features/pricing/lib/group-vendors.ts` had no
`deepseek-` prefix, and the service-status page ordered DeepSeek groups after every named
vendor, behind Seedance.

## Decision

- Add `min-w-0` to the combobox trigger, so the grid track follows the drawer's width and the
  existing `truncate` spans cut the description. The dropdown list is unchanged.
- Map `deepseek-` models to DeepSeek (`DeepSeek.Color`) in the pricing fallback, the same key
  `/api/pricing` uses for vendor -1005. List DeepSeek after xAI and before ByteDance on the
  service-status page. That page already resolved the DeepSeek logo through
  `lib/model-provider.ts`.

## Alternatives considered

- **Shorten the group description.** Fixes this one group, but the next long description would
  overflow again.
- **`overflow-hidden` on the trigger.** Clips the border instead of shrinking the box, and the
  Auto group's flow border relies on `overflow-visible`.

## Verification

A headless Chrome page with the drawer's ancestor chain (three flex columns, a `grid`
FormItem, an inline-flex `whitespace-nowrap` button, and the production description) measured
the trigger at 1012 px in a 400 px drawer without `min-w-0`, and 400 px with it. The combobox
test asserts the class and the truncating span. The vendor tests cover the DeepSeek group in
both maps.
