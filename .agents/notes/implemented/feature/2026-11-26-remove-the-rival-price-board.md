# Agent Note: Remove the rival price board

Status: implemented

## Problem

The rival price board (`/rival-prices`, [2026-11-13-rival-price-board](2026-11-13-rival-price-board.md) and [2026-11-13-compare-rival-prices-like-for-like](2026-11-13-compare-rival-prices-like-for-like.md)) probed other relays' price lists every minute through an egress proxy and posted price drops to Feishu. On 2026-11-26 the owner judged the page of little use and asked for it to be deleted.

## Decision

- Remove the page, its sidebar entry, the `/api/rival-prices` routes and their access-token scopes, the monitor task, the `rival_price_setting` options, and the models' auto-migration.
- Delete the 58 locale keys only the page named, so they do not fall into the core locale part. `Default group` stays: `setting/user_usable_group.go` sends it as a group description.
- Leave the tables (`rival_sites`, `rival_prices`, `rival_price_changes`, `rival_directory_states`, `rival_group_kinds`) and the stored `rival_price_setting.*` options in the database. Nothing reads them any more; dropping them is a separate, irreversible step the owner can take by hand.
- Keep `InsightModelHour.Output`, added for the board's blended price: the site-insights rollup still writes it.

## Consequences

- The proxy the monitor used (gpt-load proxy #14) is idle and free for other use.
- The two earlier notes stay as the record of what the board did.
