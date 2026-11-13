# Agent Note: Refuse a model the request can never reach with a 4xx that says why

Status: implemented

## Problem

The distributor answered every request no channel of its groups took with
`503 no available channel`. Over the three days to 2026-11-14 that was 2,453
refusals, and almost none of them were outages:

- a video model (`seedance-2.5-*`, `wan-3.0-*`) sent to `/v1/messages`,
  `/v1/chat/completions` or `/v1/responses`, about 1,900 of them, one client
  over 1,000 a day through an auto key;
- a model only another group serves, such as `gpt-6.1-sol` on a
  `Claude 满血（仅限CC）` key (220 in three hours from one key), or
  `gpt-5.6-sol`, which only `GPT 福利` still serves, on an auto or `GPT` key;
- a model no channel lists any more.

A 503 tells a client the server is briefly unavailable, so clients retried,
and the message named neither the cause nor the fix.

## Decision

On the no-channel path, `model.DiagnoseNoChannel` reads the enabled abilities
for the model once and sorts the refusal into four causes; only an outage keeps
the 503.

| Cause | Answer |
|---|---|
| No channel lists the model | 404 `model_not_found`: does not exist or retired. `/v1/messages` keeps Anthropic's bare `not_found_error` |
| Only other groups serve it | 404 naming the groups the user may switch the key to; on `/v1/messages` as an Anthropic `not_found_error` so Claude Code falls back at once |
| The request's groups serve it, but not on this path | 400 `invalid_request`; a task plugin's model is told to submit a task (`POST /v1/videos`) |
| The groups serve it and every channel is down, or every channel listing it is disabled | 503, as before |

- **Only groups the user may use are named.** A model whose only groups are
  closed to the user is answered as not offered, so `root` or staff groups
  never appear in an error.
- **An auto key is checked against its resolved list.** A model outside the
  auto list but in a usable group (`GPT 福利`) names that group.
- **The refusals stay in the logs.** Other-group and wrong-endpoint refusals
  are still written as `no_channel` error logs, now with their 404 or 400 in the
  content, so site insights keep counting them under the same category.
- **A task-plugin-pinned request keeps its message.** The diagnosis is skipped
  when a task plugin claimed the endpoint; that path already names the plugin.
- **A channel that would pass the filters means a race.** If the diagnosis
  finds an enabled channel that satisfies every filter, the cache moved under
  the selection, and the answer stays 503.

## Alternatives considered

- **Map retired names such as `gpt-5.6-sol` onto current models.** Rejected:
  `gpt-5.6-sol` is still sold in `GPT 福利` at its own price, and silently
  changing the model a customer asked for changes what they pay for.
- **Keep 503 and only reword the message.** Rejected: the status is what
  makes clients retry.

## Verification

- `TestDistributeExplainsModelsTheRequestCannotReach` covers each cause with
  and without the memory cache, including an auto key and a group the user may
  not use; its six refusal cases fail on the base revision.
- `TestDiagnoseNoChannelNamesATaskModelOnTheWrongEndpoint` registers a task
  plugin and a relay plugin and checks that only the task plugin's model gets
  the task hint.
- `TestProviderChannelServesOnlyItsRoutes`,
  `TestTaskOnlyPluginChannelStaysOutOfTheRelay` and
  `TestGeminiRelayHandsLongRunningPredictionToPluginRoute` asserted the old 503
  for these causes and now assert 400 or 404.
