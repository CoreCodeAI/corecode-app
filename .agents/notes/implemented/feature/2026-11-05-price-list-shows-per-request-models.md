# Agent Note: The price list shows per-request models

Status: implemented

## Problem

On 2026-11-05 `gpt-image-2` (group `GPT`) and `grok-imagine-image` (group `Grok`) went on
sale at ¥0.06 per image. new-api bills both per request: `quota_type` 1 with a
`model_price`. `PriceBoard` lists only models `getBaseUnitPrices` can price per million
tokens, so a customer who picked GPT or Grok on `/pricing` saw neither model, though
`/api/pricing` returned both. corecode-infra's static pricing pages had the same gap and
list them since its PR 204.

## Decision

- Below the token table, a group's per-request models get their own table, named
  "Per-request". It has two columns: the model and its price per request,
  `model_price` × group ratio × `Price`. That is the token table's group-price formula
  applied to a per-request price, and it matches `formatFixedPrice`.
- No official price or saving is shown, because new-api has no official per-request
  figure to compare with.
- A note under the table says that each generated image counts as one request. The note
  is a new key, translated in all eight locales; the headers reuse the existing
  `Per-request` and `Per request` keys.
- A model counts as per-request when its `quota_type` is 1, its price is not an
  expression, and its `model_price` is a non-negative number. Expression-priced and task
  models keep their current handling.
- A group with only per-request models shows only that table.

## Alternatives considered

- **A per-request column in the token table.** Every token row would carry an empty
  cell, and every per-request row would carry four.
- **Point customers at the model details drawer.** The drawer opens only from a row,
  and these models had no row to click.

## Consequences

- The per-request table is the same on mobile and desktop. Two columns fit a phone, so
  it needs no card layout.
- A future per-request model, such as video, appears with no code change. The note's
  wording assumes images.

## Verification

- `price-board.test.tsx` has two new tests:
  - A GPT group holding a chat model and `gpt-image-2` at 0.075 × 0.8 shows ¥0.06 in the
    per-request table, with no official price, and keeps each model out of the other
    table.
  - A Grok group of only `grok-imagine-image` at 0.05 × 1.2 renders one table at ¥0.06.
- The pricing suite passes: 19 files, 331 tests. Format and the lint baseline report no
  new findings.
