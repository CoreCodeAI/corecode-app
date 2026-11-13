# Agent Note: Watch card top-ups and freeze farmed-card accounts

Status: implemented

## Problem

On 2026-11-13 one account created that day topped up ¥8,492.9 in five hours
through 35 card payments from about 30 different cards. Some payments were
declined, and Stripe blocked others as card testing. The operators found it by
eye hours later, after it had already spent about $1,900 of the credit. The
account runs Radar Lite, which has no custom rules, so Stripe raises no alert.
The operators asked for a watch that reports this pattern early and disables
the account on the strongest signal.

## Decision

- **A scheduled system task in the app, `topup_watch`, every ten minutes.**
  `service/topup_watch.go` reads the last 24 hours of completed card top-ups
  (`stripe_card` and plain `stripe`). It also reads the Stripe charges of the
  same day, and the early fraud warnings and disputes of the last three days,
  with a read-only restricted key of its own. The system task runner's database
  lease gives one run at a time, including while two release colors run.
- **Rules, all thresholds in `topup_watch_setting`:**

  | Rule | Fires when |
  |---|---|
  | `burst` | `burst_count` (4) top-ups within two hours |
  | `daily` | `daily_amount` (¥3,000) within 24 hours |
  | `new_account` | an account younger than `new_account_hours` (24) pays `new_account_amount` (¥1,500) |
  | `failed` | `failed_charges` (4) declined or blocked charges within an hour |
  | `blocked` | any charge Stripe blocked |
  | `cards` | `distinct_cards` (3) different cards within 24 hours |

  Stripe leaves `fingerprint` out of charges read with a restricted key, so
  when it is missing a card is told apart by brand, last four digits and
  expiry. The first production run on 2026-11-14 read the farmed account's
  charges with no fingerprints and missed `cards`, so it could not freeze;
  brand, last four and expiry tell its 59 charges apart as 45 cards.

  Every early fraud warning and dispute is also reported once, with its user
  when the Stripe customer maps to one.
- **Freeze on `cards` plus at least `freeze_amount` (¥1,000) within 24 hours**,
  in `enforce` mode only. Administrators, accounts already disabled, and IDs in
  `allowlist` are never disabled; they are still reported.
  - The freeze uses the violation guard's ban path: a status update plus
    `InvalidateUserTokensCache`.
  - It writes a `user.manage` audit entry. The actor is `topup_watch` with
    auth method `system`, and the entry is logged under user 0, so the frozen
    customer does not see it.
- **Alerts go to the Feishu bot in `feishu_webhook`.** The message gives the
  account, the rules hit, the amount, the card count and issuers, a Stripe link,
  and whether the account was frozen and how to undo it. An alert that was sent
  is remembered in the task result for 24 hours (a week for warnings and
  disputes), and the next run reads it from the newest successful run. A failed
  send is not remembered, so it is retried.
- **Without `stripe_api_key`, or when Stripe cannot be read,** only the top-up
  rules run and nobody is disabled. The key and the Feishu secret end in
  `api_key` / `secret`, so `GET /api/option/` never returns them.
- **Calibration.** Between 2026-11-08 and 2026-11-13, 115 customers made 226
  card top-ups. The busiest made at most 2 in two hours, and at most 5 or
  ¥2,000 in one day. The farmed-card account made 20, 35 and ¥8,492.9 with about
  30 cards. `TestTopupWatchRules` replays both shapes.

## Alternatives considered

- **A cron script on the relay host that writes `users.status`.** It would
  bypass the console's step-up check and the audit entry, and it would leave
  the user and token caches stale until they expire.
- **A new admin endpoint without step-up, for a script to call.** It widens
  the attack surface for one caller. Running inside the app needs no endpoint.
- **Radar Standard rules.** They would block or review risky payments but would
  not disable the account. They are a paid upgrade and can be added later
  beside this watch.

## Trade-offs

- A customer who really pays with three cards and ¥1,000 in a day is disabled
  until an operator re-enables them. The thresholds sit above every paying
  customer seen so far, and the allowlist exempts known ones.
- The watch reads at most one day of charges per run. If it stops for more than
  three days, early fraud warnings and disputes from that gap go unreported.

## Verification

- `TestTopupWatchRules` covers the shapes:
  - The busiest real customers raise nothing.
  - The farmed-card shape hits all six rules and freezes the account.
  - Allowlist, observe mode, an administrator, a higher freeze amount, or an
    unread Stripe each keep the account enabled while still reporting it.
- `TestRunTopupWatchFreezesAndAlertsOnce` runs the job against a stub Stripe
  API and a test database. The farmed account is disabled and audited, and an
  allowlisted account with the same shape is only reported. A second run sends
  nothing and freezes nothing.
  - Passed on SQLite 3.50.4 and PostgreSQL 18.6. MySQL was not run (no
    instance available).
- Removing the allowlist check, or the card condition from the freeze rule,
  makes the tests fail.
- `TestTopupWatchChargeIdentityWithoutFingerprint` builds charges the way the
  restricted key returns them, with no fingerprint; it fails without the
  brand, last four and expiry fallback.
- No schema change: the watch reads `top_ups` and `users`, and keeps its memory
  in `system_tasks.result`.
