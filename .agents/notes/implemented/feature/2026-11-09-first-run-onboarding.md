# Agent Note: First-run checklist and inline key creation

Status: implemented

## Problem

A new customer lands on the overview with zero balance, zero usage and no key. The console told them three wrong things:

- A red "Your balance has run out" alert, for an account that never had a balance.
- A setup guide whose Copy button copied the placeholder `sk-your-key`. Pasted into `~/.claude/settings.json`, it answers 401.
- A Create API Key drawer with a "Quantity" field and a "Save changes" button, neither of which a first key needs.

## Decision

- **A first-run checklist replaces the alert, only for `request_count == 0 && used_quota == 0`.** Four steps: add credits (done when spendable balance, wallet plus plans, is above zero), create a key (done when a key exists), paste the config, run the check command. Pasting the config leaves no trace on our side, so steps three and four are done together, when the first request arrives. The card therefore disappears at that moment. Accounts that have spent keep the red alert.
- **With no key, the guide's Copy button becomes "Create API Key".** It creates `claude-code` with the payload the drawer's defaults give (the group the drawer would start on, unlimited quota, never expires) through the same `createApiKey` call, then selects the new key, so the snippet fills in and Copy fetches the real secret. A secondary link keeps the full drawer for custom settings. `createStarterKey` is separate from the drawer, which stays a form.
- **The drawer hides Quantity for non-admins** (`role >= ROLE.ADMIN`, as the overview detects admins) and names the create button "Create key". An admin batch that fails part way reports "Created X of N".
- **Deep links go through an anchor click**, not `window.open`, so a missing app no longer leaves a blank tab, and a hint says to install the app or copy the config.
- **Relative times read one shared clock** (`useNow`, one interval, `useSyncExternalStore`), so the 30-second tick re-renders the time cells and not the whole table.

## Alternatives considered

- **Create the key from the checklist card itself.** The guide already owns the snippet and the copy step; creating there keeps one place where the key appears.
- **Track "config pasted" with a stored flag.** It would be a guess the server cannot confirm; a request is the only proof.
- **Move quota and expiry under Advanced in the drawer.** Not done here: it changes the form's structure and its tests for a field group some customers do use. The drawer already hides model and IP limits.

## Consequences

- A customer with a zero balance can create a key and see a filled snippet before paying; requests still fail with 403 until credits arrive, and the checklist's first step says so.
- The old guide string "Create an API key and it fills in here automatically." is no longer used and stays in the locale files.

## Verification

`bun run typecheck`, `lint:check`, `format:check`, the full `vitest run` (273 files, 2968 tests), `build` and `first-load:check` (overview 523.7 of 526 KB, keys 603.1 of 606 KB) passed.
