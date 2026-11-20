# Agent Note: Name the coins in an on-chain credit's record

Status: implemented

## Problem

The first real on-chain credit (2026-11-20, 5 USDT on BNB Smart Chain) showed in the
wallet's 入账记录 as 支付金额: 34.000000, the top-up's money: the 5 coins times
`USDExchangeRate` 6.8. The customer sent 5 USDT and could not find that figure anywhere in
their records. The owner asked for the USDT or USDC amount to show there.

## Decision

- An on-chain credit's log keeps the two keys every online top-up uses, so the console
  needs no new locale key. Its `amount` parameter is the coins that arrived and their
  network, `5 USDT (BNB Smart Chain)`, instead of the money. The wallet card, the usage
  logs and their export all render the log's `content_parts`, so all three show it.
- Arbitrum's USDT0 is shown as USDT: exchanges send it as USDT on Arbitrum, the dialog
  lists it as USDT, and the symbol USDT0 would read as another coin. USDC.e keeps its
  symbol.
- The network names moved from the controller into `model.ChainDepositNetworkName`, which
  the Feishu notices also use.

## Consequences

- A server message key is `core` in the console's locale split, so new keys would have
  grown every first load; reusing the existing pair costs nothing.
- Records written before this change keep their money figure.
- The top-up row still records `Money` as before; only the log line changed.
