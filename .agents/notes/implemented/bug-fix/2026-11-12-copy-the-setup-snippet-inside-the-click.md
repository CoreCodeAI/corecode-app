# Agent Note: Copy the setup snippet inside the click

Status: implemented

## Problem

The setup guide's Copy button fetched the key's full secret and only then wrote the
clipboard. Safari and iOS WebKit accept a clipboard write only while the click is being
handled; after an awaited request the write can be refused, and the guide answered
"Failed to copy to clipboard". The guide is where a new customer gets a working config,
on the overview and in the dialog a new key opens.

## Decision

- `copyToClipboard` (`lib/copy-to-clipboard.ts`) also takes a promise of the text. Where
  `ClipboardItem` and `navigator.clipboard.write` exist, it writes one item whose
  `text/plain` is that promise, so the write starts during the click and the browser
  waits for the text. Where they do not exist, or the browser refuses the item, it waits
  for the text and writes it as before. A string argument takes the old path unchanged.
- `useCopyToClipboard` passes the same argument through.
- The guide's `handleCopySnippet` builds the snippet from the pending key and hands the
  promise over before awaiting anything. With no key the promise rejects, nothing is
  written, and the handler returns as it did.

## Alternatives considered

- **Fetch the full key when a key is selected**, so the click has it already. The secret
  request is rate limited, and every change of key would spend one.
- **A second helper for the promise case.** One helper keeps the fallback chain in one
  place; the string path is untouched.

## Consequences

- The other copy buttons that fetch a secret first (the key cell, the row menu's copy
  key and connection string, the bulk copy) still await before writing. They can take
  the same path by passing the promise.
- A second click on the guide uses the cached key, as before.

## Verification

- `lib/__tests__/copy-to-clipboard.test.ts`: the clipboard receives the item during the
  call, before the text resolves; without `ClipboardItem` the text is written once it
  arrives; a refused item falls back to writing the text; a text that cannot be fetched
  copies nothing and reports failure; a string still goes through `writeText`.
- `keys/components/__tests__/client-setup-guide.test.tsx`: the guide starts the write
  during the click, before the full key arrives.
- With `copy-to-clipboard.ts`, the hook and the guide from main, 5 of those 16 tests
  fail.
- Headless Chrome 157 against a local server: clicking 复制 made one
  `navigator.clipboard.write` call and no `writeText` call, the write resolved, and the
  item's text held the full key and `ANTHROPIC_BASE_URL`.

Not checked in Safari or on an iPhone, which is where the failure occurs.
