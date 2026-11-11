# Agent Note: Creation Studio entry in the console sidebar

Status: implemented

## Problem

CoreCode is building an AI canvas app, a separate static site at
`https://canvas.corecode.live`. A customer reaches it from the console, and
it needs an API key to call `/v1`. Making the customer copy a key into the
canvas by hand loses most of them.

## Decision

- **A 「创作台」 item under 「游乐场」 in the `chat` sidebar group** opens the
  canvas in a new tab. It is a new item type, `canvas-studio`, rendered as a
  menu button with an external-link icon (hidden in the collapsed rail, where
  the tooltip carries the name). The `chat.canvas` sidebar module, on by
  default, gates it through the same admin x user rule as `chat-presets`;
  admins and users toggle it where they toggle the other modules. The Go
  defaults for new users are untouched: a missing module reads as visible.
- **The key travels in the URL fragment,**
  `#baseUrl=<server>&apiKey=<sk-...>`, both `encodeURIComponent`-encoded. A
  fragment is never sent to a server and never appears in a Referer, so
  neither the canvas host's logs nor a third-party request made by the canvas
  page sees it. A query string would. The canvas reads the fragment and
  clears it. The origin is one constant, `CANVAS_ORIGIN`, in
  `web/src/features/canvas-studio/lib/canvas-link.ts`.
- **The key is an `auto`-group key.** Keys are bound to a group. Image models
  sit in 「GPT生图1-4K」, video in 「Seedance视频」 and 「WAN3.0」, and only an
  `auto` key reaches those and the chat models together. Selection order: an
  enabled key named exactly `创作台`, else the first enabled `auto` key
  (`pickCanvasKey`, pure and unit tested). The list is paged at the server's
  cap of 100 rows, so a customer with many keys is not missed.
- **A key is created only on an explicit click.** With no suitable key the
  sidebar shows a dialog; its 「创建创作台令牌」 button creates `创作台` in
  `auto` with the payload the key form builds from its defaults (unlimited
  quota, never expires, `auto_groups` empty, cross-group retry on) and then
  opens the canvas. Cancel creates nothing. A click that quietly adds a
  credential to the account would surprise a customer who only wanted to look.
- **The tab opens before the first await.** Browsers, Safari above all, block
  `window.open` after an async gap. The click opens `about:blank`, clears its
  `opener`, and points it at the canvas once the key resolves; it closes on
  failure or when the dialog path is taken. The dialog's create button is a
  fresh gesture and does the same. If the blank tab was blocked anyway, the
  final navigation tries `window.open` once.
- **The keys table gets 「在创作台打开」** on a row's menu, handing that row's
  key over with the same contract (enabled keys only).
- **The key lookup and the dialog load on demand,** so the `/sign-in`
  first-load number does not move (352.3 of 353 KB). The sidebar shell, the
  menu entry and the new locale strings still ride in the authenticated
  layout and core locale parts, which took `/dashboard/overview` from 525.3 to
  526.2 KB; its budget goes from 526 to 527 KB on purpose.

## Consequences

- The canvas host must read `location.hash` and drop it from the address bar
  and history; this change cannot enforce that.
- The key lands in the canvas page's JavaScript and whatever storage it
  chooses. A leaked canvas site leaks `创作台` keys; the key is a normal
  customer key, revocable on the API Keys page.
- Deleting or disabling `创作台` makes the next click offer to create one.
