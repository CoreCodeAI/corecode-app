# Agent Note: Start a page's requests on hover and cut the logs table's render

Status: implemented

## Problem

The owner reported the console as laggy everywhere: opening a page, switching pages from
the sidebar, acting inside a page, and on phones. A lab run of main (one server binary,
two copies of one seeded SQLite file with 25 keys and 3,000 usage logs, headless Chrome
at 170 ms latency and 600 KB/s, 10 alternating runs) showed two causes.

1. **A page switch waited for requests sent only after the click.** At 1× CPU, close to
   the owner's own machine, a switch was almost all network. The router already preloads
   a route's code while the pointer rests on its link, and the keys page's loader sends
   its request then: overview → keys was usable 146 ms after the click. The usage logs and
   wallet pages had no loader, and the overview's loader left out the balance card's
   subscriptions and the uptime panel. Their requests went out after the click, after
   the page mounted: overview → usage logs took 330 ms, overview → wallet 230 ms, keys →
   overview 242 ms.
2. **The usage logs page rendered a hundred heavy rows.** At 4× CPU the switch to it
   spent about 490 ms in JavaScript and 215 ms in layout. A profile of an unminified
   build named the largest costs:
   - `useTranslation`: react-i18next 17 copies every property of the i18n instance for
     each component that mounts with it, 58 ms self time;
   - a closed details dialog mounted in every row, 57 ms;
   - `Intl.NumberFormat` built anew for every formatted amount, about 55 ms.

## Decision

- **Hover prefetch by URL** (`lib/prefetch-get.ts`). A route loader calls `prefetchGet`
  for the GETs its page sends on mount. The page's own `api.get` for the same URL,
  parameters and session within 10 seconds takes that response, and readers of the same
  URL at that moment share it as a request in flight. A failed prefetch is not handed
  over: the page sends its own request and reports its own error. A response serves one
  load; the entry stays until it expires, so the loader's second run, when the click
  itself loads the route, does not send the request again. The entry bundle carries only
  the hook `api.get` calls; the rest loads with the routes' lazy chunks.
  - Usage logs (common section): the list and the stats, with the params the table and
    the stats bar build on their first render. The default time range is reused for 10
    seconds so the loader's URLs and the page's match.
  - Wallet: top-up info, plans, subscriptions, credit history and affiliate summary; the
    last two only while their query data is stale.
  - Overview: the balance card's subscriptions (through its query) and the uptime status.
  - Nothing is sent for a URL `index.html` already fetched on this page load.
- **Number formatters are cached** per locale and option set in `lib/currency.ts` and
  `lib/format.ts`.
- **react-i18next is patched** (`web/patches/react-i18next@17.1.0.patch`) to wrap the
  instance in a Proxy, the change version 18 made. Drop the patch with the upgrade to 18
  and i18next 27.
- **A usage log's details dialog mounts when it is first opened.**

## Alternatives considered

- **Prefetch through the query cache** (`queryClient.prefetchQuery`) as the keys page
  does. The logs table's query key carries its column filters and search params, and
  several wallet panels fetch in effects without a query; matching every key by hand is
  fragile. A URL is what both sides already agree on.
- **Lazy tooltips and menus in table rows.** A build with every tooltip and row menu
  removed was only 7 to 13% faster on the keys and logs switches; mounting them on first
  hover would remount the trigger under the pointer. Not worth the risk for now.
- **Fewer or virtualized log rows.** A visible change (page size, scrolling, find in
  page); left for the owner to decide.

## Consequences

Paired lab runs, main `3b4927015` against this branch, p50 time from the click (or
navigation start) to usable, 170 ms latency:

| Scenario | 1× CPU main → branch | 4× CPU main → branch |
|---|---|---|
| overview → usage logs | 330 → 169 ms | 694 → 457 ms |
| overview → wallet | 230 → 110 ms | 254 → 120 ms |
| keys → overview | 242 → 112 ms | 281 → 144 ms |
| overview → keys | 146 → 141 ms | 352 → 329 ms |
| usage logs, reload | 872 → 616 ms | 1,602 → 1,272 ms |
| usage logs, cold | | 3,809 → 3,420 ms |
| keys, cold | | 2,939 → 2,978 ms |

At 300 ms latency, 1× CPU: overview → usage logs 459 → 301 ms, → wallet 348 → 245 ms,
keys → overview 363 → 246 ms.

- Resting the pointer on a sidebar link now sends that page's GETs. Hovering again
  within 10 seconds sends nothing new; a hover without a click costs those requests.
- The `/keys` first load is 652 bytes larger, which needed a 1 KB budget raise
  (`.agents/notes/implemented/process/2026-11-13-raise-the-keys-first-load-budget-by-1-kb.md`).
- A response the page takes may be up to 10 seconds old, the queries' default
  `staleTime`.

## Verification

- `lib/prefetch-get.test.ts`: reuse, sharing between readers, one load per response,
  expiry, failure, another session, boot data.
- `features/usage-logs/lib/prefetch.test.ts`: the loader's URLs equal the table's and the
  stats bar's for a customer, an admin, a phone and a filtered link.
- Lab guard on main and the branch: the overview, keys, usage logs and wallet pages at
  1440 and 390 px have the same text and the same pixels; a tooltip, the key row menu, the
  key edit drawer and a log's details dialog show the same content.
- Request timelines: on hover the wallet's five requests and the logs page's two go out
  and nothing is sent again after the click.
