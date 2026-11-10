# Agent Note: Pin keyless GPT conversations to one upstream backend

Status: implemented

## Problem

On 2026-11-10 the share of gpt-6-astra input served from cache on channel 7 fell
from about 80% to 29%. That morning the traffic was Codex, which sends
`prompt_cache_key` on `/v1/responses`. That evening it was two clients on
`/v1/chat/completions` without that field, and 43-49% of their requests that
continued a conversation from the last ten minutes read no cache at all. The
same split showed on gpt-6.1-sol: Responses clients 0-10% zero-cache
continuations, chat clients 40-60%.

Direct probes to channel 7's upstream, with one ~49k-token prefix per group and
2 s between requests, showed why. The upstream spreads requests over several
backends that count the same body as 53.7k, 85k or 141k tokens and cache
separately. Chat Completions with or without `prompt_cache_key`, and Responses
without it, moved between backends request by request; Responses without the key
read 0 cache in 6 of 6. Responses with `prompt_cache_key` stayed on one backend in
8 of 8 and read 138.6k of 139.2k in 5 of them. The upstream behaves like
new-api's default `codex cli trace` affinity rule, which binds only `gpt-*` on
`/v1/responses` by `prompt_cache_key`.

## Decision

- **The OpenAI adaptor fills `prompt_cache_key` on Responses requests to the
  channels in `global.derived_prompt_cache_key_channel_ids`** when the client sent
  none, null or an empty string. A key the client sent is kept.
- **The key is `cc-` plus 32 hex characters of SHA-256 over the token ID, the
  instructions and the first input item.** These stay fixed while a conversation
  grows and differ between conversations, so each conversation sticks to one
  backend and one customer's parallel sessions still spread out. The token ID
  keeps two customers with the same opening apart.
- **It runs in `ConvertOpenAIResponsesRequest`, after channel selection.** Our own
  `codex cli trace` rule reads `prompt_cache_key` to choose a channel; a key added
  afterwards cannot change which channel serves the request.
- **Chat Completions reaches the fill through the existing
  `chat_completions_to_responses_policy`**, which converts chat requests to
  Responses before the adaptor. Both settings are empty by default, so this
  change does nothing until an operator lists a channel.

## Alternatives considered

- **A channel param override that sets `prompt_cache_key`.** Overrides write
  fixed values, so every keyless request would share one key, and the upstream
  would pin all of that traffic to one backend.
- **Adding the key to Chat Completions without converting.** The probe sent
  chat requests with a key; they still moved between backends.
- **Hashing the whole input.** The key would change every turn, which is the
  problem being fixed.

## Verification

- `go test ./relay/channel/openai/ -run DerivedPromptCacheKey`: a growing
  conversation keeps its key; another conversation or token gets a different
  one; unlisted channels, an empty request and a client key are left alone;
  nothing is added with the default setting. The tests do not compile without
  the change.
- `go test ./relay/channel/openai/ ./setting/model_setting/ ./relay/ ./relay/common/ ./service/`
  passes. One `service` test reads the host proxy variables and passes with them
  unset.
- After release, channel 7 is listed in both settings, and cache reads per
  continued conversation are compared for the chat clients before and after.
