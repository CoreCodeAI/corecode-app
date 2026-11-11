# Agent Note: Say "try again later" for a request that failed in transport

Status: implemented

## Problem

`getServerErrorMessage` skips axios error objects while it looks for a server reason, then
falls back to `error.message`. A request that got no response showed `Network Error`; a
proxy 502 or 503, whose HTML page `messageText` rejects, showed
`Request failed with status code 502`. `http-client.ts` writes that text back into
`error.message` and the shared query client shows it in a toast, in English, on every
console page. Only the auth path (`secure-verification.ts`) mapped these cases.

## Decision

After every server-supplied reason has been tried (stable codes, `message_key`, business
`message`, `error`, `title`), `getServerErrorMessage` returns `Please try again later.`
when an axios error either got no response (and was not cancelled) or got a 5xx. That is
the key `secure-verification.ts` shows for the same failures, so it is already in every
locale and in the boot part of the locale. A failure that carries a reason, a 4xx and a
cancellation read as before.

The check is inline in `server-error-message.ts`, an upstream file, because a module of
its own cost the entry script about 50 bytes more, and `/dashboard/overview` had 101 bytes
left under its first-load budget.

## Alternatives considered

- **Two new messages, "could not reach the server" and "service unavailable".** More
  specific, but the two keys landed in the boot locale and, with their code, cost 183
  bytes on the overview's first load, over the budget.
- **Add "if you already paid, check your orders" on payment paths.** Wrong: a failed
  order request means nothing was paid yet.

## Consequences

- Offline, timeouts and gateway errors read `请稍后再试。` in Chinese instead of English axios
  text. The message does not say whether the network or the server failed.
- `error.message` of such axios errors is now the translated text, as it already was for
  errors that carry a reason.

## Verification

- `bunx vitest run src/lib/__tests__/server-error-transport.test.ts src/lib/__tests__/server-error-notifications.test.ts`:
  29 pass. With `server-error-message.ts` restored to `origin/main`, 5 fail (no response,
  timeout, proxy 502, Chinese text, the retry-exhausted toast).
- `bun run typecheck`, `bun run lint:check`, `bun run format:check`, `bun run test`
  (308 files, 3143 tests), `bun run build` and `bun run first-load:check` (sign-in
  352.4 KB of 353, overview 526.9 of 527, keys 606.7 of 607) all exit 0.
