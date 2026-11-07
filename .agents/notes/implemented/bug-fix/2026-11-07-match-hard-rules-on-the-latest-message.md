# Agent Note: Match the hard rules on the latest message and hold what they block

Status: implemented

## Problem

Customers reported being blocked for no reason. The risk gate's events from 2026-11-06 22:11 to
2026-11-07 18:39 (UTC+8) held 184 rejections of 9 users. 92 came from two hard rules,
`vm2api.crack.06` (`keygen`, `warez`) and `vm2api.crack.07` (注册机):

- User 377 was rejected 26 times for `keygen` while sending "1+1=?", "只回复这两个字：通了" and
  "运行 pwd". The project was a cryptography language, where keygen is key generation.
- User 914 was rejected 37 times for 注册机 while asking for an architecture plan for a 3D engine,
  rewriting the request a dozen times, once as a "脱敏版".
- Users 1147 and 1167 were rejected inside Codex's reviewer prompt and a Claude Code client check
  (`<transcript>`).
- User 1525's 24 rejections were right: the user had loaded a jailbreak skill that offers keygens
  and 注册机.

`hardDocument` joined every user turn of the request, so a word anywhere in the history blocked
every later request of the session. The rejected messages above did not contain the word: it
came from earlier turns, among them the summaries clients write of earlier work, whose words come
from code and tool output. The message told the customer to edit the message, which could not
help. The event kept only the rule's keyword, so a reviewer could not see what had matched.

## Decision

- **The hard rules match the latest user text a person wrote.** `hardDocument` keeps the last
  user text that is not empty after the reminder and environment blocks are stripped, and not a
  turn a client generates from earlier work: Claude Code's `<conversation-checkpoint>` and
  compaction summaries, the `<transcript>` of its client checks, and Codex's reviewer prompt
  (`clientGeneratedPrefixes`). The line-rule path matches the latest human message the same way.
- **A conversation the hard rules block is held.** The client resends the blocked message with
  the next one, so without a hold "继续" would carry it to the upstream. In enforce mode the gate
  holds the conversation key of the request's last human message (the violation guard's keys), for
  7 days. A later request that reproduces the key is rejected with event rule `held`, until the
  customer rewinds past the message or starts a new conversation. Holds live in memory and in the
  Redis hash `risk_gate:held:<user>`, so the next color of a blue/green release keeps them. A lift
  in the console (`ForgiveViolations`) releases them. Observe mode holds nothing.
- **The customer is told the word and how to recover.** A hard rule rejection names the matched
  text and says to take the message back with /rewind or start a new conversation
  (`violation.risk_gate_keyword`); a held conversation quotes the start of the blocked message
  (`violation.risk_gate_held`).
- **The event keeps the match in context.** `Hit.Context` is the matched text with 40 characters
  on each side; the event's detail is `keyword · context`. Detail is now cut on a UTF-8 boundary.

The production rules are narrowed in the same change, as an option edit: `crack.06` no longer
matches keygen next to a cryptography word (RSA, Ed25519, ML-KEM, ssh, 密钥, key pair and the
like), and `crack.07` no longer matches 注册机构, 注册机关, 注册机器人, 注册机型 or 注册机理.

## Alternatives considered

- **Narrow the rules only.** Every rule would keep blocking whole sessions over a word in a
  summary or a pasted file; the next rule added would repeat it.
- **Skip the history without a hold.** Sending any next message would forward the blocked one.
- **Store holds as violation records.** It needs a schema change and the three-database check,
  and the guard's message blames the upstream. Redis is already the shared store of both colors.
- **Keep matching the history but drop client-generated turns from it.** A paste or file excerpt
  the person sent ten turns ago would still block every later request.

## Consequences

- A message matched once is not matched again; one already in a conversation's history when this
  ships passes unless it is the latest.
- A customer can escape the hard rules by putting a client-generated prefix at the start of a
  message. The rules are a cheap first filter; the upstream's refusals and the violation guard
  remain.
- OpenAI Responses requests have no human messages for the conversation keys, so they get no
  hold, as with the violation guard's refused conversations.
- A Redis fault while a user's holds load counts as no holds for that process, so that user's
  held conversation can pass on the new color; requests are never slowed by a Redis outage.

## Verification

`go test ./pkg/riskpolicy/` and `go test ./service/ ./i18n/` pass, and `go vet ./...`.
`TestRiskGateHardRulesMatchTheLatestMessageAndHoldIt` fails when the hold is removed, and when
`hardDocument` joins the history again. `TestUpstreamAddressesMaskOnlyConfiguredAddresses` fails
locally with or without this change while proxy variables are set, and passes without them.
The narrowed rules were checked in the policy's regex engine against keygen and 注册机 asks, which
match, and cryptography and 注册机构-style text, which do not.
