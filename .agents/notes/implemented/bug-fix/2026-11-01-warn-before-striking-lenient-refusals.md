# Agent Note: Warn before striking a refusal of a lenient category

Status: implemented

Superseded in part on 2026-11-07 by `2026-11-07-warn-per-category-within-a-day.md`: a lenient category warns per category, `lenient_warnings` times within 24 hours, not once per counting window.

## Problem

The violation guard (`../feature/2026-10-25-violation-guard.md`) entered enforce
mode, and its first enforce record, #100 on 2026-11-01, suspended user 490 for
24 hours. Three problems showed up while reviewing it:

- **One refusal category is mostly false positives.** Anthropic refused the
  request after 7,655 output tokens with `stop_details.category:
  reasoning_extraction`. The request was an ordinary agent session from
  `magpie/0.1.2405`: 137 messages, 82 tool calls and 5 screenshots. Of the 28
  customer `reasoning_extraction` records up to then, only one group (user
  402, "用 Claude 特有风格写一段长推理……") was a deliberate probe. Most of the
  rest were Claude Code side requests that start with `<transcript>`. With
  `ban_strikes` 2, two such refusals in 30 days would disable the account.
- **The excerpt was a client caption.** magpie sends the images a tool returned
  as a user message whose only text block is `Attached image(s) from tool
  result:`. `humanMessageText` kept it as the customer's words, so the record
  showed that caption and nothing a reviewer could judge. It is 31 characters
  without spaces, below the similarity check's 32, so it never entered the
  refusal set.
- **The records table hid the Lift button.** The table lays out by content.
  `TruncatedCell` was also width-unbounded, so a 4 KB excerpt widened its
  column, and the tooltip held the whole message. Lift ended up off screen.

## Decision

- **`violation_guard_setting.lenient_categories`** lists refusal categories,
  separated by commas or whitespace. Its default is `reasoning_extraction`.
  When a refusal in one of these categories starts a new incident, and the user
  has no warning in the counting window, the guard records action `warn`:
  - the refused conversation stays blocked, as for every record;
  - there is no suspension;
  - the warning does not count toward `ban_strikes`.
  
  A later refusal in a lenient category is a normal strike. Other categories are
  unchanged.
- **A warning merges only its own incident.** It claims the incident through
  `ClaimViolationStrike`, so parallel refusals still record one `warn`. Then
  `ShortenViolationMerge` moves `last_strike_at` back, so the merge period
  ends ten minutes after the warning, not after `suspend_hours`. Without that,
  a `bio` or `cyber` refusal an hour after a warning would be recorded as
  merged and go unpunished. The update matches the claimed timestamp, so it
  never touches a newer incident. `HasViolationStrikeInConversation` also counts
  `warn`, so resending a warned conversation merges into it.
- **`clientCaptions` skips a text block that exactly equals a known client
  caption**, currently only magpie's image caption. Only whole-block equality is
  skipped, so no customer text can hide behind it. The 2026-10-29 decision
  against stripping templates from human text still holds. That decision is
  about templates that carry other text.
- **The console** shows the excerpt as one fixed-width line (`w-60`, whitespace
  collapsed). Clicking it opens a dialog with the full message, the record's
  user, time, category, model and request ID, and a copy button. The Lift
  column is pinned right (`meta.pinned`), as in the users table. The settings
  form has a "Warn-first categories" field, and the action column has a
  "Warning (not counted)" badge.

## Alternatives considered

- **Record lenient refusals only, never strike.** This lets a deliberate
  extractor such as user 402 retry indefinitely at the cost of one blocked
  conversation each time.
- **Give a warning its own state column.** A `last_warn_at` column needs a
  migration on three databases for what a timestamp adjustment already
  expresses. The old server, running beside the new one during a release, reads
  `last_strike_at` with the same meaning.
- **Fix the excerpt by recording several human messages.** The excerpt is also
  the similarity fingerprint that incoming messages are compared against, so a
  concatenation would change that check.

## Consequences

- A customer refused once for `reasoning_extraction` keeps API access. The
  pool account still took that refusal. Whether Anthropic counts this category
  against the account is unknown; if it does, remove it from the setting.
- A lift resets warnings too, because the counting window starts at
  `forgiven_at`.
- magpie conversations get new conversation keys. The only refused magpie
  conversation, #100, belongs to user 490, who had already been lifted.
- A new client caption needs an entry in `clientCaptions`.

## Verification

- `TestViolationStrikePolicy` passes on SQLite 3.50.4, MySQL 8.0.46 and
  PostgreSQL 17.11 under `-race`. Two new cases check that:
  - eight parallel lenient refusals record one `warn`, and the account is not
    suspended while the refused conversation is blocked;
  - after the warning, a refusal within ten minutes merges, the next lenient
    refusal suspends, and the one after that disables the account;
  - a `bio` refusal 20 minutes after a warning suspends.
- `TestViolationConversationKeys` checks that the caption alone is not human
  text and that a caption followed by other text is kept whole.
- With `service/violation_guard.go` reverted, both new cases and the caption
  assertion fail.
- `go vet ./...` and `go test` for common, controller, middleware, model and
  service pass.
- Console: typecheck, `lint:check`, oxfmt, `first-load:check` and the
  system-settings tests (24 files, 232 tests) pass. A new test checks the
  one-line cell and the dialog's full text.
- A local build on SQLite, seeded with a 4,000-character excerpt and a
  multiline one, checked in a 1369-pixel-wide browser:
  - every excerpt cell is 240 by 20 pixels;
  - before the pin, Lift sat at x 1653, beyond the viewport;
  - after it, Lift sits at x 1261 and is the element hit at its center;
  - the dialog scrolls its 60vh body and copies.
