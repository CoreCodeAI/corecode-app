# Agent Note: Test a key's model with a fixed question from the keys page

Status: implemented

## Problem

Customers ask whether a model behind a relay is the real one or a weaker substitute. Other relays (zzshu.cc) put an IQ test on each key: one fixed question, sent with that key, whose answer the customer can judge at a glance. The owner asked for the same on `/keys`.

## Decision

- **The browser calls `/v1/chat/completions` with the key itself.** The test then costs what any call costs, at the key's group price, against the customer's balance, and shows in their usage logs. No server change, no new billing path. The full key comes from `POST /api/token/:id/key`, as the copy action does.
- **Two fixed questions**, stored in `web/src/features/keys/lib/iq-test.ts`: a pelican riding a bicycle as a single-file SVG animation (up to 32,000 output tokens), and a candy-drawing logic puzzle (up to 8,192). The prompts stay in Chinese in every locale so results compare. The puzzle asks for a last line `最终答案：N`; the dialog grades it against 21. With shapes told apart and flavours not, any draw of r round and s star candies fails while r ≤ 8, s ≤ 4, (r ≤ 17 and s ≤ 10) or (r ≤ 15 and s ≤ 11); the cheapest draw outside all four is 9 + 12.
- **`max_completion_tokens`, not `max_tokens`.** GPT reasoning models reject `max_tokens`; new-api's `GetMaxTokens` reads either, so Claude conversion still gets the limit.
- **The SVG answer renders in `<iframe sandbox="allow-scripts" srcdoc>`.** The page is model output. Without `allow-same-origin` its scripts run in an opaque origin and cannot read the console's cookies or storage. The existing `web-preview.tsx` adds `allow-same-origin`, so it is not reused. Download is offered; opening a blob URL is not, because a blob URL keeps the console's origin.
- **Keys of client-only groups cannot be tested from the browser.** Claude Code only and Codex only groups check `User-Agent` (and Codex's `Originator` and path), which a page cannot set. Their button is disabled, with a tooltip naming the client to test from. Groups whose models are all image, video or review models are disabled the same way. The button uses `focusableWhenDisabled`, since a natively disabled button never shows its tooltip.
- **The dialog is a lazy chunk.** The keys table imports only `iq-test-models.ts` (the model filter), so the questions and the dialog load when it opens.

## Alternatives considered

- **A server endpoint that runs the test for any group**, calling `/v1` internally with a trusted header that skips the client gate. It would cover the Claude Code only groups, but it opens a bypass of the client gate and has to be safe across the engine pool. The owner chose the browser-only version first.
- **Pick any key inside the dialog**, as zzshu does. The button sits on a row, so the dialog tests that row's key.

## Consequences

- First load: `/keys` 612.9 → 614.0 KB and `/dashboard/overview` 531.5 → 532.1 KB (the new strings land in the core locale part), measured against main on the same machine.
- Closing the dialog aborts the stream; what the upstream already generated is still billed.
- A key without a group uses the account's group; the button does not know whether that group is client-only, and such a test fails with the gate's own message.
