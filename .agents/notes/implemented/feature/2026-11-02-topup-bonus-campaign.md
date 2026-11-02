# Agent Note: Headline a limited-time top-up bonus in the wallet

Status: implemented

## Problem

For the Double 11 sale (2026-11-03 to 11-11), the operators replace the
everyday top-up bonus tiers (`payment_setting.amount_bonus`, see
`2026-10-25-topup-bonus.md`) with richer ones for nine days. The tiers already
show as small green "+N% bonus" labels on each amount, which look the same as
the everyday ones. Customers needed to see on the wallet that a sale is on and
when it ends.

## Decision

- **`payment_setting.bonus_campaign`** is a free-text headline the operator
  writes, for example 「双 11 特惠 · 单笔 ¥10 起送 11%，11 月 11 日 23:59
  截止」. It is empty by default. `/api/user/topup/info` returns it as
  `bonus_campaign`. The update rejects a value longer than 120 characters; an
  empty value is allowed and ends the banner.
- **It changes no price.** The tiers stay in `amount_bonus`. A sale is two
  option writes at its start (tiers and headline) and two at its end.
- **The wallet shows it only when a bonus can be earned**, that is, when
  there are tiers and an epay method. It renders a red banner above the
  amounts: the headline, then 「最高送 N%」 computed from the highest tier, so
  the figure always matches what the server credits. While it is set, each
  amount's bonus label becomes a red chip.
- **The amount row may wrap.** With the chip, 「1,000 送 12%」 overflowed its
  button in the four-column grid at 1280 px, so the label moves under the
  amount when it does not fit.

## Alternatives considered

- **Hard-code the sale's dates in the console.** No server change, but the
  banner would need a console release to start, stop, or reword, and dead code
  after the sale.
- **Generate the whole banner from the tiers.** Accurate, but it cannot name
  the sale or its end, which is the point of the banner.

## Consequences

- An operator who changes the tiers without clearing the headline leaves a
  banner whose free text may no longer match. The second line is computed from
  the tiers, so the top rate stays right.
- A console released before the server reads a missing field as no campaign.

## Verification

- `TestTopUpBonusCampaign` loads the headline from an option row, clears it
  with an empty row, and checks the 120-character limit.
- The wallet was rendered locally against production data through a
  read-only proxy that injected the sale's tiers, headline and amounts, at
  1280, 1024 and 390 px wide: the banner shows, every chip stays inside its
  button.
