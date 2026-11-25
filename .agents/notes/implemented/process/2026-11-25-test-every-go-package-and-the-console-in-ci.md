# Agent Note: Test every Go package and the console in CI

Status: implemented

## Problem

The `check` job tested six directories (`common`, `controller`, `middleware`,
`model`, `router`, `service`). The relay converters (`relay/`, 49 packages),
`setting/`, `pkg/` (billing expressions, JS plugins), `e2e/` and the two
modules with their own `go.mod`, `tokenkit` and `relaykit`, compiled but never
ran their tests. The `web` job built, type-checked, linted and measured the
console but never ran its Vitest suite. A pull request could break any of them
and merge green.

## Decision

- The Go step runs `go vet ./...` and `go test ./...` in the root module,
  `tokenkit` and `relaykit`, and fails if any of them fails; the log handling
  and the race run of `pkg/deployment` and `pkg/riskpolicy` stay as they were.
- A `console-tests` job runs `bun run test` in three shards beside `web`.

## Alternatives considered

- **A Vitest step at the end of `web`.** The first run of this change did that:
  the step took 7 min 5 s on the hosted runner, `web` grew from about 1.5 to
  8.5 minutes, and corecode-infra's `release-app.yml` waits for `check` and
  `web` before it deploys, so every app release would have started about 6
  minutes later.

## Consequences

- The deploy does not wait for the console tests; a pull request does. A main
  commit whose tests fail still deploys, and its red run shows on main.
- On the hosted runner the Go step took 2 min 48 s, against 81 s for the six
  directories.
- Two tests fail on a machine with `HTTP_PROXY` set
  (`TestUpstreamAddressesMaskOnlyConfiguredAddresses`,
  `TestPricingHKDPerCNYNeverWaitsAndFetchesInTheBackground`); hosted runners
  set none.

## Verification

- `actionlint .github/workflows/ci.yml`: clean.
- The Go step's script, run under bash with the proxy variables unset: exit 0,
  67 `ok` packages, no failure.
- `bun run test` in `web/` on origin/main: 439 files, 4,617 tests passed in
  96 s on a 14-core laptop.
