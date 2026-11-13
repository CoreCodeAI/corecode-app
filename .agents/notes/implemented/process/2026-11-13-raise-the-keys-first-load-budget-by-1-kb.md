# Agent Note: Raise the keys page's first-load budget by 1 KB

Status: implemented

## Problem

The console speed change of 2026-11-13
(`.agents/notes/implemented/feature/2026-11-13-start-page-requests-on-hover.md`) put
`/keys` about 190 bytes over its 615 KB budget, measured against main on the same machine:

- `/sign-in` 362,668 → 362,907 bytes, limit 363,520;
- `/dashboard/overview` 545,506 → 546,453 bytes, limit 547,840;
- `/keys` 629,302 → 629,954 bytes, limit 629,760.

Two things make up the difference:

- the hook in the entry that hands a prefetched response to `api.get`, about 190 bytes
  (the rest of the prefetch code is in the routes' lazy chunks);
- one more shared chunk, about 320 bytes: once `lib/currency.ts` grew by its formatter
  cache, rspack moved it and the spinner out of the chunk they shared with five other
  modules into a chunk of their own. Moving the cache to another module split the chunk
  the same way.

## Decision

`/keys` goes from 615 to 616 KB. The owner approved 1 KB for `/dashboard/overview` and
`/keys` on 2026-11-13; the overview still fits its 535 KB, so only `/keys` moves.

## Alternatives considered

- **Drop the formatter cache.** It is a fifth of the usage logs page's render time saved
  (see the feature note); the chunk split is a bundler threshold, not code the page runs.
- **Move other code off the first load.** No cheap candidate is left after the earlier
  rounds; finding one is a change of its own.

## Consequences

- 1 KB is under 2 ms of download at 600 KB/s on a cold visit; the paired cold loads of
  `/keys` measured 2,939 → 2,978 ms (p50), within the run-to-run spread.
- `/keys` keeps about 830 bytes of room and `/dashboard/overview` about 1.4 KB.

## Verification

`bun run first-load:check` on the branch, and the byte counts above from the same
script's sum against a build of main `3b4927015`.
