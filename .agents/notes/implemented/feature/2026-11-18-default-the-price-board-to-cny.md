# Agent Note: Default the price board to CNY

Status: implemented

## Problem

[`2026-11-17-price-the-board-in-usd-cny-or-hkd.md`](2026-11-17-price-the-board-in-usd-cny-or-hkd.md)
made USD the default of `/pricing`. The owner found that this misrepresents what
customers pay: top-up is in CNY at ¥1 per $1 of credit, so a figure shown in dollars
reads about 6.8 times lower than the charge.

## Decision

- **On 2026-11-18 the owner reverted the default to CNY**, because the board must show
  what customers are charged. USD and HKD stay in the picker; the picker, `?currency=`,
  HKD support and the server's `hkd_per_cny` are unchanged.
- `DEFAULT_PRICE_CURRENCY` is `'cny'`. The URL omits `?currency=` for CNY and writes
  `?currency=usd` or `?currency=hkd` for the others, and `priceMoney` falls back to CNY
  when HKD has no rate.
- **No storage migration.** `corecode:pricing-currency` is written only in `setCurrency`,
  when a reader picks a currency, so it never holds a default the page chose itself. A
  reader who picked USD keeps USD.
- The earlier note's "USD (the default)" lines describe the 2026-11-17 state; this note
  supersedes them.

## Verification

- `price-currency.test.ts`: the default is `cny`, HKD without a rate falls back to CNY,
  and USD still converts when picked.
- `use-pricing-url-state.test.tsx`: the page starts on CNY, picking USD writes
  `currency=usd`, and picking CNY drops the parameter.

## Follow-up: default by browser language (2026-11-18 16:3x)

- **The owner then asked for the default to follow the reader's browser language,
  with CNY as the fallback** ("按照用户浏览器语言来切换，默认人民币展示"). The
  constant `DEFAULT_PRICE_CURRENCY` is replaced by
  `defaultPriceCurrency(language, rates)` in `price-currency.ts`.
- **Language source.** i18next's resolved language, as everywhere in the console: the
  `i18next` cookie, then `localStorage`, then `navigator.language`. The cookie wins over
  the browser because it holds the reader's own choice: the console writes it when they
  switch language, and the static site writes it when they land on `/zh-tw/`. A reader
  who switched the console to English gets USD whatever their browser says. The resolved
  codes are the console's `zhCN`/`zhTW`; the function also accepts BCP-47 tags.
- **Mapping.** zh, zh-CN, zh-SG, zh-Hans* → CNY. zh-TW, zh-HK, zh-MO, zh-Hant* → HKD
  while the server's `hkd_per_cny` is above 0, otherwise CNY. Every other language (en,
  ja, ko, ru, fr, vi, an unsupported one that falls back to en) → USD. A missing language
  → CNY. `priceMoney`'s HKD-without-rate fallback is the same function with no language.
- **Precedence is unchanged.** `?currency=` in the URL, then the pick stored in
  `corecode:pricing-currency` (written only by an explicit pick), then the language default.
- **A pick is always written to the URL, CNY included.** This replaces "the URL omits
  `currency` for CNY". A link without the parameter now opens in each reader's own
  default, so a zh reader who picks CNY and shares would show an en reader USD. Writing
  the parameter on every explicit pick keeps shared links faithful in both directions
  (a zh reader's `?currency=usd` opens in USD for an en reader, and an en reader's
  `?currency=cny` in CNY for a zh one). An unpicked page writes nothing.
- The billing explainer and the "¥1 buys $1 of credit" line stay in CNY.

### Verification

- `price-currency.test.ts`: each language bucket, HKD with and without a rate, unknown
  and missing → CNY.
- `use-pricing-url-state.test.tsx`: an English reader starts on USD, zh-TW on HKD, zh on
  CNY, a `?currency=` link overrides the language and a stored pick overrides the language,
  and a language default is never stored.
