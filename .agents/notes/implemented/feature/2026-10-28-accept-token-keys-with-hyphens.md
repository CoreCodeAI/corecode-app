# Agent Note: Accept token keys that contain a hyphen

Status: implemented

## Problem

The keys of the CPA gateway (`cpa.alphafox.app`) move into new-api with their
values unchanged, so their callers only change the base URL. Seven of the
sixteen keys have a hyphen after the `sk-` prefix: six `sk-gl-…` and one
`API-…`.

Token authentication strips `sk-`, splits the rest on `-`, and looks up only
the first part. The second part, when present, pins an administrator's request
to a channel id (`sk-<key>-<channel id>`). A stored key with a hyphen therefore
never matched: `sk-gl-abc` was looked up as `gl`.

## Decision

- **A presented value that names a token whole is not split.** `splitTokenKey`
  looks the whole value up first when it contains a hyphen. Only when no token
  has that key does it split as before.
- **The channel pin keeps working.** Generated keys have no hyphen, so
  `<key>-<channel id>` misses on the whole value and splits.
- Both `TokenAuth` and `TokenAuthReadOnly` use the helper.

The extra lookup runs only for values that contain a hyphen, and it goes
through the same Redis-first `GetTokenByKey` as the main lookup.

## Alternatives considered

Not recorded when the change shipped.

## Verification

`TestSplitTokenKeyKeepsStoredKeysWithHyphens` covers a stored hyphenated key, a
generated key with a channel pin, a plain key, and an unknown hyphenated value.
