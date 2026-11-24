# Agent Note: Honest waste on the experience tab, and stale bills told from quiet channels

Status: implemented

## Problem

The experience tab's "白扣费" (charged for nothing) total mixed three things that are not
waste:

- **Client hang-ups.** When a client hangs up during an upstream read, new-api's stream
  scanner fails with the client's `context canceled`, because the upstream request carries
  the client's context. The scanner recorded that as `scanner_error`, and StreamStatus is
  first-write-wins, so the `client_gone` the main select would have set never landed. Over
  7 days in production, 358 of the "failed but billed" rows ($136.85, 68 of them with no
  output) were customers closing their own stream. The real upstream failures were 144
  connection resets ($43.96) and 2 HTTP/2 errors.
- **One-hour cache writes.** The tab counted the full 1h-write premium as waste whenever no
  request of the key followed within the hour. It never counted what the 1h cache saved:
  reads 5 to 60 minutes after the previous request, which a 5-minute entry would have
  missed. It also priced only ratio-billed logs; tiered-expression logs were "unpriced".
- **Raw JSON upstream reasons.** Upstream errors whose message was a JSON body showed up in
  the quality and upstream reason lists as the whole body. Amounts in them split one reason
  into many.

The upstream tab and the overview also flagged "账单过期" (stale bill) for channel 13
(GPT 福利). Its last bill and its last request were both at 10:41, and it had no traffic
after that. The check compared the bill with the range's end, so any channel that went quiet
read as stale.

## Decision

- **Scanner.** When `scanner.Err()` is set and the client's request context is done, the end
  reason is `client_gone`. A regression test cancels the context from inside the reader 20
  times; it fails with `scanner_error` without the fix.
- **Experience kinds.**
  - Waste is only `refusal`, `failed_billed` and `gate_wallet`.
  - `client_cancel` is its own kind, shown apart from waste. It is `client_gone`, or the
    older `scanner_error` with `context canceled`, so hours before the fix read correctly.
  - `failed_billed` carries a cause (`reset`, `http2`, `eof`, `timeout`, `other`, or the end
    reason itself), and every event carries `NoOutput`.
- **Cache trade.** The cache is stored per (hour, customer, kind) as summed rows under a
  negative log id, `-(user*16 + code)`, with a `Requests` count: there are about 2,600 1h
  writes and 1,950 1h-regime reads an hour. Kinds:
  - `cache_paid`: the 1h premium;
  - `cache_1h`: the part of the premium nothing read;
  - `cache_saved`: the reads 5 to 60 minutes after the key's previous request, priced as
    5-minute writes minus reads;
  - `cache_unpriced`.

  A tiered-expression log is priced by running its own expression on the actual tokens and
  on the counterfactual ones. A ratio log uses its ratios. The tab shows paid, unread and
  saved, and the net. It is an estimate by token key, and a key may carry several threads.
- **Stored format v2.** The hour marker (log id 0) stores `v2` in `category`. Hours stored
  under an older version are served as they are, counted in `stale_hours` (the tab shows a
  note), and rebuilt by `FillInsightExperience` at its normal 48 hours per tick. 35 days is
  about 3 hours of ticks.
- **Feedback.** A ticket counts as untouched only while it is pending or processing with no
  reply, so a closed old ticket no longer reads as ignored.
- **Reasons.** `errorReason` unwraps a JSON body (up to 4 levels, through `error`) to its
  message and prefixes the outer code or type. `normalizeReason` replaces decimal amounts
  with `<n>`. Not a rollup version bump: a bump rebuilds every hour and withholds figures in
  the meantime, and the raw reasons already stored age out of the window.
- **Stale bills.** The upstream view reports `latest_revenue_at`: the channel's newest
  charged request after its newest bill. It is one indexed read per billed channel, starting
  from that bill. A bill is behind (`UpstreamCostBehind`, `costBehind` in the web) only when
  that request is more than 1800 s after the bill. Finance's `oldest_bill_at` takes only
  channels that are behind. A server without the field reads as not behind.

## Alternatives not taken

- **Counting cancelled requests as waste.** The customer chose to stop; the tokens were
  generated and billed upstream.
- **Storing each cache event as its own row.** That is tens of thousands of rows a day for a
  figure read only as sums.
- **Raising the threshold for stale bills.** A bill can be behind by much more than an hour
  on a busy channel and be fine on a quiet one, so the threshold was not the problem.
- **Bumping `insightHourVersion` for the reasons.** See above.

## Verification

- `go test ./model ./relay/helper` on sqlite. The experience, upstream, finance and reason
  tests also ran on MySQL 8 and PostgreSQL.
- Web: typecheck, the full vitest suite, lint (no finding in site-insights) and oxfmt on the
  changed files.
- The production figures above come from read-only queries.
