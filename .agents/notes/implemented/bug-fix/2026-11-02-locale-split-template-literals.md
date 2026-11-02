# Agent Note: Read string keys past template literals when splitting the locale

Status: implemented

## Problem

The production build splits each locale into boot, core and rest parts
(`web/scripts/i18n-locale-split-loader.mjs`; see
[the first-load note](../feature/2026-10-29-console-first-load-round-two.md)). A key
goes to rest only when some module names it as a string literal and no boot or core
module does. A key that no module names goes to core, because the server may send it.

The scanner's template-literal branch stopped at `${` without consuming the template.
The template's closing backtick then opened a new match. That match ran across lines,
over ordinary code, to the next backtick, and every literal in between went unread.
Each template with a substitution shifted the pairing again.

- A page-only key read as named by no module went to core. The overview and keys pages
  downloaded it on first load. The site insights pool panel's keys did, and they pushed
  `/dashboard/overview` 0.2 KB over its budget.
- A key a core page names, but which the scanner read only in other modules, went to
  rest. That page rendered it in English until the rest part loaded. There were 50 such
  keys.

## Decision

- A template literal without a substitution is still read as a key. One with a
  substitution matches as a whole, so its closing backtick opens nothing. Its text is
  then scanned again for the literals inside it, such as `` `${t('Oops! Something went
  wrong')} …` `` on the error page.
- `locale-split.test.ts` checks a key named after several such templates (`Peak
  throughput`, rest) and one inside a template (`Oops! Something went wrong`, boot).

## Consequences

Against the zh locale on 2026-11-02:

| Move | Keys |
|---|---|
| core to rest | 581 |
| rest to core | 50 |
| core to boot | 3 |

No key left boot. Each of the 581 was searched for as a quoted literal in the 528
modules the core routes reach, and none was found.

First load:

| Page | Before | After |
|---|---|---|
| `/dashboard/overview` | 525.2 KB | 514.8 KB |
| `/keys` | 605.3 KB | 594.9 KB |
| `/sign-in` | 349.3 KB | 349.3 KB |

The scanner is still a regex. A backtick or apostrophe inside a comment can still shift
its pairing, and a key that only a template with a substitution builds at run time
still goes to core.

## Verification

- The new test fails against the previous loader (`Peak throughput` read as core) and
  passes with this one.
- `bun run build` and `bun run first-load:check` pass with the sizes above.
