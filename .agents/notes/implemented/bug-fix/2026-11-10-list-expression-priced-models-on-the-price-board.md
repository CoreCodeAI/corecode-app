# Agent Note: List expression-priced models on the price board

Status: implemented

## Problem

The price board built rows only for token-priced models and for per-request models without an
expression. A model priced by any other billing expression fell into neither list, so a group made
only of them read "No models match your search". On production that emptied the image group, whose
models bill by output size, and the two video groups, whose models bill per second. Their vendor
logos were missing too, because the vendors table is empty and the name-prefix guess knew only
Claude, GPT, Grok and Gemini.

An image model also carries a stale `model_price`. The server does not charge it, so a fix that
fell back to that field would show a wrong figure.

## Decision

- `getExpressionPrice` (`lib/board-rows.ts`) summarises an expression-priced model. A task model
  with one unconditional tier priced in seconds reports its price per second, read through
  `getDynamicPricingTiers`. An image expression whose request rules read only `size` is evaluated
  by `evaluateBillingExpression` at 1K, 2K and 4K with one image, so each figure is what the server
  computes, whatever multipliers the expression carries. Anything else returns null.
- The board lists every dynamic model that has no token row and no per-request row in a "Priced by
  usage" table. A null summary shows a link to the model's details instead of a price, so a model
  is never hidden and never shown with a figure the server does not charge. `model_price` is never
  read for these models.
- `seedance-` maps to ByteDance (`ByteDance.Color`) and `wan-` to the custom `Wan` icon. The dash
  keeps `wandb` and similar names out.

## Alternatives considered

- **Parse the size multipliers from the request rules.** It would show the same numbers but trust
  the rule text; evaluating the expression cannot drift from the server's arithmetic.
- **Show the details link for every expression model.** It fixes the empty group but leaves the
  customer with no price on the page whose job is prices.
