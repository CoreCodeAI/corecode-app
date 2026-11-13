# Agent Note: Translate plan text and payment method names in the wallet

Status: implemented

## Problem

The wallet in Russian, English or any other language still showed Chinese in
two places: the payment buttons (支付宝, 微信, 银行卡) and the plan cards
(新人体验包, ¥9.9 得 $20 额度…). Both come from operator settings, not from
locale files. `PayMethods` names each button, and `subscription_plans` stores
each plan's title and subtitle as written. The site now sends Russian readers
to the wallet from a paid campaign.

## Decision

- **Payment buttons by type.** `features/wallet/lib/payment-names.ts` maps
  the types the console knows (`alipay`, `stripe_alipay`, `wxpay`,
  `stripe_wechat_pay`, `stripe_card`) to the existing keys `Alipay`,
  `WeChat Pay` and `Card`. Any other type keeps the operator's name, so
  "USDT / USDC" and new methods show as configured. The top-up buttons, the
  confirm dialog and the plan checkout use it.
- **Plan text by exact match.** `features/subscriptions/lib/plan-text.ts`
  maps the Chinese title and subtitle of each plan on sale on 2026-11-13
  (新人体验包, 新人福利包, 渠道体验包) to an English key, translated in all
  eight locales. A plan whose text is not listed, or was edited, shows its
  text as written. Translating free text per plan in the database would need
  a schema and admin-form change; three plans did not justify it.
- **Kept off the first load.** `payment-names.ts` is not exported from
  `features/wallet/lib/index.ts`, because the overview imports that barrel
  and the locale split would then move `Card` into the core part. The
  partition diff against main shows only the six new keys, all in `rest`.

## When operators change a plan

Edit or add the plan's text in `PLAN_TEXT_KEYS` and add the key to all eight
files under `web/src/i18n/locales/`. Until then, readers in other languages
see the Chinese text.
