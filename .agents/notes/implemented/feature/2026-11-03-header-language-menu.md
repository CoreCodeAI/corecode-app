# Agent Note: The header language switch is a menu of the site's languages

Status: implemented

## Problem

corecode.live's home, docs and blog now exist in Simplified Chinese, English,
Japanese, Korean, Russian and Traditional Chinese (corecode-infra
`.agents/notes/implemented/feature/2026-11-03-site-in-six-languages.md`). The
console header still offered EN / 中文, so a reader who arrived from `/ja/` or
`/ru/` could not pick their language in the console, although the console has
`ja`, `ru` and `zhTW` locales.

## Decision

`components/language-switcher.tsx` is a dropdown with a globe and the current
language's name. It lists 简体中文, English, 日本語, 한국어, Русский and 繁體中文, in the
static site's order. Choosing one calls `i18n.changeLanguage` and, for a
signed-in user, saves it to the profile, as before.

- Korean was left out at first because the console had no `ko` locale. A
  `ko.json` translated from the English source text now carries every key
  (`locales.test.ts`), so 한국어 is listed between 日本語 and Русский. Korean is
  not an upstream locale, so new upstream keys reach it through
  `bun run i18n:sync` like the others.
- `fr` and `vi` stay on the profile page only. corecode.live is not written in
  them.
- A language the menu does not list, such as `fr`, shows "English" on the
  trigger, which is the fallback the console renders.
- The choice is the same `i18nextLng` value the static site writes, so it
  carries both ways.

## Alternatives considered

- **Keep the pill and add segments.** Five segments do not fit beside the theme
  button on a phone.
- **List all seven locales.** fr and vi would lead to a console whose home page,
  footer and docs links are English.

## Consequences

- About 340 to 390 CoreCode-specific strings in `ja.json`, `ru.json` and
  `zh-TW.json` still equal their English keys, so those readers see some
  English. The home page and footer options carry only `zh` and `en`, and fall
  back to `en`.

## Verification

- `bunx vitest run src/components`: 98 pass. This includes a new test that the
  menu lists the five languages, switches to Japanese, and labels `zhTW` and
  `fr` correctly.
- `bun run typecheck`, `bun run lint:check` and `bun run format:check` pass.
- On `bun run dev` against `https://corecode.live`, in ego-browser on
  `/sign-in`: the menu listed the five languages with English current.
  Choosing 日本語 wrote `i18nextLng=ja` and set `<html lang="ja">`. The
  heading read "CoreCode にサインイン", and the trigger read 日本語.
