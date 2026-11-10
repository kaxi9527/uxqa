# 本地运行、数据与电脑权限 / Local data and permissions

UXQA runs its inspection engine and stores its project records on your computer.
“Local” does not mean every feature is offline: opening a website, downloading a
browser, signing in to a provider and using an AI model make network requests.
There is no UXQA cloud account, telemetry uploader or mandatory cloud sync.

## 电脑权限

| Operation | Access needed | When / how to decline |
| --- | --- | --- |
| Source inspection | Read the project folder you select | Choose a folder you can read; deny protected-folder access to skip that project |
| Save evidence and settings | Write your own UXQA data folder | Use a writable user folder; no administrator account needed |
| Save rules/baselines; component sync | Write the selected project's named rule/catalog files | Only when explicitly saving rules, accepting a baseline or running component-sync; ordinary scans read source |
| Page screenshots | Run UXQA's Playwright browser and visit your configured URLs | Optional browser download requires confirmation; source inspection still works without it |
| Model connection and subscription login | Outbound HTTPS and a local callback where required | Optional; select no AI review to keep deterministic checks independent |
| LAN preview URL | Connect to that device on your local network | Only needed for a LAN preview; macOS may ask Local Network permission |

UXQA does **not require Full Disk Access, Accessibility, Screen Recording,
camera, microphone, contacts or administrator access**. Page screenshots come
from the browser, not from recording your desktop. Do not grant broader permissions
to work around a folder error; move a test project to an accessible user folder.
The app is not an OS sandbox: it runs with your user's ordinary permissions.
On Unix, UXQA creates its private state directories/files with restrictive modes;
Windows uses your user profile's ACLs. It does not replace OS disk encryption.

macOS app bundles include purpose descriptions for selected projects in Documents,
Desktop, Downloads, network/removable volumes and LAN preview access. The OS
controls whether and when a prompt appears. Re-enable a denied permission in
System Settings → Privacy & Security → Files and Folders / Local Network, then
reopen the app. Folder selection by path is currently used; access is not a
persistent security-scoped bookmark.

On Windows, extract to your own user folder and run `Open uxqa console.cmd` as
your normal user. UXQA binds its console and model runtime to `127.0.0.1`; it does
not require an inbound public-network firewall exception. A browser's localhost
permission prompt depends on that browser. Do not expose or forward these ports.

On Linux, source checks run without elevated access. Screenshot capture may need
distribution-provided Chromium shared libraries. On supported Debian/Ubuntu systems,
an administrator may install those with Playwright's `install-deps chromium` command;
that changes system packages and is optional. UXQA itself must run as your normal user.

## 本地数据位置

| Data | Default location |
| --- | --- |
| Project list and console evidence | macOS/Linux `~/.uxqa`; Windows `%USERPROFILE%\.uxqa` |
| Model settings, API keys, subscription tokens and model cache | Within the same data root; source-integrated account store is `model-core/` |
| Project rules / accepted baseline | Selected project's `.uxqa/rules.json` / `.uxqa/baseline.json`, when explicitly saved |
| CLI reports and screenshots | The `--out` directory or printed artifact path; these can be outside `~/.uxqa` |
| Browser binaries | macOS `~/Library/Caches/ms-playwright`; Windows `%LOCALAPPDATA%\ms-playwright`; Linux `~/.cache/ms-playwright` |

`UXQA_HOME` overrides the UXQA data root. `PLAYWRIGHT_BROWSERS_PATH` overrides the
browser cache. A project entry references the existing source folder; it does not
copy or upload the whole repository. Reports can contain absolute source paths,
page URLs, screenshot content and request/trace evidence. Treat reports and browser
storage-state files as potentially private before sharing them.

API keys and subscription tokens are local credential files, **not a promise of
keychain-backed encryption**. Do not commit, upload or place the data root in a
shared sync folder. Removing an account deletes UXQA's local saved account;
revoking the provider's authorization is a separate action in that provider's settings.
UXQA does not import or share another application's login directory.

## 哪些功能联网、发送什么

| Feature | Destination and data |
| --- | --- |
| Source-only rules | No remote model request; reads local code and produces local findings |
| Page inspection | Your selected URL and the page's own third-party resources; normal browser traffic |
| Browser installation | Official Playwright/CDN URLs displayed before consent; browser download request |
| Direct AI review | Selected provider/base URL; selected screenshots, review instructions and relevant rule/finding context |
| Model connection test | Selected provider; a fixed small test image and test prompt |
| Subscription authorization/model discovery | Selected provider's login/token/model APIs; authorization and account metadata required by that flow |
| MCP / external assistant | The assistant you configure receives tool results/review tasks; its own privacy policy applies |
| GitHub downloads | GitHub receives ordinary download requests; UXQA has no background self-updater |

AI review is optional and advisory. Select “不用” in AI settings to disable it.
Using a provider subscription does not make inference local: the provider still
receives the request and applies its own usage limits, billing and retention rules.
Subscription authorization is completed on the provider's website. Claude
subscription support requires an already-installed official Claude Code runtime;
UXQA does not silently install it. Public builds require your own authorized Google
OAuth client configuration for Gemini Code Assist / Antigravity subscriptions;
see [model setup](product-guide.md). Direct Gemini API access is independent.
Availability must be verified on your account.

## 退出、备份、更新与卸载

- macOS: Quit UXQA (⌘Q). Closing the last window quits the app and its own services.
- Windows/Linux portable UI: keep the launcher terminal open; press Ctrl+C to stop.
  Closing a browser tab alone does not stop the terminal's service. A model child
  also exits when its parent pipe closes. Reopen with the launcher to obtain a fresh
  private console URL; do not share that URL, which contains a session token.
- Back up after quitting: copy your UXQA data root, selected project rules and any
  reports you wish to keep to a private encrypted backup. Restore only your own
  trusted backup. Do not send credential backups in bug reports.
- Update: quit, download the new version, verify its checksum, replace the app or
  extract the new portable folder. User data is separate from the downloaded app.
  Keep a private backup before trying a new release; downgrade compatibility is
  not guaranteed when a future release changes the data format.
- Uninstall: quit and remove the application/package folder. To remove records
  too, separately remove **your UXQA data root** and selected report directories.
  Browser caches may be shared with other Playwright tools; do not delete them
  without checking other consumers. Project source files are not removed by uninstall.

## 下载信任与支持范围

Check the Release's SHA256SUMS.txt before opening a package. macOS builds have an
ad-hoc signature, not an Apple Developer ID or notarization. Windows packages have
no Authenticode signature. OS download-protection warnings are therefore possible.
Only proceed through the OS's normal “Open Anyway” / trusted-file UI after checking
the source and checksum; do not disable Gatekeeper, antivirus or firewall globally.
If your managed computer disallows unsigned apps, ask its administrator or build
from source. A successful CI build does not mean every OS version or login provider
has been manually verified. See the Release notes for exact validation coverage.
