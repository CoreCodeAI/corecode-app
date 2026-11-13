FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS builder

WORKDIR /build/web
COPY ./web ./
COPY ./VERSION /build/VERSION
# VERSION ships empty; CI writes it before building. The fallback keeps a local
# build from stamping an empty version into the console bundle.
ARG BUILD_VERSION=dev
# Install, build and remove node_modules (over 300 MB) in one step, so it never
# becomes a layer: the registry cache would otherwise compress and push it on
# every build, and pull and unpack it on a hit, which took longer than a fresh
# install. The mount persists on a builder that keeps its state, as the release
# builder in corecode-infra does.
RUN --mount=type=cache,id=new-api-bun,target=/root/.bun/install/cache \
    if [ ! -s /build/VERSION ]; then printf '%s' "$BUILD_VERSION" > /build/VERSION; fi \
    && bun install --frozen-lockfile \
    && DISABLE_ESLINT_PLUGIN='true' VITE_REACT_APP_VERSION=$(cat /build/VERSION) bun run build \
    && rm -rf node_modules

FROM golang:1.26.10-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS builder2
ENV GO111MODULE=on CGO_ENABLED=0 GOWORK=off

ARG TARGETOS
ARG TARGETARCH
ENV GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64}
ENV GOEXPERIMENT=greenteagc

WORKDIR /build

ADD go.mod go.sum ./
# relaykit and tokenkit are local submodules referenced via replace; their
# go.mod files must be present for go mod download to resolve the main module graph.
ADD relaykit/go.mod ./relaykit/go.mod
ADD tokenkit/go.mod ./tokenkit/go.mod
# The module cache and the build cache are the two costs of a Go build: the
# first avoids re-downloading dependencies, the second reuses compiled packages.
# `go mod download` fetches the module graph, which is what gives the module a
# directory; without it `go list -m {{.Dir}}` for the PGO module prints nothing
# and the build reads a profile from "/default.pgo".
RUN --mount=type=cache,id=new-api-go-mod,target=/go/pkg/mod \
    go mod download \
    && go mod download github.com/MoeForge/moejs \
    && pgo_dir=$(go list -m -f '{{.Dir}}' github.com/MoeForge/moejs) \
    && test -n "$pgo_dir" \
    && cp "$pgo_dir/default.pgo" /build/default.pgo \
    && echo "build: PGO profile copied from $pgo_dir"

COPY . .
# Only the main package embeds web/dist, so every other package compiles here,
# alongside the console stage instead of after it. The flags match the final
# build (-ldflags only affect linking), so that build finds these packages in
# the build cache and compiles just the main package. `go list -e` tolerates the
# main package's embed pattern having nothing to match yet.
RUN --mount=type=cache,id=new-api-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=new-api-go-build,target=/root/.cache/go-build \
    set -eu; \
    go build -pgo=/build/default.pgo \
      $(go list -e -deps . | grep -vx 'github.com/QuantumNous/new-api')
COPY --from=builder /build/web/dist ./web/dist
# Same fallback as the console stage: the Go binary stamps the version too.
ARG BUILD_VERSION=dev
RUN if [ ! -s VERSION ]; then printf '%s' "$BUILD_VERSION" > VERSION; fi
RUN --mount=type=cache,id=new-api-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=new-api-go-build,target=/root/.cache/go-build \
    set -eu; \
    test -s /build/default.pgo; \
    go build -pgo=/build/default.pgo \
      -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=$(cat VERSION)'" -o new-api

# The console alone, for a deployment that serves it from disk (FRONTEND_DIR)
# and releases it without replacing the server: `docker build --target console`.
FROM scratch AS console
COPY --from=builder /build/web/dist /console

FROM debian:bookworm-slim@sha256:f06537653ac770703bc45b4b113475bd402f451e85223f0f2837acbf89ab020a
# The relay host checks these before a release: drain lets it wait for admitted
# requests, and cordon lets it run a new instance beside this one and move new
# requests over first (pkg/deployment).
LABEL live.corecode.deployment-drain="1" \
      live.corecode.deployment-cordon="1"

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata libasan8 wget \
    && rm -rf /var/lib/apt/lists/* \
    && update-ca-certificates

COPY --from=builder2 /build/new-api /
COPY LICENSE NOTICE THIRD-PARTY-LICENSES.md /licenses/
EXPOSE 3000
WORKDIR /data
ENTRYPOINT ["/new-api"]
