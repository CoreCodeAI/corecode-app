# Agent Note: Read other relays' Claude prices from their own price lists

Status: implemented

## Problem

The owner wants to see what other relays charge for Claude, beside our own price, in the admin console. apiranking.com lists about 526 relays, but its prices are collected by hand and lag: on 2026-11-13 it showed PackyAPI's `cc` group at 2x while PackyAPI's own `/api/pricing` said 2.5. The owner asked for prices read from each relay directly, with apiranking used only as the list of sites.

A group ratio alone does not compare across sites. What a customer pays for a million input tokens is `model_ratio × $2 × group_ratio × status.price`, where `status.price` is the CNY a site charges for $1 of credit. A site at ratio 2.5 and ¥1 per $1 is cheaper than one at ratio 1 and ¥7.

## Decision

### Where the prices come from

- **Each site's own `/api/pricing` and `/api/status`**, the public endpoints every new-api console reads. Only Claude models priced per token count: a model priced per call or by a billing expression has no single ratio, and the auto group and groups without a ratio are left out. Model names are compared after lower-casing, dots to dashes, and dropping a trailing date.
- **apiranking.com is the site list only.** The home page gives the slugs; each `/p/<slug>` page gives the name and address in its schema.org `provider` object. Pages are read ten a minute, three seconds apart, because apiranking answers 429 to bursts, and each is read again after seven days so a moved domain is picked up.
- **Many relays serve their console on another host than their landing page.** The probe tries the origin that answered last, the listed address, `api.<domain>`, and the domain with and without `www`. An admin can fix the origin; the probe then tries only that one.
- In a sample of 40 directory sites, 8 answered with a new-api price list at the listed address. Most others answer 404 or 401 (another platform, or a price list behind sign-in) and are marked `unsupported`. They stay listed and are checked again daily.

### The yardstick

The official price is our own model ratio divided by its `official_price_markup`, the figure our pricing page compares against, converted at our `usd_exchange_rate`. Every site, ours included, is measured against it, so the share of official is comparable down the board. Top-up bonuses are not counted, and models we do not sell have no row.

### Running it

- **Off until an admin turns it on** (`rival_price_setting.enabled`). Every probe is a request from the server to another relay, and the origin sits behind the Tokyo edge; a direct probe shows the origin's address to every relay probed. `rival_price_setting.proxy` (http, https or socks5) sends the probes through an egress instead. The option API rejects an address it cannot parse.
- **Prices depend on where the request comes from.** On 2026-11-13 PackyAPI's `/api/pricing` listed 86 models, 15 of them Claude, through one egress and 42 models with no Claude through another. The chosen egress decides what the board shows.
- **Private and reserved addresses are always refused**, whatever the site-wide fetch setting says, since the addresses come from a third party. Through a proxy the dialer never sees the target, so the URL is resolved and checked before the request.
- **Master node, every minute.** Each unit of work (the daily directory read, a directory page, a site probe) is claimed by a conditional update on its row, so the two servers during a release never do it twice. A site with prices is read again after six hours; one without, after a day.
- **A site's first price list is its baseline.** Later reads record a change when a group's ratio or input price moves more than half a percent, or a group appears or goes away. A failed read keeps the last prices and only updates the status.

### Console

`/rival-prices`, root only, a lazy route. Three tabs: the board for one model (each site at its cheapest group, ours highlighted, other groups on expand), the site list (status, origin, enable, check now, add by hand), and the price changes.

## Alternatives considered

- **apiranking's own price tables as a fallback for sites we cannot read.** They cover sites without a public price list, but they are hand-collected, a week old, and already wrong for PackyAPI. The owner chose live prices only.
- **A cron script in corecode-infra that writes a JSON file the console reads.** It would keep outbound traffic off the app, but the board would read a file another repository writes, and claims would need their own store. The task already has the database and the release-safe claim pattern.
- **Probing straight from the origin with no switch.** It is the least work, but it publishes the origin address that the edge hides, so the monitor starts off and names an egress.

## Consequences

- Four new tables (`rival_sites`, `rival_prices`, `rival_price_changes`, `rival_directory_states`), migrated by AutoMigrate. Nothing else reads them.
- Sites that sell only subscriptions, or whose price list needs a session, never appear on the board.
- First load: +128 bytes on `/sign-in`, +263 on `/dashboard/overview` and `/keys` (the sidebar entry and its route), measured against main on the same machine.
