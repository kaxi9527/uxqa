# 本地运行、数据与电脑权限 / Local data and permissions

首次下载请先看 [安装与使用说明](install-and-use.md)，按你的系统完成解压、首次启动和第一次检测。

## 中文速读

- **怎么运行**：Mac 打开 `UXQA.app`；Windows 解压后双击 `Open uxqa console.cmd`；Linux 运行 `./open-uxqa-console.sh`。安装包自带 Node 和 UXQA 模型模块。Windows/Linux 使用浏览器显示本机界面，终端要保持打开。
- **需要什么权限**：读取你选中的项目目录、在自己的用户目录保存配置和报告、访问你填写的预览网址。截图由浏览器完成，无需系统录屏、辅助功能、全盘访问、摄像头、麦克风或管理员权限。保存项目规则、基线或执行组件同步时才会写入对应项目文件。
- **数据放哪里**：Mac/Linux 默认 `~/.uxqa`，Windows 默认 `%USERPROFILE%\.uxqa`。模型与订阅账号保存在其中的 `model-core`；直接 API 设置在 `ai.json`。命令行报告还可能保存在你指定的 `--out` 目录。凭据是本地文件，不等于经过系统钥匙串加密，不要上传整个数据目录。
- **截图保留（0.5.0 起）**：应用截图和已登记的命令行截图按文件最后修改时间保留 48 小时；应用运行时每分钟检查，关闭期间到期的截图在下次启动应用或运行检查命令时清理。命令行会核对文件身份，保留后来修改或替换的文件；默认输出目录中可由历史报告确认的截图会在下次命令行检查时登记。旧自定义输出目录无法自动发现。检查记录、对比数值、非截图报告、手动另存的副本和项目文件保留；清理后需重新检测生成截图。浏览器 trace 压缩包不会被此规则删除，可能包含截图。
- **什么时候联网**：打开预览页面会访问该页面及其资源；安装截图浏览器会从提示的官方来源下载；登录订阅会访问服务商。启用 AI 看图复核会发送所选截图和复核上下文。0.5.2 起，项目修复对话会把本轮问题摘要、对话、实际读取的项目文件及预览资源片段发送给所选模型；有可用截图时默认附上，可手动取消。连接测试发送固定测试图。
- **模型登录限制**：ChatGPT/Codex、Copilot 等需要有效的个人账号与套餐；Claude 还需要已安装官方 Claude Code。公开版不内置其他应用的 Google OAuth 客户端信息，Gemini Code Assist/Antigravity 订阅登录需要自行配置获准使用的客户端；Gemini API 协议可以独立使用。
- **退出和更新**：Mac 按 ⌘Q；Windows/Linux 在启动终端按 Ctrl+C。只关浏览器标签页不会停止服务。更新前退出并备份数据，再替换应用或解压新版；历史版本可在 Releases 中选择。
- **备份与卸载**：退出后，把自己的数据目录、项目规则和所需报告备份到私密加密位置。删除应用不会自动删除数据；需要时另行删除自己的 UXQA 数据。Playwright 浏览器缓存可能与其他工具共用，不要盲目删除。
- **首次打开被拦截**：先核对发布来源和 `SHA256SUMS.txt`。本版 Mac 未经 Apple 公证，Windows 没有可信发布者签名；使用系统针对该文件的正常信任入口，不要全局关闭安全保护。受管理电脑不允许未签名软件时，请由管理员处理。

以下英文详细说明列出完整目录、网络去向和权限恢复方式。

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
| Project repair agent (0.5.2+) | Read, edit or create text files within the selected project without per-path setup | Review recorded operations and recheck. Original text is backed up locally; unchanged agent-created files can be undone |
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
| Access observations and language choice (0.5.0+) | `access-settings.json` in the UXQA data root; stores selected paths, last observed status and time, language, and setup completion—not a copy of system permission settings |
| Issue handling, manual observations and diagnostic plans | Under the same data root: `projects/<id>/issue-workflow.json`, `projects/<id>/diagnoses/` and per-plan evidence history in `projects/<id>/diagnosis-verification/`; separate from original check rounds |
| Project repair conversations and original source backups (0.5.2+) | `project-agent/` and `project-agent-backups/` under the same data root; may contain project conversation and source text |
| Model settings, API keys, subscription tokens and model cache | Within the same data root; source-integrated account store is `model-core/` |
| Project rules / accepted baseline | Selected project's `.uxqa/rules.json` / `.uxqa/baseline.json`, when explicitly saved |
| CLI reports and screenshots | The `--out` directory or printed artifact path; these can be outside `~/.uxqa` |
| Browser binaries | macOS `~/Library/Caches/ms-playwright`; Windows `%LOCALAPPDATA%\ms-playwright`; Linux `~/.cache/ms-playwright` |

From 0.5.0, app screenshots and registered CLI screenshots expire 48 hours after their last modification time. UXQA checks every minute while open and catches up on the next launch or CLI check. CLI cleanup verifies file identity and retains files subsequently modified or replaced. Unchanged screenshots identified by historical reports in the default output directory are registered on the next CLI check; undiscovered old custom output directories cannot be recovered automatically. Findings, comparison values, non-image reports, manually saved copies and project files remain. Browser trace archives are retained and may contain screenshots.

`UXQA_HOME` overrides the UXQA data root. `PLAYWRIGHT_BROWSERS_PATH` overrides the
browser cache. A project entry references the existing source folder; it does not
copy or upload the whole repository. Reports can contain absolute source paths,
page URLs, screenshot content and request/trace evidence. Treat reports and browser
storage-state files as potentially private before sharing them.

本地迭代中的首次引导允许逐个检查用户输入的项目目录；检查时实际打开目录并记录结果，不保存目录清单。UXQA 会在启动时重新检查之前可访问的位置，在开始项目检查时检查该项目；设置中可手动重试或仅移除访问记录。结果不是 macOS 系统授权清单，也不保证未来仍可访问。目录移动、网络卷不可用和权限拒绝分别显示；此机制不是实时权限监控。自动项目发现只会在用户点击扫描后读取 `~/Projects`。

API keys and subscription tokens are local credential files, **not a promise of
keychain-backed encryption**. Do not commit, upload or place the data root in a
shared sync folder. Removing an account deletes UXQA's local saved account;
revoking the provider's authorization is a separate action in that provider's settings.
UXQA does not import or share another application's login directory.

专项诊断读取本地检查记录、项目依赖清单和内置知识，在上述数据目录保存方案；不发送模型请求、不运行工程脚本、不修改项目源码。可选 AI 截图复核和复制方案后交给其他 AI 的行为另按下面的联网说明处理。

## 哪些功能联网、发送什么

| Feature | Destination and data |
| --- | --- |
| Source-only rules | No remote model request; reads local code and produces local findings |
| Page inspection | Your selected URL and the page's own third-party resources; normal browser traffic |
| Browser installation | Official Playwright/CDN URLs displayed before consent; browser download request |
| Direct AI review | Selected provider/base URL; selected screenshots, review instructions and relevant rule/finding context |
| Project repair conversation (0.5.2+) | Selected model provider; conversation, up to 30 selected-round findings, project files and preview-resource excerpts read by the agent; an available screenshot is attached by default and can be deselected |
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
