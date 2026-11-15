# Agent Note: Make the site-insights tabs quicker to read and to load

Status: implemented

## Problem

Read on production on 2026-11-15, the `/site-insights` tabs answered in 0.3 to 1.3 seconds each, so speed was not what cost the reader time. Reading was:

- The risk tab was 13.3 screens tall with 56 tables: each of the 50 shared addresses listed drew its own table of accounts.
- Every tab opened on a verdict of up to ten facts in one paragraph, and the overview repeated five of those paragraphs in bold.
- The overview's findings named every item they counted: 50 addresses in one line, 11 failing models in another. Four of those models (`wan-3.0-*`, `gpt-6-luna`) had been taken off sale, so nothing could be done about them and the finding could not clear until they left the range.
- A finding's button opened its tab at the top, whatever panel it was about.
- A row of seven or nine figures left its last card or three alone beside a gap.
- The upstream tab's margin card (US$2,873.99, 89.9%) sat beside a revenue card of US$57,548.58 without saying it covers only the channels whose cost is known.
- The page loaded all ten tabs' code in one 372.7 KB chunk whichever tab was opened.

## Decision

- **A verdict is a headline and a list.** `TabVerdict` carries `points`, its sentences in order, beside `text`. `sentences(...)` in `verdicts/shared.ts` builds both, so the wording of every verdict is unchanged. `Verdict` draws the first point as the headline and the rest as a list. The overview's tab digest shows the headline as the line and the rest under it.
- **Shared addresses are a queue of lines.** `ClusterList` draws one line per address (address, accounts, reasons, requests). The three riskiest (`CLUSTERS_OPEN`) show their accounts; the others open on a click or with "Expand All". Ten (`CLUSTERS_LISTED`) are listed until the reader asks for all. An address's accounts are drawn only while it is open.
- **A long list is named by its head.** `namedHead` names three items and counts the rest. The overview uses it for addresses with several plan buyers (in the risk tab's own rank order, so the first is the one the risk tab reviews first), failing models and failing upstream channels. The tab the finding opens lists them all.
- **A model taken off sale is marked, not reported.** The quality view sends `retired_models`: the models of `models` with no enabled ability now. The console leaves them out of the overview's failing models (and says how many it left out), out of the quality verdict's worst model and out of the quality tab's findings. The model table keeps them, faded, with an "Off sale" badge. A server that does not send the field retires nothing.
- **A finding can open its tab at a panel.** `Finding.section` names one of `SECTIONS`; `Panel` takes an `id`. The page keeps the jump until the panel is drawn (the tab's code and data arrive first) and gives up after six seconds. Debt, shared addresses, failing models and per-user limit rejections use it.
- **Each tab has a menu of its panels.** `SectionMenu` reads the open tab's `h3` headings when it opens and scrolls to the one picked. It keeps no list of its own, so a panel a tab draws conditionally is listed exactly when it is on the page.
- **Rows of figures fill.** `metricLayout` keeps one row of six columns for up to six columns of figures. More are spread over the fewest equal rows, and the cells left over widen the first featured figure, or else the last one. A caller that passes its own columns is left alone.
- **The upstream margin names its revenue.** When some revenue has no known cost, the margin card reads "89.9% of US$3,207.02 with a known cost".
- **Each tab's code loads when the tab is wanted.** `index.tsx` imports every tab through `React.lazy` and fetches a tab's chunk when its trigger is hovered or focused, as it already prefetches the tab's data.
- **Commission on a fee channel is a note.** The owner said on 2026-11-15 that it can be ignored. The channels verdict no longer mentions it or turns amber for it, and its panel moved below the tables with a neutral icon. This replaces the 2026-11-12 choice to show it as a warning; the net still leaves commission out for a fee channel.

## Alternatives considered

- **Collapse the shared addresses with `<details>`.** The 50 tables would stay in the page (4,092 elements). Drawing an address's table only while it is open halves the page's elements.
- **A list of sections written per tab.** Nine lists to keep in step with panels that appear and vanish with the data. Reading the headings needs none.
- **Decide "off sale" in the console from the price list.** The console would need a second request and the same rule in two places; the server already holds the abilities.
- **Drop retired models from the quality view.** Their requests and failures are real history and belong in the totals; only the call to act is wrong.
- **Split a verdict on punctuation.** Amounts and times contain full stops ("1.3s", "US$1.00"). The verdicts already build their text sentence by sentence.

## Consequences

- A verdict's test that compared the whole object now matches `tone` and `text`; `reading.test.tsx` pins `points`.
- `retired_models` adds one query on `abilities` to every quality read.
- The entry's chunk map lists 13 more chunks: first load grows by about 100 bytes on `/sign-in`, `/dashboard/overview` and `/keys`.
- A tab's first open waits for its chunk when the trigger was never hovered; the page shows two skeletons meanwhile.
- The section menu lists panels only. Figures and findings above the first panel are the top of the tab.

## Verification

- `go test ./model/ -run "Quality|Insight" -count=1` passed on SQLite, including `TestQualityNamesRetiredModels`.
- Console, from `web/`: `bun run typecheck`, `oxfmt --check` on `src/features/site-insights`, `bun run lint:check`, `bun run build` and `bun run first-load:check` passed (502, 1,037 and 480 bytes left; main has 604, 1,139 and 582). `vitest run src/features/site-insights src/i18n` passed: 44 files, 505 tests. The locale partition (`localeParts`) of main and the branch differs only in the keys added and removed, all in `rest`.
- The built console was served beside a build of main, each against production through a read-only proxy (GET forwarded, the session refresh answered locally, every other write swallowed; `retired_models` computed from the public price list, since production does not send it yet). At 1,600 px, over 7 days:
  - Risk: 13.3 screens, 56 tables and 4,092 elements on main; 4.1 screens, 9 tables and 1,676 elements on the branch.
  - Scripts loaded to open one tab: 2,551 KB in 42 files on main; 2,220 to 2,309 KB on the branch, by tab.
  - The model table marked `wan-3.0-480p`, `wan-3.0-prime-1080p`, `wan-3.0-prime-720p` and `gpt-6-luna` as off sale.
- At 390 and 360 px the risk, overview and upstream tabs had no horizontal overflow (`scrollWidth` equal to `innerWidth`).
- In that build, the overview's finding on addresses with several plan buyers read "95.169.0.32、188.253.121.96、23.237.196.226 还有 47 项"; its button opened the risk tab with "共用同一 IP 的账号" at the top of the view. The section menu listed the risk tab's seven panels and scrolled to the one picked.
- Not checked: Safari; the light theme; a server that sends `retired_models` itself (the proxy supplied it).
