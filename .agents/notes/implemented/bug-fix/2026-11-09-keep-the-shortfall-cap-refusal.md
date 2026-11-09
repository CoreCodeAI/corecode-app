# Agent Note: Keep the shortfall-cap refusal instead of falling back

Status: implemented

## Problem

On 2026-11-09 a customer sent a Claude Opus request through
`/v1/chat/completions` whose input needed a $16.66 reservation. The user was on
`subscription_first` with wallet overflow, a $3 gift plan and a $3 wallet. The
subscription session held $6 across both sources, and the shortfall was above
`max_shortfall_usd`, so `preConsume` refused it with the correct amounts.
`NewBillingSession` then fell back to the wallet alone. The wallet refund from
the first attempt reaches the Redis cache asynchronously, so `GetUserQuota`
still read $0. The client got
`Insufficient user quota, remaining quota: $0.000000`, which made the account
look empty.

`wallet_first` failed in the same position with a worse result: the
subscription fallback returned a bare `update_data_error`.

## Decision

- The cap refusal now wraps the sentinel `errShortfallAboveCap`. When the first
  attempt fails with it, neither fallback branch tries the other source.
- The refusal uses a new message, `quota.shortfall_above_cap`. It states the
  estimated reservation and what the subscription and wallet hold together, and
  tells the user to top up or shorten the context.

The fallback cannot succeed after a cap refusal. The other source already took
part as overflow, so on its own it holds no more than the two sources held
together. The only exception is a wallet at or below zero, and that wallet
refuses on its own anyway.

## Alternatives considered

- **Read the wallet from the database in the fallback.** That removes the stale
  $0, but the fallback would still replace the combined figure with one
  source's balance, and it adds a query to a request that is going to fail.

## Consequences

- When a subscription refuses before the cap, for example with an empty wallet
  and no overflow hold, the request still falls back and still receives
  `quota.subscription_and_wallet_insufficient`.
- The error code and status stay `insufficient_user_quota` and 403.
