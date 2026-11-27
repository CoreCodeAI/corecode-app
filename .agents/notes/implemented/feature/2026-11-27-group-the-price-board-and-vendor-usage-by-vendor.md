# Agent Note: Group the price board by vendor, and give DeepSeek and media their own usage tabs

Status: implemented

## Problem

The price board at `/pricing` put the Claude groups first and listed every other group in one
「更多模型」 grid, ordered by group ratio alone. On 2026-11-27 that interleaved vendors: GPT 福利
(0.5×), DeepSeek（官Key） (0.6×), GPT (0.7×), GPT（UltraFast） (1×), Seedance视频 (1×), GPT生图1-4K
(1×), Grok (1.2×). The four OpenAI groups were spread across the grid with other vendors between
them.

The funds tab's 「按厂商：消耗与成本」 panel had tabs for Claude, Codex, Grok and Gemini only. The
server's `ModelVendor` had no `deepseek-` prefix, so DeepSeek's charge fell into "other" with
any unrecognised model. Seedance and the other image and video models were already the `media`
vendor on the server, but the panel had no tab for it, so their charge was in no tab.

## Decision

- `orderGroups` (`web/src/features/pricing/lib/group-vendors.ts`) keeps Claude first, then puts
  each other vendor's groups together. Vendors are ordered by their cheapest group. Within a
  vendor, token-priced groups come before per-call ones (images, video), each cheapest first.
  Groups no vendor claims come last. `vendorSections` splits that order into one run per vendor.
- The desktop board gives each vendor a heading with its icon and name, as Claude already had.
  Each non-Claude vendor block spans one column per group, up to three, so a single-group
  vendor shares a row with others instead of taking a full row. The phone picker shows the
  same sections. Each section's title is a plain `aria-hidden` element, and the group is named
  by `aria-label`, because `SelectLabel` would add Base UI's group label to the select chunk
  that every core page preloads.
- The server gains `VendorDeepSeek` (`deepseek-`) in `model/site_insights_finance.go`. The
  console adds `deepseek` to `VENDOR_ORDER` and `MARGIN_VENDORS`, with a deeper shade of the
  fourth series color and the name DeepSeek in `useVendorName`. The vendor panel's tabs are
  Claude, GPT, DeepSeek, Grok, Gemini and 图像与视频, plus 其他模型 when it has charge. Tab labels
  now come from `useVendorName`, so the Codex tab reads GPT, as on every other vendor panel.

## Alternatives considered

- **Reorder without headings.** In a three-column grid, OpenAI's four cards still wrap beside
  DeepSeek, so the grouping does not read.
- **A full-width row per vendor.** Clear, but four single-group vendors made the board twice as
  tall.
- **Order vendors by a fixed list.** Has to be edited for each new vendor. Ordering by cheapest
  group follows the data.

## Rollout

The server and console ship from the same merge, with the server first. Until the console
follows, the console in production files `deepseek` models under no tab. Its margin panel then
sorts a `deepseek` row first, labelled with the raw key.

## Verification

`group-vendors.test.ts` orders the 2026-11-27 board from reversed input and expects each vendor
together. Its fixture makes the image group cheaper than UltraFast to prove the per-call rule.
The test fails with the old comparator, and fails again with the per-call tiebreak removed.
`finance-tab.test.tsx` expects the six tabs, and DeepSeek and Seedance charges in their own
tabs; it fails with the old tab list. `TestMediaVendorMatchesRealModels` maps three live
DeepSeek names to `deepseek` and fails without the prefix.

In ego-browser, the dev server read production `/api/pricing` through a GET-only proxy. At
1,488 px the board showed Claude, OpenAI ×4, then DeepSeek, ByteDance and xAI sharing one row;
at 900 px, two columns. At 390 px, a touch on the picker opened the same five sections. The
core pages' first load is 28 bytes under main's on `/keys` in a local build, and the CSS is
byte-identical to main's.
