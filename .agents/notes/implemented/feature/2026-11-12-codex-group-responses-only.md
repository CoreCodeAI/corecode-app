# Agent Note: Admit only Responses requests into a Codex only group

Status: implemented

## Problem

The Codex only group admitted any request that carried Codex's User-Agent and
Originator, whatever the API. From 2026-11-10 to 2026-11-12 one user sent 113
requests to `/v1/chat/completions` in 「GPT（仅限Codex）」 with Codex headers;
every other Codex user, about 520 requests, used `/v1/responses`. Codex talks
to the Responses API only, so such a client is something else that copies the
headers. Its requests also lose cache: the GPT upstream keeps a conversation on
one backend only for Responses requests that carry `prompt_cache_key`.

## Decision

- **A Codex only group admits `/v1/responses` and the paths under it**
  (`/v1/responses/compact`), after the two header checks. The model list stays
  exempt, as for every client only group.
- **The refusal names the API.** A request with Codex's headers on another path
  gets 403 `access_denied` with `auth.codex_only_responses`, which tells the
  customer to use another group for Chat Completions, instead of the "only
  accepts requests from Codex" message, which a client with Codex's headers
  would not understand.
- **An `auto` token drops the Codex group** for such a request, as it does for
  any request that fails the Codex gate.

## Alternatives considered

- Converting the request to Responses for this group: it keeps admitting a
  client that is not Codex at Codex's price, which is what the group exists to
  prevent.

## Verification

`TestCodexOnlyGroupGate` refuses Codex headers on `/v1/chat/completions` and on
`/v1/responsesx` with the new message, and admits `/v1/responses/compact`.
`TestClientOnlyGroupsAutoCandidates` checks that an `auto` token keeps only
`gpt` for Codex headers on Chat Completions.
