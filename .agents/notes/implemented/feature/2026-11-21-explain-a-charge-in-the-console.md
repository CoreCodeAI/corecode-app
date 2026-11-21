# Agent Note: Explain a charge in the console

Status: implemented

## Problem

Eight of a week's 21 customer reports were about reading a bill: one "hello" costing
$4.9, `prompt_tokens` not matching the input (the rest was cache reads), a request for
opus-5-5 answered by opus-4-8, a low cache hit rate, charges with no output, and a cache
lifetime that could not be set. The log detail showed two unit prices, the checks sat
below request IDs and policy decisions, and the list showed `Standard · $4 / $20/M +1`.

## Decision

- The log detail opens with a "Why this price" card whose rows are the lines of the cost
  check, so the amounts add up to the table below it. Cache writes say 5-minute or 1-hour;
  a 1-hour write points at `X-CoreCode-Cache-TTL: 5m` and `/docs/cache/#ttl`. The unit
  price column shows the paid price over `base × group ratio`. Request conversion,
  policy decisions and processing steps fold into "Technical details" (a native
  `<details>`).
- A Claude answered by another Claude reads "Fell back to …". The popover shows
  request → response → billed and links `/docs/fallback/`. The billed model is the
  requested one: the gateway bills `OriginModelName`, so the copy says that and does not
  say the upstream "paused" a model.
- A charge with no output carries a "No output" tag. The week's 84 such charges were all
  Anthropic refusals, so the user log now carries two read-only fields,
  `upstream_refusal` and `upstream_refusal_category`, set public in
  `appendUpstreamRefusalForLog`. Without them the console shows the general explanation,
  so the frontend can ship before or after the server. `reject_reason` stays admin-only.
- Customers see a cache badge ("Cache 98%", "Cache miss · full price") beside the cost and
  "View billing details" as the entry. Admins keep their columns.
- The overview cache banner links `/docs/cache/` and the logs it counts, explains the
  grade tiers on hover and can be dismissed for 24 hours (localStorage). The logs link adds
  `cacheMiss=true`; the server has no such filter, so the page narrows its rows to the
  long requests that missed the cache and says so.

## Consequences

- Billing is untouched. The only backend change adds two fields to the user log.
- Deploy order: server first, though the console degrades without the fields.
- The "View these N" link filters the loaded page, not the whole range, so a page of 100
  can show fewer rows than the banner's count.
- First load: the overview stays under its budget by 106 bytes; no budget changed and no
  new Tailwind class was added (the CSS file is byte-identical).
