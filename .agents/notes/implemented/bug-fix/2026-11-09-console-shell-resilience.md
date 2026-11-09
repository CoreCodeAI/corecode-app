# Agent Note: Console error handling, shell resilience and customer sidebar defaults

Status: implemented

## Problem

- Any query that failed with HTTP 500 hard-navigated the whole console to `/500`
  (`createAppQueryClient`'s `onInternalServerError`, wired in `main.tsx`), including silent
  background polls such as the feedback unread count. One flaky endpoint threw a signed-in
  customer out of the page they were on.
- Queries retried up to four times for every status except 401 and 403, so a 400, 404 or
  429 left a skeleton on screen for about 15 seconds.
- Only the root route had an error boundary. A crash inside a console page replaced the
  sidebar and header with a full-screen error, and the page's "Report an issue" button
  pointed at the upstream new-api GitHub issues.
- Below 1024 px the console header hid `TopNav`, whose own hamburger is `lg:hidden`, so
  phones could not reach the top-nav links. The public header's mobile menu was only
  opacity-hidden: focusable while closed, no Escape, no `aria-expanded`.
- A customer's sidebar listed "Overview" and "Dashboard" side by side, plus task logs for
  Midjourney and Suno that a Claude Code relay never produces.
- Invitation links carried `?aff=CODE`; linux.do marks any address containing `aff=` as
  dangerous.

## Decision

- **A failed query never navigates.** The 500 hook is gone. Route-level crashes reach an
  `errorComponent`; background polls fail quietly (`meta.errorToast: false` still silences
  the toast). A query that truly needs fatal handling opts in explicitly in a future
  change; none does today.
- **Retry policy (`shouldRetryQuery`)**: at most 2 retries, only for transport failures
  (no HTTP status and an `ERR_NETWORK`, `ECONNABORTED` or `ETIMEDOUT` code) and HTTP 5xx.
  Every 4xx, including 429, fails at once. Development still never retries.
- **The console shell survives page crashes.** TanStack replaces a route's whole component
  with its error boundary, so the `_authenticated` layout route's `errorComponent` and
  `notFoundComponent` render `AuthenticatedLayout` around the error themselves
  (`features/errors/shell-errors.tsx`, `embedded` fills the content area instead of
  `h-svh`). Unknown addresses never reach that
  route, so they still get the full-screen root 404 (its "Back to Home" goes to
  `/dashboard` when signed in). Rendering the shell there through a lazy import was tried
  and grew the sign-in first load from 351 KB to 395 KB through chunk re-splitting, past
  its 352 KB budget; a catch-all route under `_authenticated` would turn public 404s into
  sign-in redirects, so neither shipped.
- **Report an issue** goes to `/feedback` for a signed-in user and to `/docs` (the docs
  site the top navigation already links) for a visitor. "Back to Home" goes to
  `/dashboard` when signed in.
- **Navigation on phones.** The console header always renders `TopNav` (it switches
  between hamburger and inline links itself); the hamburger has an accessible name and
  `aria-expanded` from the dropdown. The public mobile overlay is `inert` while closed,
  closes on Escape, and its toggle carries `aria-expanded` and `aria-controls`.
- **Touch targets.** `icon` button sizes get a `pointer-coarse:` `::after` hit area so the
  tap target reaches about 40 px on touch screens; mouse layout is unchanged.
- **Customer sidebar defaults, changed in the front end only.** For a user whose role is
  below admin, `useSidebarConfig` overlays the user-layer config with
  `console.midjourney = false` and `console.task = false` unless the user's own saved
  settings turn them on. The admin-controlled `SidebarModulesAdmin` stays the first gate
  and is untouched, so an administrator can still hide them for everyone; admins keep the
  full view. Audit Logs stays visible, as it was. "Dashboard" is shown to customers as "Usage analytics" (zh: 用量分析) to
  stop it competing with "Overview"; the admin label is unchanged. The chat group is left
  as is: Playground is a working entry for customers.
- **Invitation links use `?ref=`.** The sign-in form already stored `ref` as the
  invitation code (`captureAffiliateCodeFromUrl`), and the route's search schema now
  names it. `?aff=` links already shared keep working.

## Consequences

- A transient 5xx on a background request no longer moves the user; the toast is the only
  signal, and the retry budget is smaller (2 instead of 4).
- Anyone who had Task Logs in their sidebar by default no longer sees it until they turn
  it on in their own sidebar settings.
- The `aria-label` gap in other icon-only buttons outside `components/layout/**` was not
  audited here.
