# Agent Note: Serve the static files of kept console releases

Status: implemented

## Problem

A console release unpacks the build into `console/<tag>/` and repoints the
relative symlink `console/current`, which `FRONTEND_DIR` names
(`corecode-infra`'s `scripts/deploy-relay.py`, `StaticRelease`). The host keeps
the five newest release directories (`STATIC_KEEP`). The server read only the
directory `current` resolves to, then the console embedded in the image.

A tab opened before a release still runs the previous build. When it opens a
route it has not loaded yet, it asks for that build's lazy chunk. The chunk was
in neither place, so the request fell through to the SPA fallback and got
`index.html` with status 200. The browser failed to run it as a script, and
`general-error.tsx` reloaded the page on the `ChunkLoadError`, losing its
state. The edge cache hides most of these misses, because a chunk somebody
already fetched stays there until the daily purge. A chunk nobody fetched
before the release, or any chunk after a purge or restart, still failed.

## Decision

- `DiskFrontend.Open` (`common/embed-file-system.go`) calls
  `openKeptStatic` (`common/frontend_releases.go`) when a file is missing
  from the current build and from the embedded one. It looks only for names
  under `/static/` and never for `.br` copies. It reads only when
  `FRONTEND_DIR` is a symlink. It searches the directories beside the one the
  symlink resolves to, newest first by modification time, skipping
  dot-prefixed staging entries and directories without an `index.html`, as the
  release script's prune does.
- Files under `/static/` are named by a hash of their content, so a file found
  in any kept release is the file asked for. It keeps `Cache()`'s
  `public, max-age=31536000, immutable`.
- `ServeFrontendFiles` answers a `/static/` path that no build has with 404 and
  `Cache-Control: no-store`, instead of letting it reach the HTML fallback. The
  edge cache does not store it.
- Each lookup opens through `http.FS(os.DirFS(release))`, which rejects names
  with `..` elements, so it cannot leave a release directory. The current
  build's own open already rejects such names before kept releases are read.

A request outside `/static/` does no extra filesystem work: `openKeptStatic`
returns on the prefix check before any call. `Exists` runs on every NoRoute
request (in the compression gate, `GlobalWebRateLimit` and
`ServeFrontendFiles`), so a `/static/` miss now lists `console/` and checks up
to four directories each of those three times. A hit in the current build
costs what it did.

## Alternatives considered

- **Look in kept releases for every path.** Console routes such as
  `/dashboard/overview` miss the build on every navigation, and the lookup
  would add a directory listing to each.
- **Keep the list of releases in memory per `Release()`.** It saves the
  listing on a miss, but misses are rare after the edge cache, and a list read
  per miss cannot go stale when a release is pruned.
- **Only the 404.** It removes the HTML served as a script, but the tab still
  reloads. The lookup is what lets it keep running.

## Consequences

- A tab survives releases as long as its build is one of the five kept.
  `STATIC_KEEP` lives in `corecode-infra`. At up to eleven console releases a
  day, five may not cover a day; raising it is an infra change (about 87 MB of
  disk per release).
- A `/static/` URL no build has now gets 404 with an empty body. A client that
  relied on the HTML fallback there was already broken.
- Without `FRONTEND_DIR`, or with a plain directory, nothing beside the build is
  read, as before.

## Verification

- `go test ./common -run DiskFrontend -count=1`: ok.
  `TestDiskFrontendServesStaticFilesOfKeptReleases` builds `old`, `previous`
  and `new` releases, a staging directory, a directory without `index.html` and
  a `current -> new` link. It requires current files first, then the newest
  kept release, `.br` and non-`/static/` names never taken from kept releases,
  staging and incomplete directories ignored, and `..` names refused both by
  `Open` and by the lookup itself.
  `TestDiskFrontendReadsNoSiblingsOfAPlainDirectory` requires nothing to be
  read beside a directory that is not a symlink.
- `go test ./middleware -run 'ServeFrontendFiles|Cache' -count=1`: ok.
  `TestServeFrontendFilesServesChunksOfKeptReleases` requires a previous
  release's chunk with status 200 and the immutable header, plain, gzip and br;
  a chunk no release has with 404 and `no-store`; and a console route still
  reaching the index handler. `TestServeFrontendFilesCompressesEachFileOnce`
  now expects 404 and `no-store` for a missing `/static/` file, and the HTML
  fallback for a console route.
- With the `Open` change reverted, both kept-release tests fail. With the 404
  reverted, both middleware tests fail.
