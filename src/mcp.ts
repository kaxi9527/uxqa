import { readFile, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { pngSize } from './ai/model.js';
import { applyReview, discoverPrompt, reviewTasks, verifyPrompt, type Finding, type ReviewAnswers } from './ai/review.js';
import { reviewContext, runRound } from './ui/round-runner.js';
import { addProject, getRound, listProjects, listRounds, updateProject, updateRound, type ProjectEntry, type Round } from './ui/store.js';
import { formatPrompt } from './check/format.js';
import { describeVariants, importHint } from './check/messages.js';
import { runCheck } from './check/run.js';
import { findComponents } from './inventory/find.js';
import { findProductRoot, libraryLabel, readInventory } from './inventory/read.js';
import { buildRuleSet, readRuleFile } from './rules/load.js';

const TOOLS = [
  {
    name: 'find_component',
    description: '写任何界面元素（按钮、标签页、弹窗、输入框、卡片等）之前先调用：在项目自己的组件库里找现成组件，返回引入方式和可选样式。找不到时如实说明，此时应在组件库里新建，而不是写在页面里。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '要找的东西，如"按钮"、"tabs"、"下拉菜单"' } }, required: ['query'] },
  },
  {
    name: 'list_components',
    description: '列出组件库里的全部组件（不含图标）和它们的样式选项。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_rules',
    description: '读取项目的界面规则（默认基础规则 + 项目自定义规则 + 一句话规则），写代码前了解哪些写法不允许。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'check_files',
    description: '检查刚改过的文件有没有绕过组件库、写死颜色尺寸、重复定义组件等问题，返回具体到行的修改要求。',
    inputSchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' }, description: '文件路径（绝对路径或相对项目根目录）' } }, required: ['files'] },
  },
  {
    name: 'run_page_check',
    description: '完整检测一次：源码 + 打开页面截图 + 从宽到窄检查页面。需要项目在本机跑着（预览地址在 uxqa 控制台的"页面"里设置，也可以在这里传 base_url）。结果和截图保存在 uxqa 控制台里，之后可以用 review_screenshots 看图复核。',
    inputSchema: { type: 'object', properties: { base_url: { type: 'string', description: '可选：本地预览地址，如 http://localhost:5173' } } },
  },
  {
    name: 'review_screenshots',
    description: '取出最新一轮里还没复核的截图，交给你（AI 助手）用自己的看图能力复核：一类是程序圈出的问题（判断红框里的问题是否真的存在），一类是整屏截图（按规则找程序没查到的问题）。请认真看每张图，每个结论都再看一遍确认后再提交；拿不准就判 unsure，宁可少报。看完用 submit_screenshot_review 提交。',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '这次最多取几项（默认 6）' } } },
  },
  {
    name: 'submit_screenshot_review',
    description: '提交看图复核的结论。verdicts 对应"复核问题"项；findings 是你在整屏截图里新发现、并且再看一遍确认过的问题；reviewed_views 列出你看过的整屏截图编号（没发现问题也要列，避免重复）。结论会标注为"AI 助手复核"显示在 uxqa 控制台里，不会改动程序的检查结果。',
    inputSchema: {
      type: 'object',
      properties: {
        round: { type: 'string', description: 'review_screenshots 返回的轮次编号' },
        verdicts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, verdict: { type: 'string', enum: ['real', 'not-real', 'unsure'] }, reason: { type: 'string' } }, required: ['id', 'verdict', 'reason'] } },
        findings: { type: 'array', items: { type: 'object', properties: { view: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' }, fix: { type: 'string' }, rule: { type: 'string' }, box: { type: 'array', items: { type: 'number' }, description: '[x, y, 宽, 高]，截图像素坐标' } }, required: ['view', 'title', 'detail'] } },
        reviewed_views: { type: 'array', items: { type: 'string' } },
      },
      required: ['round'],
    },
  },
];

type Content = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;

/** The console's record of this project (added on first use, so agent-run rounds show up in the console). */
async function consoleProject(source: string): Promise<ProjectEntry> {
  const root = await realpath(await findProductRoot(source));
  // Compare real paths: /tmp vs /private/tmp (or any symlinked checkout) is the same project.
  for (const entry of await listProjects()) if (entry.root === root || await realpath(entry.root).catch(() => entry.root) === root) return entry;
  return addProject(root);
}

async function latestRound(entry: ProjectEntry): Promise<Round | undefined> {
  const summary = (await listRounds(entry.id))[0];
  return summary ? getRound(entry.id, summary.id) : undefined;
}

async function agentTool(source: string, name: string, args: Record<string, unknown>): Promise<Content | undefined> {
  if (name === 'run_page_check') {
    let entry = await consoleProject(source);
    if (typeof args.base_url === 'string' && args.base_url.trim()) {
      const baseUrl = /^[a-z]+:\/\//i.test(args.base_url.trim()) ? args.base_url.trim() : `http://${args.base_url.trim()}`;
      entry = await updateProject(entry.id, { pages: { ...(entry.pages ?? { routes: ['/'], discover: true }), baseUrl } });
    }
    const round = await runRound(entry);
    const shots = Object.values(round.capture?.captures ?? {}).filter((capture) => capture.shots.length).length;
    return [{ type: 'text', text: [
      `第 ${round.number} 轮检测完成（轮次 ${round.id}）：需要改 ${round.newMust} 个，建议改 ${round.newDefault} 个，可以看看 ${round.newReference} 个。`,
      entry.pages?.baseUrl ? `截图 ${shots} 张，整屏截图 ${round.capture?.views?.length ?? 0} 张。${round.partial ? `注意：${round.partial}` : ''}` : '没有设置预览地址，这一轮只检查了源码。传 base_url 或在 uxqa 控制台的"页面"里设置后再检测，就能截图。',
      round.ai ? `已用配置的模型复核：调用 ${round.ai.calls} 次。` : '可以调用 review_screenshots 用你自己的看图能力复核截图。',
    ].join('\n') }];
  }
  if (name === 'review_screenshots') {
    const entry = await consoleProject(source);
    const round = await latestRound(entry);
    if (!round) return [{ type: 'text', text: '这个项目还没有检测记录。先调用 run_page_check（需要项目在本机跑着）。' }];
    const { ruleText, pageRules } = await reviewContext(entry);
    const tasks = reviewTasks(round, ruleText, pageRules);
    if (!tasks.length) return [{ type: 'text', text: round.capture ? `第 ${round.number} 轮的截图都已经复核过了。` : `第 ${round.number} 轮没有截图（没设置预览地址或页面没打开），没有可以复核的。` }];
    const limit = Math.min(12, Math.max(1, Number(args.limit) || 6));
    // Whole-page screens are large; at most two per call.
    const picked = [...tasks.filter((task) => task.kind === 'verify').slice(0, limit), ...tasks.filter((task) => task.kind === 'discover').slice(0, 2)].slice(0, limit);
    const content: Content = [{ type: 'text', text: [
      `uxqa 第 ${round.number} 轮（round: "${round.id}"），还有 ${tasks.length} 项待复核，这次给你 ${picked.length} 项。`,
      '每项后面紧跟它的截图。看完后调用 submit_screenshot_review 提交，round 填上面的编号。',
    ].join('\n') }];
    for (const task of picked) {
      const image = await readFile(task.image).catch(() => undefined);
      if (!image) continue;
      if (task.kind === 'verify') content.push({ type: 'text', text: `【复核问题】id: ${task.id}
${verifyPrompt(task)}` });
      else content.push({ type: 'text', text: `【整屏查找】view: ${task.id}
${discoverPrompt(task, pngSize(image))}
（提交时放进 findings，每条带 view: "${task.id}"；看完这张也要把它放进 reviewed_views）` });
      content.push({ type: 'image', data: image.toString('base64'), mimeType: 'image/png' });
    }
    return content;
  }
  if (name === 'submit_screenshot_review') {
    const entry = await consoleProject(source);
    const round = await getRound(entry.id, String(args.round ?? ''));
    if (!round) return [{ type: 'text', text: '找不到这一轮，请用 review_screenshots 返回的 round 编号。' }];
    const verdicts = (Array.isArray(args.verdicts) ? args.verdicts : []) as ReviewAnswers['verdicts'];
    const findings = (Array.isArray(args.findings) ? args.findings : []) as Finding[];
    const reviewedViews = (Array.isArray(args.reviewed_views) ? args.reviewed_views : []).map(String);
    const applied = applyReview(round, { verdicts, findings }, { by: 'AI 助手（MCP）', reviewedViews: [...new Set([...reviewedViews, ...findings.map((finding) => String(finding.view))])] });
    await updateRound(entry.id, round);
    const left = reviewTasks(round, (await reviewContext(entry)).ruleText, []).length;
    return [{ type: 'text', text: `已记录：复核 ${applied.verified} 个问题，新增 ${applied.found} 个看图发现的问题。${left ? `还有 ${left} 项待复核，可以再调用 review_screenshots。` : '这一轮都复核完了，结果在 uxqa 控制台里。'}` }];
  }
  return undefined;
}

async function callTool(source: string, name: string, args: Record<string, unknown>): Promise<string> {
  const inventory = await readInventory(source);
  if (name === 'find_component') {
    const query = String(args.query ?? '').trim();
    if (!query) return '请提供要找的组件，例如"按钮"。';
    const matches = findComponents(inventory, query);
    if (!matches.length) return `组件库（${libraryLabel(inventory) ?? '未找到组件库'}）里没有和"${query}"相关的组件。如果确实需要，请在组件库里新建并按项目方式登记，再在页面中引用；不要在页面里直接写一份。`;
    return [
      `组件库里和"${query}"相关的组件（优先用第一个；如果样式选项都不满足需求，请提议给它加一个选项，不要另写一份）：`,
      ...matches.map((match) => `- ${match.component.name}${match.component.label ? `（${match.component.label}）` : ''}：${importHint(match.component, inventory)}${describeVariants(match.component) ? `；${describeVariants(match.component)}` : ''}；定义在 ${match.component.file}`),
    ].join('\n');
  }
  if (name === 'list_components') {
    if (!libraryLabel(inventory)) return '没有找到组件库。';
    return [`组件库 ${libraryLabel(inventory)}${inventory.libraries.length > 1 ? '（排在前面的优先）' : ''}：`, ...inventory.components.filter((component) => !/Icon$/.test(component.name)).map((component) => `- ${component.name}${component.label ? `（${component.label}）` : ''}${component.library ? `［${component.library}］` : ''} ${component.importPath}${describeVariants(component) ? `；${describeVariants(component)}` : ''}`)].join('\n');
  }
  if (name === 'get_rules') {
    const productRoot = await findProductRoot(source);
    const file = await readRuleFile(productRoot);
    const rules = buildRuleSet(file.raw, file.path);
    const level = { must: '必须', default: '建议', reference: '参考', off: '关闭' } as const;
    return [
      `规则来源：${rules.extends ? '默认基础规则 + ' : ''}${file.path ? '项目规则 .uxqa/rules.json' : '（项目没有自定义规则）'}`,
      ...rules.rules.map((rule) => `- [${level[rule.level]}] ${rule.id}：${rule.fix ?? rule.type}${rule.include.length ? `（只在 ${rule.include.join('、')}）` : ''}`),
      ...rules.disabled.map((entry) => `- [已关闭] ${entry.id}：${entry.reason}`),
      ...rules.guidance.map((entry) => `- [一句话规则，需自觉遵守] ${entry.text}`),
    ].join('\n');
  }
  if (name === 'check_files') {
    const files = Array.isArray(args.files) ? args.files.map(String) : [];
    if (!files.length) return '请提供要检查的文件。';
    const result = await runCheck({ source, files });
    return formatPrompt(result);
  }
  throw new Error(`未知工具：${name}`);
}

/** Minimal MCP server over stdio (newline-delimited JSON-RPC 2.0). */
export async function serveMcp(source: string): Promise<void> {
  const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request: { id?: number | string; method?: string; params?: Record<string, unknown> };
    try { request = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    const { id, method, params } = request;
    if (id === undefined) continue; // notifications
    try {
      if (method === 'initialize') {
        send({ jsonrpc: '2.0', id, result: { protocolVersion: (params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'uxqa', version: '0.4.0' } } });
      } else if (method === 'ping') send({ jsonrpc: '2.0', id, result: {} });
      else if (method === 'tools/list') send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      else if (method === 'tools/call') {
        const name = String(params?.name ?? '');
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        const content = await agentTool(source, name, args) ?? [{ type: 'text', text: await callTool(source, name, args) }];
        send({ jsonrpc: '2.0', id, result: { content } });
      } else send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (method === 'tools/call') send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: message }], isError: true } });
      else send({ jsonrpc: '2.0', id, error: { code: -32603, message } });
    }
  }
}
