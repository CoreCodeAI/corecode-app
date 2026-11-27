# Agent Note: Leave the ban of lenient refusals to the operators

Status: implemented

## Problem

The violation guard ([design](2026-10-25-violation-guard.md)) disabled an account at its third
strike, whatever the category. Anthropic's classifier over-refuses the lenient categories
(`reasoning_extraction`, `cyber`, `frontier_llm` on production), and a disabled account cannot
be re-enabled by `ForgiveViolations`. Between 2026-11-21 and 11-27 production recorded 21
enforced suspensions or bans on 18 customers; reading their refused messages, about 14 looked
like false positives (a read-only code survey, a statusline prompt, résumé editing, a compaction
prompt). User 4831 was disabled by the third strike in two days. Its seven refusals were all
`reasoning_extraction`, from one pattern: batch authoring of evaluation questions with golden
answers and rubrics, scored against competing models. That pattern the upstream refuses
consistently, so the ban was right for that user, but the same rule banned customers the
classifier misjudged.

## Decision

- **A lenient category never disables an account.** When a new strike reaches `ban_strikes` and
  its category is lenient, the action is `suspend` (or `strike` when `suspend_hours` is 0), and
  the operators are told. Any other category still bans at the count. Warnings are unchanged.
- **The operators hear of every restriction.** `violation_guard_setting.feishu_webhook` and
  `.feishu_secret` name a Feishu custom bot, validated like the top-up watch's. In enforce mode
  each suspension, each ban and each lenient strike that reached the ban count posts the user,
  category, model, request id and the first 200 characters of the refused message
  (`notifyViolationGuard`). Empty sends nothing; a failed send is logged and does not undo the
  restriction.
- **`here is the full conversation to compact` is a client-generated prefix.** The hard rules no
  longer match that compaction prompt, which blocked a changelog quoting
  `[ignore previous instructions]` (risk gate event 2959).

Production, 2026-11-27, through `PUT /api/option/`: `violation_guard_setting.lenient_warnings`
from 2 to 3 (read back 3). It was 2 when user 5198 was suspended by a read-only survey, 43
minutes after an earlier warning left the 24 hour window.

## Not done

- **No hard rule for evaluation-data authoring.** The `===PROMPT===` / `===RUBRIC===` /
  `===FIXTURES===` boundaries appear only in user 4831's refused requests; two other users'
  evaluation-authoring requests (4511, 4628) share no marker. A rule would catch one banned
  customer and cannot be scored against requests the upstream accepted, which are not stored.
- **The risk gate event's excerpt is still the latest message, not the matched span.** For
  user 4882 the nine `jailbreak.02` blocks show a `<transcript>` excerpt while the matched text
  lies elsewhere; the cause is not established.
- **`<environment_context>` and `<turn>` are not added as prefixes.** No stored request showed
  that either one starts a turn that a rule matched.

## Verification

- `TestViolationStrikePolicy` on SQLite: a lenient category reaching the ban count suspends and
  leaves the account enabled; a non-lenient category bans; the alert says which; no webhook
  sends nothing. With `case banDue && !lenient` changed to `case banDue`, the lenient cases fail
  on the expected action. `TestHardRulesSkipClientGeneratedTurns` covers the new prefix.
- `go test -race -p 1 ./service/ -run 'TestViolation|TestRiskGate'` and
  `go test ./pkg/riskpolicy/` pass; `go vet` of the three packages is clean. MySQL and
  PostgreSQL were not run: no query, schema or migration changed.
