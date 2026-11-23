# QA Master user guide

## Schedule work on the status board

Open **Workflow** to see **Untested → Testing → Needs repair → Repairing → Awaiting retest → Completed**. Create a task, import a documented requirement through **Acceptance tasks**, or choose **Add to task board** on a finding. Repeated observations can link back to the same card. Switch to **Workflow builder** for step-by-step or automatic runs.

Move a card by dragging it or using its actions. A passing initial test may complete immediately. Submit a repair with a change summary and evidence location. Retest under the original conditions. A failed retest goes back to **Needs repair** with its evidence intact. Record a blocker when evidence or a prerequisite is missing, then unblock the task when it is ready.

**Scheduling** sets the priority mode for new project tasks. Open a card’s **Priority** section to override P0–P3 or return to system assignment. The board explains its suggestion and preserves manual overrides across failures. **Next task** selects the highest eligible priority, favoring retests and already-started work within a level. Blocked, unassigned and completed tasks remain visible. Your workflow step order is preserved.

### Run a document-backed acceptance task

Drop a requirements or interaction document in **Check**. Review the suggested role, conditions, action and expected result for each source passage. Resolve missing fields and save the tasks you want to run. An optional button sends excerpts on the current page to the selected model. Each saved task keeps its source revision and quotation.

In **Workflow → Acceptance tasks**, prepare the scenario and review its actors, setup, assertions and test URL. Use a repeatable test environment for scenarios that change data. For configuration propagation, bind three distinct observed phases for the baseline, activated change and untouched control. Approved tasks can appear repeatedly as columns. **Run task** replays the saved definition.

Open a failing task in **Issues** or the workbench. **Repair with AI and retest** sends the requirement and failed observations to the project agent, records the files it actually edited and replays the same scenario with its controls. A selected region can also send the verified design and observed image pair to the configured model. Expand the retest for before-and-after observations and unresolved gaps.

### Component regions, feedback and storage

In **Design fidelity**, align the design and observed state at the same dimensions. Click a marked component on an imported design, drag a rectangle, or enter pixel coordinates. QA Master can use component markers or available development-mode component ownership to identify a component. You can provide a manual mapping. Compare each state and width independently. The components view lists observed usage across the captured routes.

Record a confirmed issue, an acceptable difference or a missed issue in **Experience feedback**. Include any assistive technology actually used. High impact and conflicting decisions enter the blind-review queue. Add a neutral evidence packet for the two independent reviewers. Priority reviews list settled model-pass cases with a human-confirmed blocker or participant-reported difficulty.

**Project measures** shows median import-to-first-conclusive-run time, serious escapes in held-out projects, and same-scenario repair verifications, with counts and pending results. **Project storage** measures managed data and lets you separately discard screenshots or failure traces. Review history, sources, conversations and edit backups remain available. CLI reports exported to user-selected locations are managed separately.

### Arrange tests and repairs in a workflow

Open **Workflow** in a project. Add a test or repair, choose its scope and optionally name it. Steps run from left to right. Drag cards or use **Move earlier** and **Move later**. Duplicate a test after a repair to collect fresh evidence. Repairs can use a specific preceding test or the most recent matching test. A page sample can target its own preview route.

Choose **Step by step** to run and review each column. **Automatic** runs eligible project checks, component checks and browser samples until a finding, evidence gap or manual step needs attention. Open the specialist tool for a design comparison, logic scenario or user observation. Open the project chat for repairs and review the draft before sending it. Return to select the new evidence or enter a human observation with its source. Mode switches take effect at a step boundary. The plan and run history stay local to the project and survive a refresh.

In **Project → Check**, select a specialist category and expand **Task acceptance**. Record a criterion and observations for the current round. Seal the optional model prediction before two people independently rate the case. Usability sessions can also record participant-rated ease. **View calibration metrics** shows missed blockers, reviewer agreement and the share of model passes where participants reported difficulty. [Workflows and metric definitions](assurance-workflows.md#task-acceptance-and-calibration)

QA Master checks frontend projects locally, combining browser evidence with optional AI review. A configured check passing is not acceptance of the entire product.

## Import check sources

Choose a check category in the project’s **Check** tab. Drop files onto **Drop project sources** or choose files from disk. To attach the same file to several checks, open **Add link or repository**, select the categories, then drop the files. Expand **Sources for this check**, choose a passage, review its location and applicable categories, and save it. Importing a revised file creates a new snapshot. Existing clauses retain their original revision.

| Source | How it is used |
| --- | --- |
| PDF, DOCX, PPTX, XLSX | Local text extraction retains PDF pages, Word paragraphs, slide paragraphs, and worksheet rows and cell addresses. Image-only PDF pages are recorded as gaps. Convert legacy DOC/XLS/PPT to modern Office format first. |
| Markdown, TXT, CSV, TSV, JSON, YAML, XML, HTML | Search the extracted text by location. Files may be up to 32 MB, with up to 8 MB of extracted text. |
| PNG, JPEG, WebP, SVG | Import a single frame and choose **Compare with round capture**. Match content, fonts, theme and dimensions. Missing captures and mismatched sizes are reported. |
| Sketch, FIG, XD, PSD | Sketch imports artboard names, dimensions and text layers. FIG, XD and PSD record the file name and fingerprint. Attach an exported frame for pixel comparisons. |
| Git repositories and code files | Supply a GitHub, GitLab or other Git clone URL and an optional branch or tag. Fetching uses local Git credentials and scans the downloaded code. The commit and source positions are recorded. GitHub/GitLab file links and raw text URLs can also be read individually. |
| Figma, Canva and other boards | Choose a specific Figma node or a Canva.com page. An explicit online export sends the one-time credential to the provider. For Canva China, other boards or offline use, save the link and drop its rendered frame in the same form. A link alone is recorded as awaiting evidence. |

**Offline use and models.** QA Master requires no hosted backend. Local extraction, cached evidence, source scans and pixel comparisons work without a model. For scenario generation or image interpretation, select Ollama, LM Studio or a compatible LAN address in model settings and choose an installed model. Image interpretation requires a vision-capable model. A cloud endpoint receives the selected excerpt and project context. Initial browser/model downloads and remote-source reads require access to their hosts. Saved snapshots remain available offline.

## Add a project and run a check

Add an existing project folder, inspect the discovered component library and project rules, and start a source check. Source checks are read-only by default. For rendered pages, start the project's preview server and configure its URL. The optional screenshot browser can be downloaded after you review and confirm the download.

Version 0.5.0 organizes work as **Project → Check → Issues → Recheck**. UI, UX, and experience findings are classified separately. Automatic checks, AI suggestions, and manual observations have different evidence boundaries. Unvisited pages, untriggered states, and missing screenshots are not passes.

## General logic checks

Under **Workflow → Acceptance tasks**, generate a task from an imported document and open **Create a check from this requirement**. Bind test routes and controls to the quoted requirement, review the ordered phases, then run with test data. These templates run locally without a model.

| Verification type | Evidence required |
| --- | --- |
| Published setting propagation | Establish the setting, every reader and an independent control. Make a distinct change, publish, reopen and compare. Restore the initial fixture before replay. |
| Confirm, cancel and recipient outcomes | Read each identity, complete row total, item key and recipient. Compare cancellation to the original lists and confirmation to a freshly captured preview. |
| Return to a task after interruption | Observe the record ID and original value, make an edit, leave and return. Compare the value on the same record to the retention or restoration requirement. |

Missing prerequisites remain unverified. Unavailable pages or controls can block execution. Retests use the same bound plan. Held-out false alarms and misses show their human-adjudicated denominators.

Recipient lists are read after the preview closes. If it stays open, bind an indicator that appears on cancel or confirm. For separate signed-in roles, CLI `actorStates` supports local test sessions keyed by `operator` and `recipient:<ID>`. The desktop check verifies the identity visible on each recipient page.

In **Check → Check category**, choose a specialist workflow. **Link a source clause** reads project UTF-8 text or accepts an excerpt from another document, PDF or design node. Record its revision, section or page and select all applicable categories. QA Master checks the file digest again when opening its references. Relink changed or missing files. **Prepare scenario with selected model** sends the selected clause and project check context to your configured model. Review actors, actions, assertions and the test URL in the project conversation before selecting **Run test scenario**.

Under **Design fidelity → Compare design frame**, pair a project PNG with an observed page in the current round. Confirm the revision and capture conditions. Inspect dimensions, changed pixels and the difference image locally. **Run page sample** collects accessibility, interaction, compatibility or motion evidence. **Create verification tasks** keeps manual evidence and recheck history. [Workflow methods and scope](assurance-workflows.md#english)

Without a requirements document, ask the project assistant to check two views for a contradiction. The built-in same-fact check reads the object identifier, field identifier, version and displayed value independently on each side. It compares values only when all three identifiers match. Field identifiers must account for units and scope. An unknown snapshot leaves the check unverified. In a scenario, each of `sameFact.object`, `sameFact.field` and `sameFact.version` references a pair of observations.

In project repair chat, state the relationship you expect, such as “both views show the same value after the change” or “undo restores the original value”. You can also point to a project file that states the rule. Review the source, object, state and observation points before selecting **Run test scenario**. If two values differ and no rule says they should match, record the difference and leave its business meaning open.

Use `observe` to name text, control values or attributes captured across actions, views or isolated actor sessions. Use `assert` to compare observations with each other or with a constant specified in the requirement. Text supports equality and inequality. Explicit `as: "number"` observations also support ordering and inclusive boundaries. An optional `when` limits applicability. An unwitnessed condition, unreadable value or incompatible type leaves the assertion unverified. An observed contradiction fails it. Lists can be compared by stable identifiers including multiplicity. Reports show individual verdicts and observations.

The CLI accepts the same plans. From the repository root, run `python3 -m http.server 4189 --bind 127.0.0.1 --directory examples/logic`, then `./uxqa run --config examples/logic/scenario.json` in another terminal. Each desktop actor starts with a fresh session. On the CLI, `actorStates` maps actors to independent storage-state files relative to the config. Keep session files outside the repository. [Runnable logic example](../examples/logic/scenario.json)

## Handle and recheck issues

When a page sample finishes, its summary shows passed, failed, blocked and unverified checks. Each built-in interaction sample saves its route, control bindings and setup steps locally with this project. Expand the record and choose **Rerun with these settings** to repeat the original scenario. If you switch tabs during a sample, the results appear automatically when you return.

Open **Check → Scan coverage** to see the directories and file counts included in this round. Files read only for component or repetition comparisons are listed separately. Each skipped rule shows its reason and affected scope. Older rounds keep their original evidence.

In **Check → Interaction → Run page sample**, choose a built-in scenario and bind controls on a test page. For **Recover after a failure**, enter the GET request pattern, error message and recovered content selectors, with an optional retry button. For **Continue by keyboard after saving**, provide the save control, a confirmation that appears only after saving, and the expected next focus target. For **First entry after switching language**, specify the language control, target language and the first control’s role and translated accessible name. Use preparation steps to open menus or edit test data. A save runs against the configured project at both viewport sizes. Unbound scenarios appear as unverified. Failed preparation appears as blocked.

Under **Usability and ease of use → Record task observation**, record an observed task, participant group and device, outcome, difficulty and evidence. Duration is optional. QA Master shows independent completions against the actual sample count for the same round, task and conditions. Retest suggested changes using the same task.

**Check overview** shows the selected round, files checked and new findings. Opening a category clears previous filters. Issue search waits until you finish composing a character with an input method. Use the arrow keys on a project tab to switch tabs, or Home and End to reach the first and last tabs.

Open a finding to review its location, evidence, and repair direction. Record a handling state or add a manual observation. Accepting a deviation or manually confirming a result requires a reason. After a fix, repeat the check with comparable rules, pages, viewport sizes, and states. “Not observed again” alone does not prove a fix.

A focused repair plan combines the selected round's facts, project rules, and built-in knowledge into verification tasks. Record each task's result and evidence, inspect its history, or transfer a finding to a manual observation. A recorded pass is supplied by its author; it does not mean QA Master automatically executed the task. See [quality workflow](quality-workflow.md) for source details.

In **Issues**, the round, search and severity controls stay visible while you scroll. More findings load as you approach the end. Opening a finding and returning keeps your place. Use the up and down arrows to browse and Home or End to reach the first or last finding. If every preview page fails to open, choose **Check preview URL** to edit its address.

## Project repair chat (0.5.2 and later)

Enter adds a line to your draft. Press ⌘ + Enter on macOS or Ctrl + Enter on Windows and Linux to send, or select **Send**.

**Ask AI to repair** opens **Repair chat → AI repair**. Sending a message calls the model saved in Model settings and keeps its reply in this project. **Copy issue prompts** previews and copies the current finding or the whole round. For rounds with more than 10 findings, you can also copy just the first 10. Copying happens locally and you can return to your chat draft at any time.

Select **Discuss and repair** in a finding to bring it into the project conversation. Use **Back to finding** to revisit its evidence. The issue list shows search and severity first. Open **More filters** to narrow results by handling status or other criteria, or choose **Clear filters** to see the full list again.

In an empty conversation, choose a suggested question to draft a message, edit it, then send. Returning to a finding keeps any search and filters that include it. After the agent edits a file, choose **Recheck edits** to run a new check and see the comparison. Switch rounds in **Recheck** and open a finding directly from **Still detected**. Verify findings marked **No longer detected** under the same page conditions.

Open **Repair chat** within a project, or choose **Discuss and repair** on a finding; both open the same project conversation. Select and save a model in Settings first. Sending shares up to 30 findings from the selected check, the conversation and any project files actually read with that model provider. A finding screenshot or page overview is attached by default when available; you can deselect it. If none is available, QA Master explains how to run a page check.

The agent can read and edit text files, and create files and folders, throughout the current project without per-path setup. It must read a file before editing it and inspect the project before creating a file; three consecutive tool failures stop the turn. Each message makes at most 24 model requests and also respects the limit in model settings. It cannot run arbitrary terminal commands or access outside the project, symbolic links or common credential files. Component verification can run project scripts with your confirmation, as described below. Binary images cannot be edited as text. Original text is backed up locally; tool records offer undo unless the file has changed since the edit. Undoing creation removes the new file if it is unchanged. QA Master attempts a source recheck after edits; pages and screenshots still require a new check. A model response is not an acceptance result. This feature is not in the published 0.5.0 download.

The agent reads current project rules and discovers supported native component catalogs. A missing or ambiguous catalog does not mean the project has no components; shared component creation or extraction still follows the project's component planning and sync workflow. Each file change must include a reason connecting it to the current issue or request; the reason appears in the tool record but does not guarantee the model's judgment is correct. The selected finding is visible above the conversation and can be cleared. Actual source recheck records are returned to the model; an absent fingerprint alone does not verify a page or interaction.

For a new shared component, the agent can prepare a plan bound to the project's native catalog. Review the implementation and consumer paths, actual project test and typecheck commands, and browser scenario, then choose **Run checks and synchronize**. Scripts and scenarios can change test data: use a trusted project and test environment. The catalog and specification update only after checks pass; changes to the plan or scenario require a new plan. Screenshots follow the 48-hour retention policy. Discovery supports specific catalog formats and paths, so it cannot identify every shared component automatically; explicitly use the project's plan and sync workflow when revising existing components.

- **Design candidates:** Ask the agent for a proposal grounded in the project. It can suggest semantic colors and typography, spacing, radius and duration tokens, generate candidate CSS, and calculate solid text/background contrast for supplied pairs. Source citations must match an excerpt read during that turn and show its location; when none is cited, the basis is marked unverified. A matching quote does not prove the design judgment. The candidate does not become project policy or prove rendered accessibility.
- **Compare alternatives:** Configure a running project preview and ask for two or three alternatives. QA Master opens the original and candidates in separate temporary browser contexts and waits for your choice; previews do not write source. Supported changes include styles and leaf text on multiple existing elements and repositioning existing elements. Framework rerenders can undo changes; arbitrary structures and native components are not covered. Non-GET/HEAD requests and WebSockets are blocked, so some interactions may not work. GET endpoints can also have side effects: use a test environment. Close the previews in the conversation or exit QA Master.
- **Compare code alternatives:** For structures or behavior that must survive rerendering, the agent can read same-origin preview HTML, scripts or styles and prepare alternatives; read excerpts are sent to the selected model. Common credential paths and suspected keys are blocked, but pattern screening cannot identify every secret. Expand each alternative to review the original and replacement, then choose **Run code alternatives**. Only scripts or styles actually read during this turn, with unique original text and an unchanged resource hash at load time, can be replaced. Candidate code runs in isolated browser contexts without importing saved login state. Ordinary cross-origin requests, redirects, writes and WebSockets are blocked, but GET requests can change data and the browser is not a security sandbox: use a trusted test environment. Only resources requested during page load are supported; pages requiring login, external resources, redirects or lazy loading may not work. Initial errors and failed requests are recorded; later interactions need checking. After selection, the agent still needs to edit the real project source and recheck.
- **Motion sampling:** Ask the agent to measure hover, focus, idle, scroll or click, with optional reduced-motion emulation. Before/after comparisons require matching page, element, browser, viewport, trigger, motion preference and observed scroll distance. Enable page clicks in that message to test a click, and use a test environment: GET endpoints can have side effects. Records include frame callback intervals, long tasks, target and page animations, and Chromium main-thread counters when available. Counters can overlap and include sampling overhead. A scroll is not reported as complete unless scrolling occurred. This is not a GPU dropped-frame or device-performance verdict and does not cover all gestures.

## Access and network

Version 0.5.0 explains requested access at first use and can check a project folder selected by the user. Settings show the result of the most recent actual read; the result is not a permanent operating-system grant. Previously accessible locations are checked at startup and when starting a project check. This is not continuous monitoring of operating-system permissions: after changing system settings, use **Recheck** in QA Master. macOS normally remembers permission choices, but a moved folder, disconnected disk, changed system setting, or app update can affect access. If access is denied, review **System Settings → Privacy & Security → Files and Folders**, then check again. Removing QA Master's observation does not delete the directory.

Project lists, check results, model settings and project conversations are stored under `~/.uxqa` (Windows: `%USERPROFILE%\.uxqa`), unless `UXQA_HOME` is set. Ordinary checks do not rewrite project source. Saving project rules, baselines, component sync and agent repairs can write to the project. Optional preview, browser downloads, AI review and repair chat can use the network. See [local data and permissions](local-data-and-permissions.md).

## Models and accounts

Configure an API protocol or a supported subscription account in Settings, fetch models, select a vision-capable model, test it, and save. A successful connection does not establish access to every model or subscription feature. Claude subscriptions require the official Claude Code runtime; Google subscriptions require your own authorized OAuth client configuration. Credentials are local files; keychain-backed encryption is not guaranteed.

For installation, operating-system prompts, updates, and removal, see [installation and updates](install-and-use.en.md). Check the version on the release page; earlier downloads may not include these features.
