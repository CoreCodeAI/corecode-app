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
