# Agent Note: The Claude Code gate admits fixed client checks on Messages

Status: implemented

## Problem

Clients check a gateway with fixed, tiny requests that carry no `claude-cli`
User-Agent and no Claude Code system prompt, so a token in a Claude-Code-only
group got `403 access_denied` ("Group … only accepts requests from Claude
Code"). Two arrive through Magpie (User-Agent `magpie/<version>`); its binary
names them `connection_check` ("Claude Desktop's") and `api_detect`
("Detect APIs"):

- Claude Desktop's connection check, relayed by Magpie's gateway:
  `{"max_tokens":16,"messages":[{"role":"user","content":"."}],"model":"..."}`.
  Relay logs on 2026-11-02 07:16–08:35 UTC held 34 such rejections from one
  user whose Claude Code requests on the same token succeeded in between.
- Magpie's "Detect APIs", one request per API and model:
  `{"model":"...","max_tokens":16,"messages":[{"role":"user","content":"hi"}]}`
  on Messages, and the same `"hi"` with a 16-token limit on Chat Completions,
  Responses and Gemini. After the first check was admitted, a run at 09:07 UTC
  had 48 rejections, 12 on each of the four APIs.

## Decision

- `admitClaudeCode` asks `clientCheck` first. A match is admitted before the
  User-Agent, prompt, header, `metadata.user_id` and version checks, and logs
  `claude code only group <group>: admitted the "<prompt>" check,
  user-agent="<ua>"`. The line names the prompt, not a client: after release,
  `"hi"` also came from a client that was not Magpie. The model name is not
  checked.
- `clientCheck` matches only a `/messages` request whose top-level fields are a
  subset of `model`, `max_tokens`, `messages` and `stream`, with `max_tokens`
  from 1 to 16 and exactly one `user` message whose content is the string `"."`
  or `"hi"`. Any other field (`system`, `tools`, …), message or content form
  fails the match, and the request is judged as before.
- Chat Completions, Responses and Gemini checks stay refused. The group serves
  only Claude Code over Messages; admitting the others would tell Magpie they
  work, and its real requests on them would then be refused.

- A refused request's warning line carries its User-Agent (clipped to 120
  bytes) and the body's shape from `requestShape`: top-level field names (each
  clipped to 40 bytes, at most 20), `max_tokens`, the message count, and the
  last message's content kind and length (`string(<characters>)` or
  `blocks(<n>)`), never any text. Two refusals on 2026-11-02 09:36–09:37 UTC
  could not be told apart from real work because neither was logged. A request
  on an auto token that goes on to another group (`rejected=false`) logs only
  the failed check, so ordinary traffic is not parsed twice.

## Alternatives considered

- **Match the Claude Desktop or Magpie User-Agent.** A header proves less than
  the body: the body is what decides whether the request can do work.
- **Raise the `max_tokens == 1` exemption to 16 for any prompt.** A short answer
  to an arbitrary prompt is still useful work, such as classification.

## Consequences

- Any client can send these exact requests to a Claude-Code-only group. Their
  input is one word and their output at most 16 tokens, billed as usual, with no
  system prompt or tools to carry a task.
- If a client changes its check, the gate rejects it again and the log shows
  the failed check, the User-Agent and the body's shape.
- The relay log now holds client User-Agents and field names of refused
  requests; prompt text stays out of it.

## Verification

- `go test ./middleware/ -count=1`, `go vet ./middleware/`: pass.
- `TestRequestShape` covers Magpie's check, a conversation ending in blocks
  (with "secret" text absent from every shape), multibyte content counted in
  characters, a non-numeric `max_tokens`, a Responses body, a long field name,
  malformed JSON, a form body and an empty object. `TestClipKeepsValidUTF8`
  covers clipping inside a multibyte character.
- Cases admit the `"."` check on a fixed and an auto token and Magpie's `"hi"`
  Messages check. They refuse a check with a system prompt, tools, `max_tokens`
  17, other or longer content, content blocks, a second turn, an assistant
  role, and Magpie's Chat Completions, Responses and Gemini checks.
  `TestClaudeDesktopProbeIgnoresVersionBounds` admits the `"."` check under
  bounds that refuse the CLI.
- With either prompt removed from `clientCheckPrompts`, its admitting cases fail.
- In production after the first change (2026-11-02 09:03 UTC), three `"."`
  checks from Magpie returned 200 with 16 output tokens each.
