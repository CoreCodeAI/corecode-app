# Agent Note: The on-chain deposit replaces NOWPayments, with a 1% extra bonus

Status: implemented

## Problem

The owner wants the per-user deposit address to replace NOWPayments when it opens to
everyone. Taking a deposit on chain costs only the sweep's gas, so customers should see,
and get, an extra 1% for using it. The dialog listed every transfer of the last half
hour, which read as a history. A pre-launch security review of the app side found several
places where one bad total could stall or mis-price crediting.

## Decision

- `ChainDepositBonusRate` (option, default `0.01`, 0 to 1) is added to the tier rate of
  every on-chain credit, summed in decimals. The quote's `bonus_rate` is the whole rate and
  `chain_rate` the extra part; `lower_rate` includes the extra too.
- `GET /api/user/topup/info` lists the on-chain deposit in NOWPayments' place for any user
  `canUseChainDeposit` admits, with the extra rate as `bonus_rate`, and NOWPayments for
  everyone else. `nowpayments_currencies` stays in the reply and the NOWPayments callback
  stays on, because the plans do not allow balance payment and are bought through
  NOWPayments, and invoices already open must still credit. Turning
  `ChainDepositAdminOnly` off is the launch.
- The wallet button reads "Extra 1% bonus, credited in about a minute" in the success
  colour, and the dialog opens with the same statement. The dialog follows only the
  newest transfer.
- Hardening:
  - A total must name a mainnet network and token at its contract's decimals (bsc
    USDT/USDC 18, arbitrum USDT0/USDC/USDC.e 6). Anything else alerts instead of being
    priced, so a misread decimal or a testnet service cannot mint balance.
  - A feed page whose totals the service dropped comes back empty with a later `next`;
    the pass now moves past it instead of stopping there forever.
  - Twenty failed scheduled passes in a row (five minutes) alert Feishu once, and the
    first success after that says it recovered. A total that fails every time holds the
    cursor, so every later credit waits behind it.
  - The check button's pass goes through the activity's gate (one at a time, one per 2 s).
  - `/chain-deposit/activity` is limited to 60 requests a minute per user; the dialog asks
    20 times a minute.
  - The quote and activity routes are declared in the access-token rules, and CI now runs
    `./router/...`, whose test for undeclared routes had been failing on main unseen.

## Consequences

- An on-chain credit under the first tier still earns 1%.
- The extra rate is set through `PUT /api/option/`; the payment settings page does not
  show it, to keep settings copy out of the first load.
- The new strings are in the wallet's `rest` locale part; `index.css` is unchanged.
