# Agent Note: Price the board in USD, CNY or HKD

Status: implemented

## Problem

`/pricing` showed every price in CNY: what a customer pays at ¥1 per $1 of credit, against
the official price in yuan at the site's reference rate. The owner asked for prices in
USD by default, and for Hong Kong dollars to be available to Traditional Chinese readers.
The console had no HKD rate. The server already fetched one for Stripe Checkout, which
charges HKD for a CNY price (`controller/stripe_fx.go`).

## Decision

- **A currency switch on the price board: USD (the default), CNY and HKD.** Every figure
  starts as yuan and is converted once, in `features/pricing/lib/price-currency.ts`:
  - USD: yuan ÷ `usd_exchange_rate`. The official price then reads as the vendor's USD
    list price (Sonnet 5.5 input $2), and every saving keeps its share.
  - HKD: yuan × `hkd_per_cny`, what Checkout charges for one yuan.
  It covers the price list, the media rows, and the Claude Code estimate on the page and in
  the model drawer. The billing explainer and the "¥1 buys $1 of credit" line stay in
  CNY: they describe the top-up, which is priced in CNY.
- **USD is the default in every language, Traditional Chinese included**, at the owner's
  choice; HKD is offered beside the other two. A pick is kept in `?currency=` (omitted for
  USD) and in localStorage `corecode:pricing-currency`, so a link reproduces the view and a
  return visit keeps the last pick.
- **`GET /api/pricing` returns `hkd_per_cny`**: the cached market rate less
  `StripeHKDDiscount`, rounded to four decimals, so the page shows what Checkout would
  charge. `pricingHKDPerCNY` never waits on a fetch: it reads the last rate from an atomic
  snapshot, which `stripeHKDPerCNY` stores on each successful fetch. When the rate is over
  an hour old or missing, it starts one background fetch. It answers 0 when no rate is
  younger than a day, and the board then hides HKD and shows USD.
- **The console detects language from the `i18next` cookie first.** See the workspace note
  `corecode-infra/notes/workspace/implemented/architecture/2026-11-17-share-the-language-choice-in-a-cookie.md`.
  The detector keeps its default cookie name and options, so `/dashboard/overview`, whose
  entry carries the config, grows 57 bytes (317 to 260 bytes of room).

## Alternatives considered

- **USD as the credit spent ($3.8 for what costs ¥3.8).** Rejected by the owner: the
  official figure would read $13.6 for a $2 list price.
- **A fixed HKD rate in the console.** It would drift from what Checkout charges, and the
  server already keeps the live rate.
- **Fetch the rate inside the pricing request.** A cold cache would hold `/api/pricing` for
  up to two 5-second source timeouts.
- **HKD by default for Traditional Chinese.** Asked first; the owner chose USD for every
  language.

## Verification

- `controller/pricing_hkd_test.go`: with no rate, `pricingHKDPerCNY` answers 0 at once and
  starts one fetch; after it, 1.1 × (1 − 0.01) = 1.089, and a fresh rate starts no fetch. A
  rate older than a day answers 0. Run with `-race` together with the Stripe tests.
- `lib/__tests__/price-currency.test.ts` and `price-board.test.tsx`: ¥13.6 is $2, ¥3.8 is
  HK$4.1382 at 1.089; HKD is hidden without a rate; the board shows $0.8824 against
  "Official $4" and HK$6.534 against HK$29.6208, both "Save 78%", and the picker reports
  `cny`.
- On the dev server against production's pricing data and a live rate, the board
  defaulted to USD in Traditional Chinese, and `?currency=hkd` showed claude-sonnet-5 at
  HK$4.4506 against HK$15.9283.
