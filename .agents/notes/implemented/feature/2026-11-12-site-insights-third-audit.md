# Agent Note: Count staff apart, start every range on the hour, and say where unpaid credit came from

Status: implemented

## Problem

After the release recorded in `2026-11-12-site-insights-sound-figures.md` the owner asked what else on `/site-insights` was worth fixing. A third audit read each tab but the account pool against live production responses and recomputed the main figures from the raw tables. Requests, failed requests, consumption, top-ups by method and sign-ups matched. It kept 33 findings after a skeptic tried to refute each. The ones that changed a decision:

- **The balance runway mixed two kinds of money.** It divided every balance, gift credit included, by paid use only. Over 30 days it read 21 days; on one basis it is about 14.
- **The manual adjustment total was the newest 500 audit rows.** The 7-day and the 30-day range both read 8,144.0, and the 30-day figure covered six days.
- **"24 hours" was a different span on each tab.** The activity view dropped the hour its range started in (3.2% of the day's consumption), the funds view clipped top-ups to the minute, and the others counted that hour whole.
- **Unpaid spenders read as farming.** Five accounts held 76% of the "given" spend. An administrator had credited each by hand, and the audit log has every grant.
- **Media failures had no visible cause.** 43% of media requests failed over seven days while the task card read 0.4%: most failed before a task existed. Five models failed every request and no sentence named them. Failure reasons were cut at the first dot, so `gpt-image-2.5` read `gpt-image-2`.
- **Two failure panels counted tries under a headline that counts requests**, 775 against 278 in one day.
- **Three empty hours hid the pool's peak for 30 days.** They predate the earliest log, so the rebuild never reaches them, and one out-of-date hour withheld the pool peak of the whole range.
- **A 30-day range held 26 days of logs.** Hours before the first log drew as zero, and the previous 30 days compared against nothing.

## Decision

The owner decided five things, and they are not reopened here:

1. An account an administrator credited by hand is not a farming suspect; unpaid spend is split by where the credit came from.
2. Administrators are staff. Staff are left out wherever root was.
3. `jev-latest` is not a media model and stays in `other`.
4. An upstream's 400 is the customer's error. The service failure rate keeps leaving it out and says how many errors it leaves out.
5. Every range starts on the hour.

### Rollup version 6

`insightHourVersion` goes 5 to 6. No schema change: the new dimensions are in the `InsightHour.Data` summary.

- **Customers are accounts below `RoleAdminUser`.** One bound (`customerRoleBound`, `StaffUserIDs`) replaces every root-only test in the rollup and the views, and in the per-user concurrency rejections. Fields named `root_*` keep their names and carry staff.
- **The quality view counts customers only**: requests, errors, the hourly and daily series, model rows, status codes and reasons. Staff requests and failures are returned apart (`staff_requests`, `staff_errors`), so the categories sum to the errors and the view agrees with capacity. Per-channel rows still count every attempt.
- **A failure reason is cut at the end of a sentence**, at 120 characters with an ellipsis. Ids, long numbers, path indices, dates and times become placeholders, so one cause is one reason. An empty text is `unknown`.
- **Failed tries by vendor.** Each hour keeps, per vendor, its top 30 reasons and status codes with a remainder count; the view returns the top 10 per vendor (`vendor_failures`), the try total (`failed_tries`) and the reasons it did not list (`error_reasons_other`).
- **"No available channel for model …"** from the retry path counts as `no_channel`. The nine templates (three messages in English and both Chinese locales) are matched as produced, and a test keeps them in step with the locale files.

### Reading the hours

- **An older row is out of date only if a rebuild would change it**: it holds a request, an attempt, a model row or a status code. The empty hours before the first log are current.
- **What only version 6 hours hold is withheld while an out-of-date hour remains**: the failed try total and the vendor breakdown, as the pool peak and attempts already were. A total over part of a range reads as the range's.
- **`logs_since`** is the earliest log the rollup can read, cached for five minutes, on every view. The console says once per page where the logs begin, draws earlier buckets as missing, divides a per-day average by the days that have logs, and compares with a previous period only when the logs cover all of it.
- **`ResolveInsightsRange` floors the start to the hour**, and the span bound allows the hour that adds. The console asks for a start already on the hour and a previous period that ends there, so the two share no hour. The activity view counts the hour its range starts in. A 24-hour range is 25 buckets: the hour it starts in, 23 closed hours and the hour still filling.

### Views

- **Funds.** The adjustment net and count cover the whole range, read in batches and summed in Go; the list stays the newest 500 and says so (`adjustments_total`, `adjustments_truncated`). The runway is paid balance plus paid plan quota left, over paid use per day (`paid_use_per_day_usd`, `paid_plan_quota_left_usd`), and is unmeasured on a range under three days. The top-up bonus help now says what the code does: bonus credit counts in the gifted part. The view says when an hour was cut by the row cap.
- **Growth.** Time from sign-up to first payment (`first_payment`: median, share within a day and within a week, four bins), counting payments before the range's end. Payers gone quiet (`payer_activity`): accounts that ever paid, used quota in the 14 days before the last 14 and nothing since. Retention runs to day 30. The activation card judges the cohort the verdict judges, sign-ups at least six hours old.
- **Risk.** An unpaid spender has no top-up with money and no plan bought with money; a plan bought from the wallet is not money. Its spend splits in a fixed order: gift plan use is known from the rollup; of the wallet part, hand grants first, up to the account's audit net before the range's end, then redeemed codes, then check-in rewards, and the rest is sign-up and invite gifts. An inviter is ranked on the gift part only and on the invitees that spent some of it (`gift_accounts`). The shared exits are listed (`shared_exit_top`, 20).
- **Quality console.** The two breakdown panels say they count failed tries and give the total beside the failed requests. The task card adds requests that failed before a task was created. Models that fail at least 90% of 20 or more requests are named in one sentence. A panel shows each vendor's own reasons. Codex's first-token tail gets a sentence over 100 requests.
- **Capacity console.** A pool that served nothing says so, not "peak 0 at -". The overview counts per-user refusals as attempts, as the capacity tab does.
- **Speed.** Engine usage reads are cached briefly, the user-spend table for three minutes, the day profile for the hour.

## Alternatives considered

- **Count status codes and reasons once per request.** A per-try count shows which upstream errors occur, failover included, and that is what the panels are read for. They are labelled as tries.
- **Return a pool peak over the current hours when some are out of date.** It is a lower bound that reads as the range's peak. It stays withheld.
- **Cap the audit read behind the unpaid split.** A cap drops grants silently and attributes hand credit to gifts. The view reads every quota audit row before the range's end, about 700 today.
- **Compare with the logged part of a previous period.** The two periods would differ in length under one percentage. The console says there is no data to compare.
- **Translate upstream error messages.** The verbatim text is what one searches the logs for.

## Consequences

- **Release.** The rebuild is the one of the last release: held 15 minutes after start and while an older-version row was stored in the last 30, then 200 hours every 10 minutes, newest first. Until it ends, a range with version 5 hours counts staff in those hours' model rows, says so through `stale_hours`, and shows no vendor breakdown, pool peak or attempts.
- **Rollback is safe.** A version 5 server leaves a version 6 row as it is and serves it.
- The console releases after the server. For those minutes the old console's help says the quality figures count everyone while the server sends customers only.
- Staff is whoever holds the role when an hour is computed. Promoting an account moves it out of customer figures for hours computed afterwards.
- The reason keys of version 6 differ from version 5's, so a reason does not carry across the rebuild boundary within one range.
- The risk view reads the whole quota audit history, and the growth view the user-hours of 28 days, on every load. Both are linear and uncached.
- The channels and risk views return `truncated` when an hour was cut; the console does not show it yet.
- Not built: caching the stored hours across views and bounding the risk and funds scans (each needs its own design), a margin by price group (the help now says revenue by group is a pro-rata estimate), a cap on the members listed per shared exit.

## Verification

At the commit that adds this note, on main `e272c3d67`:

- Server, proxy variables unset: `gofmt -l model controller service middleware` listed nothing, `go vet ./...` passed, and `go test ./common/... ./controller/... ./middleware/... ./model/... ./service/... ./relay/... ./router/... -count=1` passed in 28 packages on SQLite.
- The site-insights tests ran on SQLite, MySQL 5.7.44 and PostgreSQL 9.6.24 in local containers: 247 passed, none failed or skipped.
- Before the review fixes, the insight tests passed under `-race` in `model`, `service` and `controller`.
- Console, from `web/`: `typecheck`, `lint:check`, `format:check`, `build` and `first-load:check` passed (353.3 KB of 355, 528.5 of 530, 609.0 of 610). `bun run test` passed.
- A review in five parts, each finding put to a skeptic, kept 28 defects; 24 were fixed in this change. Among them: a range of the longest span returned 400 once its start was floored; a version 5 hour holding only staff rows read as current; a timestamp in an error text made a reason per request.

Not verified: the new tests were not run against the old code, so that each fails without its change rests on reading; nothing was rendered in a browser; the console was not run against the new server, which arrives with this release. Those are checked on production after the release.
