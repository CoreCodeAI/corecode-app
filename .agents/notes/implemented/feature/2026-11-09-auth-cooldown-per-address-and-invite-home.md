# Agent Note: Key the resend cooldown to its address and send invite visitors to sign-up

Status: implemented

## Problem

Two sign-in dead ends, found by tracing the console on 2026-11-09.

- After "Use a different email", the email form's submit stayed disabled as
  "Resend code (47s)" even for a new address. One countdown guarded the whole
  form, so a customer who mistyped their mailbox waited out a cooldown that
  belonged to the wrong address.
- An invitation link `/?ref=CODE` opened the home page, which showed a bare
  "Loading..." until the home-content request answered and then, with no
  custom content, the stock hero for deploying a gateway. The visitor came to
  create an account.

## Decision

- The magic-link form remembers which address the running countdown was
  started for. The send button is held only while the typed address matches it
  (trimmed, case-insensitive). A different address sends at once; the server's
  own rate limits still apply to it.
- The home page paints cached content immediately (the hook reads
  `localStorage` synchronously) and waits only when nothing is cached. When the
  request settles with no custom content, an unauthenticated visitor whose
  address carries a non-empty `ref` or `aff` is redirected to `/sign-up`. The
  root route already saves the code with `captureAffiliateCodeFromUrl` on
  mount, and the redirect saves it again before navigating, so the code
  survives the hop.

## Alternatives considered

- **Reset the countdown on "Use a different email".** That would let the same
  address resend at once, bypassing the cooldown the server asked for.
- **Redirect before the content request answers.** An operator's custom home
  page would then never be shown to invite visitors. The redirect waits for
  the settled answer; cached custom content wins.
- **Change the static marketing site.** Out of scope; the console route is the
  only place this redirect can live.

## Consequences

- A cold invite visitor still sees "Loading..." for one request before the
  redirect. Cached visitors see no flash.
- The cooldown is client state. Reloading the page drops it, as before, and the
  server's rate limit remains the real guard.

## Verification

- `auth-flow-polish.test.tsx` covers the same-address hold and the
  different-address send; `home-invite.test.tsx` covers the redirect, the
  untouched stock page without a code, and cached content painting before the
  request answers.
