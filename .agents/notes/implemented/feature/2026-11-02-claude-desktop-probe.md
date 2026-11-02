# Agent Note: The Claude Code gate admits Claude Desktop's gateway probe

Status: implemented

## Problem

Claude Desktop checks a gateway with a fixed request:

```json
{"max_tokens":16,"messages":[{"role":"user","content":"."}],"model":"..."}
```

It carries no `claude-cli` User-Agent and no Claude Code system prompt, so a
token in a Claude-Code-only group got `403 access_denied` ("Group … only accepts
requests from Claude Code"). Relay logs on 2026-11-02 07:16–08:35 UTC held 34
such rejections, all `User-Agent check failed`, from one user whose Claude Code
requests on the same token and address succeeded in between.

## Decision

- `admitClaudeCode` admits the probe before any other check, so neither the
  User-Agent, the system prompt, the headers, `metadata.user_id` nor the
  version bounds apply to it. The model name is not checked.
- `isClaudeDesktopProbe` matches only a `/messages` request whose top-level
  fields are a subset of `model`, `max_tokens`, `messages` and `stream`, with
  `max_tokens` from 1 to 16 and exactly one `user` message whose content is the
  string `"."`. Any other field (`system`, `tools`, …), message or content form
  fails the match, and the request is judged as before.
- An admitted probe logs `claude code only group <group>: admitted the Claude
  Desktop probe`.

## Alternatives considered

- **Match the Claude Desktop User-Agent.** Its value is not recorded (Caddy has
  no access log and the gate does not log it), and a header proves less than
  the body: the body is what decides whether the request can do work.
- **Raise the `max_tokens == 1` exemption to 16 for any prompt.** A short answer
  to an arbitrary prompt is still useful work, such as classification.

## Consequences

- Any client can send this exact request to a Claude-Code-only group. Its input
  is one character and its output at most 16 tokens, billed as usual, with no
  system prompt or tools to carry a task.
- If Claude Desktop changes the probe, the gate rejects it again and the log
  shows the failed check.

## Verification

- `go test ./middleware/ -run 'ClaudeCode|ClaudeDesktop' -count=1`: pass. Cases
  cover the probe on a fixed and an auto token, and refuse it with a system
  prompt, tools, `max_tokens` 17, other content, content blocks, a second turn,
  an assistant role, and on a Gemini path. `TestClaudeDesktopProbeIgnoresVersionBounds`
  admits it under bounds that refuse the CLI.
- With the exemption disabled, the two admitting cases fail.
