# Agent Note: Follow an on-chain transfer in the deposit dialog

Status: implemented

## Problem

After sending coins, a customer saw nothing until the balance changed. The owner asked for
the dialog to show the transfer as soon as it is seen and follow it to the credit. The
deposit service now lists each user's transfers with whether its block has been read
(corecode-deposit `POST /v1/activity`, its note
`2026-11-20-list-transfers-while-they-confirm.md`).

## Decision

- `GET /api/user/chain-deposit/activity`, gated like the other chain deposit routes, places
  each transfer: `confirming` until the service read its block, then `crediting`,
  `waiting` (under 1 USD left to credit, which `CreditChainDeposit` holds), or
  `credited`. A transfer's point is the confirmed total less the newer confirmed transfers
  of its token; it is credited once the app's credited total reaches that point, so an
  older transfer stays credited when a newer one arrives. The transfer a credit ended at
  carries what it added (`Money / Price` and the bonus quota in wallet units), found by its
  trade number.
- When a transfer is `crediting`, the request runs one feed pass at once instead of
  waiting up to 15 seconds for the scheduled one; at most one such pass runs at a time and
  one per 2 seconds.
- The dialog asks every 3 seconds while open and shows, above the amount card, each
  transfer not yet credited and each credited in the last half hour: the coins and
  network, a link to the transaction, and three steps, detected, confirmed and credited.
  The sweep is not shown: it is the operators' move, and a customer could read it as the
  coins leaving. The newest transfer's stage is in a `role="status"` line. A transfer
  turning credited refreshes the balance.
- The hint about the "I've sent it" button now says the transfer shows at the top within
  seconds and the button is for when it does not.

## Consequences

- A transfer the webhook missed is not listed; the reconciliation credits it and the
  balance changes as before.
- Amounts in the steps are the webhook's, display only; what is credited comes from the
  confirmed totals.
- All new strings are in the wallet's `rest` locale part; first-load did not grow and
  `index.css` is unchanged.
