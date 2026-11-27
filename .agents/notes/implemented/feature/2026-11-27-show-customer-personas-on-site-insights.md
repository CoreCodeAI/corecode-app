# Agent Note: Site insights shows customer personas

Status: implemented, pending merge

## Problem

Operators keep a short persona for some customers: the industry they work in and
a few tags. The persona lives in the admin-only `users.remark` field, after any
human remark, as one block:

```
<optional human remark> 〔<segment>｜<segment>｜…·画像MM-DD〕
```

Nothing on the admin site-insights page showed these personas against spend, so
an operator could not see which sectors pay, or which large customers still lack
a persona. Reading each remark by hand does not scale.

## Decision

- **A new `personas` tab on `/site-insights`.** It shows three things: spend by
  sector (with an unidentified bucket), a customer table sorted by spend, and
  the large customers (spend at or above the whale floor, ¥500 in the 30-day
  window) that have no persona block.
- **The block is the source of truth, and the tab only reads it.** The parser
  takes the last `〔…·画像MM-DD〕` in a remark. Everything before it is the
  human remark. Segments are split on `｜`. A segment is an industry only when
  it is `<sector>·<detail>` and the sector is one of the seven known names
  (科研, 软件, 游戏, 硬件, 内容, 专业, 其他). Any other segment is a tag. The tab
  never writes `remark`.
- **The block is maintained by hand or by an offline script.** Operators or a
  script write the block into the admin-only remark. This note does not define
  that process.
- **Spend comes from the existing hourly rollup** (`insight_user_hours`) over
  30 days, the same source as the other customer views. One quota-dollar is
  ¥1 (`QuotaPerUnit` 500000). Staff are excluded as elsewhere.
- **A new endpoint, `GET /api/site-insights/personas`,** under the existing
  `RootAuth` group, served through `serveInsights` with the page's range and no
  cache wrapper. No existing endpoint changes.
- **The tab is a lazy module.** Its component reuses the insight kit's panel,
  share donut and stack bar. It adds no dependency, and the tab's chunk is not
  on any first-load route, so the first-load budgets are unchanged. Each moved
  page measured four bytes more; the cause was not traced.

## Alternatives considered

- **A persona column on `users`.** This would make the data queryable, but it
  moves the source of truth away from the remark that operators already edit,
  and needs a migration and a UI to edit it. Rejected for now.
- **Parse the remark in the browser.** This would ship the remark text to every
  viewer of the page and duplicate the parser in TypeScript. The server already
  reads the remark for the admin console, so the parser stays in Go.
- **Put the tab in the existing customers view.** That view is a customer-level
  list, and the persona tab is a segmentation view. A separate tab keeps the
  existing view unchanged.

## Consequences

- The tab shows only what operators have written into the remark. Customers
  without a block appear as unidentified, and large customers without a block
  are listed for follow-up.
- Remarks are read on every request to the endpoint. Cost is one query over the
  30-day rollup and one lookup of users with a remark containing `画像`, or in the
  whale list. It is not cached, because the page is an admin view.
- The parser must stay in step with the format written by operators. A change to
  the block format changes both the parser and this note.
- Customer names and remarks are shown only to admins, through the same
  `RootAuth` group as the other site-insights endpoints.

## Verification

- `go vet ./model/ ./controller/ ./router/`, and `gofmt -l` on the new and
  changed Go files, both clean. `go build ./...` after `bun run build`.
- `go test ./model/ -run Persona`: the parser cases, the aggregation, the empty
  case, and the database matrix. SQLite passes. The MySQL and Postgres subtests
  skip without a DSN and were not run.
- `go test ./controller/ -run Insight`: 9 passed.
- Mutation checks of the parser (copy the file, mutate, run, restore the copy)
  each failed the test named for that rule.
- Web: `bun check -b`, `node scripts/check-lint-baseline.mjs` (no new findings),
  `bun run test` (the full suite), and `bun run build` followed by
  `bun run first-load:check`. The base commit and the branch were both built.
  Byte deltas on the moved pages: sign-in +4, dashboard +4, keys +4, each within
  its budget. The file counts match (28, 38, 49).
- The locale keys land in the `rest` part of `localeParts`, and every new key is
  referenced from the source.
