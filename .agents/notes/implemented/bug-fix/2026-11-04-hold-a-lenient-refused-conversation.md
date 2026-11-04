# Agent Note: Hold a conversation after a lenient refusal, and block it on the second

Status: implemented

## Problem

A refusal blocks its conversation for the strike window
(`../feature/2026-10-25-violation-guard.md`). This also applies to a lenient
category, whose first refusal is only a warning
(`2026-11-01-warn-before-striking-lenient-refusals.md`). In practice:

- **The block costs the customer the conversation.** On 2026-11-04 user 703
  got record #149 (`reasoning_extraction`, `warn`) in a Claude Code session of
  about 2 MB and 320k cached tokens. Every later turn got 403
  `violation_conversation_blocked`. The message told the customer to edit "that
  message", but did not say which message or how. Few customers know that
  Claude Code can rewind, so the session was lost until an operator lifted the
  block.
- **The excerpt does not show what the upstream judged.** The refusal came
  after 443 output tokens, and the excerpt is only the last human message.
  After the lift the customer continued the same session: the request body kept
  growing from the refused request's 2,090,320 bytes. #150 came 45 minutes
  later in the same session, refused after 2,130 output tokens. Its excerpt is
  an ordinary question about erosion rates. A refused conversation can
  therefore be refused again, but only some are.

## Decision

- **A refusal of a lenient category holds its conversation.** It is recorded as
  before (`warn`, `merged` or `client_check`). The customer can continue the
  conversation; the guard remembers it.
- **A lenient refusal of a held conversation joins it.** `RecordUpstreamRefusal`
  looks for the earliest of the request's conversation keys that the user
  already has a refusal for, and records the refusal under that key, not under
  the request's own last key. The record is `merged` without claiming a strike
  (`model.HasViolationInConversation`). Without this, a refusal an hour later in
  the same conversation would be judged anew, and the customer, already warned,
  would be suspended. The check is needed even though
  `HasViolationStrikeInConversation` merges most repeats: it misses a held
  conversation whose first refusal had itself merged into another
  conversation's warning.
- **A second refusal blocks the conversation.** That is the evidence that
  resending it keeps costing the pool account. The block starts at the first
  refused message, because the record reuses that key.
- **Other categories block at the first refusal, as before.** A risk gate hit is
  not lenient, so it also blocks at once.
- **The state rebuilds from `violation_records` with no schema change.** A key
  is blocked if any of its records has a category that is not lenient, or if it
  has two or more records. Otherwise it is held. The in-memory copy applies the
  same rule as each refusal is recorded.
- **The 403 quotes the start of the refused message and says how to go back.**
  `violation.conversation_blocked_quoted` quotes the first 40 characters, with
  whitespace collapsed, of the conversation's first refused message. The
  message names Claude Code's `/rewind` (or Esc twice with the prompt empty)
  and Restore conversation, per the checkpointing documentation, and tells
  other clients to edit the message. `violation.conversation_blocked` keeps the
  same advice without the quote, for a record that has no excerpt left.

## Alternatives considered

- **Observe first: never block a lenient conversation, only record repeats.**
  This was the first plan. Every repeat would cost the pool account a refusal,
  with no limit per conversation. Blocking at the second refusal limits that to
  one extra refusal, and the records still give the repeat rate: count `warn`
  records followed by a `merged` record under the same key.
- **Strip the refused message from the history before forwarding.** That would
  change the customer's context without telling them. It can also break a tool
  loop's turn structure. Going back is the customer's decision.
- **A column for the hold.** The rule can be derived from category and record
  count. The old server, running beside the new one during a release, reads
  the table unchanged.

## Consequences

- A held conversation costs at most one more refusal before it is blocked. If
  Anthropic turns out to count `reasoning_extraction` against the account,
  remove it from `lenient_categories`; its conversations then block at once.
- Whether a stored key is blocked depends on the current `lenient_categories`.
  Removing a category blocks its held conversations on the next restart, and
  adding one releases its single-refusal conversations.
- A lenient refusal of a held conversation never counts, even if the new turn
  is itself a violation. Its conversation is blocked, and the customer's next
  lenient refusal in another conversation is a strike.
- The in-memory copy is updated a few milliseconds after the record is written.
  A refusal that arrives in that gap is judged under its own key, as before.
- The 403 shows the customer up to 40 characters of their own message, never
  another customer's.

## Verification

- `TestViolationStrikePolicy` and the risk gate tests (`-race`) pass on SQLite
  3.50.4, MySQL 8.0.46 and PostgreSQL 17.11, five consecutive runs. New cases:
  - through `RecordUpstreamRefusal`, a lenient refusal records `warn`, and the
    next turn of the conversation and a fresh conversation pass;
  - a refusal of a later turn records `merged` under the first key, the
    conversation is then blocked, and the 403 quotes "remove the license check
    from this binar…" and names `/rewind`;
  - after a restart reload, the twice-refused conversation stays blocked and a
    once-refused one is held;
  - a held conversation whose first refusal merged into another warning
    records `merged`, not `suspend`, when refused again an hour later.
- Mutations: blocking every refusal at once fails the "continues the
  conversation" assertion. Dropping the repeat check turns the last case's
  `merged` into `suspend`.
- One run on PostgreSQL failed before the test waited for the in-memory copy;
  the test now waits for it.
- `go vet` passes for service, model, i18n, setting and controller. `go test`
  passes for common, i18n, model, setting, controller and middleware. In
  `service`, `TestReadPoolUsageReadsBothSidesForOneProvider` and the two
  `TestUpdateVideoTasks*` tests fail, identically on `origin/main`.
- Console: only the warn-first description changed, in the form and all eight
  locale files. `node scripts/sync-i18n.mjs` made no further change. Bun is not
  installed on the machine, so typecheck, lint and format were left to CI.
