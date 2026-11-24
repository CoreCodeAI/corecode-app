# Agent Note: Fold the verdict to a headline and chips; open the funds and upstream tabs on their charts

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

## Part two: the funds and upstream tabs open on charts

### Problem

After the verdict was folded, the funds tab still ran 22 panels in 8,000px, with the day chart eleven panels down, and the upstream tab opened on a row of seven figures and a long table. The owner asked for figures and a trend chart first and the long tables later, and for the zzshu accounts' balances (balance_source newapi/sub2api) on the upstream cards.

### Decision

- **Funds order.** Verdict, the cash and credit cards, then side by side the daily revenue paid chart (moved up) and a new "Revenue earned and consumption" chart, the profit waterfall, vendor margin, the payment method donut with its table beside a "Customer concentration" panel, then the drivers, vendor usage, model mix and group consumption. The rest sits under one folded "Details" bar: plan book, gift watch, orders, wallet credit issued, largest balances, manual adjustments, negative balances and consumption by user.
- **The details stay in the page.** `DetailsGroup` (`finance-overview.tsx`) hides its panels with `hidden`, not by unmounting, so the section menu still lists them and tests still find their text. `revealPanel` (`sections.ts`) opens the group around a panel; the section menu and the overview's jump to `#debtors` call it before scrolling, because a hidden panel cannot be scrolled to. The group opens synchronously (`flushSync`) so the scroll lands on a shown panel.
- **Daily gross margin is not drawn.** Margin is computed over the period from vendor bills; the daily rows carry no cost, so a daily margin line would be invented. The new chart shows revenue earned beside consumption at list price by the day, and consumption alone by the hour (hourly rows carry no earned revenue).
- **Concentration reads the existing user-spend query** (same query key as the consumption table, window 24 hours or 7 days). `spendConcentration` sums the biggest 5, 10 and 20 customers' `quota_usd` over the server's whole-window total, which covers every customer, not only the listed hundred. No new server field was needed.
- **Upstream cards.** One card per upstream that cost something, carried attempts or has a balance read: balance, cost, failure rate, attempts, dearest first, eight at most. `UpstreamChannel` gained `balance` and `balance_updated_at` (the channel's own columns). `balance_updated_at` of 0 means no balance was ever read, so the card shows a dash, never $0. A balance older than a day is not judged: no threshold was invented.
- **Spend chart.** `upstreamSpendSeries` stacks each day's or hour's `cost_usd` by upstream: the four dearest named, the rest one grey series. The cost is the same cost the table reads.
- **A layout fix on the way.** At 390px the funds tab's cards were 427px wide inside a 366px column: a grid with one implicit auto column takes its widest child's minimum width. The tab's root grid and the summary grid now use `grid-cols-[minmax(0,1fr)]`.

### Alternatives considered

- **A tab strip inside the funds tab for the details.** It would hide panels the section menu and jumps must reach, and a strip needs its own state per link.
- **Unmount the folded panels.** Their queries would then start only on opening, but the section menu would lose them and `#debtors` would never be found.
- **Cumulative concentration curve.** Three bars say the same with less to read; the curve needs 20+ points from a list capped at 100.

### Consequences

- A test that reads a panel in the details opens the group first (`finance-tab.test.tsx`, `finance-round3.test.tsx`).
- A panel moved into a folded group must keep its `h3`; the section menu reads headings.
- The server fields are additions: an older console ignores them, and a newer console on an older server shows no balances.

### Verification

- `go test ./model/` passes with a test that the balance and its read time come through and that a channel never read has a zero `balance_updated_at`.
- `bun run typecheck`, `lint:check`, `build` and `first-load:check` passed (1,386, 961 and 1,200 bytes left). `vitest run src/features/site-insights src/i18n`: 59 files, 628 tests, including `overview-B.test.tsx` for the spend series, balance reading, the cards, the concentration panel and the details group.
- Against the stub of production reads (balances for three channels were filled in by hand there, since the server had not shipped the fields), at 1440 and 390 px, light and dark: the funds tab opens on the cards and two day charts, the concentration bars read 45.7%, 56.1% and 68% over 24 hours, and picking "Negative balances" in the section menu opens the details and scrolls to it. The upstream tab opens on six cards and the stacked spend chart.
- Not checked: Safari; the live balance of the zzshu accounts before the server release.
