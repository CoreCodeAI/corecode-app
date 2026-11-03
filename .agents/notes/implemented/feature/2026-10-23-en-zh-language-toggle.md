# Agent Note: The header language switch is an EN / 中文 toggle

Status: implemented

Superseded on 2026-11-03 by `2026-11-03-header-language-menu.md`: the
header offers the five languages corecode.live is written in.

## Problem

The header, sign-in and setup pages opened upstream's seven-language menu
behind an icon. CoreCode's customers read English or Simplified Chinese, so
the menu was a click and a scan to reach one of two answers.

## Decision

`components/language-switcher.tsx` renders a two-segment pill, EN and 中文,
with the active side raised. Every caller keeps `<LanguageSwitcher />`.

- 中文 sets `zhCN`; EN sets `en`. A signed-in user's choice is still saved to
  their profile.
- Any Chinese variant, including `zhTW`, lights 中文; any other language,
  such as a French browser, lights EN.
- The seven locale files and the profile page's language list stay.

## Alternatives considered

- **Drop the other five locales.** They are upstream files; deleting them
  conflicts on every upstream sync, and the profile page still offers them.
- **Keep the menu with two entries.** It keeps the extra click the toggle
  removes.

## Consequences

- A customer on `zhTW`, `fr`, `ru`, `ja` or `vi` sees 中文 or EN lit and
  leaves that language the moment they press the other side.

## Verification

- `src/components/__tests__/language-switcher.test.tsx`: both switch
  directions and the `zhTW` and `fr` mappings pass.
- `bun run typecheck` passes; lint reports nothing for the file.
- Checked in a browser on `/pricing` against production data: the pill
  switches the page between English and Chinese both ways.
