# Agent Note: Lead the pricing page with Claude and Claude Code

Status: implemented

## Problem

On 2026-10-28 the GPT, Grok and Gemini groups joined the two Claude groups on
`/pricing`. The page sorted groups by ratio, so GPT (0.8) came first and was
selected by default, ahead of the Claude groups the site sells. Nothing marked
which group is for Claude Code, and nothing showed which vendor a group or
model belongs to. The Claude Code cost estimator also listed every token-priced
model, and its `sonnet` default matched the Gemini pool's
`gemini/claude-sonnet-5-5-high` alias first.

## Decision

- **A group's vendor is the vendor most of its models come from.** It reads
  `vendor_name` and `vendor_icon` from `/api/pricing`, falls back to the model
  name prefix when a model has no vendor, and lets aliases containing `/` not
  vote: the Gemini pool lists two Gemini models and two Claude aliases.
- **Claude groups come first and are selected by default**, cheapest first
  within; the other pools follow by ratio. With both kinds present the picker
  shows two labelled rows: Claude for Claude Code, then more models.
- **A group whose description mentions Claude Code gets a Claude Code badge.**
  The description is what operators already write for `UserUsableGroups`.
- **Vendor logos** come from `getLobeIcon`, on the group cards and beside each
  model name.
- **The header links to the Claude Code guide** (`/docs/claude-code/`).
- **The estimator offers only Claude models**, without aliases.

## Alternatives considered

Not recorded when the change shipped.

## Verification

`vitest run src/features/pricing` passes, including `group-vendors.test.ts`
(alias votes, name-prefix fallback, Claude-first order), a price-board case
where a cheaper GPT group still follows Claude, and an estimator case that
fails on the old filter. `bun run typecheck` and `format:check` pass. The page
was checked against the live `/api/pricing` in a browser at desktop and 390 px
widths, in light and dark.
