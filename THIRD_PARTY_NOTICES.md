# Third-party notices

UXQA's original code is MIT licensed. Third-party source and bundled dependencies
retain their own licenses and copyright notices.

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

UXQA is independent of model providers. Names identify supported services, not
affiliation or endorsement. Subscription access depends on the provider's current
authorization flow, account entitlement and terms; this project grants no account access.
