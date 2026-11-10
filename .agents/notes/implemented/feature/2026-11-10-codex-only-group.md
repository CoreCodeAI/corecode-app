# Agent Note: Restrict a group to Codex clients

Status: implemented

## Problem

The operators are splitting GPT into two groups priced apart: one for Codex at
0.7 and one open to any client at 0.8. The cheaper group needs the same guard
the Claude Code only group has, and that guard knew only Claude Code.

## Decision

- **`codex_client_setting.groups`** lists the Codex only groups, beside
  `claude_code_client_setting.groups`. It is written through the option API,
  which validates it like the Claude Code list.
- **Codex is recognized by two headers.** The User-Agent must start with
  `codex_cli_rs`, `codex-tui`, `codex_exec`, `codex_vscode` or `Codex Desktop`
  followed by `/x.y.z`, and `Originator` must be one of those names or
  `codex_work_desktop`. These are the pairs Codex clients sent to the relay in
  the 72 hours before the change. A gateway that forwards Codex under its own
  User-Agent (`axonhub/1.0` was seen) is refused, as such resellers belong in the
  open group.
- **No body check.** Unlike Claude Code, Codex's prompt is not a stable marker
  across the CLI, the IDE extension and the desktop app, and the Responses
  WebSocket handshake has no body. Headers are as easy to copy as the Claude
  Code fingerprint, so the guard keeps ordinary SDK clients out and nothing
  more.
- **One gate for both clients.** `enforceClientOnlyGroups` replaces
  `enforceClaudeCodeOnlyGroup`. A named restricted group refuses other clients
  with 403 `access_denied`. An `auto` token judges each client once and keeps
  only the candidates whose client the request is; it is refused only when no
  candidate remains, with the first refusing group's message.
- **`/api/user/self/groups` reports `codex_only`**, and the key setup guide
  offers only Codex for such a group.

## Alternatives considered

- Renaming the existing `GPT` group: the 2026-10-26 rename stranded keys, and
  keeping `GPT` as the open group leaves every existing key working at its
  current ratio.

## Verification

`TestCodexOnlyGroupGate` admits the six recorded User-Agent and Originator
pairs and refuses the forwarding gateway, a missing or foreign Originator, a
versionless User-Agent, an OpenAI SDK, and each client in the other client's
group. `TestClientOnlyGroupsAutoCandidates` checks the candidates an `auto`
token keeps for Codex, an SDK and Claude Code, and the refusal when only
restricted candidates exist. The Claude Code gate tests pass unchanged apart
from the function name.
