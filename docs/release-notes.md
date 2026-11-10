UXQA's first public release combines deterministic frontend checks, local browser
evidence and an optional model access center in one product.

- Native macOS app: Apple Silicon and Intel, macOS 14+.
- Portable Windows x64 and Linux x64/ARM64: bundled runtime, local browser UI.
- Built-in protocol adapters, provider configuration and independent subscription
  account management. No separate Magpie application is needed.
- New interface-inspector icon, contribution guide, issue/PR templates, privacy and
  permissions documentation. Future tags produce the same five-package matrix.

Download the archive matching your computer and verify SHA256SUMS.txt. Unpack the
whole folder. Start UXQA.app on Mac, Open uxqa console.cmd on Windows, or
./open-uxqa-console.sh on Linux. Browser screenshot components are optional and
downloaded only after confirmation.

Build/verification: each package is built and runtime-smoked on its native CI
OS/architecture. Fixture tests check CLI/UI, authentication, independent accounts,
provider/model discovery and shutdown. These are automated runner checks, not a
claim of manual testing on every OS version or live login with every provider.

Limits: interface copy is currently Chinese. macOS uses ad-hoc signing without
Apple notarization; Windows has no Authenticode signature. Windows ARM64 and Linux
musl have no native package in this release. Subscription access depends on your
account/provider; Claude subscriptions require official Claude Code. Google
subscription sign-in requires an explicitly configured authorized OAuth client;
no third-party Google client credentials are embedded. Direct Gemini API remains
available. AI review
sends selected screenshots/context to the selected provider.

See README for downloads and docs/local-data-and-permissions.md for local storage,
computer permissions, network requests, backup and uninstall instructions.
