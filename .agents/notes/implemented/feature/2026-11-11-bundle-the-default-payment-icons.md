# Agent Note: Bundle the default payment icons

Status: implemented

## Problem

The default PayMethods option, and production's (commit 099c6141d), names the icons
`SiAlipay`, `SiWechat` and `LuCreditCard`. `getPaymentIcon` handed a configured name to
`ReactIconByName`, which imports a whole react-icons pack per name prefix. The Simple
Icons pack is one module: in this build `63898.42a36b960d.js`, 5,088,126 bytes raw and
1.7 MB brotli. Every customer who opened the wallet downloaded and parsed it to draw two
payment buttons, after the top-up info request had returned.

## Decision

- **`wallet/lib/payment-icon-glyphs.ts` holds the three glyphs**, built with `GenIcon`
  from `react-icons/lib` and the SVG trees copied from react-icons 5.7.0. `GenIcon` is the
  function every react-icons export is built with, so each renders the same `<svg>` as
  the pack's export, attributes included.
- **`getPaymentIcon` looks the name up there first** and renders the glyph synchronously,
  with the brand color of the payment type as before. Any other name still goes through
  `ReactIconByName`.

## Alternatives considered

- **Map the names to the built-in `IconAlipay` and `IconWeChat`.** `IconAlipay` draws the
  same path as `SiAlipay`, but `IconWeChat` draws a different glyph on a 1024 viewBox, and
  both set their own `fill-current` class and `<title>`. The icons on the wallet would
  change.
- **Remove the icon names from production's PayMethods.** No code change, but the
  fallback icons differ, and any site keeping the defaults keeps the download.
- **Import the glyphs from `react-icons/si`.** The pack is a single 5 MB module, so this
  only works if tree-shaking removes the rest, and the generic loader imports the same
  module by namespace in another chunk.

## Consequences

- The wallet draws the default payment icons on first paint, without the icon pop-in
  that came after the pack loaded.
- The si pack still ships and still loads for an icon name outside the three, from the
  wallet or from the admin payment method dialog.
- A react-icons upgrade that redraws one of these glyphs no longer reaches the wallet.
  The test compares each bundled glyph with the installed pack's export, so it fails
  when they drift.

## Verification

- `wallet/lib/__tests__/payment-icons.test.tsx`: for each of the three names, the icon
  is present on the first synchronous render and its `outerHTML` equals the pack
  export's rendered with the same class, title and color. A name outside the set
  (`SiStripe`) still renders nothing first and then resolves through the loader. With
  `ui.tsx` reverted, 5 of the 10 tests fail.
- `bun run build`: `63898.42a36b960d.js` (5,088,126 B, 1.7 MB `.br`) is unchanged and is
  referenced only from the lazy loader's map in `29651.593475a819.js` and from other
  chunks' loader maps. The wallet's `61749.f67fc4930c.js` (14.1 KB, 4.6 KB `.br`) now
  contains the bundled glyphs and `getPaymentIcon`.
- `bun run first-load:check`: `/sign-in` 352.4, `/dashboard/overview` 526.9, `/keys` 606.6
  KB, the same as before the change.
- Not measured in a browser: whether the wallet makes the request was checked through the
  synchronous render in the test, not through a network log.
