# Agent Note: Keep the relay's CORS when copying an upstream response

Status: implemented

## Problem

On 2026-11-11 a 1024x1024 `gpt-image-2` request from the Creation Studio (canvas.corecode.live, a browser app calling `/v1` with the customer's key) took 20 s and returned 200 in new-api's log, and was billed. The browser reported status 0 and the canvas showed 「请求失败」.

The upstream behind 「GPT生图1-4K」 answers every request, whatever its `Origin`, with `Access-Control-Allow-Origin` set to its own web app's origin, and its own `Access-Control-Allow-Methods` and `-Headers`. `IOCopyBytesGracefully` copied every upstream header except `Content-Length` with `Header().Set`, so the upstream's value replaced the `*` the CORS middleware had set. The browser then withheld a response the user had already paid for. The same copy also gave every API client:
- the upstream's session cookie, on corecode.live;
- its `NEL` and `Report-To`, which direct browsers to report corecode.live's network errors to the upstream's Cloudflare account;
- its `Alt-Svc`, `Cf-Ray` and `Cf-Cache-Status`;
- a response header naming the supplier's site.

Grok images worked from the same page because their channel sends no CORS headers.

## Decision

`ShouldCopyUpstreamHeader` refuses the headers that describe the upstream's host rather than the API response:
- any `Access-Control-*`;
- `Set-Cookie`;
- `NEL` and `Report-To`;
- `Alt-Svc`;
- any `Cf-*`.

The match ignores case. Every path that copies upstream headers to the client already asks it: `IOCopyBytesGracefully`, the SSE scanner, OpenAI audio and MiniMax TTS. The task plugin runtime receives upstream headers for its own hooks and is unchanged.

`Content-Type`, `Cache-Control`, rate-limit and request-ID headers still pass. A client that read them before reads them now.

## Alternatives considered

- **Copy an allowlist only.** It is the stricter rule, but each channel type returns headers clients use (`Openai-*`, `X-Ratelimit-*`, `Anthropic-*`), and a missing entry would silently drop one. The denylist covers the classes that are never the response's own.
- **Re-set the CORS headers after the copy.** It fixes the browser, but it keeps the cookie, reporting and CDN headers, and every copy path would need it.

## Consequences

- Browser apps on any origin can read relayed responses again, so an image the user pays for reaches the page that asked for it.
- API clients no longer see the upstream's cookie, CDN or reporting headers.

## Verification

- `go test ./service/ -run 'TestIOCopyBytesGracefullyKeepsTheRelaysCORS|TestShouldCopyUpstreamHeader'` passes. The first test feeds `IOCopyBytesGracefully` the header set the image upstream returned on 2026-11-11. Without the fix it fails: `Access-Control-Allow-Origin` comes back as the upstream's site instead of `*`, and the cookie and CORS lists pass through.
- `go vet ./service/ ./relay/...` and `go build ./...` pass.
- `go test ./service/... ./relay/...` passes except `TestUpstreamAddressesMaskOnlyConfiguredAddresses`, which fails the same way on main without this change: the local HTTP proxy changes the DNS error text it compares.
