# Agent Note: Take USDT and USDC through a deposit address per user, administrators first

Status: implemented

The cross-repository design is `corecode-infra`
`notes/workspace/proposed/feature/2026-11-13-per-user-evm-deposit-addresses.md`. This
note is the app's side: the Crediting section, as built.

## Problem

NOWPayments invoices a fixed amount, so a customer who sends a little less lands in
`partially_paid` and waits for an administrator. The operators want a crypto top-up with no
amount at all. A separate deposit service (`corecode-deposit`) gives each user an address,
watches it, and reports how much has ever arrived. The app has to show the address and
turn those totals into wallet credit, correctly, with two servers running during a
release.

## Decision

- **Beside NOWPayments, not instead of it.** A new method `chain_deposit` (payment method
  and provider) shows next to "USDT / USDC". NOWPayments' code, options and webhook are
  untouched.
- **Four options.** `ChainDepositEnabled` (default off), `ChainDepositAdminOnly` (default
  on), `ChainDepositApiUrl`, `ChainDepositHmacSecret`. The secret's key ends in `Secret`, so
  `GET /api/option/` never returns it, and the settings form sends it only when typed.
  `canUseChainDeposit` needs the switch, both service options, the payment compliance
  confirmation, and an administrator role while admin-only is on.
- **Two customer routes**, both under `/api/user/chain-deposit/`: `address` gets or
  creates the caller's address, `check` is "I've sent it". Both refuse a caller
  `canUseChainDeposit` refuses. `topup/info` carries `chain_deposit_available` and a
  `chain_deposit` entry in `pay_methods`; the old console ignores both.
- **Every call is signed and every answer verified.** `X-Deposit-Timestamp` and
  `X-Deposit-Signature` follow the service contract; a 200 answer without a good
  `X-Deposit-Signature` (HMAC of `response\n<request signature>\n<body>`, compared in
  constant time) is an error and its body is never read.
- **The poller is a system task**, `chain_deposit`, every 15 seconds while the URL and
  secret are set, whatever `ChainDepositEnabled` says, because addresses already issued keep
  receiving. A successful `check` also runs one pass.
- **One cursor, claimed through the database.** `chain_deposit_cursors` holds one row. A
  pass reads the cursor `c`, fetches `/v1/feed?after=c&limit=500`, applies the items, and
  moves the cursor with `UPDATE ... WHERE last_seq = c`. Only the pass whose update changes
  a row sends that page's alerts (the service's alerts and the app's own), so each goes out
  at most once. A pass that fails before the update leaves the cursor, and the page is read
  again.
- **Totals are idempotent on their own.** `chain_deposit_credits` keeps, per user, network
  and token (unique), the credited total as a decimal string of base units. In one
  transaction `CreditChainDeposit` takes the row's lock and compares:
  equal: nothing; lower: nothing credited and an alert; more by under 10^decimals base units
  (one dollar): wait; else credit the difference. The credit moves `credited` with
  `WHERE credited = <old>`, inserts one successful `top_ups` row, and adds the quota, or
  none of it. A deterministic `trade_no`
  (`CHAIN_<network>_<token>_<user id>_<received>`, unique) is the second guard. Amounts are
  `math/big` and `shopspring/decimal`; an 18-decimal coin passes int64 at about 9 dollars.
  SQLite takes no row lock, but serialises writers, and the conditional update and the unique
  key still hold.
- **Pricing reuses the NOWPayments path.** dollars × `USDExchangeRate` is `money`;
  `money / Price` is the top-up units, which keep their fraction, so 1.5 dollars credits
  1.5; the bonus is `TopUpBonusRate` of that amount's tier (in tokens under token display),
  applied to the quota. `top_ups.amount` stores the units rounded to a whole number, because
  the column is an integer, while the quota credited is exact.
- **Feishu goes through the NOWPayments webhook options.** "✅ 链上充值到账" names the user
  (`nowPaymentsFeishuUser`), network, token, dollars, credited quota and trade number; a
  service alert reads "⚠️ 链上充值告警: ..." ("🚨 ... 严重告警" when critical). The credit's
  notice is sent by the server that won the credit transaction.
- **A total the app cannot apply does not stall the feed.** An unknown token, a malformed
  amount, a deleted user or a wallet at its ceiling raises a Feishu alert and the cursor
  moves on; the next change to that total credits the whole difference once the cause is
  fixed. A database or pricing error stops the pass before the cursor moves, so it retries.
- **Console.** The wallet shows "链上充值 (USDT/USDC)" only when the server lists it. A click
  asks for no amount and opens a dialog (loaded on demand, with `qrcode.react`) with the
  address, QR code, networks, token contracts, the warnings and "I've sent it".

## Alternatives considered

- **A process-local ticker.** Two servers would both run it; the cursor and the credit rows
  already make that safe, but the system task runner also gives one run at a time and a
  record of each run.
- **Crediting from the `check` response.** The feed carries the same totals with a
  cursor and is the single path, so a missed check loses nothing.
- **Rounding the difference down to whole dollars.** It would keep `top_ups.amount` exact
  but strand the cents; the difference is credited whole.

## Consequences

- The system task runner writes a row every 15 seconds while the method is configured, and
  its daily cleanup removes them.
- The first-load budget of `/dashboard/overview` rises from 535 to 536 KB and `/keys` from
  617 to 618 KB. The settings tab and its six strings are in the core routes' reach, and
  main had 113 bytes left on the overview; the change costs about 450. This raise needs the
  owner's approval.
- A refund of a `chain_deposit` top-up reads `amount`, which is rounded; the sub-unit
  remainder is not reversed. Nothing reverses on-chain deposits automatically.
- If the deposit service's database is reset, its feed restarts at a lower sequence and the
  stored cursor would skip it. Clearing the cursor row is the recovery.

## Verification

- `go build` of the touched packages, `go vet ./...`, and `go test` of `common`,
  `controller`, `middleware`, `model`, `service`, `router` and `setting`.
- `controller/topup_chain_deposit_test.go` runs against a stub service that recomputes every
  request signature itself: the signed method, URI with query, timestamp and body; an
  unsigned, wrongly signed, and request-signature response each fail a pass, an address
  call, and the handler and credit nothing; a 12.5-dollar 18-decimal total credits the
  difference with bonus once; a repeated page or a replayed total adds no `top_ups` row; a
  lower total credits nothing and alerts once; 0.6 then 1.1 dollars waits then credits 1.1,
  and 0.999999999999999999 more waits while exactly 1 credits; six concurrent passes and
  eight concurrent credits of one total insert one row and send each Feishu message once;
  admin-only, switch-off and missing-secret gating; `check` maps 404 and 429, and runs a
  pass. The suite also ran under `-race`.
- Console `bun run typecheck`, `bun run lint:check`, `bun run test`, `bun run build` and
  `bun run first-load:check`.
- Not run: a real deposit service. Whether Postgres's `FOR UPDATE` and MySQL behave as the
  tests assume was not exercised; only SQLite was.
