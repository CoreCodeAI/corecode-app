# Agent Note: Take upstream new-api by merging its release tags

Status: implemented

## Problem

`corecode-app` began as a plain tree. Root commit `1897f73a5` copied the derouter
monorepo's `services/new-api` submodule without its history, so this repository
shared no commit with `QuantumNous/new-api`. A merge from upstream had no base:
git either refused it or, with `--allow-unrelated-histories`, treated every file
as a two-sided addition. GitHub did not mark the repository as a fork either,
and an existing repository cannot be turned into one, so GitHub could not show
how far behind upstream it was.

The submodule pointed at `alphafoxai/new-api@db76827` on its `derouter` branch.
That commit's tree is byte-identical to `1897f73a5`, and it sits six CoreCode
commits (N1–N5 and the theme) above upstream `633b4c5b1`, which is
`v1.0.0-rc.44` plus later fixes.

## Decision

- **One `-s ours` merge records the vendored commit as an ancestor.**
  `git merge -s ours --allow-unrelated-histories db76827` adds `db76827` as a
  second parent and keeps every file as it is. That claim is exact, because the
  root tree equals `db76827`'s tree. From then on, `git merge-base` with any
  upstream tag resolves to `633b4c5b1` or later, so only lines both sides changed
  conflict.
- **Upstream arrives by merging a release tag.** Fetch
  `https://github.com/QuantumNous/new-api.git` as the `upstream` remote and run
  `git merge <tag>` on a `chore/sync-upstream-<tag>` branch. A tag is a version
  upstream itself shipped, and the merge commit names it.
- **Upstream `main` is merged when a fix should not wait for a tag.** The merge
  commit names the upstream commit it ends at, and the next tag merge takes the
  rest. `019611f52` took 29 commits through `34003e9c2`; the 2026-10-30 sync took
  10 through `a2defd2a8` for a security advisory fix to
  `relaykit/relayconvert/kitutil/mask.go`.
- **A sync pull request lands as a merge commit, never squashed or rebased.**
  A squash keeps the tree but drops the upstream parent, so the next sync falls
  back to the last recorded base and conflicts again on everything in between.
  The repository allows all three merge methods; this one is a rule, not a
  setting.
- **Upstream tags stay local.** `git push` without `--tags` sends only the
  branch. The upstream tags are reachable through the merged history and are
  not republished under this repository.
- **This repository is the GitHub fork.** The original `corecode-app` was
  renamed `corecode-app-pre-fork` and archived. Its `main` was pushed as a fast
  forward to `alphafoxai/new-api`, the fork of `QuantumNous/new-api` that
  already existed, which was then renamed `corecode-app`. GitHub now reports the
  commits ahead of and behind upstream `main`. Issues and pull requests
  `corecode-app-pre-fork` #1–#8 stay in the archived repository; the fork's own
  earlier branches stay here.
- **The fork keeps the deploy identity by name.** The workload identity
  provider admits `assertion.repository` values, which follow the repository
  name, so `alphafoxai/corecode-app` authenticates as before. GitHub does not
  return secret values, so `CORECODE_RELAY_SSH_KEY` here is a key of its own,
  `corecode-app-ci-20261022`, added to the relay `runner` account beside the key
  `corecode-provider` and `corecode-engine` use.
- **A pull request targets this repository explicitly.** In a fork, the web
  "Compare & pull request" button and `gh pr create` default the base to
  `QuantumNous/new-api`. Check that the base reads `alphafoxai/corecode-app`
  before creating one. Do not use "Sync fork": it follows upstream `main`
  rather than a tag and offers to discard the commits here.
- **`gh` is pinned to this repository.** With a remote named `upstream`, the
  GitHub CLI resolves `upstream` as the base repository, so `gh pr create` and
  `gh run list` act on `QuantumNous/new-api`. `gh repo set-default
  alphafoxai/corecode-app` records the base in this repository's git config;
  scripts pass `-R alphafoxai/corecode-app` as well.

## Alternatives considered

- **Rebase the CoreCode commits onto `db76827` and force-push `main`.** It gives
  a linear history, but it rewrites a public default branch and breaks the
  commit references in merged pull requests and in `corecode-infra` image tags.
- **Cherry-pick selected upstream commits.** It needs no ancestry, but each sync
  becomes a manual selection, and fixes that build on skipped commits stop
  applying cleanly once upstream moves a few releases ahead.
- **Keep the unforked repository and its history connection only.** Syncing
  works without the fork relationship, but GitHub then cannot show the distance
  from upstream, which is the reason to keep the fork.
- **Fork upstream again and cherry-pick the CoreCode commits.** Cherry-picks get
  new commit ids, and the image tags that production records end in the commit
  id, so every running and past tag would stop pointing at its source.

## Consequences

- The first sync, `v1.0.0-rc.46`, brings about 6,600 upstream commits into this
  public repository's history. Upstream is public under the same license, so
  nothing private is exposed.
- Where both sides changed the same lines, conflicts come back on each sync.
  `git config rerere.enabled true` in the sync checkout replays earlier
  resolutions. The recurring spots are the CoreCode branding in
  `web/index.html`, the i18n key lists, the token path that carries
  `UpstreamKey` (N1) and the administrator token route (N2), and the workflows
  upstream edits but this repository deleted.
- **A clean merge can still be wrong where code is positional.** In
  `v1.0.0-rc.46`, `model/token_cache.go` gained `AllowUserQuotaQuery` as the
  17th Lua argument while N1 had already put `UpstreamKey` there. Both sides
  moved the TTL from `ARGV[17]` to `ARGV[18]`, so git merged those lines without
  a conflict. The resolution numbers them 17, 18 and 19.
  In `v1.0.0-rc.48` upstream appended four arguments after `AllowUserQuotaQuery`
  for the cache MAC. git merged the Go argument list, which keeps `UpstreamKey`
  at 17, while the Lua conflicted; upstream's half reads each of them one place
  early. The resolution reads them at 20–23, and the MAC names `UpstreamKey`
  beside `AutoGroups`, both `json:"-"` on `Token`.
  `model/token_cache_upstream_key_test.go` fails on either mistake.
  Read every Lua `ARGV` list and every positional argument list a sync touches,
  not only the conflicted hunks.
- Dependabot's open pull requests (`corecode-app-pre-fork` #1–#5) stayed in the
  archived repository. Vulnerability alerts were off on the fork and are now on,
  matching the archived repository. Whether Dependabot version updates open pull
  requests here is unverified; if none appear, enable them under Insights →
  Dependency graph → Dependabot.

## Verification

For the `v1.0.0-rc.46` sync: after the ancestry merge, `HEAD^{tree}` equals
`HEAD^1^{tree}`, and `git merge-base HEAD v1.0.0-rc.46` is `633b4c5b1`. The tag
merge auto-merged 291 files and conflicted in 13, all resolved on the sync
branch. On the merged tree `go vet ./...`, `bun run build`, `bun run test`,
and `bun run typecheck` pass. `go test ./...` passes except
`TestAdaptorMasksDialedHostsInDialFailure` in `relay/channel/advancedcustom`,
which fails the same way on an unmodified `v1.0.0-rc.46` checkout on the
same machine and is outside the packages CI tests.

For the repository move: `alphafoxai/new-api`'s `main` (`09109ec31`) is an
ancestor of `903750457`, so the push was a fast forward with no force. After
the renames, `gh api repos/alphafoxai/corecode-app` reports `fork: true` with
parent `QuantumNous/new-api`, and the compare view reads 0 behind and 29 ahead
of upstream `main`. A `workflow_dispatch` run of `ci.yml` on the fork passed
`check` and `publish`, which authenticates to GCP and pushes to Artifact
Registry. `deploy` runs only on push. Its key was checked by running
`scripts/deploy-service.sh` with that key and the tag production runs; it
printed "already runs …; nothing to restart" and restarted nothing.
