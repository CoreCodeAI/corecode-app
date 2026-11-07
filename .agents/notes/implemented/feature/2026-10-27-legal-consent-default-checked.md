# Agent Note: Start legal consent checked and open linked documents directly

Status: implemented — superseded by [2026-11-07-terms-update-gate](2026-11-07-terms-update-gate.md) while `legal.terms_version` is set

## Problem

CoreCode publishes its terms at `https://corecode.live/docs/terms/` and wants sign-up and sign-in to show the consent line once `legal.user_agreement` and `legal.privacy_policy` point there. Upstream starts the consent checkbox unchecked, so every new customer has to tick it before the sign-up, password, magic-link and OAuth buttons work. A document configured as a URL also opened an intermediate card with a "View document" button instead of the page itself.

## Decision

- `agreedToLegal` starts `true` in the sign-up form, the password sign-in form and the magic-link form. The checkbox still shows the linked documents and can be unchecked; unchecking still blocks submission and OAuth.
- `LegalDocument` calls `window.location.replace` when the configured content is an http(s) URL. The card stays as the fallback while the browser navigates.

## Alternatives considered

- **Hide the checkbox and keep only the "By creating an account, you agree to" footer.** The owner asked for a checked box, which keeps the links visible next to the button.
- **Point the consent links at `/docs/terms/` in code.** That hardcodes a CoreCode path into a component the admin setting already drives.

## Consequences

- A pre-checked box is weaker evidence of consent than one the customer ticks; the owner accepted that trade-off.
- Upstream merges that touch these three forms will conflict on the removed effects.

## Verification

- `bun run typecheck`, `bun run format:check`, `bunx vitest run` (239 files, 2688 tests) pass; `oxlint` is clean on the changed files.
- The new `legal-document.test.tsx` redirect case fails with the effect removed.
