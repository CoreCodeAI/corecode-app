# Agent Note: Record egress IP costs and leave the site's own promotion accounts' commission out of cost

Status: implemented

## Problem

The overview's gross margin for 10/27–11/25 was ¥130,135 (85.9%). It subtracted pool accounts and upstream bills and fees only. The owner asked for the full cost. A read of every source found two gaps the dashboard could close:

- **Egress IPs and proxy hosts were not recorded anywhere.** Their bills come by hand from several providers (sixtynet, cblnk, aaitr and others), in yuan or US dollars, monthly or quarterly. Neither the infra docs nor the Feishu 开号记录 sheet has a price column.
- **The waterfall's commission step was ¥11,729, and ¥10,618 of it was the site's own promotion accounts.** magpie (#306) earned ¥10,037, linuxdo (#964) ¥375, alphafox (#863) ¥185 and v2ex (#2931) ¥21. Their commission stays as wallet quota and is never withdrawn. In the whole history of `affiliate_withdrawals` there has been one paid withdrawal: ¥60, by bond0060. The `channel` flag on `affiliates` cannot pick these four out, because bond0060 and nine other outside accounts carry it too.

## Decision

- **An IP cost ledger.** The `IPCosts` option holds a list of `IPCost` entries. Each entry has a name, an amount in `CNY` or `USD` per cycle of 1, 3, 6 or 12 months, a start, an optional end, and a note. The funds view spreads each entry over the range at a thirtieth of a month per day, as channel fees are spread (`ipCostsIn`). It returns `ip_cost_cny` and `ip_cost_usd` separately, plus the stored list as `ip_costs`. `PUT /api/site-insights/ip-costs` replaces the list and is root-only, like the other site-insights writes.
- **IP cost is part of the gross margin.** `financeMargins` adds it to `cost` as `ipCost`, converting dollars at the response's rate. The overview verdict, the vendor panel and the waterfall therefore move together. The cost goes in no vendor's row, and the vendor panel's notes say so.
- **An exemption list for commission.** The `CommissionExemptUsers` option holds user ids. The funds view returns those accounts as `commission_exempt` and the commission they earned in the range as `commission_exempt_usd`. `PUT /api/site-insights/commission-exempt` replaces the list. The waterfall's commission step is `commission_usd − commission_exempt_usd`. Every other account's commission still counts, including channel accounts such as bond0060 that can withdraw.
- **Both editors are on the funds tab**, below the profit waterfall (`components/cost-ledgers.tsx`). A save drops the settled-answer cache and invalidates every site-insights query.
- **A bad entry is refused with the existing `Invalid parameters` message.** New server messages land in the core locale part and would cost `/keys` about 70 bytes of its first-load budget.

## Alternatives considered

- **Count only paid withdrawals as commission cost.** This is closest to cash, but it hides the commission that outside affiliates can still withdraw. The owner named the accounts to leave out, so a list follows that decision.
- **Exclude every affiliate with `channel = true`.** This would wrongly drop bond0060, which has withdrawn.
- **Store a monthly figure only.** sixtynet bills quarterly. Entering the price as billed avoids hand conversion when the list is maintained.
- **Convert yuan entries to dollars on the server.** The model has no exchange rate; the console already converts real dollars at `usd_exchange_rate`. Sending the two currencies apart keeps one conversion point.

## Consequences

- The gross margin falls by the recorded IP cost once the ledger is filled in. Until then both lists are empty and every figure stays as before, except that commission is still counted in full until the four accounts are added to the exemption list.
- All new fields are additive. An older console ignores them. A newer console against an older server shows empty editors with their Add buttons disabled, so nothing is saved over an unread list.
- Payment processing fees are still not in any figure. Measured for 10/27–11/25: epay at 8.11% and Stripe at about 3.8%, about 5% of cash in total. The waterfall's note still names them as missing.
