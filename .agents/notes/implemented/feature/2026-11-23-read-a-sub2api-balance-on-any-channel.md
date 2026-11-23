# Agent Note: Read a Sub2API balance on an OpenAI custom or plugin channel

Status: implemented

## Problem

Two channels point at one Sub2API-style upstream (`sub.zzshu.cc`) and show a balance of 0 on the channel list. #12 is an OpenAI custom channel (type 1), whose balance query asks `/v1/dashboard/billing/subscription`, which the upstream does not have. #9 is a task plugin channel (type 61) bound to a runtime-installed plugin that exports no `buildBalanceRequest` / `parseBalance`, so the balance run skips it and the console hides its balance action. The upstream's real balance is on `GET /v1/usage`, which the Sub2API channel type (59) already reads.

## Decision

A channel names its balance endpoint with one other-settings key, `balance_source`, whose only value is `"sub2api"`. The channel type, and so request forwarding and billing, stay as they are.

- `updateStandardChannelBalance` calls `updateChannelSub2APIBalance` first when the key is set, so an OpenAI custom channel, the manual "update balance" button and the scheduled run all share the Sub2API reading (`remaining` before `balance`, `isValid=false` and a missing figure are errors, never a stored 0).
- A type-61 channel whose plugin exports the balance hooks keeps its plugin query. One whose plugin has none falls through to the built-in query when `balance_source` is set, in both `UpdateChannelBalance` and `updateBalanceInRun`; without the key it behaves as before ("does not report a balance"). The runtime plugin is not touched.
- The key lives in `settings` (other settings), not in `setting`. The console rebuilds `setting` from its form fields on every save and drops a key it does not know, while `buildSettingsJSON` starts from the stored `settings` and keeps unknown keys, so a later save in the console does not erase the source.
- `ValidateSettings` rejects any value but `""` and `"sub2api"`.
- The console's `useChannelBalanceQueryable` also counts a plugin channel with a `balance_source` as queryable, since it read only the plugin's hooks.
- A query failure never writes a balance or disables a channel. A reported balance of 0 or less disables a channel with auto-ban on, as it does a Sub2API channel; the real balance of these two is far above 0.
- Multi-key channels stay unsupported, as for every built-in query.

## Operator step

The console has no field for the key. Set it through the admin API, keeping the other keys of the channel's `settings`: read the channel, add `"balance_source":"sub2api"` to the `settings` JSON string, and `PUT /api/channel` with `{id, settings}`.

## Verification

`go test ./controller/... ./model/...`; `GOWORK=off go test ./dto/` in `relaykit`; `bun run typecheck`, `lint:check` and `vitest run src/features/channels` in `web/`. The tests cover an OpenAI custom channel with and without the key (which paths are asked), a plugin channel without hooks on both the manual and the scheduled path, a failing query leaving balance and status alone, and the value check.
