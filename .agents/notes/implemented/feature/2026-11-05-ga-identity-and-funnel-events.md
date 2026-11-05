# Agent Note: Identify GA users, drop operators' hits, and report the steps between sign-up and purchase

Status: implemented

## Problem

The console reported only `sign_up` and `purchase`. GA could not tell a returning customer on a second device from a new visitor, operators' own console use (`/site-insights` alone had 883 views from 3 users in 28 days) counted as customer traffic, and nothing between registering and paying was visible: not the return visit, not the first key, not the click on Pay.

## Decision

`web/src/lib/analytics.ts` gains four calls, all no-ops without the tag:

- **`identifyUser`**, run from `SignedInEffects` whenever the signed-in user changes, sets `user_id` to the numeric account id and the user property `user_group`. Nothing else about the account leaves the browser.
- **Operators are internal traffic.** For a role of admin or above it sets `traffic_type: 'internal'` and writes `corecode:analytics:internal` = `1` to localStorage; a customer signing in on the same browser removes the flag. The GA property's Internal Traffic filter (exclude `traffic_type` = `internal`) is active, so those hits are dropped.
- **The first page view is covered too.** The tag fires its `page_view` from `config`, before React and the session exist. new-api's injected snippet (`InjectGoogleAnalytics` in `main.go`) now reads the flag and calls `gtag('set', {traffic_type: 'internal'})` before `config`. corecode-infra's docs snippet reads the same key, so an operator's docs visits are dropped as well. The key name is the contract between the two repositories.
- **`trackLogin`** replaces `trackSignUp`: a login within 10 minutes of registration is still the one `sign_up`; any other login sends `login` with its method.
- **`create_api_key`** with `count` when the key drawer creates one or more keys.
- **`begin_checkout`** with `value` (the amount the payment page will charge), `currency` `CNY` and `payment_type` when the customer confirms a top-up in the wallet. It fires at the confirmation, before the redirect, so it measures intent even when the payment page never loads.

## Alternatives considered

- **Exclude operators by IP.** Operators reach the site through proxies whose exit addresses change; an IP rule would miss most of their traffic.
- **Skip loading the tag for administrators.** The tag is injected before the server knows who is asking (the console is a static page), and the docs pages are static files.
- **Fire `begin_checkout` after the payment request succeeds.** The request is followed at once by a form submission that leaves the page; the confirmation click is the decision we want to count.

## Consequences

- An operator's first visit on a fresh browser, before signing in, is still counted; every later one is not.
- `traffic_type` set to `undefined` for a customer relies on gtag dropping undefined parameters; a customer who signs in after an operator on the same page keeps the internal flag only until the page reloads.
- `begin_checkout` assumes CNY like `purchase`; a channel charging another currency needs a per-method currency in both.
- The injected snippet changed, so this ships with the next server release; the console part works without it, minus the first page view.

## Verification

- `web/src/lib/__tests__/analytics.test.ts`: login versus sign-up, identity without PII, the internal flag set for admin and super admin and cleared for a customer, `create_api_key` and `begin_checkout` payloads.
- Local server on SQLite with `GOOGLE_ANALYTICS_ID=G-TESTLOCAL1`: the page carried the flag check before `config`; a root password sign-in pushed `sign_up`, `set {user_id: "1", traffic_type: "internal"}` and `user_properties {user_group: "default"}`, and set the flag; after a reload `set {traffic_type: "internal"}` preceded `config`; creating a key pushed `create_api_key {count: 1}`. `begin_checkout` was not exercised in a browser (no payment provider locally).
