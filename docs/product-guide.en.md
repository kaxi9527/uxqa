# UXQA user guide

UXQA checks frontend projects locally, combining browser evidence with optional AI review. A configured check passing is not acceptance of the entire product.

## Add a project and run a check

Add an existing project folder, inspect the discovered component library and project rules, and start a source check. Source checks are read-only by default. For rendered pages, start the project's preview server and configure its URL. The optional screenshot browser can be downloaded after you review and confirm the download.

Version 0.5.0 organizes work as **Project → Check → Issues → Recheck**. UI, UX, and experience findings are classified separately. Automatic checks, AI suggestions, and manual observations have different evidence boundaries. Unvisited pages, untriggered states, and missing screenshots are not passes.

## Handle and recheck issues

Open a finding to review its location, evidence, and repair direction. Record a handling state or add a manual observation. Accepting a deviation or manually confirming a result requires a reason. After a fix, repeat the check with comparable rules, pages, viewport sizes, and states. “Not observed again” alone does not prove a fix.

A focused repair plan combines the selected round's facts, project rules, and built-in knowledge into verification tasks. Record each task's result and evidence, inspect its history, or transfer a finding to a manual observation. A recorded pass is supplied by its author; it does not mean UXQA automatically executed the task. See [quality workflow](quality-workflow.md) for source details.

## Access and network

Version 0.5.0 explains requested access at first use and can check a project folder selected by the user. Settings show the result of the most recent actual read; the result is not a permanent operating-system grant. Previously accessible locations are checked at startup and when starting a project check. This is not continuous monitoring of operating-system permissions: after changing system settings, use **Recheck** in UXQA. macOS normally remembers permission choices, but a moved folder, disconnected disk, changed system setting, or app update can affect access. If access is denied, review **System Settings → Privacy & Security → Files and Folders**, then check again. Removing UXQA's observation does not delete the directory.

Project lists, check results, and model settings are stored under `~/.uxqa` (Windows: `%USERPROFILE%\.uxqa`), unless `UXQA_HOME` is set. Ordinary checks do not rewrite project source. Saving project rules, baselines, and component sync are explicit project writes. Optional preview, browser downloads, and AI review can use the network; AI review sends selected screenshots and context to the selected provider. See [local data and permissions](local-data-and-permissions.md).

## Models and accounts

Configure an API protocol or a supported subscription account in Settings, fetch models, select a vision-capable model, test it, and save. A successful connection does not establish access to every model or subscription feature. Claude subscriptions require the official Claude Code runtime; Google subscriptions require your own authorized OAuth client configuration. Credentials are local files; keychain-backed encryption is not guaranteed.

For installation, operating-system prompts, updates, and removal, see [installation and updates](install-and-use.en.md). Check the version on the release page; earlier downloads may not include these features.
