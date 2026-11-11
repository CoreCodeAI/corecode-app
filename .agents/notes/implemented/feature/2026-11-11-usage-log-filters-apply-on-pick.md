# Agent Note: Apply usage-log selections on pick, and suggest key and model names

Status: implemented

## Problem

On desktop, every usage-log filter waited for Search. Picking "7 Days" or a log
type left the table on the old data with no sign that the filters were not
applied. On a phone the date range applied at once, so one control behaved two
ways. Reset counted only the other filters, so after changing just the date it
stayed disabled and could not bring the page back to today.

The token-name and model filters were free text. The server matches
`token_name` exactly, so part of a key's name returned no logs and the page
said only that there were none. The model filter matches exactly too unless the
value holds `%`, which nothing on the page mentions.

## Decision

- **Choosing applies; typing waits.** The date range (presets and Confirm)
  applies on every screen. On desktop, a log type, and a group, model or token
  name picked from its list, apply at once. Text typed into a field still
  applies on Enter or Search. In the mobile drawer a value picked from a list
  waits for Search, as the drawer's hint says, and Enter in the model, token
  name or group field searches at once, as Enter in a plain input always did.
- **The shared combobox reports a commit.** `ComboboxInput` and the
  options-style `Combobox` take an optional `onValueCommit`, called when a value
  is picked from the list or entered with Enter, and not on each keystroke. It
  passes the source, `list` or `enter`, because the combobox consumes Enter
  itself: the field's own `onKeyDown` never sees it, and at that moment the
  draft filters still hold the previous value. The filter bar applies the
  committed value directly. Existing callers pass nothing and behave as
  before.
- **Reset follows the default range, not its timestamps.**
  `isDefaultTimeRange` treats a range as the default when it starts at today's
  midnight and ends between now and the later of the day's end or an hour from
  now. `getDefaultTimeRange` takes its end from the moment it runs, so a
  timestamp comparison would read the page's own default as changed a moment
  later. The "Today" preset counts as the default.
- **Token and model names are comboboxes that still take free text.** Model
  choices come from `/api/user/models`; token choices are the names of the
  viewer's keys, the first 100 that `/api/token/` returns, without repeats. A
  typed `%opus%` still goes to the server as typed. The token list follows the
  sensitive-value mask the group list already used. An administrator viewing
  every user's logs gets no token choices, since their own keys' names would
  mislead there.

## Alternatives considered

- **Matching token names with `LIKE` on the server.** It fixes partial names
  everywhere, but it scans the log table and changes a query other pages share.
  The server was out of scope.
- **Applying typed text after a pause.** Every pause would start a log query,
  and a half-typed exact name returns nothing, which is the confusion this
  change removes.

## Consequences

- Each pick on desktop starts one log query and one stats query, where a
  session of several picks used to start one.
- A customer with more than 100 keys sees the first 100 as choices and types
  the rest.
- `combobox.tsx` and `combobox-input.tsx` come from upstream; the change to
  each is the optional prop, its source type, and the calls that pass it.
- In the mobile drawer, Enter in the group field now searches. Before this
  change the group combobox consumed Enter there and nothing happened.

## Verification

- `immediate-filters.test.tsx`: on desktop, "7 Days" sets `startTime` and
  page 1 at once; a log type and a picked group apply at once; typed group text
  waits for Enter; Reset is disabled on the default range, enabled after
  "30 Days" alone, and still disabled after "Today". Five of the six failed
  before the change.
- `name-filters.test.tsx`: each key name is offered once and applies when
  picked; a hand-typed token name and a typed `%opus%` apply on Enter; a picked
  model applies; the token list carries the mask; the administrator view does
  not request `/api/token/`. All six failed before the change. In the mobile
  drawer, text typed into the model, token name or group field and followed by
  Enter applies at once (three cases), and a model picked from the list waits
  for Search. With the filter bar applying commits only on desktop, as the first
  version did, the three Enter cases failed (`expected {} to match object`);
  with the fix all ten cases pass.
- `default-time-range.test.ts`: the range from `getDefaultTimeRange`, the same
  default taken minutes earlier, and "Today" count as default; an earlier
  start, a past end, a later day and a missing bound do not.
- `group-filter.test.tsx`: the two cases that expected a picked group to wait
  for Search now expect it to apply; the mobile case checks it still waits.
- `bun run test`, `bun run typecheck`,
  `bun run lint:check`, `bun run format:check`, `bun run build`,
  `bun run first-load:check`, all with exit status 0.
