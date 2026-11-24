# Agent Note: Fold the verdict to a headline and chips, so each tab opens on its charts

Status: implemented

## Problem

Read on production on 2026-11-24, every site insights tab (except the account pool) opened on an amber verdict of one headline and up to ten long sentences. That list stood between the tab bar and the first chart: the quality verdict was 10 lines, and the funds tab's first screen was only figures and sentences. The owner said the page "still doesn't read well" and that what needs attention should fold away so the charts come first.

## Decision

- **A verdict is a headline, a row of chips and a fold.** `Verdict` (`components/shared.tsx`) draws `points[0]` as the headline and the rest of `points` inside a collapsible panel, shut by default under a "N details" button. The panel stays mounted (`keepMounted`), so the sentences remain in the page text and in tests that read it. A verdict with one sentence, or `text` alone, has no button. The collapsed card is 75px tall at 1440px and about 160px at 390px, where the headline wraps.
- **Chips are optional structured figures.** `TabVerdict` has an optional `chips: VerdictChip[]` (`{ label, value, tone? }`), built with `chipList(...)` in `verdicts/shared.ts` from the numbers each hook already computes: the quality tab's failure rate with its move in points, each failing vendor, Claude and GPT first-token p95, requests with no channel; the capacity tab's requests, peak against slots, refusals and quota demand; the funds tab's cash received, recognized revenue, margin and debt; the upstream tab's failure rate, margin, incidents and stale bills; the growth, activity, risk and channels tabs' three or four figures. A tone is set only where the verdict already colors by that figure. The thresholds and the sentences are unchanged.
- **A tab passes `chips={verdict?.chips}`.** The eight `<Verdict>` call sites in the tab files each gained that one prop; a tab that builds its verdict some other way shows no row.
- **The sentences did not change.** `text` and `points` are what they were, so the overview's tab digest and every verdict test that reads them still hold.

## Alternatives considered

- **Parse the figures out of the sentences.** The sentences are translated per language and carry amounts, times and names; a parser would break on the first new wording. The hooks hold the numbers.
- **Drop the list.** Each sentence is an action the reader has no other place to find (who to check, which channel to renegotiate). It is folded, not removed.
- **Open the fold when the tone is red.** The overview's "needs attention" list is the place for that; a red verdict keeps its color and its chips, and one click opens the list.

## Consequences

- A test that read the whole verdict as one text now reads each sentence (the chips and the button sit in the same element), and one that listed its items opens the fold first.
- A new verdict hook adds chips by returning `chips: chipList(...)`; the tab file passes `chips={verdict?.chips}`.
- Chip labels are new i18n keys in all eight locale files.

## Verification

- `bun run typecheck`, `bun run lint:check`, `bun run build` and `bun run first-load:check` passed (1,338, 913 and 1,152 bytes left; the verdict lives in the lazy tab chunks, so first load did not move). `vitest run src/features/site-insights src/i18n` passed: 58 files, 616 tests, including the new chip tests for the quality, capacity and funds hooks and the fold test in `reading.test.tsx`.
- The built console was served beside a stub of `/api` replaying GET responses read from production in the administrator's own browser session (writes swallowed, nothing sent to the database). At 1440 and 390 px, light and dark, the eight tabs opened on a verdict of 75px with its chips, and "N details" opened the list. The measured chips of each tab are in the PR.
- Not checked: Safari; a tab opened on a range with no previous period beyond the unit tests.
