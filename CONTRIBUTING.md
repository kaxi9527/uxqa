# Contributing to UXQA

Issues, documentation improvements, reproducible bug reports and pull requests are
welcome. You do not need write access: fork this repository, create a branch in your
fork, then open a normal pull request targeting `main`.

1. Check existing issues first. For a large behavior change, describe the problem
   and proposed scope in an issue before implementing it.
2. Use Node 22+, the pinned pnpm version in `package.json`, and Go 1.26.8+ for the
   model core. Run `pnpm install --frozen-lockfile`. Do not commit dependencies.
3. Change the smallest relevant surface. Preserve deterministic checks, explicit
   download consent, localhost/token protection and independent local account state.
4. For web console changes, run `node scripts/embed-ui.mjs`. Run `pnpm typecheck`,
   `pnpm test`, and `pnpm build`. For the model core, run
   `go test ./cmd/uxqa-core ./internal/appdir ./internal/provider` in `native/model-core`.
5. Describe the user-visible change, validation and limitations in your PR. UI
   changes should include screenshots using synthetic data. Platform changes should
   name the OS/architecture actually tested.

Never include API keys, account tokens, `.uxqa`, browser storage-state files, private
URLs or private screenshots. For security issues, use [SECURITY.md](SECURITY.md).
Tests should use fixtures, not paid services or personal accounts. Public CI never
needs a model API key. Fork PR checks have read-only permissions and no release secrets.

The maintainer reviews and merges contributions; submitting a PR does not bypass
review. By contributing you agree that your original contributions are provided
under the project's MIT license. Retain third-party notices. Treat other contributors
respectfully and keep feedback specific to the work.

Release maintainers: see [packaging](docs/building-releases.md) for tag/version validation,
platform builds, checksums and the draft-to-public release gate.
