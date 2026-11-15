# Agent Note: Take revenue down to what is left on the funds tab, and name the checkout methods that mostly fail

Status: implemented

## Problem

The funds tab stated a gross margin of 90.1% (¥34,842 of ¥38,655) and no view showed the steps from revenue to what was left. Two costs the dashboard already knew were missing from that figure: the promotion-channel fees for the range (¥2,577, on the channels tab) and the referral commission credited to wallets in the range (¥3,082, in the wallet-credit list). Payment processing fees were not recorded anywhere.

The orders-by-method table showed checkout completion but named a method only when the site-wide completion rate halved against the previous period (`completionDrop`). A method that always completed about 10% of its checkouts was never named, and nothing said what its unpaid checkouts might be worth.

## Decision

### A profit waterfall

`profitWaterfall` in `finance-analysis.ts` takes revenue down, in yuan, through five costs in order: pool accounts, upstream bills, upstream monthly fees, promotion-channel fees and commission. The first three reproduce `financeMargins`: revenue less them is the gross margin the vendor panel reports, and the panel keeps the same figure. Each step shows its share of revenue, and the last line is what is left after every step. The panel is `ProfitWaterfallPanel`, placed below the vendor margin panel and hidden on a server that does not send `channel_fee_usd`.

The server adds one field, `channel_fee_usd` on `FinanceInsights`: the range's promotion-channel fees in real US dollars. It is computed by `channelFeesIn`, which the channels view also calls for each channel's `fee_usd`, so the two tabs share one function. The console converts it at the response's `usd_exchange_rate`, as the channels tab converts its own fee. `TestFundsChannelFeeEqualsChannelsView` checks that the funds figure equals the sum of the channels view's fee column for the same range, on each database dialect. Commission is not a new field: the funds view already sent `commission_usd`, and the waterfall reads it one for one, as the wallet-credit list does.

Commission is labelled as wallet quota and drawn in the neutral colour. The panel's note says what is not in the figure: payment processing fees, refunds, and any cost the dashboard does not record. Refunds are not netted from revenue (a refunded order stays in revenue, as the channels tab notes), and gift credit is not a cost step because its consumption was never revenue.

The accounts step is the whole pool at its monthly price over the range, so it includes capacity used by staff, whose use is not revenue. The step is therefore a conservative cost. Accounts bought or dropped during the range are not reflected, as the vendor panel already says.

### Checkouts that mostly fail

`checkoutValue` adds five fields to each orders-by-method row:

- `settled`: created, less the pending ones opened within the hour. This is `checkoutCompletion`'s basis, so the funds tab and the overview agree.
- `unpaid`: failed, expired and pending past the hour. A refund was a payment, so it is not unpaid.
- `settledRate`: paid over settled.
- `averagePaid`: paid money over paid checkouts, in the payment currency.
- `estimate`: unpaid times `averagePaid`. The table's "Unpaid, up to" column shows it.

The estimate is an upper bound. Some customers retry with another method, so the same buyer can be counted once as unpaid and once as paid. It is not a forecast of recoverable revenue. A method with no paid checkouts has no average, so its estimate is absent and it ranks last.

`checkoutLossFindings` in `components/checkout-loss.ts` names each method whose `settledRate` is under 0.5 over at least `MIN_CHECKOUTS` (10) settled checkouts. It produces a `warning` finding with `impact` set to the estimate, so `sortFindings` ranks it by the estimate. The finding appears in the orders panel of the funds tab and in the overview's findings. A method is named whether or not its rate changed, and no provider is special-cased. `completionDrop` is unchanged.

The Feishu digest does not mirror this rule. It mirrors `completionDrop`, which this change leaves as it was.

### Corrected the same day: a refunded checkout completed

On production the new finding read "Stripe · 银行卡 completed 10.3% of settled checkouts": 6 paid of 58. The other statuses were 15 failed or expired, 2 pending past the hour and 35 refunded, which the rate counted as settled and not paid. Forty-one of the 58 went through; the method's trouble is that its payments are refunded, not that its checkouts fail.

- `settledRate` counts a refunded checkout with the paid ones: it went through. The console now reads the funnel's `refunded`, which the server already sent.
- `refundedCheckoutFindings` names a method with at least ten refunds that are at least half of its payments, on the funds tab and the overview, apart from the checkout-loss finding. Its text says the checkouts went through and the money was returned.
- The table's paid cell notes the refunds. The method's `completion_rate`, paid over opened, is unchanged: the previous-period comparison rests on it.

## Alternatives considered

- **Put the channel fee into the console from `channels` data.** The funds view does not read the channels view's rows, so the console could not compute the same figure without a second read. A server field computed by the channels view's own function keeps the two equal by construction.
- **Send the channel fee in yuan.** The channels tab converts at the response's exchange rate, and the funds tab already converts real US dollars the same way (upstream fees). Sending US dollars keeps one convention for real-dollar fees.
- **Net commission off the channel row only.** The funds view's commission is the whole range's, not only channels', and the waterfall must reconcile to the wallet-credit list. The channel row still shows its own commission.
- **Rate on the created basis, as the table's "Completed" column does.** A method with many checkouts still pending within the hour would read low. The finding uses the settled basis, as `completionDrop` does, and the finding's wording says so. The table column keeps its existing basis.
- **Rewrite the orders panel's help sentence.** The new explanation is a second sentence beside the existing one, so the existing string keeps its locale key and no key is orphaned.

## Consequences

- A funds read now also reads the channel costs option. It is one row read, and the existing settled-answer cache already drops on a fee save (`forgetSettledInsights`).
- `channel_fee_usd` is additive. An older console ignores it; a newer console against an older server hides the waterfall.
- The overview gains findings only where the funds view has order methods with at least 10 settled checkouts. The overview's help text is unchanged; the finding explains itself.
- The waterfall is not a profit figure, and the finance tab says so on the panel.
- Eighteen locale keys are new, all in the `rest` part of the locale split. No existing key moved part, so `first-load:check` is unaffected on the three core pages: the entry chunk got 58 bytes smaller, and the site-insights finance chunk regrouped.

## Verification

- `model/site_insights_channel_fee_test.go` (`TestFundsChannelFeeEqualsChannelsView`): the funds view's fee equals the channels view's summed fee column over a range with two channels and a fee change; the sum equals the closed-form value, to a cent. The SQLite subtest runs; the MySQL and PostgreSQL subtests skip without `TEST_MYSQL_DSN` and `TEST_POSTGRES_DSN`.
- `web/src/features/site-insights/__tests__/profit-waterfall.test.ts`: the first three steps equal `financeMargins`' margin; revenue less every step equals the remainder; the 2026-11-15 figures give 90.1%, 83.5% and 75.5%; fees convert at the rate; the panel is hidden on an older server.
- `checkout-loss.test.ts`: the finding fires at 10 settled checkouts and 40% paid, not at exactly half or under the sample floor; it is ranked by the estimate rather than the rate; a method with no paid checkout is named with no estimate.
- `finance-waterfall-render.test.tsx`: the panel's eight rows and their percentages, the hidden state and the loading state; the orders panel's new column and the finding.
- `bun run lint:check`, `bunx vitest run src/features/site-insights src/i18n` (53 files, 559 tests), `bun run typecheck`, `bunx oxfmt --check` on the folder, and `bun run build` with `bun run first-load:check`, as the commit's own checks.
- Not checked in a browser: the layout of the waterfall and the new column on a real range.
