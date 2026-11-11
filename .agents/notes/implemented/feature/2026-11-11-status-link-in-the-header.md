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

## Alternatives considered

- **A console route that renders the status in React,** as some relays do. It would add to
  the console's first load and go down with new-api, which the static page does not.

## Verification

- `bunx vitest run src/hooks/__tests__/top-nav-links.test.tsx src/components/layout`: 13 pass,
  2 new (shown by default, hidden when the module is off).
- `bun run typecheck`, `bun run lint:check`, `bun run format:check` each exit 0.
