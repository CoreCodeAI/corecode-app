# Agent Note: Open each site insights tab with a one-sentence verdict

Status: implemented

## Problem

Each tab of the site insights page opened on a row of figures, every one the same size. The reader had to read them all to learn whether anything was wrong. Only the pool tab's capacity card, and the overview's attention list, stated a conclusion.

## Decision

Capacity, service quality, funds, growth, activity and risk each open with a `Verdict`: one sentence in a card with a colored edge, green, amber or red by how it reads. The sentences come from the figures the tab already has, through hooks in `verdicts.ts`. The thresholds are the ones the tab's own cards color by.

- **Capacity:** requests and their change, peak concurrency against the pool's slots, and what the pool or the per-user limits turned away. Red when the peak passed the slots or the pool turned requests away; amber for per-user rejections.
- **Service quality:** the failure rate and its change in points, each vendor failing past 5% over 100 requests or more, Claude's first token at p50 and p95, and the model that fails most, when one passes 5%. Green under 2%, otherwise `failureTone`; amber when a vendor fails past 5% or Claude's p95 passes 10 seconds. A vendor is named even when the site's rate is low: on 2026-11-05 GPT failed 6.3% while the site stood at 1.6%.
- **Funds:** money paid and its change, revenue earned, the gross margin and its rate (`vendorMargins`), and debt. Red for a loss, amber for a margin under 20% or debt past a dollar.
- **Growth:** sign-ups and their change, and the share that sent a request and that paid. Amber when under 30% activated.
- **Activity:** active users and their change, and the largest customer's and the top ten's share. Amber when one customer holds over 30%.
- **Risk:** sign-ups and what to check: shared addresses, alias emails, sign-ups off the whitelist, accounts in debt. Green when there is nothing to check.

A change against the previous period appears only once that period has loaded; past doubling it reads as a multiple ("to 3.7×"), since the site's first weeks make percentages in the hundreds. Sentences are joined by `joinSentences`, which leaves no space after a full-width full stop. Each sentence has its own variant without the change, so no translation is assembled from fragments.

## Alternatives considered

**Computing verdicts on the server.** The thresholds live in the console beside the cards that color by them. A server sentence would need the same thresholds in two places, and its own translations.

## Consequences

A threshold changed on a card has to change in `verdicts.ts` too.

## Verification

`verdicts.test.tsx` checks the capacity, quality, growth and risk sentences and tones, including a quiet risk tab and a growth tab without a previous period.
