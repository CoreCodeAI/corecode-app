# Agent Note: Localize group names, plan titles, compact numbers and the Creation Studio key

Status: implemented

## Problem

A Russian (or English, Japanese, Korean, French, Vietnamese) console reader
still saw Chinese in four places. Group names and descriptions are stored
server text (`Claude 满血（仅限CC）`, `usable_group` descriptions) and showed on
the keys, pricing, usage-log, playground, service-status, dashboard and IQ-test
pages. Plan titles inside gift and credit messages (渠道体验包) stayed Chinese.
`/profile` showed 4.2万 because `Intl.NumberFormat` took the browser's zh-CN
locale rather than the console's language. The Creation Studio canvas key is
stored as `创作台` and displayed as-is.

## Decision

- **Group names and descriptions are locale keys.** The 15 stored strings
  (6 names, 9 descriptions) are keys in all eight locale files, with the
  translations in `/tmp/oversea/GROUPS.md`. `zh` and `zh-TW` hold the key as
  the value. Translation happens at render time only; the stored name stays
  the identifier (option value, filter value, React key, `autoColor`, sort
  key). `GroupBadge` translates its own label and keeps `copyText` raw.
- **Only Han-character text is looked up.** `web/src/lib/group-text.ts`
  (`groupText`) wraps `translateServerText` and skips text without a Han
  character. An ASCII group such as `default` or `vip` is an identifier; the
  locale's `default` key is `默认` in zh and would relabel it for a Chinese
  reader. The keys listing test caught this.
- **Plan titles are passed in, not imported.** `renderLogContent` and
  `renderAuditContent` take a `PlanTitleText` reader (optional, identity by
  default) and translate `params.plan` and `params.plan_title` through it.
  `usage-logs/lib/format.ts` is imported by the overview, so importing
  `plan-text.ts` there would move the six plan-title keys from `rest` to
  `core` in every core page's first load. The partition diff against main
  showed exactly that before the change was moved.
- **Compact numbers follow the console language.** `formatCompactNumber`
  defaults its locale to `toIntlLocale(i18next.resolvedLanguage)`. The
  pricing app-ranking total used a module-level formatter with the browser
  locale and now calls `formatCompactNumber`.
- **Creation Studio display only.** `displayKeyName` in
  `features/canvas-studio/lib/canvas-link.ts` maps the stored `创作台` to
  `t('Creation Studio')` where a key or token name is shown: the keys name
  cell, usage-log token column and mobile card, the token filter, the spend
  breakdown, and overview recent requests. Lookups keep matching the stored
  name. zh-TW shows `創作台` (its existing `Creation Studio` value) where it
  showed `创作台` before; this is the one visible change in a Chinese
  interface and is intended.
- **Shared auto-group item takes a label.** `AutoGroupOrderItem` shows an
  optional `label` (the translated name) and keeps `group` as the reorder
  value. The admin editors that use it pass nothing and are unchanged.

## Alternatives considered

- **Leave zh and zh-TW out of the files and short-circuit Chinese in the
  helper.** This would cut the budget cost, but `locales.test.ts` requires
  every en key in every locale, so the entries stay. The measured cost was
  about 400 bytes of brotli in the zh core part, which fits the budget.
- **Put plan-text in a core-safe module.** Any module that imports the plan
  dictionary is core-reachable from the overview, so the keys move to core
  regardless of file layout. Passing the reader in avoids touching the
  dictionary.
- **Translate flow graph labels at the chart.** Graph nodes are built in
  `lib/flow.ts` without `t`. The build context already carries
  `deletedTokenLabel`, so a `groupLabel` callback follows the same pattern.
- **Filter the Creation Studio key from lists.** Rejected: the key is
  usable, and the spec keeps the stored name.

## Verification

Run from `web/` on the branch, with the outputs summarised:

- `bun run typecheck`: no type errors in 1,887 files (across two projects).
- `bun run lint:check`: no new lint findings.
- `bunx vitest run` (full suite): 381 files, 3,984 tests passed. The four new
  focused tests are in it: `components/__tests__/group-badge.test.tsx` (Russian
  label for a Chinese group, zh shows the stored name, a caller label is
  kept), `lib/__tests__/format-compact.test.ts` (ru has no 万, zh-CN keeps
  4.2万, an explicit locale wins), `features/usage-logs/lib/__tests__/plan-text-gift.test.ts`
  (plan title translated in ru, kept in zh), and
  `features/canvas-studio/lib/__tests__/display-key-name.test.ts`.
- `bunx oxfmt -c .oxfmtrc.json` on the 43 changed or new TypeScript files.
- Locale partition against main: `localeParts` on main and on the branch
  differ only in the 15 new keys, all `core`; no key moved part. zh core
  brotli grew by about 400 bytes.
- First load (`bun run build`, brotli bytes, main built earlier on the same
  machine from the same commit, `first-load-budget.json` limits):

  | Page | main | branch | room main | room branch |
  |---|---|---|---|---|
  | `/sign-in` | 362,701 | 362,691 | 819 | 829 |
  | `/dashboard/overview` | 544,849 | 545,529 | 2,991 | 2,311 |
  | `/keys` | 628,708 | 629,325 | 1,052 | 435 |

  `bun run first-load:check` passes on all three (354.2 / 532.7 / 614.6 KB).
  `/keys` keeps 435 bytes; the group keys are the largest share of the rise.

## Not covered

- Admin-only pages (channels, users, system settings, site insights, rival
  prices, subscriptions admin) keep their group text as stored.
- CSV export keeps the stored group and token names, so the data stays
  machine-readable.
- The usage-log user-info dialog is an administrator view; its group name is
  translated, but the other admin tables were not touched.
