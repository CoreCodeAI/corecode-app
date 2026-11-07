# Agent Note: Sync the console locales against en

Status: implemented

## Problem

`bun run i18n:sync` picked as its base the locale with the most keys. `ko.json` carried one
key no other locale had, "Task pricing not configured", left from the Korean locale's
import and used by no source file. That made Korean the base, and the sync filled every
other locale's copy of the key with the Korean text, so each run added a Korean line to
seven files.

## Decision

- **en is the base.** The console's keys are the English source strings, so `en.json`
  decides which keys exist and their order. The sync fails when `en.json` is missing. The
  key-counting code is removed.
- **The orphan key leaves `ko.json`.** With en as the base, a key only another locale has
  goes to `_extras/<locale>.extras.json`, as the sync already did for any key outside the
  base.
- **`_extras/` is ignored,** like `_reports/`: both are the sync's output.
- **`locales.test.ts` fails on a key en lacks,** beside the existing check for a key a
  locale lacks, so the next stray key is caught in CI rather than at the next sync.

## Verification

From `web/`: the new test failed on the old `ko.json` and passes on the new one. A key
planted only in `fr.json` stayed out of every other locale and went to
`_extras/fr.extras.json`. A second sync changed nothing. `bun run typecheck`,
`format:check`, `lint:check`, `test` (271 files, 2940 tests), `build` and
`first-load:check` pass.
