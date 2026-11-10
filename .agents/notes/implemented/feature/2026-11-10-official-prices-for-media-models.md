# Agent Note: Show official prices for image and video models on the price board

Status: implemented

## Problem

The price board shows a struck-through official price and a saving chip for token-priced models. Image and video models showed only CoreCode's price, so a customer could not tell whether it was cheap. The group "x折" badge was also misleading for a group with no token-priced model: it is the group ratio against the site-wide exchange rate, which says nothing about a per-second or per-image price. The per-request footnote said only images count once, which is wrong for a group of video tasks.

## Decision

- **A separate option, `OfficialMediaPrice`.** `OfficialPriceMarkup` is a multiple of a ratio-derived price. A per-second or per-size price has no ratio to divide, so the option holds the official figure itself: `{"currency": "CNY"|"USD", "per_second": n}` or `{"currency": ..., "per_image": {"1K"?, "2K"?, "4K"?}}`. `/api/pricing` exposes it per model as `official_media_price`, omitted when unset. Billing never reads it.
- **Validation is strict.** The update rejects unknown keys, currencies and tiers, negative or non-finite numbers, an entry with both or neither of `per_second` and `per_image`, and an empty `per_image`. A rejected value leaves the map as it was. A tier that is left out means there is no official figure for it. No allowlist needed changes: the option is accepted through `controller/option.go` and `model/option.go`, as `OfficialPriceMarkup` is.
- **The console converts to yuan.** CNY is used as is; USD is multiplied by `usd_exchange_rate`. Our price is `usd × group ratio × priceRate`, as in the other rows. A non-positive official figure is treated as absent.
- **Per-second and image rows** show the official price struck through under ours. The "Save x%" chip is `1 - ours / official`, shown only when `getDiscountKind` calls it a discount. An image row takes the chip from its 1K tier, and has none when 1K has no official figure.
- **Per-call rows** with an official `per_second` show it as plain reference text, with no chip: a price per call and a price per second are not comparable.
- **The group badge, and "About x折", show only for a group with at least one token-priced model.** Groups made only of per-call or expression models show neither. The lone-group header follows the same rule.
- **The per-request footnote covers both images and video tasks.** The old English key was renamed in all seven locale files.

## Alternatives considered

- **Reuse `OfficialPriceMarkup` for media.** It divides a ratio-derived price. Expression and per-call models have no ratio, so there is nothing to divide.
- **Compute a chip for per-call video from a typical clip length.** It would invent a duration the customer does not choose.
- **Hide the badge only for groups with no models at all.** A group of video models would still carry a discount that is about tokens.

## Verification

- `TestOfficialMediaPrice` (`setting/ratio_setting`) covers both shapes, an absent tier, unknown models, and twelve rejected inputs that each leave the previous map intact.
- `price-board-media.test.tsx` covers:
  - official price and chip on a per-second row;
  - no chip when ours is dearer;
  - USD conversion and tiers shown only where configured, with the chip from 1K only;
  - no official text when none is set;
  - a per-call video's reference price with no chip;
  - the new footnote;
  - the badge hidden for a media group and kept for a token group.
- Making the badge ignore the token check fails the badge test.
- Checks run: `go build ./...`, `go vet` and `go test` on `./setting/... ./model/... ./controller/...`; the console's `typecheck`, `lint:check`, `format:check`, full `test`, `build` and `first-load:check`.
- Not verified: the rendered layout in a browser. The option is unset until the operator sets it after release.
