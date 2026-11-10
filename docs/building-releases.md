# Building and publishing releases

## Toolchain

Use the pinned pnpm from `package.json`, Node 22 and Go 1.26.8 or newer. macOS native
apps additionally require Xcode command-line tools (Swift, iconutil, codesign).
Dependencies are locked by `pnpm-lock.yaml` and `native/model-core/go.sum`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
cd native/model-core
go mod download
CGO_ENABLED=0 go test -p 2 ./cmd/uxqa-core ./internal/appdir ./internal/provider
```

Build commands below run from the repository root. Model-core builds use cached
modules with `GOPROXY=off`, bounded Go parallelism and the private UXQA entry point.
Tests and releases use `CGO_ENABLED=0` to match the shipped standalone model core.
No account state is copied. Do not package your data directory.

## Native macOS

```sh
node scripts/desktop/build.mjs --out release/macos
node scripts/desktop/smoke.mjs release/macos/UXQA.app /path/to/private/evidence
```

Build separately on Apple Silicon and Intel. The app includes the build host's
official Node runtime, model core, generated icon, purpose strings and license
notices. The minimum deployment target is macOS 14. Local signatures are ad hoc;
Developer ID signing and Apple notarization are not configured in this release.

## Portable Windows / Linux

```sh
node scripts/package/fetch-node.mjs --target linux-x64 --yes
node scripts/package/build.mjs --target linux-x64
node scripts/package/smoke-release.mjs release/uxqa-0.4.0-linux-x64.tar.gz
```

Other targets: `win-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`. Build
and test on the target OS/architecture: source-analysis binaries must match the host.
Node downloads use official HTTPS URLs
and verified SHASUMS256.txt entries. The version-keyed cache defaults to
`~/.cache/uxqa/node-<version>` and can be overridden by `UXQA_NODE_CACHE`.
Do not treat different revisions or architectures as interchangeable.

Each archive includes `runtime`, `app`, `model-core`, launchers, local-data guidance,
licenses and `BUILD-INFO.json`. jscpd and react-scanner include their own runtime
dependencies for source analysis. The browser is an optional separate download; users
see its source and size before agreeing. Linux screenshot capture may additionally
require distribution libraries. `--node` creates explicitly named local development
packages; those are not official release assets.

## GitHub pipeline

`.github/workflows/ci.yml` checks pull requests with read-only permissions. The
release workflow runs on a `v*` tag, verifies it equals `package.json`'s version,
and builds on native macOS arm64/x64, Windows x64 and Ubuntu x64/arm64 runners.
Alternatively, dispatch Release on `main` with `create_release=true`; after the
same verification gates it creates the version tag and draft at that exact commit.
Publishing a new draft tag can trigger the tag workflow once more. Its preflight
recognizes an already published version and skips duplicate builds/uploads, keeping
the verified public assets immutable. A build-only manual dispatch still runs checks.
The full JavaScript unit suite runs on POSIX hosts (it includes POSIX mode/symlink
fixtures); Windows runs typechecking, model-core tests and packaged-runtime smoke.
Fixture-based runtime smoke tests use temporary account directories and no real
provider credentials. Browser/model tests do not assert live subscription entitlement.

Only after all build jobs pass does the workflow assemble SHA256SUMS.txt and create
a **draft** Release. The maintainer verifies the artifacts and publishes the draft.
This is a release verification gate, independent of PR readiness. Never publish a
partial matrix as complete. Record manual OS testing separately from CI execution.

To release a new version, update `package.json`, download links and release notes,
run checks, commit, tag `v<version>` and push the tag. Existing releases remain
available for users choosing an older version. Use a fresh version for changed
binaries; do not silently replace published assets.

## Checksums

```sh
shasum -a 256 UXQA-0.4.0-macOS-arm64.zip  # macOS
sha256sum uxqa-0.4.0-linux-x64.tar.gz     # Linux
```

PowerShell: `Get-FileHash .\uxqa-0.4.0-win-x64.zip -Algorithm SHA256`.
Compare with the matching line in the Release's SHA256SUMS.txt. A matching hash
detects a changed download; it does not replace publisher signing or code review.
