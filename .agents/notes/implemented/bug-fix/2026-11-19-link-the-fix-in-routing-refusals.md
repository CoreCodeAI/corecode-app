# Agent Note: Put the console link in the routing refusals, and leave Claude suffix aliases to the existing adapter

Status: implemented

## Problem

A weekly error review (2026-11-19) listed two groups of requests that can never
succeed and that customers kept retrying:

1. A key in a Claude-only group calling `gpt-6.1-sol`, about 480 errors from
   three users in seven days.
2. `claude-opus-5-5-high`, 422 errors from two users, `503 No available
   upstream candidate.`

Reading production first showed most of the premise was already out of date.

- **Group mistakes were already answered.** The 2026-11-14 note
  (`2026-11-14-refuse-unreachable-models-with-a-4xx.md`) answers them with a
  404 that names the usable groups that serve the model. Since 2026-11-14 00:32
  CST the 503s for this cause are gone (11-12: 720, 11-13: 1,715, 11-14: 33, 11-15
  onward: 0 except real outages). What remains is 404s that scripts keep
  resending. Those messages named the fix but gave no place to do it, and the
  unlisted-model message gave no list of models.
- **The `-high` 503s were the engine, not a missing alias.** The two users
  were in `限时满血 Gemini`; the request reached channel 14 and the engine had
  no candidate for the name. Channel 14 is disabled now and no ability lists
  `claude-opus-5-5-high` anywhere.

## Decision

Only copy changes, in `distributor.model_in_other_groups` and
`distributor.model_not_served`, in en, zh-CN and zh-TW:

- the other-groups message points at the console keys page,
  `https://corecode.live/keys`;
- the unlisted-model message points at the static model pages,
  `https://corecode.live/model/`;
- a URL ends its sentence, so a full-width comma after it cannot be pulled into
  an auto-linked URL.

The status stays 404. `abortWithClaudeModelNotFound` exists because Claude Code
retries a 503 and falls back at once on a 404; a 400 or 403 would lose that
fallback, and an OpenAI SDK does not retry a 404 either.

## Claude reasoning suffixes: no code change

`relaykit/relayconvert/reasoning` already folds a trailing
`-low/-medium/-high/-xhigh/-max` and `-thinking` on a `claude-*` name into the
base model plus an effort or thinking intent (`ParseClaudeModelSuffix`),
`ApplyReasoningModelSuffix` sets the upstream model to the base, and routing and
billing use `BaseModelName`. A live probe on 2026-11-19 with a
`Claude 满血（可外接）` key sent `claude-opus-5-5-low`: the response model was
`claude-opus-5-5`. Adding a second mapping would duplicate that adapter.

`-high` fails only because production's `global.thinking_model_blacklist`
lists `claude-opus-5-5-high` and `claude-sonnet-5-5-high`, which keeps those
names verbatim. Nothing lists either name any more, so the entries only block
the mapping. Removing them is an operator option change; this change does not
make it. With them removed, `-high` behaves as `-low` does.

## Alternatives considered

- **Return 400 or 403 for a model outside the group.** Rejected: see above.
- **Say "not available to your account" when only closed groups serve a
  model.** Written and removed: the 2026-11-14 note chose to answer that case as
  not offered, and no replayed pair reached it.
- **Map `-high` in code regardless of the blacklist.** Rejected: the blacklist is
  the operator's override for names that are real upstream IDs.

## Verification

- `TestDistributeExplainsModelsTheRequestCannotReach` asserts the exact message
  per case, now including the keys link, the model-page link, and a zh-CN and a
  zh-TW case through `Accept-Language`.
- Replay: the 34 distinct (group, model) pairs of the last seven days'
  `no_channel` errors, seeded with production abilities, usable groups and auto
  groups, were run through the real `Distribute` in a throwaway test (not
  committed). Every other-group pair answered 404 with the usable groups and the
  keys link; retired models answered 404 with the model-page link; outage pairs
  kept 503. Video-model pairs answered 204 locally because the local channels
  are plain OpenAI channels, not task plugins; production answers those 400,
  unchanged by this change.
