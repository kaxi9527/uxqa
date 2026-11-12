# 安装与使用 / Install and use

[English installation, use, and update instructions](install-and-use.en.md)

UXQA 通过 GitHub 提供下载，直接解压安装，不需要应用商店。下载包自带运行环境和模型模块，无需另外安装 Node.js，也不需要注册 UXQA 账号。AI 功能可以稍后配置。

本说明对应 **v0.5.2**，较早版本的功能可能不同。以[下载页](https://github.com/kaxi9527/uxqa/releases)实际列出的版本为准，展开页面下方的 **Assets**，选择下面对应的文件；`Source code (zip)` / `Source code (tar.gz)` 是开发源码，不是可直接运行的应用。

## 1. 选择下载包

| 你的电脑 | 下载文件 |
| --- | --- |
| Mac，Apple 芯片（M 系列），macOS 14 或更高 | UXQA-0.5.2-macOS-arm64.zip |
| Mac，Intel 芯片，macOS 14 或更高 | UXQA-0.5.2-macOS-x64.zip |
| Windows 11 或更高，Intel / AMD x64 | uxqa-0.5.2-win-x64.zip |
| Linux，x86_64 / amd64，glibc | uxqa-0.5.2-linux-x64.tar.gz |
| Linux，aarch64 / arm64，glibc | uxqa-0.5.2-linux-arm64.tar.gz |

Mac 在“ → 关于本机”查看芯片；Windows 在“设置 → 系统 → 系统信息”查看系统类型；Linux 运行 `uname -m`。Linux 建议使用 Ubuntu 22.04 / 24.04 桌面环境。此版本没有 Windows ARM64 原生包，不支持 Alpine / musl。

同时下载 SHA256SUMS.txt。在压缩包所在文件夹打开终端，运行对应命令，将输出与校验文件中**同名文件**的 64 位摘要逐字比较；不一致就重新下载，不要继续打开。

```sh
# macOS；Intel 包请换成对应文件名
shasum -a 256 UXQA-0.5.2-macOS-arm64.zip
# Linux；ARM64 包请换成对应文件名
sha256sum uxqa-0.5.2-linux-x64.tar.gz
```

```powershell
# Windows PowerShell
Get-FileHash .\uxqa-0.5.2-win-x64.zip -Algorithm SHA256
```

## 2. 安装并打开

### macOS

1. 双击 ZIP 解压，得到 `UXQA.app`。
2. 将 `UXQA.app` 拖到“应用程序”。如果没有该目录的写入权限，可放到自己用户目录下的 `Applications` 文件夹。
3. 双击 `UXQA.app`。成功后会看到 UXQA 独立窗口及“添加项目”入口。
4. 首次打开若提示“无法验证开发者”或“Apple 无法检查是否包含恶意软件”，先关闭提示，再进入 **系统设置 → 隐私与安全性 → 安全性 → 仍要打开**，确认应用名称是 UXQA，再按系统提示打开。只在已核对本仓库下载来源及摘要后使用这个针对该应用的入口。[Apple 操作说明](https://support.apple.com/en-us/102445)

此下载版没有 Apple 公证，首次打开可能需要上述确认；以后正常双击即可。若提示“已损坏”，先重新下载、核对摘要并重新解压；若系统明确报出恶意软件，或受管理电脑没有“仍要打开”，停止并联系管理员或反馈问题，不要全局关闭系统保护。

退出使用 **⌘Q / UXQA → 退出**，不要只关闭窗口后就替换程序文件。

### Windows

1. 右键 ZIP → **全部解压缩**，放到自己可写的目录，例如“文档”下的 `UXQA` 文件夹。不要在 ZIP 预览窗口里直接运行。
2. 打开解压后的 `uxqa-0.5.2-win-x64` 文件夹，双击 **`Open uxqa console.cmd`**。
3. 会出现终端窗口，并在默认浏览器打开 UXQA 本机界面。使用期间保留该终端窗口；它是 UXQA 的本地服务。
4. 若出现“Windows 已保护你的电脑”，核对来源与摘要后，在提示中选择 **更多信息 → 仍要运行**（系统提供该选项时）。企业策略、S 模式或 Smart App Control 可能不提供单次放行入口；此时由管理员处理，不要关闭整机防护。[Microsoft 说明](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)

`runtime`、`app`、`model-core` 和启动脚本必须保留在同一个解压目录里。无需使用“以管理员身份运行”，也无需修改 PowerShell 执行策略。

退出时在启动终端按 **Ctrl+C**，若询问是否终止批处理则确认；只关浏览器标签页不会退出 UXQA。

### Linux

在下载的压缩包所在目录打开终端，按自己的架构执行一组命令。

```sh
# x64
tar -xzf uxqa-0.5.2-linux-x64.tar.gz
cd uxqa-0.5.2-linux-x64
./open-uxqa-console.sh
```

```sh
# ARM64
tar -xzf uxqa-0.5.2-linux-arm64.tar.gz
cd uxqa-0.5.2-linux-arm64
./open-uxqa-console.sh
```

浏览器会打开本机界面，保留启动终端，退出时按 **Ctrl+C**。不要用 `sudo` 启动 UXQA。若解压工具丢失执行权限，在解压目录执行以下命令后重试：

```sh
chmod u+x open-uxqa-console.sh uxqa runtime/node model-core/uxqa-model-core
```

首次截图若报缺少 Linux 系统库，在受支持的 Debian / Ubuntu 系统中，可以在解压目录运行以下命令。它通过包管理器安装 Chromium 所需的系统依赖，会请求管理员权限；日常运行 UXQA 不需要此权限。[Playwright 依赖说明](https://playwright.dev/docs/browsers#install-system-dependencies)

```sh
sudo ./runtime/node ./app/node_modules/playwright-core/cli.js install-deps chromium
```

## 3. 完成第一次检查

1. 点击 **添加项目**，选择发现的本地前端项目，或填写项目文件夹的完整路径；需要已有源码目录。
2. 可以先进行源码检查。如果需要检查网页，按项目自己的说明启动预览服务，再把可在浏览器打开的地址（例如 `http://localhost:5173`）填入 UXQA 的预览地址。
3. 点击 **开始检测**。首次需要截图时，按提示查看浏览器组件的下载来源、大小并确认下载；完成后按界面提示继续或重新检测。不下载浏览器组件仍可检查源码。
4. 查看问题列表、文件位置和截图。修改项目后，再运行一次检测验证结果。没有预览地址或浏览器组件时，不要将“只有源码结果”当作网页检查已通过。

浏览器组件是 UXQA 用来截图的工具，与 Windows/Linux 用来显示控制台的系统浏览器用途不同。

**可选：连接模型。** 打开 **设置 → AI 看图复核 → 模型与账号**，配置 API 或登录自己的订阅账号，获取模型、选定支持图片的模型、测试并保存。不使用 AI 时，源码与规则检查仍可运行。Claude 订阅需要官方 Claude Code；Google 订阅需要自行配置获准使用的 OAuth 客户端；具体方法见 [模型接入说明](https://github.com/kaxi9527/uxqa/blob/main/docs/product-guide.md)。

## 4. 权限、数据与常见问题

项目内依次使用「检查 → 问题处理 → 复检」。0.5.2 的项目修复对话可结合问题和截图读取、修改项目文本；请核对修改并重新检查页面。具体步骤和限制见 [使用说明](product-guide.zh-CN.md)。

- **目录访问**：只在使用相应项目时允许读取该目录。无需全盘访问、辅助功能、系统录屏、摄像头或麦克风。写规则、基线、组件同步和项目修复 Agent 的修改会写入项目。
- **macOS 位置授权**：访问桌面、文稿、下载等受保护位置时，系统可能提示授权，通常会保存你的选择；系统设置、应用更新或位置变化后仍可能需要重新检查。前往“系统设置 → 隐私与安全性 → 文件与文件夹”查看或调整，单次读取成功只代表当时该位置可访问。
- **本地网络**：只有检查局域网中的预览网址时，才可能需要系统的本地网络许可。UXQA 控制台默认只监听本机，不需要开放公网入站端口。
- **没有自动打开网页**：确认启动终端仍在运行，复制终端显示的完整本机 URL 到浏览器，不要自行改端口；若终端有报错，先处理报错。
- **Windows 窗口退出 / 提示找不到文件**：确认已完整解压，且 `runtime`、`app`、`model-core` 未被移动或删除；在终端启动脚本可查看报错。
- **页面无法连接 / 没有截图**：先用普通浏览器打开项目预览地址，确认预览服务在运行；然后检查截图浏览器是否下载完成。网络失败可在连接恢复后重试。
- **模型为空 / 登录过期**：在“模型与账号”中重新授权，再获取模型并测试；接口可连接不等于账号有模型权限。
- **数据位置**：Mac/Linux 默认 `~/.uxqa`，Windows 默认 `%USERPROFILE%\.uxqa`。账号凭据也在本地数据目录内。AI 复核和项目修复会将对应截图、对话以及实际读取的项目文件或预览资源片段发送给所选模型服务。
- **截图清理（0.5.0 起）**：应用截图和已登记的命令行截图保留 48 小时，运行时定期清理；关闭期间到期的在下次启动或运行检查命令时清理。检查记录、非截图报告和手动另存的副本保留；旧自定义输出目录无法自动发现。trace 压缩包可能包含截图且不自动删除。
- **更新**：退出 UXQA，备份自己的数据目录，下载新版并完整解压。Mac 替换应用；Windows/Linux 将新版放到新目录运行，不要混合两个版本的文件。
- **卸载**：退出后删除应用或解压目录即可；项目与用户数据不会自动删除。要清除数据时先备份，再单独处理自己的数据目录。

详细目录、联网范围与备份方法见 [本地数据与权限说明](https://github.com/kaxi9527/uxqa/blob/main/docs/local-data-and-permissions.md)。仍无法使用时，到 [Issues](https://github.com/kaxi9527/uxqa/issues) 附上系统版本、芯片架构、下载文件名、操作步骤和脱敏后的报错。不要上传 API Key、登录令牌、完整账号目录或私密项目截图。

五种下载包已通过各自系统/架构的自动构建和包运行检查，Mac Apple 芯片包还经过实际下载后的本机运行验证；具体企业策略和所有系统版本无法逐一覆盖。
