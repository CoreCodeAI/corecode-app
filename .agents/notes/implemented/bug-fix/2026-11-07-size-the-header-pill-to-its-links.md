# Agent Note: Size the scrolled header pill to its links on desktop

Status: implemented

## Problem

Once a page scrolls, `PublicHeader` (`web/src/components/layout/components/public-header.tsx`,
upstream code) shrinks the header into a pill capped at `max-w-[52rem]`. Its desktop links
carry `min-w-0 truncate`, so when the pill is narrower than its content every link gives up
a few pixels and shows an ellipsis.

The console's header outgrew 52rem. CoreCode adds 排行榜 and 企业服务, the version beside
the name, a language label and, signed in, notifications and the avatar. On 2026-11-07 the
owner reported the scrolled pill on `/` reading 主… 控制… 模型定… 排行… 文… 企业服…:

- Signed in, in Chinese, the content is 814 px wide and the pill leaves 808 px.
- Signed out, in English, the content is 858 px wide, and Home, Console, Model Pricing, Docs
  and Enterprise all truncate.

## Decision

- **From `lg` up, the scrolled pill is `w-fit`.** It is as wide as its content, within
  `max-w-7xl` and the viewport. The logo block is a size container, so it contributes its
  `lg:min-w-36` and the version shows as its icon, as it did at 52rem.
- **Below `lg` nothing changes.** The desktop links are hidden there and the pill keeps
  `max-w-[52rem]`. The added `w-full` equals the block's auto width under `border-box`.
- **The width still eases.** The container is `w-full` when the page is at the top and
  `lg:w-fit` once scrolled, with `[interpolate-size:allow-keywords]`, so browsers that can
  interpolate to `fit-content` (Chromium 129 and later) animate it; others switch at once.

## Alternatives considered

- **A wider fixed cap, such as 60rem.** It moves the cliff instead of removing it: the next
  link or a longer translation truncates again.
- **Measuring the content in script, as the static home page does (`--pill-w`).** It needs a
  resize observer and a re-measure on every language switch and sign-in, for what CSS
  sizes by itself.

## Consequences

- This changes an upstream file. A sync that touches this `div`'s classes conflicts here; keep
  `w-full`, `lg:w-fit lg:max-w-7xl` and the interpolation class.

## Verification

- `bun install --frozen-lockfile`, `bun run build`, `bun run typecheck`, `bun run lint:check`
  and `bun run first-load:check` pass in `web/`. The built CSS carries
  `.lg\:w-fit{width:fit-content}`, `.lg\:max-w-7xl` and `interpolate-size:allow-keywords`.
- On production `/pricing` in headless Chrome at 1,440 px, scrolled 800 px, with the
  container's width set inline to `fit-content` under `max-width: 80rem`:
  - English, signed out: 808 px at 52rem with five links truncated; 858 px fitted, none.
  - Chinese, signed out: 776 px fitted, none.
- In the owner's signed-in browser at 1,440 px on `/`, with transitions off so the frame shows
  the final state: at 52rem the links read 主… 控制…; fitted, the pill is 814 px and every
  label is whole.
