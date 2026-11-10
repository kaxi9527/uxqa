import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askVision, publicAi, readAiSettings, writeAiSettings, type AiSettings } from '../src/ai/model.js';
import { applyReview, reviewTasks } from '../src/ai/review.js';
import { formatPrompt } from '../src/check/format.js';
import { runCheck } from '../src/check/run.js';
import { reviewContext, reviewRound } from '../src/ui/round-runner.js';
import { addProject, getRound, saveRound, shotsDir, type ProjectEntry, type Round } from '../src/ui/store.js';

/** A solid-colour PNG of the given size. */
function png(width: number, height: number): Buffer {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 200)]);
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
    return Buffer.concat([length, Buffer.from(type), data, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
}

// A stand-in vision model. It answers by what the prompt asks, and alternates on one question so "looks disagree" can be tested.
interface Seen { path: string; headers: Record<string, string | string[] | undefined>; body: Record<string, unknown> }
const seen: Seen[] = [];
let flip = 0;
function answerFor(prompt: string): string {
  if (prompt.includes('有人说图里有这个界面问题')) return prompt.includes('看不清的灰字') ? '{"verdict":"not-real","reason":"其实挺清楚"}' : '{"verdict":"real","reason":"确实被遮住"}';
  if (prompt.includes('请按下面的界面规则检查')) return '```json\n{"problems":[{"title":"「横幅」挡住了标题","detail":"首页顶部横幅压住了大标题","fix":"给横幅留出位置","rule":"内容不能叠在一起","box":[40,30,200,60]},{"title":"看不清的灰字","detail":"底部说明文字太淡"}]}\n```';
  if (prompt.includes('统计')) return (flip++ % 2 === 0) ? '{"verdict":"real","reason":"看到了"}' : '{"verdict":"not-real","reason":"没看到"}';
  return '好的，这是我的判断：{"verdict":"real","reason":"红框里确实是这样"}';
}

let model: Server;
let modelUrl: string;
let home: string;
let product: string;
let entry: ProjectEntry;
let roundCount = 0;

async function freshRound(): Promise<Round> {
  const result = await runCheck({ source: product });
  // Round ids sort by time; a counter keeps "the latest round" the one made last.
  const id = `2026-11-01T00-00-${String(++roundCount).padStart(2, '0')}-000Z`;
  const dir = shotsDir(entry.id, id);
  await mkdir(dir, { recursive: true });
  const fresh = result.violations.filter((violation) => violation.status === 'new');
  const captures: NonNullable<Round['capture']>['captures'] = {};
  // Two problems with boxed screenshots; one of them is named so the mock disagrees with itself.
  fresh[0].name = '「统计」链接点击区太小';
  for (const [index, violation] of fresh.slice(0, 2).entries()) {
    const crop = join(dir, `crop-${index}.png`);
    await writeFile(crop, png(520, 260));
    captures[violation.fingerprint] = { number: index + 1, status: 'found', shots: [{ route: '/', viewport: '1440x900', crop, full: crop, matches: 1 }], matches: 1, note: '' };
  }
  const view = join(dir, 'view-home.png');
  await writeFile(view, png(1440, 900));
  return saveRound(entry.id, result, { roundId: id, capture: { baseUrl: 'http://localhost:1', viewport: '1440x900', pages: [], captures, cancelled: false, durationMs: 1, views: [{ route: '/', width: 1440, image: view }] } });
}

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), 'uxqa-ai-home-'));
  product = await mkdtemp(join(tmpdir(), 'uxqa-ai-product-'));
  await cp(resolve('examples/check-fixture'), product, { recursive: true });
  process.env.UXQA_HOME = home;
  model = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      seen.push({ path: request.url ?? '', headers: request.headers, body });
      const content = ((body.messages as Array<{ content: Array<{ type: string; text?: string }> }>)[0].content);
      const text = answerFor(content.find((part) => part.type === 'text')?.text ?? '');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.url?.endsWith('/v1/messages')
        ? { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }], stop_reason: 'end_turn' }
        : { choices: [{ message: { content: text } }] }));
    });
  });
  await new Promise<void>((done) => model.listen(0, '127.0.0.1', done));
  modelUrl = `http://127.0.0.1:${(model.address() as { port: number }).port}`;
  entry = await addProject(product);
});

afterAll(async () => {
  await new Promise<void>((done) => model.close(() => done()));
  delete process.env.UXQA_HOME;
  await rm(home, { recursive: true, force: true });
  await rm(product, { recursive: true, force: true });
});

const settings = (change: Partial<AiSettings> = {}): AiSettings => ({ mode: 'api', protocol: 'openai', baseUrl: `${modelUrl}/v1`, model: 'mock-vision', apiKey: 'test-key-123456', passes: 2, verify: true, discover: true, maxCalls: 40, ...change });

describe('optional screenshot review by a vision model', () => {
  it('keeps the key on this machine only: stored with owner-only permissions and never shown back', async () => {
    await writeAiSettings(settings());
    const mode = (await stat(join(home, 'ai.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
    const shown = publicAi(await readAiSettings());
    expect(JSON.stringify(shown)).not.toContain('test-key-123456');
    expect(shown.keyHint).toBe('…3456');
  });

  it('speaks both the OpenAI-compatible and the Claude message formats, without sampling parameters', async () => {
    seen.length = 0;
    const image = png(64, 64);
    expect(await askVision(settings(), '问一下', [image])).toContain('verdict');
    expect(await askVision(settings({ protocol: 'anthropic', baseUrl: modelUrl, model: 'claude-opus-5-5' }), '问一下', [image])).toContain('verdict');
    const [openai, claude] = seen;
    expect(openai.path).toBe('/v1/chat/completions');
    expect(openai.headers.authorization).toBe('Bearer test-key-123456');
    expect(JSON.stringify(openai.body)).toContain('data:image/png;base64,');
    expect(claude.path).toBe('/v1/messages');
    expect(claude.headers['x-api-key']).toBe('test-key-123456');
    expect(claude.headers['anthropic-version']).toBe('2023-06-01');
    const block = (claude.body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content[0];
    expect(block).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
    // Claude now rejects temperature/top_p/top_k; neither format sends them.
    for (const request of seen) for (const key of ['temperature', 'top_p', 'top_k']) expect(request.body).not.toHaveProperty(key);
    // A non-Anthropic address gets no Anthropic-only extras (relays would reject them).
    expect(claude.body).not.toHaveProperty('fallbacks');
  });

  it('looks several times, keeps only agreeing verdicts, and keeps only re-confirmed new problems', async () => {
    const round = await freshRound();
    seen.length = 0;
    const outcome = await reviewRound(entry, round, settings());
    const stored = (await getRound(entry.id, round.id))!;
    const fresh = stored.result.violations.filter((violation) => violation.status === 'new');
    const flaky = fresh.find((violation) => violation.name === '「统计」链接点击区太小')!;
    expect(flaky.ai).toMatchObject({ verdict: 'unsure', looks: 2, by: 'mock-vision' });
    expect(flaky.ai!.reason).toContain('不一致');
    const steady = fresh.find((violation) => violation.ai && violation !== flaky)!;
    expect(steady.ai).toMatchObject({ verdict: 'real', looks: 2 });
    // Of the two claims on the whole-page screen, only the one confirmed twice is kept.
    const found = fresh.filter((violation) => violation.origin === 'ai');
    expect(found.map((violation) => violation.name)).toEqual(['「横幅」挡住了标题']);
    expect(found[0]).toMatchObject({ rule: 'ai/look', level: 'default', file: '页面 /', line: 0 });
    expect(stored.capture!.captures[found[0].fingerprint]).toMatchObject({ status: 'found', mark: { x: 40, y: 30, width: 200, height: 60 } });
    expect(outcome.found).toBe(1);
    expect(stored.ai).toMatchObject({ by: 'mock-vision', reviewedViews: ['/|1440'] });
    // 2 problems × 2 looks + 1 page look + 2 claims × 2 looks
    expect(seen).toHaveLength(9);
    // Nothing is left to review, so running again costs nothing.
    const { ruleText, pageRules } = await reviewContext(entry);
    expect(reviewTasks(stored, ruleText, pageRules)).toEqual([]);
  });

  it('stops at the per-round request budget and records failures instead of crashing', async () => {
    const round = await freshRound();
    seen.length = 0;
    await reviewRound(entry, round, settings({ maxCalls: 3 }));
    expect(seen.length).toBeLessThanOrEqual(3);
    const broken = await freshRound();
    const outcome = await reviewRound(entry, broken, settings({ baseUrl: 'http://127.0.0.1:9/v1' }));
    expect(outcome.errors[0]).toContain('连不上模型服务');
  });

  it('tells the fixing AI which problems the screenshot review doubted, and puts them last', async () => {
    const round = await freshRound();
    const fresh = round.result.violations.filter((violation) => violation.status === 'new');
    applyReview(round, { verdicts: [{ id: fresh[0].fingerprint, verdict: 'not-real', reason: '图里没有' }], findings: [] }, { by: 'AI 助手（MCP）' });
    const prompt = formatPrompt(round.result);
    const blocks = prompt.split(/\n(?=问题 \d+【)/);
    expect(blocks.at(-1)).toContain(fresh[0].name);
    expect(blocks.at(-1)).toContain('看图复核（AI 助手（MCP））：截图里看起来没有这个问题，请先确认再决定改不改——图里没有');
  });

  it('lets a subscription user\'s own AI agent do the looking through MCP', async () => {
    const round = await freshRound();
    const call = (lines: unknown[]) => new Promise<Array<{ id: number; result: { content: Array<{ type: string; text?: string; data?: string }> } }>>((done) => {
      const child = execFile(process.execPath, ['--import', 'tsx', resolve('src/cli.ts'), 'mcp', '--source', product], { cwd: resolve('.'), env: { ...process.env, UXQA_HOME: home }, maxBuffer: 64 * 1024 * 1024 }, (_error, stdout) => done(stdout.trim().split('\n').map((line) => JSON.parse(line))));
      child.stdin?.end(`${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    });
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };
    const [, review] = await call([init, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'review_screenshots', arguments: {} } }]);
    const content = review.result.content;
    expect(content[0].text).toContain(`round: "${round.id}"`);
    expect(content.filter((part) => part.type === 'image')).toHaveLength(3);
    const ids = content.filter((part) => part.text?.startsWith('【复核问题】')).map((part) => part.text!.match(/id: (\S+)/)![1]);
    const [, submitted] = await call([init, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'submit_screenshot_review', arguments: {
      round: round.id,
      verdicts: [{ id: ids[0], verdict: 'real', reason: '红框里确实太小' }],
      findings: [{ view: '/|1440', title: '页脚文字压到了按钮', detail: '最下面一行说明压住了"保存"按钮', box: [10, 800, 300, 40] }],
      reviewed_views: ['/|1440'],
    } } }]);
    expect(submitted.result.content[0].text).toContain('复核 1 个问题，新增 1 个看图发现的问题');
    const stored = (await getRound(entry.id, round.id))!;
    expect(stored.result.violations.find((violation) => violation.fingerprint === ids[0])!.ai).toMatchObject({ verdict: 'real', by: 'AI 助手（MCP）' });
    expect(stored.result.violations.some((violation) => violation.origin === 'ai' && violation.name === '页脚文字压到了按钮')).toBe(true);
    expect(JSON.parse(await readFile(join(home, 'projects.json'), 'utf8'))).toHaveLength(1);
  }, 60_000);
});
