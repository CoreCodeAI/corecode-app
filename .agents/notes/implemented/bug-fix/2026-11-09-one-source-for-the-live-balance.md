# Agent Note: Read the balance from one live source

Status: implemented

## Problem

The sidebar and the overview's balance card read `user.quota` from the Zustand auth store, which
is written only at sign-in and token rotation. The wallet fetched `/api/user/self` into its own
local state, and the redemption and referral paths called `getSelf()` and dropped the result. After
a top-up or a redemption, the wallet showed the new balance while the sidebar kept the old one
until the next sign-in.

A payment opened in another tab was also never confirmed. The wallet showed "Redirecting…" and
refetched at once, before the customer had paid.

## Decision

- `web/src/hooks/use-self.ts` owns every read of `/api/user/self`. `useSelf()` is a react-query
  query (refetch on focus, every 60 s while the tab is visible) and each result is merged into the
  auth store user, so existing readers of the store follow the server without changing. The merge
  keeps fields the payload lacks and ignores a payload for another account id.
- `useRefreshSelf()` forces a fresh read after a balance-changing action: redemption, referral
  transfer, subscription purchase, payment. The wallet no longer holds its own copy of the user.
- After a payment is handed off, `usePaymentConfirmation` polls every 4 s for 3 minutes and on
  `visibilitychange`. The baseline is read fresh before polling, so credit that landed earlier is
  not mistaken for this payment. A rise in balance ends the wait with one toast naming the amount.
  A timeout shows a calm "still waiting?" banner that opens Order History. The wait is a session
  counter, so a late response from an ended wait does nothing, and unmount clears every timer.
- The balance-runway logic is unchanged: it still takes the quota as an argument.

Top-up input changed with it. The amount field accepts whole numbers only, because the server
charges an integer and `Math.floor` used to turn 10.5 into 10 silently. A calculation failure now
throws and surfaces as `calculationFailed` instead of an amount of 0, and an amount under the
minimum is not priced.

## Alternatives considered

- **Write the wallet's fetch into the store only.** It fixes the sidebar after a wallet visit but
  not after spending, and leaves two fetch paths.
- **Poll the top-up history to confirm a payment.** The balance is what the customer cares about
  and it covers redemption and plans too; history rows can be pending after credit lands.

## Consequences

- Each console page with the sidebar issues one `/api/user/self` request a minute while visible.
  The sidebar, overview and wallet share one cache entry.
- A payment whose credit arrives after the three minutes still updates the balance on the next
  refetch, only without the toast.
