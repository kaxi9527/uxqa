# Third-party notices

UXQA's original code is MIT licensed. Third-party source and bundled dependencies
retain their own licenses and copyright notices.

- The local console bundles the official Ant Design 6.7.1 browser distribution,
  React and React DOM 18.3.1, and Day.js 1.11.23. Its combined licenses are in
  `src/ui/web/vendor/antd.min.js.LICENSE.txt` and are served by the packaged
  console at `/vendor/antd.min.js.LICENSE.txt`.

- `native/model-core` contains protocol and subscription authorization source from
  [Magpie](https://github.com/yetone/magpie), MIT, revision
  `51bdc985bc413c9e87a976ba08bcfa1054a0b699`. See its `LICENSE`, `NOTICE.md` and
  `UPSTREAM-MANIFEST.json` for provenance and adaptations. UXQA builds its own
  private entry point; the Magpie application is not shipped or launched.
- Download packages include official Node.js with `runtime/LICENSE`. Bundled
  Playwright, axe-core and TypeScript keep their license files in `app/node_modules`.
  Other bundled JavaScript notices are in `app/THIRD-PARTY-NOTICES.txt`.
- Model-core dependency licenses are collected at build time in
  `model-core/THIRD-PARTY-NOTICES.txt` (inside `Contents/Resources` on macOS).
- Browser components are downloaded separately, with the browser distribution's
  own licenses. Downloading is optional and requires confirmation in the console.
- `assets/icon.png` is an AI-generated UXQA brand image created for this project.
  The supplied design reference was used for mood; it is not included in this repository.

Offline document parsing includes Mozilla PDF.js 6.5.438 (Apache-2.0, with bundled CMap notices) and fflate 0.8.2 (MIT). Their license texts ship alongside the local assets. [PDF.js](https://github.com/mozilla/pdf.js) and [fflate](https://github.com/101arrowz/fflate).

UXQA is independent of model providers. Names identify supported services, not
affiliation or endorsement. Subscription access depends on the provider's current
authorization flow, account entitlement and terms; this project grants no account access.
