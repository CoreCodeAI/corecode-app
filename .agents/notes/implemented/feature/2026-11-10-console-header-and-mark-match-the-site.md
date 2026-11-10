# Agent Note: The console's header and mark match the static site

Status: implemented

## Problem

A customer who clicks from the home page into the console crosses from the static site
(`corecode-infra`, `site/`) to this console in one click, and the header changed under
them. The site said 首页 and 模型价格; the console said 主页 and 模型定价. The site set
the name in serif with Code in the accent colour; the console set it in sans, one colour.

The home page's mark, the C drawn in real thinking signatures, appeared nowhere in the
console, so sign-in, a missing page and an empty list looked like any new-api
deployment.

## Decision

- **Words.** In `zh` and `zh-TW`, `Home` is 首页 / 首頁, `Model Pricing` is 模型价格 /
  模型價格, and `Back to Home` and `Go to home` follow. The console changes because the
  site's words are in every generated page; the console's are four locale lines.
  `src/i18n/site-header-labels.test.ts` fails if an upstream sync brings 主页 back.
- **Wordmark.** `BrandWordmark` sets the system name in serif, and for a name of two
  capitalised words puts the second in `text-primary`. The public header, the app
  header and the sign-in brand mark use it. Any other system name is shown whole.
- **Mark.** `SignatureMark` paints `/brand/signature-field.svg` through a CSS mask in
  the primary colour. It sits on the sign-in panel, behind the 404 page and behind
  `EmptyState`, at 10% opacity in the last two. No page where work is done changes.
- **The drawing is not built in.** The host serves `/brand/` beside the console, as it
  serves the logo. A `url()` in the stylesheet is resolved at build time and fails, so
  the component sets `--signature-field` and the stylesheet reads it. Where the file is
  missing the mask has no image and nothing paints.
- **Within the first-load budgets.** The change adds about 0.3 KB to each core page.
  The new elements reuse utility classes the stylesheet already had, which kept
  `/sign-in` at 360,303 of 360,448 bytes.

## Alternatives considered

- **Change the site's words.** Every static page carries the header; the diff would
  touch several hundred files to move two words.
- **Copy the drawing into `web/public/`.** Two copies of a generated file, and
  `corecode-infra` checks only its own.
- **Restyle the dashboard like the home page.** The dashboard is a tool used daily;
  receipts and stamps there would be noise, and a moved control costs its users.

## Consequences

- Admin-only strings still say 模型定价 (添加模型定价, 模型定价页) and 主页 (自定义主页).
  They are upstream's and were left to keep the sync diff small.
- Other languages differ from the site by a word (`Model Pricing` and `Pricing`,
  モデル料金 and 料金). They were not changed.
- `EmptyState` is now `relative isolate overflow-hidden`. Content that must escape the
  empty state's box needs a portal.

## Verification

- `bun run typecheck`, `bun run lint:check`, `bun run format:check` and
  `bun run first-load:check` pass; `bun run test` passes.
- The production build was served locally with GET requests read from production and
  nothing written: the session refresh was answered locally and other non-GET
  requests got an empty success. Signed out: `/sign-in` in light and dark, a missing
  page in both, `/pricing` at desktop width and 390 px. Signed in with the owner's
  current access token, read-only: the overview's header and the feedback page's
  empty list.
- `https://corecode.live/brand/signature-field.svg` answers 200.
