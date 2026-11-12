## UXQA 0.5.2

Project repair chat now uses the selected finding, screenshot, project rules,
component catalog and source recheck feedback. It can propose design candidates,
open temporary browser style alternatives and sample interaction animation timing.
It can prepare component plans and, after the user reviews and starts the project
scripts and browser scenario, synchronize the native catalog and specification
when verification passes. Verification screenshots follow 48-hour retention.
Design candidates can cite excerpts read in the current turn and suggest semantic
tokens. Browser alternatives support multiple existing elements in isolated
contexts; motion samples add scroll, reduced-motion emulation and available
main-thread counters. See the product guide for coverage and limitations.
Reviewed code alternatives can temporarily replace same-origin scripts or styles
loaded by the page to compare structure and interactions without editing source.
They run only after the user starts them in a trusted test environment.
Candidates, source checks and browser observations have distinct evidence and
coverage limits. Real accounts, devices, all page states and complete parity with
the three reference projects remain unverified. Download the archive for your
operating system and processor, and verify it using `SHA256SUMS.txt`.

### 中文

项目修复对话结合本轮问题、截图、项目规则和组件目录，支持查看并修改项目文本、生成设计候选、比较临时方案及采样动效。组件同步与可执行代码方案需要用户核对后启动；可执行预览应使用可信测试环境。截图按既有 48 小时规则清理。各项建议、源码检查和页面实测的证据范围不同，真实账号、实际设备及所有页面状态仍需分别验证。

从 Assets 下载对应系统和芯片的安装包及 `SHA256SUMS.txt`；详细步骤见 [中文安装说明](https://github.com/kaxi9527/uxqa/blob/main/docs/install-and-use.md) 和 [English installation guide](https://github.com/kaxi9527/uxqa/blob/main/docs/install-and-use.en.md)。macOS 未公证，Windows 未使用受信任的发布者证书签名；按系统提示核对来源后打开。

## UXQA 0.5.0

### 中文

本版将检查流程整理为项目、检查、问题处理和复检，并把界面与体验诊断知识融入检查与修复方案。首次启动可选择中文或 English，查看访问说明并逐项检查目录；设置显示最近的访问结果，系统授权可能变化。

应用截图和已登记的命令行截图在 48 小时后清理：应用运行时定期检查，关闭期间到期的截图在下次启动或执行检查时处理。报告和手动另存的副本保留；旧自定义输出目录及浏览器 trace 压缩包不会自动发现或清理。

各系统安装与限制详见 [中文安装说明](https://github.com/kaxi9527/uxqa/blob/main/docs/install-and-use.md) 和 [完整中文更新说明](https://github.com/kaxi9527/uxqa/blob/main/docs/release-notes.zh-CN.md)。各平台打包、真实系统授权和订阅登录的验证范围以实际结果为准。

### English

Choose Chinese or English on first launch, review the requested access and check
selected project folders. Settings show the latest observed access and support
rechecking; the operating system owns its grants and they can change. Historical
findings, project content and provider messages retain their original language.

This iteration also adds 48-hour retention for app screenshots and registered
CLI screenshots. Cleanup runs while UXQA is open and on the next launch or CLI
check; findings and manually saved copies remain. Previously unregistered custom
output directories cannot be discovered automatically.

Built-in quality procedures drive
classification, screenshot diagnosis, repair instructions and verification.
Seven new browser checks cover information structure, naming, labels and motion.
Workflow navigation, manual observations, handling records and evidence-aware
rechecks are integrated in UXQA. No external Skill directory or reference browser
is required.

- Native macOS app: Apple Silicon and Intel, macOS 14+.
- Portable Windows x64 and Linux x64/ARM64: bundled runtime, local browser UI.
- Built-in protocol adapters, provider configuration and subscription account
  management, integrated directly into UXQA.
- New interface-inspector icon, contribution guide, issue/PR templates, privacy and
  permissions documentation. Future tags produce the same five-package matrix.

Download the archive matching your computer and verify SHA256SUMS.txt. Unpack the
whole folder. Start UXQA.app on Mac, Open uxqa console.cmd on Windows, or
./open-uxqa-console.sh on Linux. Browser screenshot components are optional and
downloaded only after confirmation.

Build/verification: the release workflow builds and runtime-smokes packages on
their target CI systems. Review the actual workflow result for this version.
Fixture tests do not establish real system permission changes, manual operation on
every OS version or live login with every provider.

Limits: macOS uses ad-hoc signing without
Apple notarization; Windows has no Authenticode signature. Windows ARM64 and Linux
musl have no native package in this release. Subscription access depends on your
account/provider; Claude subscriptions require official Claude Code. Google
subscription sign-in requires an explicitly configured authorized OAuth client;
no third-party Google client credentials are embedded. Direct Gemini API remains
available. AI review
sends selected screenshots/context to the selected provider.

See README for downloads and docs/local-data-and-permissions.md for local storage,
computer permissions, network requests, backup and uninstall instructions.

中文 [安装与使用说明](https://github.com/kaxi9527/uxqa/blob/main/docs/install-and-use.md)：下载包选择、各系统解压启动、首次打开提示、第一次检测、更新与常见问题。无需应用商店，直接下载使用。
