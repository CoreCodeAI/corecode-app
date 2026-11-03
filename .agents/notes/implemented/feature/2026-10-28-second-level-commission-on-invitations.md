# Agent Note: Show second-level commission on the invitations page

Status: implemented

## Problem

A distributor earns the second-level rate on what its invitees' invitees pay
for, but `/invitations` counted only first-level credits. Its "commission from
invitees" figure read as the whole, while the commission balance beside it
included the second level, so the two disagreed with nothing on the page to
explain why. Production user 9 saw 1,485,000 earned against a 2,232,499
balance; the 747,499 between them came from user 305, whom user 181 (user 9's
invitee) invited. The level-2 rows were visible only in the wallet's commission
records, masked and one credit at a time.

## Decision

- **`GET /api/affiliate/self/invitees` adds `second_level`**, from
  `model.SumAffiliateSecondLevel`: how many users the caller's invitees invited,
  paid or not; the base and amount of the caller's level-2 credits, summed
  without a join so they always add to `Affiliate.Earned` together with the
  first-level totals; and those figures split by the invitee who brought the
  users in. A credit counts toward the source user's current inviter. The split
  lists at most 20 invitees, biggest commission first, and reports how many
  there are.
- **The invitee table stays first-level only.** Its per-row commission is what
  that invitee's own spending earned; mixing in what the users they brought
  earned would make a row's commission exceed its rate times its paid spend.
  The second level gets its own card instead.
- **The card shows for a distributor, and for anyone with level-2 earnings.**
  A former distributor keeps what it earned in its balance, so it still sees
  where that came from, with copy saying it earns no more. Other users never
  had a second level and do not see the card.
- **The card explains the chain, then reconciles the money.** Three steps (you,
  your invitees and your rate, the users they invited and the second-level
  rate), a bar splitting everything earned into direct and second-level with
  labelled values and a tooltip per segment, a note that the balance is that
  total less transfers and withdrawals, and the per-invitee split. On phones
  the split is a list rather than a table. Next to the card, the overview's
  figure is labelled "Direct commission".
- Direct and second level reuse the wallet's colours for the two levels (info
  and chart-4), so a level looks the same on both pages.

## Alternatives considered

- **Add second-level commission to the invitee rows.** A row's commission
  would then exceed its rate times its paid spend.

## Compatibility

The response field is added, and the console treats it as optional because the
admin invitee endpoint does not return it. The console in production ignores
the field, so the server can ship first. No schema change.

## Verification

- `go test ./model -run 'TestAffiliate|TestSetUserInviter'` against SQLite
  3.50.4, MySQL 8.0.46 and PostgreSQL 17.11.
  `TestAffiliateInviteesDatabaseMatrix` covers a paid and an unpaid
  second-level user under different invitees, the order of the split, the two
  levels adding up to `Earned`, and a user with no second level.
- `go test ./model ./controller ./router` on SQLite. With the MySQL and
  PostgreSQL DSNs set, `TestMigrationSchemaStability` and eight controller
  database-matrix tests fail the same way on the base commit.
- `bun run typecheck`, which failed on a planted error first. Vitest for the
  invitations page covers the card for a distributor, its absence for an
  ordinary inviter, and the overview label. In the users feature,
  `quota-display.test.tsx` fails the same way on the base commit.
- A local build seeded like user 9, checked in a browser: dark and light
  themes, Chinese and English, 375 px wide. A pointer sweep of the split bar
  showed a value everywhere on the bar except the corner pixels outside its
  rounded ends.
