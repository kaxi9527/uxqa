# UXQA product guide

UXQA combines deterministic frontend checks, browser evidence and optional AI review
in a local product. A passing configured scan is not acceptance of the entire product.

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

- Console copy is currently Chinese. Reports/CLI contain Chinese and English.
- Page-to-source matching uses evidence and heuristics; ties or inaccessible states
  remain unresolved rather than receiving fabricated source locations.
- No automatic product-code repair or background remote synchronization.
- No background update service. Install versioned releases manually.
- macOS has a native window. Portable Windows/Linux packages serve the same UI on
  localhost and open it in a browser. No separate model-manager product is needed.

See [local data and permissions](local-data-and-permissions.md) before connecting
accounts, collecting private pages or sharing a report.
