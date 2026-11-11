# Install, use, and update UXQA

UXQA is distributed directly through GitHub Releases; no app store or UXQA account is required. The bundles include their own runtime and model module. Download the archive for your operating system and processor, and keep all extracted files together. This guide describes v0.5.0; earlier downloads may have different features.

## Download and verify

Open [Releases](https://github.com/kaxi9527/uxqa/releases), expand **Assets**, and choose the archive matching your computer. The target platforms are macOS 14+ for Apple Silicon and Intel, Windows 11+ x64, and Linux glibc x64 and ARM64. Check the assets actually available for the selected version. Windows ARM64 and Linux musl are not provided. `Source code` archives are for developers and are not runnable downloads.

Download `SHA256SUMS.txt` from the same release. In the download folder, compute the archive's SHA-256 and compare it with the matching filename in the checksum file. If they differ, download again before opening it.

```sh
# macOS
shasum -a 256 UXQA-0.5.0-macOS-arm64.zip
# Linux
sha256sum uxqa-0.5.0-linux-x64.tar.gz
```

```powershell
# Windows PowerShell
Get-FileHash .\uxqa-0.5.0-win-x64.zip -Algorithm SHA256
```

Substitute the actual archive name where necessary.

## Install and open

- **macOS:** Extract the ZIP, move `UXQA.app` to Applications or your own `Applications` folder, and open it. The app uses an ad-hoc signature and is not notarized. If macOS blocks it, use the system's Privacy & Security controls after verifying the archive and publisher information. Do not disable system security globally.
- **Windows:** Extract the complete ZIP to a folder you can write to, then run `Open uxqa console.cmd`. Keep the launcher window open. Windows may warn because the package is not Authenticode-signed; verify the archive before deciding whether to continue.
- **Linux:** Extract the complete archive and run `./open-uxqa-console.sh`. Keep the terminal open; use Ctrl+C to stop it. Do not run the app with `sudo`. If extracted files lost executable permissions, run `chmod u+x open-uxqa-console.sh uxqa runtime/node model-core/uxqa-model-core` in the extracted folder. On supported Debian/Ubuntu systems, the optional screenshot browser may require system packages; the browser installer explains the required administrator action.

The Windows and Linux packages open a local browser interface; macOS uses a native window. UXQA listens on the local computer and does not require a public inbound port.

## First review

Add an existing project folder, inspect its component library and project rules, then start a source check. To inspect rendered pages, start the project's preview server and configure its URL. The optional screenshot browser is downloaded only after confirmation; source checks do not require it. Review the findings and evidence, make changes in your project, and run the same checks again. An unvisited route or missing screenshot is not a passed page review.

In 0.5.0, use **Project → Check → Issue handling → Recheck**. The embedded quality knowledge supports classification and repair plans. Individual verification records are supplied by their author and do not themselves constitute automatic test results. See [quality workflow](quality-workflow.md) for current source behavior.

AI review is optional. Configure an API provider or connect your own supported subscription account in model settings, fetch models, select a vision-capable model, test it, and save. Connecting successfully does not establish that every model or subscription feature is available. Claude subscriptions require the official Claude Code runtime; Google subscription authorization requires an appropriately configured OAuth client.

## Access, data, and recovery

UXQA reads selected project folders. It writes to a project only for explicitly requested actions such as saving project rules, recording baselines, or component sync. On macOS, protected folders such as Desktop, Documents, and Downloads may produce a system prompt when accessed. The system normally remembers your choice, but permissions or folder availability can change. Review the application's access in **System Settings → Privacy & Security → Files and Folders** if access is denied. A successful folder check records accessibility at that time; it is not a permanent grant or proof that all other locations are accessible.

The optional LAN preview can require local-network access. UXQA does not need camera, microphone, accessibility, full-disk access, or system screen-recording permission for normal checks. Browser screenshots capture the configured web page, not the computer's screen. Review [local data and permissions](local-data-and-permissions.md) for exceptions, network details, and platform-specific behavior.

Data is stored under `~/.uxqa` on macOS/Linux or `%USERPROFILE%\.uxqa` on Windows, unless `UXQA_HOME` is set. Credentials are local files, not a promise of keychain-backed encryption. Optional AI review sends selected screenshots and context to the chosen provider. Never include credentials, private project data, or sensitive screenshots in a public issue.

From 0.5.0, app screenshots and registered CLI screenshots expire after 48 hours. Cleanup runs while UXQA is open and catches up on the next launch or CLI check. Findings, non-image reports and manually saved copies remain. Old custom output directories cannot be discovered automatically; retained browser trace archives may contain screenshots.

## Update or uninstall

Quit UXQA and back up your data directory before updating. Download and verify the new release. On macOS, replace the app; on Windows/Linux, extract the new release into a new directory instead of mixing files from different versions. System trust prompts or folder permissions can need attention again after an update. Deleting the application does not automatically delete your projects or local data; back up first if you decide to remove the data directory separately.

For detailed Chinese instructions and troubleshooting, see [安装与使用](install-and-use.md). Report problems through [GitHub Issues](https://github.com/kaxi9527/uxqa/issues) with the operating system, architecture, package name, steps, and sanitized error.
