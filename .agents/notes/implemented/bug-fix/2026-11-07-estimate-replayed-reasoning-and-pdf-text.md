# Agent Note: Estimate replayed reasoning and inline PDF text before reserving

Status: implemented

## Problem

A wallet reservation is the request's estimated input cost times
`quota_setting.pre_consume_multiplier`, and up to `max_shortfall_usd` of that
estimate may go unreserved (`2026-11-01` shortfall cap). When upstream bills far
more input than the estimate, the settlement takes the wallet below zero by more
than the cap. On 2026-11-07, 48 users were below zero by $39.12 in total.

On 2026-11-07 at 14:29 UTC, user 1525 sent a `gpt-6-astra` chat request of
893 KB from `kimi-code-desktop/1.3.0` with $3.10 in the wallet. new-api
estimated $3.55, about 222k tokens. Upstream billed 632,791 tokens, which
falls in the price tier above 272k, and the settlement charged $10.43 (log
290287). The wallet ended at -$7.32. The request body was not kept, so its
exact content is unknown.

Probes through a temporary `GPT`-group token showed two inputs that upstream
bills and the chat estimate missed:

- **Replayed reasoning.** An assistant message whose `reasoning_content` held
  20,000 characters billed 10,345 prompt tokens. The same text placed in
  `content` billed 10,340, and the message without it billed 5,339.
  `GeneralOpenAIRequest.GetTokenCountMeta` skipped `reasoning_content` and
  `reasoning`. Clients such as Kimi Code send every earlier turn's reasoning
  back.
- **Inline PDFs.** A 70 KB, 33-page text PDF billed 22,781 tokens, of which
  5,337 is a fixed per-request prefix the channel adds. The text alone counts
  16,320. The estimate was a flat 4,096 tokens. A 1-page and a 10-page PDF with
  almost no text billed the same as no file, so upstream bills a PDF's extracted
  text and not its page images. A base64 text file sent as a `file` part billed
  nothing.

## Decision

- **Chat requests count `reasoning_content`**, or `reasoning` when that is the
  field sent, as prompt text.
- **An inline PDF is estimated from its decoded size at 4 bytes per token,
  capped at 1,000 tokens per page**, and never below the old 4,096. Pages are
  page objects (`/Type /Page`) in the raw bytes. A PDF whose page objects sit
  in compressed object streams, a file sent by id or URL, and any non-PDF file
  keep the flat 4,096.

## Alternatives considered

- **Extract the PDF's text and tokenize it.** This needs a PDF parser in the
  request path. The size estimate came within 2% of the measured PDF.
- **Estimate every file by its size.** A scanned PDF is mostly image bytes,
  which upstream does not bill. A 5 MB scan would reserve about 1.3M tokens and
  refuse most customers. The page cap bounds that at 1,000 tokens a page.
- **Lower `max_shortfall_usd`.** A 200k-token Claude Code request reserves
  about $2 of input before its cache reads are known, and settles near $0.15.
  A lower cap would leave each customer's last few dollars unusable. The owner
  kept the cap at $1.

## Consequences

- Kimi Code style sessions reserve their replayed reasoning, so a
  nearly empty wallet is refused earlier instead of settling below the cap.
- The measured PDF now estimates 17,642 tokens against 17,444 billed. A text-free
  PDF of 10 pages estimates 4,556 against 0 billed; the excess is only reserved
  and is returned at settlement.
- These two inputs do not account for all of request 290287's 410k-token gap.
  Its body was 1.41 bytes per billed token, against a median of 4.1 for
  `gpt-6-astra` chat requests over two days. A third, unidentified input may
  remain.
- The channel's 5,337-token prefix is still not estimated. At most it costs
  about $0.09 a request on `gpt-6-astra`'s top tier.

## Verification

- `TestTokenCountMetaCountsAgentLoopContent` covers `reasoning_content` and
  `reasoning`; with `relaykit/dto/openai_request.go` reverted, its chat case
  fails.
- `TestFileTokensEstimatesInlinePDFs` covers the size estimate, the page cap,
  the floor, PDFs without visible pages, text files, URLs and invalid base64.
- `fileTokens` on the three probe PDFs: 33 pages 17,642, 1 page 4,096,
  10 pages 4,556.
- `go test` passes for `relaykit/...`, `service/...`, `relay/...` and
  `controller/...` with proxy variables unset. With them set,
  `TestUpstreamAddressesMaskOnlyConfiguredAddresses` fails, on `origin/main`
  too. `go vet` and `gofmt -l` are clean.
