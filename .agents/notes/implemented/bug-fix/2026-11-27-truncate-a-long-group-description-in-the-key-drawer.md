# Agent Note: Truncate a long group description in the key drawer, name DeepSeek's groups, and count a group's markup in its figure

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

The price board's group figure ("about N of official price" on the group card, in the mobile
picker, and on the lone-group banner) multiplied only the exchange rate and the group ratio.
Every model of 「DeepSeek（官Key）」 carries `official_price_markup` (deepseek-flash and
deepseek-v4.1-flash 6.666667, deepseek-v4-pro 6.818182), so at ratio 0.6 the card claimed
0.9 of the official price when the truth is about 5.9.

## Decision

- Add `min-w-0` to the combobox trigger, so the grid track follows the drawer's width and the
  existing `truncate` spans cut the description. The dropdown list is unchanged.
- Map `deepseek-` models to DeepSeek (`DeepSeek.Color`) in the pricing fallback, the same key
  `/api/pricing` uses for vendor -1005. List DeepSeek after xAI and before ByteDance on the
  service-status page. That page already resolved the DeepSeek logo through
  `lib/model-provider.ts`.
- A group's own figure multiplies by `getGroupMarkupFloor` (`lib/billing-discount.ts`): 1 when
  any of the group's token-priced models has no markup, otherwise the smallest markup among
  them. infra's `render-pricing.py` applies the same rule. A Claude group, where Fable at 1.5
  sits beside unmarked Opus, keeps its figure; a group whose every model is marked up never
  claims more than its least marked-up model saves. Each model's own saving chip still
  multiplies in its own markup.

## Alternatives considered

- **Shorten the group description.** Fixes this one group, but the next long description would
  overflow again.
- **Average the group's markups.** Would claim more saving than some models give; the floor
  never overstates.
- **`overflow-hidden` on the trigger.** Clips the border instead of shrinking the box, and the
  Auto group's flow border relies on `overflow-visible`.

## Verification

A headless Chrome page with the drawer's ancestor chain (three flex columns, a `grid`
FormItem, an inline-flex `whitespace-nowrap` button, and the production description) measured
the trigger at 1012 px in a 400 px drawer without `min-w-0`, and 400 px with it. The combobox
test asserts the class and the truncating span. The vendor tests cover the DeepSeek group in
both maps. `getGroupMarkupFloor` is tested on a Claude-like mix (1), an all-marked group
(6.666667) and a group with no token-priced model (1). A price-board test renders a DeepSeek-like
group at 0.6x beside a Claude group and expects 5.9 and 2.2 of the official price; against the
old board it fails, finding no 5.9.
