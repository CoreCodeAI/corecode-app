# Agent Note: Keep signatures and bodies out of payment webhook logs

Status: implemented

## Problem

The payment webhooks logged each delivery's signature header and raw body at INFO:
Creem, Stripe, Waffo and Waffo Pancake on receipt and again on a failed check,
NOWPayments on receipt, and Epay with its full callback parameters, `sign`
included. Anyone who can read the relay's logs then holds a signed body that the
endpoint accepts, and the bodies carry customer emails and order details. Creem's
outgoing checkout request and its API response were logged whole too.

`verifyCreemSignature`, inherited from upstream, also returned true with an empty
secret whenever Creem test mode was on. `CreemWebhook` already refuses to run
without a secret (`isCreemWebhookEnabled`), so this was not reachable in
production, but it was one removed guard away from crediting a forged
`checkout.completed`. The Creem subscription checkout used the same test-mode
exception and could start a payment whose webhook would then be refused.

## Decision

- Logs carry `payloadFingerprint` (length and a 16-hex-digit SHA-256 prefix)
  instead of a body, and `signature_present` instead of a signature. The
  fingerprint still matches a delivery against the provider's dashboard.
- Epay parameters are logged with every signature field masked
  (`redactedPaymentParams`); the order number, status and amount stay readable.
- An empty Creem secret always fails verification, and the Creem subscription
  checkout requires a configured webhook secret, test mode or not.

## Alternatives considered

- **Log bodies at DEBUG.** DEBUG is turned on to diagnose incidents, which is
  when the logs are copied around most; the fingerprint plus the parsed fields
  each handler already logs (event type, order id, status) cover diagnosis.

## Verification

- `TestPaymentWebhooksDoNotLogSignatureOrBody` posts a forged Creem and Stripe
  delivery and requires the captured log to hold neither the signature nor an
  email from the body. `TestVerifyCreemSignatureRejectsEmptySecretInTestMode`
  covers the bypass. With the controllers at origin/main (only the helper file
  added) both fail; on this branch they pass.
- `go vet ./controller/` and `go test ./controller/ -count=1`: ok.
