# Agent Note: Show service status inside the console

Status: implemented

## Problem

Customers who wanted to know whether a group was healthy had to leave the console for
the public page at `/status/`. The header's 服务状态 link opens it in a new tab, and
the sidebar had no entry. Other relays built on new-api show channel status as a
console page, and the owner asked for the same: an entry in the regular sidebar
that opens a page inside the console.

## Decision

- **A console page at `/service-status`, listed as 服务状态 in the General
  sidebar group.** It is not `/status` because `corecode-infra`'s Caddyfile sends
  `/status` and `/status/*` to the static page. The console route does not shadow
  that page, so the public page stays as it is.
- **It reads `/status/status.json`, the file the public page reads.** The file is
  same-origin and public, so the page needs no new API, no backend change and no
  session. `relay-watch.py` in `corecode-infra` remains its only writer, so both pages show
  the same numbers. The page follows the public page's rules: the response's
  `Date` header decides staleness, data older than 10 minutes reads "Status
  unknown", and the page polls every 60 s.
- **It shows groups, never channels or suppliers.** The file holds only
  customer-facing group names, which is why the page is called 服务状态 rather than
  渠道状态.
- **A `console.status` sidebar module, on by default.** Admins and customers can
  turn it off like any other entry. An admin layout saved before the module existed
  shows the entry because defaults are merged in, and a user layout without the key
  does not narrow it. The Go defaults in `controller/user.go` and `model/user.go`
  already omit newer modules such as `audit` for the same reason, so they are left
  unchanged.
- **The strips reuse the site-insights `Sparkline` interaction.** The pointer's x
  position picks a period, so gaps between cells read out too. A finger can drag
  along the strip, and arrow keys step through it. The readout is a line under the
  strip, not a floating tooltip, so a tap shows the same text as a hover.

- **Each group card leads with its vendor.** It shows the vendor's logo and a
  vendor tag. The ratio and model are tags, the three figures sit in bordered tiles,
  and a 创建 API 密钥 button links to `/keys`. The vendor comes from
  `resolveModelProvider` on the group's busiest model, or from the group name when
  the group has no traffic. The logo comes from `getLobeIcon`, the source the
  pricing and log pages use. The owner preferred this layout, which other new-api
  relays use, to the first plain card. The strip's title and readout sit above the
  cells so that a finger on the strip does not cover them.

## Alternatives considered

- **Embed `/status/` in an iframe.** That is the least code, but it nests the public
  site's header, footer and fonts inside the console, and it does not follow the
  console's dark theme or mobile layout.
- **A new `/api` endpoint over the logs.** That would duplicate `relay-watch.py`'s
  aggregation in Go, so the two pages could disagree.

## Verification

- `bun run typecheck`, `bun run lint:check`, `bun run format:check`,
  `bun run build` and `bun run first-load:check` pass. The full `bun run test` run
  passes 3119 tests.
- New tests cover the rate and latency formats, request-weighted strip summaries,
  the operational, maintenance, stale-by-server-clock and unreadable banners, the
  strip readout under the pointer, and the sidebar module under old and switched-off
  configurations.
- The built console was checked in a browser with production data through a read-only
  proxy, at desktop and phone widths.
