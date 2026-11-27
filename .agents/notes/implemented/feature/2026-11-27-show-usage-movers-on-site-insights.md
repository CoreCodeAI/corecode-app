# Agent Note: Site insights shows where a change in spending came from

Status: implemented, pending merge

## Problem

On 11-27 site spend ran about 40% above its usual level, and the owner asked
which accounts drove it. The activity tab names the range's biggest customers
and, in the churn watch, the big ones whose use fell, but nothing set each
customer's spend against their own usual level. Finding the accounts behind a
jump took ad-hoc SQL. The same SQL also showed that the rise came mostly from
accounts registered that week, which no panel separates either.

## Decision

- **A movers block in the customers view.** `GET /api/site-insights/customers`
  gains a `movers` field. It is added, not changed, so the console now in
  production keeps working, and a console reading an older server leaves the
  panel out.
- **The usual level is the baseline's spend scaled to the range's length.**
  The baseline is the range's length or seven days before the range's start,
  whichever is longer, floored to the hour. A 24-hour range is then weighed
  against the average day of the week before it, rather than against one
  previous day that may itself have been busy or quiet. On 11-27 the day ran
  +8% against the day before and +42% against the week's average.
- **Each customer is filed by why they moved,** in this order: registered in
  the range (new), registered in the baseline (recent, whose usual level counts
  days before they existed), registered earlier with no baseline spend
  (returning), at or above their usual level (growing), below it (shrinking,
  nothing spent included). The kinds sum to the site's change. The panel's
  sentence names the new and recent accounts' share of it.
- **The 20 largest risers are listed** with registration date, inviter, what
  they paid, range spend, usual level, change and main model. The inviter is
  shown because the 11-27 rise clustered under one inviter.
- **One more grouped read of `quota_data`** (one row per customer over the
  baseline), one read of the users registered since the baseline began, and the
  small reads for the 20 risers. Staff are left out, as in the rest of the
  view. The view's cache (`settledRead`) is unchanged.

## Alternatives considered

- **Compare with the previous range of the same length.** This is what the
  page's other comparisons use, but for a 24-hour range it measures the rise
  against one day. Rejected for this panel; the help text states the baseline.
- **A separate endpoint.** The customers view already reads the range's spend
  per customer and model and runs only on the activity tab, so the block reuses
  that read.
- **Request-log details such as IPs and keys per riser.** These need the
  `logs` table, which the hourly views avoid. They are left to the user's
  usage-log page.

## Consequences

- The panel sits in the activity tab between the biggest customers and the
  churn watch, so the risers and the fallers read together.
- On a range longer than seven days the baseline doubles the span the view
  reads from `quota_data`. On the longest range, 366 days, that is 732 days,
  still one grouped row per customer.
- "Recent" grows with the site's sign-ups. On 11-27 it held 354 accounts over
  the last 24 hours.

## Verification

- `go test ./model/ -run 'UsageMovers|CustomerInsights'`: a 24-hour range with
  one customer of each kind, staff and pre-baseline spend left out, and every
  sum checked by hand. Scaling the baseline by 1 instead of the range's share
  fails it. The MySQL and Postgres subtests skip without a DSN.
- `go vet ./model/`, `gofmt -l` on the changed files, and
  `go test ./model/ ./controller/ ./service/`: 3,572 passed.
- Web: `bun run typecheck`, `bun run lint:check`, `bun run test` (443 files,
  4,639 tests), `bun run build` and `bun run first-load:check`. Room is the
  same as main's CI run 45956066890, ±3 bytes, and the new locale keys land in
  `rest`.
- The same rules, written as read-only SQL over production `quota_data` for the
  last 24 hours on 11-27: spend $15,026 against a usual $10,782. New
  +$1,382, recent +$3,069, returning +$304, growing +$2,151, shrinking −$2,662.
