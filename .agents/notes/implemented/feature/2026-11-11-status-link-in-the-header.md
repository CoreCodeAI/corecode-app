# Agent Note: Link the status page from the console header

Status: implemented

## Problem

`https://corecode.live/status/` shows each customer group's success rate, latency and
cache hit rate (corecode-infra `.agents/notes/implemented/feature/2026-11-11-status-page-group-cards.md`).
Nothing in the console led to it, so a customer seeing errors had to know the address.

## Decision

- The header gets a 服务状态 link after the pricing link, controlled by a new `status` key
  in `HeaderNavModules`. It defaults to on, and administrators can turn it off under
  header navigation like the other simple modules.
- The link is marked external. `/status/` is a static page Caddy serves beside the console,
  not a router route, so a router `Link` would land on the SPA's not-found page. External
  links open in a new tab, as the docs link does.

- **The /sign-in first-load budget rises from 352 to 353 KB.** Against a build of
  `origin/main`, the page's entry bundle shrank 48 bytes and the zhCN boot locale grew 20
  for the link's label. Rspack also split one shared 4,228-byte async chunk into two of
  2,364 and 2,229 bytes, which took the page from 351.9 to 352.3 KB and from 26 to 27
  files. The same build left /dashboard/overview and /keys 0.4 KB smaller. As in the 1 KB
  raise of `cffb0408f`, the excess is chunk layout, not code that a smaller change avoids.

## Alternatives considered

- **A console route that renders the status in React,** as some relays do. It would add to
  the console's first load and go down with new-api, which the static page does not.

## Verification

- `bunx vitest run src/hooks/__tests__/top-nav-links.test.tsx src/components/layout`: 13 pass,
  2 new (shown by default, hidden when the module is off).
- `bun run typecheck`, `bun run lint:check`, `bun run format:check` each exit 0.
- `bun run build` then `node scripts/check-first-load.mjs`: /sign-in 352.3 of 353 KB,
  /dashboard/overview 525.3 of 526, /keys 604.7 of 606. `origin/main` built the same way:
  351.9, 525.8, 605.1.
