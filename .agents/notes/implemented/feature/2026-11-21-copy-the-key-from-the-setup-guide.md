# Agent Note: Copy the key alone from the setup guide

Status: implemented

## Problem

The setup guide (the 接入客户端 dialog on `/keys` and the card on `/dashboard/overview`)
copied only the whole snippet, through a small ghost button in the code block's header.
A customer who needed only the key, for a tool the guide does not cover, had to open the
row menu or edit the pasted snippet. The owner asked for a separate key shortcut and a
cleaner dialog.

## Decision

- A key bar opens the guide: the key's name, its masked value, and a Copy Key button that
  fetches the full key and copies it alone. With several keys, the key picker moves into
  this bar from beside the method tabs.
- Both copy buttons share one path (`copyWithKey`), which hands the clipboard a promise
  before awaiting the key, so Safari still accepts the write.
- The snippet's button becomes the filled primary Copy config. The masked-key footnote
  under the snippet becomes one line in the key bar, and the dialog drops the key name
  from its description, since the bar shows it.

## Consequences

- The guide is on two core pages. The change costs about 55 bytes of first load: two new
  `core` locale keys replace one removed key, and the bar reuses existing Tailwind classes.
- The overview card is one row taller.
