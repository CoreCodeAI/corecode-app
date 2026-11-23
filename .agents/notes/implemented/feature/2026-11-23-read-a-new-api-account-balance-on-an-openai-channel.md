# Agent Note: Read a New API account balance on an OpenAI custom channel

Status: implemented

## Problem

Channels #7 and #13 are OpenAI custom channels (type 1) pointing at one new-api upstream (`usdj.zzshu.cc`). Their balance query asks `/v1/dashboard/billing/subscription`, which that upstream answers with the key's own limit. Both keys are unlimited there, so the panel showed 99,998,975 and 99,999,802, which are not money. The figure wanted is the upstream account's remaining quota, which both keys share ($335.29 on 2026-11-23).

## Decision

`balance_source` accepts a second value, `"newapi"`, next to `"sub2api"` ([why](2026-11-23-read-a-sub2api-balance-on-any-channel.md)). `updateStandardChannelBalance` routes it to `updateChannelNewAPIBalance`, the query of the New API channel type (60), which reads `/api/usage/token/` and converts with the upstream's `quota_per_unit`.

- `updateChannelNewAPIBalance` is unchanged. It takes the smaller of the key's quota and its owner's, and an unlimited key counts as infinite, so a key with no limit and a finite `user_quota` reports the account quota. The error "The upstream key has unlimited quota" appears only when the upstream sends no `user_quota`, and no balance is written then. The type-60 test `TestUpdateChannelNewAPIBalanceUsesTheSmallerRemainingQuota` already covers that and still passes.
- The routing is a `switch` on the source, so an unset source keeps each channel type's own query and `"sub2api"` behaves as before.
- A plugin channel that names any source (not only `sub2api`) is queried as a built-in channel, through one helper, `namesBalanceSource`, in `UpdateChannelBalance` and `updateBalanceInRun`.
- A failed query writes no balance and disables nothing, as for `sub2api`. A reading of 0 or less disables a channel with auto-ban on; the real balance is far above 0.
- `ValidateSettings` rejects every value but `""`, `"sub2api"` and `"newapi"`. The console needs no change beyond the type comment: it already counts any non-empty source as queryable and keeps the key through a save.

## Operator step

Read the channel, add `"balance_source":"newapi"` to its `settings` JSON string, keeping the other keys, and `PUT /api/channel` with `{id, settings}`; then `GET /api/channel/update_balance/{id}` should show about $335.

## Verification

`go test ./controller/...` and `GOWORK=off go test ./...` in `relaykit`. New tests: an OpenAI custom channel with `newapi` reads `/api/usage/token/` and `/api/status` only and stores the account quota for an unlimited key; the same channel without the source still reads the subscription endpoints; a failing query keeps the stored balance and status; the value check accepts `newapi` and rejects an unknown source.
