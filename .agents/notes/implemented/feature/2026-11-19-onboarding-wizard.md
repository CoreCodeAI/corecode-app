# Agent Note: A three-step onboarding wizard right after sign-up

Status: implemented

## Problem

Production data for 2026-11-06 to 2026-11-18 shows that only 20-40% of new sign-ups ever send a request. After sign-up a customer lands on the overview and must find the keys page, create a key, read the docs and edit a config file; most stop there. The overview already carries a first-run checklist, but it is a list of places to go, not a path.

## Decision

A dialog of three steps opens once over the overview for an account that has never made a request, and a card on the overview reopens it while that stays true.

- **Trigger.** `isFirstRun(user)` (`request_count` and `used_quota` both 0 on the self endpoint the console already loads). No server field is added. The overview signs in with a possibly hours-old copy of the user, so the launcher fetches `/api/user/self` first and opens only when the fresh figures still show no request.
- **Shown once.** The dismissal is a localStorage key per user id (`corecode:onboarding-dismissed:<id>`), written when the wizard opens, so leaving by any route counts. No server flag exists, and none was added. The reopen card shows while the account is still a first run, even after a dismissal.
- **Step 1, client.** Claude Code (CLI, VS Code, JetBrains), CC Switch, "let my AI agent set it up", and an OpenAI-compatible client.
- **Step 2, key and config.** The key step uses the snippets, hints, deep links and masking of the per-key setup guide on `/keys` (`features/keys/lib/client-setup.ts`; the label tables moved to `setup-labels.ts` so both read one copy). With no usable key for the client it creates `默认密钥` through the token API: Claude Code and CC Switch get `Claude 满血（仅限CC）`, an agent or OpenAI-compatible client gets `Claude 满血（可外接）`. If the account cannot use that group, the key takes the account's default group and the screen says so. A key in a Claude Code only group is not offered to another client, and a Codex only group's key is not offered at all. An existing usable key is reused, with a picker. The full key appears only on request ("show key"); every copy button copies the full key.
- **Funding notice.** Before step 3 the wizard reads the wallet and the active subscriptions. An empty account gets "add credits" and, if plan 2 is enabled and the account is under its purchase limit, "新人福利包". A trial plan from an affiliate gift is named as already covering the first requests.
- **Step 3, wait.** It polls `/api/user/self` every 4 s for ten minutes at most and turns green on `request_count` above its value when the wizard opened. Closing the dialog unmounts it, which ends the polling. It reads the payload directly instead of merging into the auth store, because a store that stops looking like a first run would unmount the wizard host before the green state showed.
- **Bundle.** The overview loads the launcher with a dynamic import, and only for a first-run account; the launcher loads the wizard's own locale parts and the wizard. The import path is preceded by a comment so `scripts/i18n-locale-split-loader.mjs` does not follow it, which keeps the wizard's strings out of the core locale part. See "Measurements".
- **i18n.** Every string is in all eight console locale files.

## Measurements

Same machine, same session, base `f9b51503b` and this change, `bun run build` and `bun run first-load:check`:

| Page | Base | This change |
|---|---|---|
| `/sign-in` | 354.4 KB of 355, 579 bytes left | 354.5 KB, 550 left |
| `/dashboard/overview` | 534.9 KB of 535, 148 left | 534.8 KB, 172 left |
| `/keys` | 616.4 KB of 617, 628 left | 616.4 KB, 661 left |

No budget was raised. The room is small; the CI line decides.

## How to measure it

Activation is the share of sign-ups with a `type = 2` log within 24 hours of signing up. Compare the cohorts that signed up before and after the console release. Run it read-only on the relay (`BEGIN READ ONLY`). If the log database is separate or ClickHouse, run the `logs` half there and join on the user ids.

```sql
SELECT to_char(to_timestamp(u.created_at) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS signup_day,
       count(*) AS signups,
       count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM logs l
         WHERE l.user_id = u.id AND l.type = 2
           AND l.created_at >= u.created_at
           AND l.created_at < u.created_at + 86400
       )) AS activated_24h,
       round(100.0 * count(*) FILTER (WHERE EXISTS (
         SELECT 1 FROM logs l
         WHERE l.user_id = u.id AND l.type = 2
           AND l.created_at >= u.created_at
           AND l.created_at < u.created_at + 86400
       )) / count(*), 1) AS activated_pct
FROM users u
WHERE u.deleted_at IS NULL
  AND u.created_at >= extract(epoch FROM timestamptz '2026-11-06 00:00+08')::bigint
  AND u.created_at <  extract(epoch FROM now())::bigint - 86400   -- the 24 h window has closed
GROUP BY 1 ORDER BY 1;
```

- **Before** is 2026-11-06 to 2026-11-18 (20-40% a day). **After** starts the day after the console release; read at least a week, since a day has few sign-ups.
- Leave out staff, the owner's test accounts and the gift-farm accounts the abuse reviews voided, or the rate moves for reasons the wizard did not cause.
- The wizard writes nothing to the server, so nothing separates a customer who used it from one who did not. If the rate moves, a second read can split by whether the account created a key within the first hour (`tokens.created_time`), which the wizard does automatically for a customer with none.
- A new-customer mix change (a channel launch, a promotion) moves the rate with no wizard. Read the daily series, not one average, and check the channel split before attributing the change.

## Verification

- `bun --bun x vitest run src/features/onboarding src/features/keys src/features/dashboard src/i18n`: step flow (no key creates one in the right group, an existing key is reused, the fallback group is named, a zero balance shows the call to action, polling turns green when the count goes from 0 to above 0 and stops after unmount, a dismissed account does not reopen by itself but keeps the card).
- Local build served against a mock API in a browser: automatic open, creation in the Claude Code only group, the funding notice, the green state, dismissal, the reopen card, light and dark, desktop and 390 px (no horizontal overflow; the dialog is 358 px wide).
