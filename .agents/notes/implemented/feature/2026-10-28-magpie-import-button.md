# Agent Note: Add to Magpie one-click import

Status: implemented

## Problem

The key console offers a one-click import for CC Switch but only a pasted CLI
snippet for Magpie. Magpie has an import link (`https://usemagpie.ai/import#…`,
which opens `magpie://import?…` and shows its own confirmation), so a customer
can be one click from a working provider.

## Decision

- **`buildMagpieImportURL`** in `lib/client-setup.ts` builds the link:
  `anthropic=<base>`, `chat=<base>/v1`, `responses=<base>/v1` (CoreCode serves
  all three), `key`, `id=corecode`, `name` (the console's provider name),
  `website`, `keys` (`<base>/keys`), `icon` (`<base>/brand/logo.svg`). It
  carries no `models`: Magpie then lists what `/v1/models` returns for the key,
  so an Auto key offers its GPT, Grok and Gemini models to the agents that use
  `chat` and `responses`, and a Claude-Code-only key offers Claude alone. `id=corecode` matches Magpie's built-in preset, so
  the import replaces it instead of adding a duplicate. Parameters are explicit
  rather than `preset=corecode`, so the link does not depend on the preset's
  current contents.
- **The key rides in the fragment.** It never reaches a server on the import
  page. It is resolved on click (as for CC Switch) and the link opens with
  `window.open(url, '_blank', 'noopener')`; it is never in a rendered `href`.
- **Two entry points.** The setup guide's Magpie tab gets an "Add to Magpie"
  button next to the existing snippet. The key row menu gets a "Magpie" item
  after "CC Switch" that opens the link directly, with no extra dialog, because
  Magpie confirms the hosts, key and models itself.
- **Web link, not `magpie://`.** usemagpie.ai/import loads Cloudflare Web
  Analytics. The served `beacon.min.js` (version 2026.10.1) sanitizes the page
  `location` and `referrer` through a function that clears `username`,
  `password`, `hash` and `search` before reporting, and Cloudflare's FAQ says
  query strings are not logged. The fragment is therefore not reported, and the
  web link works for customers who have no `magpie://` handler registered yet.

## Alternatives considered

- `magpie://import?…` directly: no third-party page, but the browser does
  nothing visible when Magpie is not installed.
- A confirmation dialog in the console, as CC Switch has: redundant with
  Magpie's own confirmation.

## Consequences

- The import page is third-party; if Magpie changes it to send the fragment,
  switch to the `magpie://` form.
- Link parameters follow https://usemagpie.ai/docs/import; a renamed parameter
  breaks the import silently.

## Verification

`buildMagpieImportURL` tests cover the fragment-only key, the `/v1` endpoints,
the shared id, the absence of `models`, and encoding. Typecheck, lint, format and the keys
tests pass.
