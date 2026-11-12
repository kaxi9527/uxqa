# UXQA product guide

UXQA combines deterministic frontend checks, browser evidence and optional AI review
in a local product. A passing configured scan is not acceptance of the entire product.

## 0.5.0 界面质量工作流

本地迭代按「项目 → 检查 → 问题处理 → 复检」组织。组件库、项目规范、预览设置留在项目内，模型与账号在全局设置。

检查覆盖 UI、UX、体验三个维度。内置知识直接参与问题分类、诊断上下文、修复说明与复检方法，不需要安装外部 Skill，也没有独立的资料浏览器。新增网页规则检查卡片密度、操作命名、字段标签、标题结构、过渡属性、布局动画及减少动态偏好。

问题支持处理状态与人工观察。接受偏差或人工确认必须留下理由；记录不会改变原始扫描证据。复检区分仍检出、进入基线/忽略和未再检出；“未再检出”需要结合相同覆盖条件确认。

在「问题处理 → 专项修复方案」选择 10 类诊断目标之一，结合本轮问题、项目规则、组件和当前工程生成并保存方案。27 项内置规程、81 项场景要求与 22 类技术栈建议用于修复顺序和复检任务；待验证项不会自动变成通过。方案可重看、复制，也可通过 MCP `diagnose_quality` 生成。设计、动效和实现知识用于建议，不直接改源码。

功能与验证边界见 [质量工作流](quality-workflow.md)。已发布下载以 GitHub Releases 实际版本为准。

专项方案支持「逐项验证」：为每个任务保存结果与证据、查看历史、筛选未完成项，并将失败项带入问题处理。记录通过、不适用和自动检测结果分别说明；保存失败保留输入。MCP `quality_verification` 使用相同的任务与记录。旧文字方案可继续阅读，重新生成后启用逐项验证。

## Start a review

Add a local project, inspect its discovered component library and configure preview
URLs/routes. Run source checks first or add page screenshots. Findings distinguish
confirmed rule results, heuristic matches and unverified coverage. Use the evidence
to decide what to fix; UXQA does not rewrite the product during an ordinary scan.

- Source checks: component bypasses, duplicate definitions, repeated patterns and
  literal styling. Static analysis cannot infer every dynamic value or business intent.
- Browser checks: page health, configured flows, accessibility, overflow, screenshots
  and traces. Only routes/states actually visited are covered; authenticated pages
  require explicitly supplied access.
- Component library workflow: inventory, an explicit component plan, implementation
  in your product, then component-sync. Sync validates configured checks and writes
  the selected native catalog/specification. It is an intentional write operation.
- AI review: optional image review of selected evidence. Model findings are advisory;
  they do not override project rules or substitute for reproducible checks.

## 模型接入中心 / Model access center

The UI entry is **模型与账号** under AI review settings. It contains provider protocol
configuration, model discovery, subscription authorization and account management.
The integrated model runtime is compiled from source and belongs to UXQA.

API protocols: OpenAI Chat Completions, OpenAI Responses, Anthropic Messages and
Gemini. Configure only endpoints you trust. Subscription adapters include Codex,
Claude, GitHub Copilot, Gemini and Antigravity. A listed adapter is not a guarantee
that your account has entitlement or that its provider flow remains available.
Claude subscriptions require an existing official Claude Code installation.
The public build does not embed Google OAuth client credentials: Gemini Code Assist
and Antigravity subscription login remain unavailable until you configure a client
you are authorized to use. Direct Gemini API configuration is available independently.

Advanced Google setup uses `UXQA_GEMINI_OAUTH_CLIENT_ID` and
`UXQA_GEMINI_OAUTH_CLIENT_SECRET`, or `UXQA_ANTIGRAVITY_OAUTH_CLIENT_ID` and
`UXQA_ANTIGRAVITY_OAUTH_CLIENT_SECRET`, in the app process environment. Restart the
app after configuration. For a native Mac app, launch its `Contents/MacOS/UXQA`
executable from that configured shell. Do not put credentials in Git or a Release.
The provider must approve the OAuth client, scopes and account entitlement;
supplying client fields alone does not establish access. Missing configuration
is reported before starting a login flow.

After authorization, refresh models, select a vision-capable model and test it.
The connection test sends a fixed small image; it does not submit your project.
Save the settings before enabling screenshot review. An empty model list or expired
account is a failure to resolve, not a successful review. UXQA keeps its own accounts
and does not switch or borrow another application's saved credential directory.

## Current boundaries

- Version 0.5.0 offers Chinese and English in the console; project content, historical findings and provider messages retain their original language.
- Page-to-source matching uses evidence and heuristics; ties or inaccessible states
  remain unresolved rather than receiving fabricated source locations.
- Ordinary checks do not repair product code; the 0.5.2 development repair agent can edit text source and create files within the selected project without per-path setup. No background remote synchronization.
- No background update service. Install versioned releases manually.
- macOS has a native window. Portable Windows/Linux packages serve the same UI on
  localhost and open it in a browser. No separate model-manager product is needed.

See [local data and permissions](local-data-and-permissions.md) before connecting
accounts, collecting private pages or sharing a report.
