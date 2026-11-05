# Agent Note: Split the business tab and show gross margin by vendor

Status: implemented

## Problem

The site insights page's "Models & referrals" tab held four unrelated things: revenue by model, referral return, clients, and users by group. It answered no one question, so it was rarely opened. Its model table spread revenue by list-price share, which cannot say which vendor makes or loses money. Its referral figures set commission against invitee consumption, not against what invitees paid.

## Decision

The tab is removed and its parts go where their questions are asked:

- **Funds** gains *Gross margin by vendor*, below the summary, and *Revenue by model*, below the vendor tabs. The model table drops to five columns, and consumption shows its share as a bar.
- **Growth** gains *Referrals*: invitee payments and their share of revenue, invitee consumption, commission, and payments ÷ commission, then each inviter's return. *Users by group* follows it.
- **Service quality** gains *Clients*, by client and by version.

The `business` view stays and its endpoint is unchanged. The three tabs read it beside their own view. `?tab=business` opens Funds.

Gross margin by vendor sets revenue against account cost, in yuan:

- **Revenue.** `vendor_revenue` shares out the range's recognized revenue by each vendor's part of customers' list-price consumption, read from `quota_data` without root's own use. Recognized revenue is what customers' use and running plans earned in the range. Revenue per list-price dollar is not known by model, so every vendor earns the site's average: an estimate.
- **Cost.** Each pool account's monthly price is spread over the range's days at the site's exchange rate. `plan_accounts` gains `vendor`, the vendor its group's channel serves (`ChannelProvider`). A Claude account is priced by plan and tier (`ACCOUNT_PRICES`). Another vendor's account is priced by vendor (`VENDOR_ACCOUNT_MONTHLY_USD`): Codex is ChatGPT Pro at $200. Grok and Gemini have no recorded price; their accounts count as free and the panel says so.

The panel opens with one sentence: what was earned, what the accounts cost, the margin, each vendor that loses money, and which vendors are unpriced.

## Alternatives considered

**Keeping the tab and restyling it.** That leaves four unrelated panels together. They would still be read only by someone who goes looking for them.

**Merging the business fields into the finance, growth and quality endpoints.** That moves the same queries to three handlers for no new figure. Reading the cached `business` view beside them is one more request on those tabs.

**Revenue per model from each user's price.** The hourly cache keeps users and models apart, so a per-user, per-model price needs a new scan of the logs. The site's average is close enough to rank vendors.

## Consequences

- Cost uses the pool as it is now, not as it was through the range: an account added yesterday costs the whole range.
- Grok and Gemini margins read high until their prices are recorded in `VENDOR_ACCOUNT_MONTHLY_USD`.
- Payment fees and refunds are not counted.

## Verification

`TestFinanceRecognizesRevenueAsItIsEarned` checks that root's use earns nothing and that customers' use shares recognized revenue by vendor. `TestEnginePlanCounts` checks the vendor of each account's group. `business-panels.test.tsx` checks margins by vendor, the panel's sentence, the referral return, and client families.
