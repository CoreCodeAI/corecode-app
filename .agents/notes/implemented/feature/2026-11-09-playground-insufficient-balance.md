# Agent Note: Playground shows insufficient balance as a top-up prompt

Status: implemented

## Problem

Any playground error other than `model_price_error` fell into a red alert that printed
the server's raw text, in raw quota units, with a Retry that could only fail the same
way. A customer whose balance ran out saw `用户额度不足, 剩余额度: ...` and a button that
did nothing useful. The playground also dropped every message past the latest 24
without saying so.

## Decision

- **The mapping.** `service/billing_session.go` refuses a request with
  `types.ErrorCodeInsufficientUserQuota` (`insufficient_user_quota`, HTTP 403) when the
  wallet cannot reserve the cost, when the shortfall is above the cap, or when a
  subscription cannot cover it. The stream and the request error paths already carry
  `error.code` into `Message.errorCode`. The playground treats that code as
  "insufficient balance". When a message has no code at all, it matches the server's
  wording (`额度不足` or `insufficient (user) quota`) as a fallback.
  `pre_consume_token_quota_failed` is a per-key limit, which a top-up does not fix, so
  it stays a generic error.
- **The alert** is titled "Insufficient balance", says to top up, and links to `/wallet`
  with "Go to top up". It does not print the server's text. The reply's Retry is removed,
  because it would fail the same way; editing the prompt and deleting stay.
- **Earlier messages.** When more than 24 messages exist, a "Show N earlier messages"
  button above the list reveals them. The limit still bounds the first render.
- **The selected model's price** per million tokens at the playground's group shows under
  the input, from the pricing data the page already loads (`getModelPriceSummary`, which
  reuses the pricing page's unit prices, group ratio and recharge rate). Per-request and
  task models show nothing.
- `/playground` and the chat routes set their document titles with `useDocumentTitle`.

## Alternatives considered

- **Match the text only.** The server's wording differs by language, so the code is the
  primary signal and the text a fallback for events that lost it.
- **Keep Retry and disable it.** A disabled button still invites a click; no Retry says
  that retrying is not the next step.

## Verification

- `insufficient-balance`, `playground-chat` and `model-price` tests under
  `features/playground`.
