# Agent Note: Pricing deep links, search and sort

Status: implemented

## Problem

The pricing page listed every model in one table sorted by input price. A customer
could not find a model by name or sort by output price or saving. `PricingToolbar`,
`SearchBar`, `ModelCardGrid`, `PricingTable` and `use-filters` still existed but nothing
rendered them, and `routes/pricing` validated `search` and `sort` params that nobody read.
On a 390px phone the group cards pushed the first price about one and a half screens
down. A model's drawer opened from `useState`, so it had no URL, Back left the page
instead of closing it, and a link could not point at a model. The model page's code
samples named the key `$NEW_API_KEY` (upstream's name) in some places and
`<YOUR_API_KEY>` in others, and offered no Claude Code setup for the product's main use.

## Decision

- **`search`, `sort` and `model` are URL params of `/pricing`.** `usePricingUrlState`
  reads and writes them. Typing and sorting replace the history entry; opening a model
  pushes one, so Back closes the drawer. A link that already carries `model` opens the
  drawer, and closing it replaces the entry rather than leaving the page. The drawer's
  "Copy link" copies `/pricing?model=<name>`. The route schema gained only the `model`
  string, with no import from the page module (lesson `keep-route-options-off-page-modules`).
- **Sort keys are `input` (default), `output` and `savings`.** The default is not written
  to the URL. Savings sort by the model's markup over the official price, ascending,
  because the group discount is shared by every row. An unknown value falls back to the
  default. Search matches the model name only.
- **The board owns the search box's text while typing** and reports each change; the
  router's asynchronous update would otherwise move the caret.
- **Below `md` the group choice is a Select**; the radio cards stay for wider screens.
  The pricing rules bar and the model-check banner move below the prices on a phone with
  CSS `order`, so the DOM and the desktop layout are unchanged.
- **The cache write and cache read headings explain themselves** in a popover, which
  opens on a tap as well as on hover.
- **One key name, `CORECODE_API_KEY`**, in every sample. Python samples read it with
  `os.environ`. A Claude model opens on a "Claude Code" sample: a `settings.json` `env`
  block with `ANTHROPIC_BASE_URL` set to the origin without `/v1` and
  `ANTHROPIC_AUTH_TOKEN`, then `claude --model <id>`.
- **A call to action follows the samples.** Signed out: "Sign up to get started" to
  `/sign-up`. Signed in: "Create an API key" to `/keys`, and "Try in the playground" to
  `/playground?model=<id>`; the playground route gained an optional `model` param that
  sets the playground's model once on mount. If the key's group does not serve that model,
  the playground's existing fallback picks one.
- **Dead code removed** with its tests: `PricingToolbar`, `PricingSidebar`, `SearchBar`,
  `ModelCardGrid`, `PricingTable`, `useFilters`.

## Alternatives considered

- **Route the drawer to `/pricing/$modelId`.** That page renders the model without the
  list behind it, so closing it would be a navigation to a different page. A search param
  keeps the list and the drawer together.
- **Revive the deleted toolbar.** It filtered by vendor, tag, endpoint and quota type,
  none of which a Claude Code customer chooses by. Search and three sorts are what the
  price list needs.

## Verification

- `price-board-controls`, `use-pricing-url-state`, `model-api-samples` and
  `model-share-link` tests under `features/pricing`.
- `bun run typecheck`, `lint:check`, `format:check`, `test`, `build` and
  `first-load:check` in `web/`.
