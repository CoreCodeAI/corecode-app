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
- The `web` job runs `bun run test` after the first-load check.

## Consequences

- Local cost on 2026-11-25: the Go step ran 67 test packages in about a minute
  with a warm build cache; Vitest ran 439 files and 4,617 tests in 96 s. The
  first CI runs give the hosted runner's figure.
- Two tests fail on a machine with `HTTP_PROXY` set
  (`TestUpstreamAddressesMaskOnlyConfiguredAddresses`,
  `TestPricingHKDPerCNYNeverWaitsAndFetchesInTheBackground`); hosted runners
  set none.

## Verification

- `actionlint .github/workflows/ci.yml`: clean.
- The Go step's script, run under bash with the proxy variables unset: exit 0,
  67 `ok` packages, no failure.
- `bun run test` in `web/` on origin/main: 439 files, 4,617 tests passed.
