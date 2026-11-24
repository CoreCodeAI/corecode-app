# Agent Note: A balance refusal is HTTP 402, short, in the customer's language, with the top-up link

Status: implemented

## Problem

A request the wallet and subscription could not cover was refused with HTTP 403 and a long English
sentence with six-decimal amounts. Claude Code reads a 403 as an authentication failure
(`Failed to authenticate. API Error: 403 ...`, a hint to `/login`), so customers with an empty
balance hunted for a login problem. Feedback #57 and 13 refusals in 24 hours on 2026-11-24 (user
4986 among them) read it that way. The Chinese text existed, but 4,788 of 4,958 users had saved
no language and API clients send no `Accept-Language`, so nearly every refusal was English.

## Decision

- **Status and body.** Every refusal for want of balance (`quota.user_insufficient`,
  `quota.pre_consume_insufficient`, `quota.shortfall_above_cap`,
  `quota.subscription_insufficient`, `quota.subscription_and_wallet_insufficient`, the image and
  task reservation refusals) is 402 with `insufficient_user_quota` as the internal code, skip
  retry and no error log, as before. `NewAPIError.isBalanceRefusal` (402 plus that code, raised
  by the gateway itself) makes `ToClaudeError` answer `error.type: billing_error`, which Claude
  Code understands, and `ToOpenAIError` answer `type` and `code` `insufficient_quota`; Gemini
  clients get the OpenAI shape like every other local error. An upstream's own 402 keeps its type.
- **Still 403.** The newcomer-plan gate (`quota.limited_plan_gate`) is a risk refusal, and
  `pre_consume_token_quota_failed` and the key's daily cap are per-key limits a top-up does not
  fix; none of them is a balance refusal.
- **Language.** `UserSetting.LanguageHint` (inside the `setting` JSON, no migration) records the
  language the console browser asked for. `setDashboardAuthContext` writes it for a session
  request (never a PAT) when the user saved no language and the browser's language differs from
  the recorded one, through `model.SetUserLanguageHint`, a compare-and-swap on the stored setting
  text so a setting the user saved in between is not overwritten. A process-local memo stops a
  stale user cache from repeating the attempt. `StatedLang` reads saved language, then the hint,
  then `Accept-Language`; the hint comes from the user setting TokenAuth already loads into the
  request, so a relay request costs no query. A reader with none of these gets the Chinese text
  with the English gloss in brackets (`i18n.TBilingual`), unless `DEFAULT_LANGUAGE` is set; other
  messages keep their fallback.
- **Wording.** One line per language, amounts through `logger.FormatQuotaBrief` (two decimals,
  `<$0.01` for a nonzero amount below a cent, `$0` for zero), and the wallet page
  `https://corecode.live/wallet`. The cap refusal keeps the advice to shorten the context. Each
  refusal has an English `_gloss` key in all three locale files for the bilingual line.
- **Console.** The playground recognises both `insufficient_quota` and `insufficient_user_quota`
  as an insufficient balance.

## Consequences

- Between the server release and the console release, a playground refusal carries the new code
  that the old console does not know, so it shows the generic error alert (with the new text and
  link) instead of the top-up prompt.
- A French or other browser records the hint `en`, like every language without a backend locale.
- Documents that say "403: balance used up" (corecode-infra `branding/`) say 402 in a separate change.

## Verification

- `TestBalanceRefusalErrorBodies` (relaykit/types), `TestQuotaRefusalLanguagePriority` (i18n),
  `TestRememberLanguageHint` (middleware), `TestFormatQuotaBrief` (logger), and the 402 and
  bilingual assertions in `TestPreConsumeShortfall*`.
- `TestSetUserLanguageHintDatabaseMatrix` and `TestPreConsumeShortfall*` pass on SQLite 3.50.4,
  MySQL 8.4.13 and PostgreSQL 16.16.
