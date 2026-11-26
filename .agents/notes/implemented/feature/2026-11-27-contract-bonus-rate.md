# Agent Note: A contract bonus rate per customer, the higher of it and the site's tier

Status: implemented

## Problem

Some customers were promised a top-up bonus that differs from the site's tiers
(`payment_setting.amount_bonus`, 3%, 5%, 7% and 10% at ¥300, ¥1000, ¥5000 and
¥10000 on 2026-11-27): PathPal and 申德盈瑞 10% on every transfer, Allen Mai
30%. The server did not know these terms. Online top-ups and on-chain deposits
applied the site's tiers to everyone, so a contract customer who paid in the
console got the site's rate. Offline payments took a `bonus` that an operator
worked out by hand before each `POST /api/user/topup/offline`, and nothing
stated whether a contract rate and the site's tier add up. Each payment from
these customers was handled case by case, and on 2026-11-12 one was credited
$400 too much and corrected on 11-18.

## Decision

- **`user_contract_bonuses` holds a customer's rate.** One row per user:
  `rate` (a fraction above 0, at most 1), `updated_by`, `updated_time`. A user
  without a row has no contract rate. It is a table of its own rather than a
  column on `users`, so the upstream user model and its update path stay
  untouched.
- **The higher rate applies; the two never add up.**
  `operation_setting.BonusTiersWithContract` merges the site's tiers with a
  contract rate: at every amount the higher of the two, the contract rate from
  an amount of 1, and only the tiers that raise the rate. `model.TopUpBonusTiersFor`
  reads a user's merged tiers.
- **Every top-up path reads the merged tiers.** `topUpBonusQuota(userId, amount)`
  serves epay, Stripe, Dodo Payments and NOWPayments. The on-chain deposit
  prices each credit with the depositor's tiers, read before the credit, and
  still adds `ChainDepositBonusRate` (1%) on top, as the owner decided. A
  contract rate starts at 1, so the deposit quote names no least transfer for
  it (`bonus_usd`, `lower_rate`).
- **The wallet shows the customer's own tiers.** `/api/user/topup/info`
  returns the merged tiers as `bonus`, so the console's labels, banner and
  confirmation show what the server credits without a console change.
- **Offline payments are quoted, not worked out by hand.**
  `GET /api/user/topup/offline/quote?user_id=&amount=` answers `contract_rate`,
  `site_rate`, `rate` and `bonus` (whole quota dollars, rounded down). The
  recording endpoint still takes `bonus` explicitly, because the step-up proof
  binds it before the request is sent; the caller passes the quoted figure.
- **Administrators set the rate.** `GET` and `PUT /api/user/:id/contract-bonus`
  (`billing:read`, `billing:write`); `{"rate":0}` removes the row. Each change
  writes `user.contract_bonus` with `from` and `to`. In the console, root opens
  Contract bonus (协议赠送) from a user's row menu and types a percent. The
  form accepts 0 to 100 with two decimals, so the server's range message is
  left untranslated: only a script can reach it, and a translated key no
  source names would land in every core page's locale.
- **The API lives in `features/users/contract-bonus-api.ts`.** The API keys
  page loads `features/users/api.ts`; functions added there grew `/keys`'
  first load by 44 bytes.

## Alternatives considered

- **Lower the customer's price through a group ratio.** It needs no bonus
  code, but it reprices balance already bought, the site speaks of bonuses
  rather than discounts, and the site's bonus would still add on top.
- **Add the contract rate to the site's tier.** Rejected by the owner: the
  promise is a rate, and stacking would give a 10% customer 17% at ¥5000.
- **Compute the offline bonus on the server when the request omits it.** The
  step-up proof binds the bonus, so the caller must know it before the request
  either way.

## Consequences

- Orders already created keep their bonus; a rate set later applies from the
  next top-up.
- The site's tiers at or below a contract rate no longer show for that
  customer: a 10% customer sees 10% at every amount.
- Allen Mai's hand-added credit before offline recording existed stays
  unrecorded, by the owner's decision on 2026-11-27: the paid and the gifted
  parts can no longer be told apart.

## Verification

- `TestBonusTiersWithContractTakesTheHigherRate`: with the production tiers, a
  6% contract gives `{1: 0.06, 5000: 0.07, 10000: 0.1}`, 10% gives `{1: 0.1}`,
  and 0 leaves the site's tiers.
- `TestContractBonusRateTakesTheHigherOfItAndTheSiteTier`: ¥5000 earns $350
  without a contract and $500 with 10%; ¥20000 earns $2000, not $4000; the
  offline quote agrees; invalid rates and a missing user are refused; removing
  the rate restores the site's tiers. With `topUpBonusQuota` reading the site's
  tiers instead, it fails.
- `TestChainDepositEarnsTheContractRateAndTheOnChainBonus`: a 30% contract
  credits 31% on a $5 and a $12.5 deposit. With the credit priced by the site's
  tiers, it fails.
- `TestSetContractBonusRateUpsertsAndRemoves` passes on SQLite, MySQL 8.4 and
  PostgreSQL 16 (local containers; CI runs SQLite only).
- The console's dialog test saves 30% as `{"rate":0.3}` and refuses 101.
- `bun run first-load:check` against a build of `origin/main`: `/keys` 241
  bytes left against main's 229, `/sign-in` and `/dashboard/overview` 12
  bytes better.
