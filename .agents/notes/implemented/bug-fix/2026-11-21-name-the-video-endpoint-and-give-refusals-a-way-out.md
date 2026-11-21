# Agent Note: Name the video endpoint in the group refusal, and give the console's refusals a way out

Status: implemented

## Problem

The weekly review of 2026-11-21 reported 30 users a fortnight calling video
models (`seedance-2.5-*`, `wan-3.0-*`) through `/v1/chat/completions` and
getting `no available channel in group auto`, some of them as 503s that clients
retry. Reading production first:

- **The 503s are gone.** `no_channel` error logs by status: 11-12 720 and 11-13
  1,715 (all 503); from 11-14 the 503s fall to 33, 0 and then single digits,
  each a real outage (`claude-sonnet-4-6`, `gemini-4-hydrogen-high`). The
  2026-11-14 note's diagnosis already splits the rest.
- **The 400s are the wrong-endpoint answer, not a routing gap.** From 11-14 the
  `status_code=400 ... in group auto` logs are 5 to 15 users a day sending
  `seedance-2.5-480p/720p/720p-fixed` to a chat path. The log text keeps the
  `no available channel in group` prefix on purpose, so site insights still
  count them. Auto does reach `Seedance视频`: the diagnosis found a serving
  channel in the auto list and blamed the path.
- **What was still missing.** A video model on a key whose group does not serve
  it (a `GPT` key) was answered with the generic other-groups text, which never
  says the model is a video model or that it takes `POST /v1/videos`. The
  console showed every refusal as a red "Error", with no way to the keys page
  or the docs. The key form said nothing about video models.

## Decision

- `DiagnoseNoChannel` sets `TaskModel` for the other-groups cause too, when a
  channel serving the model in another group is a task plugin's. The
  distributor then answers with `distributor.task_model_in_other_groups`: the
  model is a video (asynchronous) model, submit it with `POST /v1/videos`, not
  this path; this key's group does not offer it; the groups that do; the keys
  page. en, zh-CN and zh-TW.
- Two new error codes, so the console can tell a refusal it can fix from one it
  cannot: `model_not_in_group` (404, the other-groups answer on OpenAI-format
  paths) and `model_wrong_endpoint` (400, replacing `invalid_request`). Both are
  still 4xx with the message in `error.message`, which Codex and the OpenAI SDKs
  read; `/v1/messages` keeps Anthropic's `not_found_error`. `model_not_found`
  stays for a model no channel lists and for the 503 outage, which share it with
  the retry logic in `service/relay_error.go`.
- The log content is unchanged, so `isNoChannelMessage` and the
  `no available channel in group` parsing in `model/site_insights*.go` need no
  edit.
- Playground: `message-error-utils` reads the two codes as their own kinds.
  `MessageError` shows the server's text with a "Create a key" button (keys page)
  for the group case and a "View docs" button, to the video page when the text
  names `/v1/videos`, else to the groups page. The generic outage stays red.
- The key form's Auto description says video models cannot be called through the
  chat endpoints and take `POST /v1/videos`; Auto includes the video group, so
  the hint does not say a separate key is needed.

## Alternatives considered

- **Keep `invalid_request` and `model_not_found` and have the console read the
  text.** Rejected: the wording is translated three ways and an outage 503 shares
  `model_not_found`, so a text match would offer "Create a key" for an outage.
- **Hide video models from `/v1/models` on chat keys.** Not done: it changes what
  a client lists, and the refusal now says what to do.

## Verification

- `TestDistributeExplainsModelsTheRequestCannotReach` gains a video plugin in its
  own group: a `gpt` key gets the 404 with the video wording in English and
  Chinese and `model_not_in_group`; an auto key that includes the video group
  gets the 400 `model_wrong_endpoint`. Every other row asserts its code too.
  `TestDiagnoseNoChannelNamesATaskModelOnTheWrongEndpoint` asserts `TaskModel`
  on the other-groups cause.
- Console: `insufficient-balance.test.ts` asserts the two codes map to their
  kinds and that `model_not_found` stays generic.
- Production read-only SQL for the status counts above (`BEGIN READ ONLY`).
