import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { dataDir } from '../ui/store.js';
import { engineConnection } from './engine.js';

/**
 * Optional vision model. Four wire formats plus UXQA's source-integrated model module:
 * - "openai": the OpenAI-compatible Chat Completions shape (OpenAI, Gemini's compatible endpoint, Qwen/DashScope,
 *   Zhipu GLM, Doubao/Ark, Kimi, OpenRouter, local Ollama / LM Studio, and most relays);
 * - "responses": OpenAI Responses; "anthropic": Claude Messages; "gemini": native generateContent.
 * Settings live only in ~/.uxqa/ai.json (mode 0600); the key is never written into a project or sent anywhere but baseUrl.
 */
export type AiProtocol = 'openai' | 'responses' | 'anthropic' | 'gemini';
export interface AiSettings {
  /** off: not used; api: uxqa calls the model with the key below; agent: the user's own AI agent reviews through MCP. */
  mode: 'off' | 'api' | 'agent';
  protocol: AiProtocol;
  connection?: 'direct' | 'native' | 'magpie'; // legacy setting migrates to native; never launches the old app
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** How many independent looks each question gets; a verdict counts only when they agree. */
  passes: number;
  verify: boolean;
  discover: boolean;
  /** Upper bound of model requests per round, so a big project cannot run up a bill. */
  maxCalls: number;
}

export const DEFAULT_AI: AiSettings = { mode: 'off', protocol: 'openai', baseUrl: '', model: '', passes: 2, verify: true, discover: true, maxCalls: 40 };

/** Starting points shown in the console; model names are examples the user can change. */
export const AI_PRESETS: Array<{ id: string; label: string; protocol: AiProtocol; baseUrl: string; model: string; keyless?: boolean }> = [
  { id: 'claude', label: 'Claude（Anthropic）', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5' },
  { id: 'openai', label: 'OpenAI Responses', protocol: 'responses', baseUrl: 'https://api.openai.com/v1', model: '' },
  { id: 'gemini', label: 'Google Gemini', protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: '' },
  { id: 'deepseek', label: 'DeepSeek（需选择支持看图的模型）', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: '' },
  { id: 'qwen', label: '通义千问（阿里云百炼）', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: '' },
  { id: 'glm', label: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: '' },
  { id: 'doubao', label: '豆包（火山方舟）', protocol: 'openai', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: '' },
  { id: 'kimi', label: 'Kimi（月之暗面）', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: '' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: '' },
  { id: 'ollama', label: '本机 Ollama', protocol: 'openai', baseUrl: 'http://localhost:11434/v1', model: '', keyless: true },
  { id: 'custom', label: '其他（OpenAI 兼容接口）', protocol: 'openai', baseUrl: '', model: '' },
];

const file = () => join(dataDir(), 'ai.json');

export async function readAiSettings(): Promise<AiSettings> {
  try { return { ...DEFAULT_AI, ...(JSON.parse(await readFile(file(), 'utf8')) as Partial<AiSettings>) }; } catch { return { ...DEFAULT_AI }; }
}

export async function writeAiSettings(settings: AiSettings): Promise<void> {
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  const temporary = `${file()}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file());
  await chmod(file(), 0o600).catch(() => undefined);
}

/** What the browser may see: everything except the key itself. */
export function publicAi(settings: AiSettings) {
  const { apiKey, ...rest } = settings;
  return { ...rest, hasKey: !!apiKey, keyHint: apiKey ? `…${apiKey.slice(-4)}` : '' };
}

export class AiError extends Error {}

export function modelBase(settings: AiSettings): string {
  let url: URL;
  try { url = new URL(settings.baseUrl); } catch { throw new AiError('请填写有效的模型地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new AiError('模型地址必须是 HTTP(S) 地址，不能包含账号、查询参数或片段');
  let base = url.href.replace(/\/+$/, '').replace(/\/(chat\/completions|responses|messages|models)$/, '');
  if (settings.protocol === 'anthropic') base = base.replace(/\/v1$/, '');
  if (settings.protocol === 'gemini') {
    base = base.replace(/\/models\/[^/]+:(?:streamGenerateContent|generateContent)$/, '');
    if (new URL(base).pathname === '/') base += '/v1beta';
  }
  return base;
}

async function resolved(settings: AiSettings): Promise<AiSettings> {
  return settings.connection === 'native' || settings.connection === 'magpie' ? { ...settings, ...await engineConnection() } : settings;
}

/** Never show a provider's raw error body: it may echo credentials or request content. */
function responseError(status: number): AiError {
  const hint = status === 401 || status === 403 ? '请检查 API Key 或重新登录订阅账号' : status === 429 ? '额度或请求频率受限，请稍后重试或换一个模型' : status === 404 ? '请检查模型地址、协议和模型名称' : '请检查服务状态、模型能力和请求设置';
  return new AiError(`模型服务返回 ${status}：${hint}`);
}

export async function listModels(input: AiSettings, signal?: AbortSignal): Promise<string[]> {
  const settings = await resolved(input);
  const base = modelBase(settings);
  const headers: Record<string, string> = settings.protocol === 'anthropic' ? { 'anthropic-version': '2023-06-01', ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}) } : settings.protocol === 'gemini' ? (settings.apiKey ? { 'x-goog-api-key': settings.apiKey } : {}) : (settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {});
  const models: string[] = [];
  let page = '';
  let pages = 0;
  const timeout = AbortSignal.timeout(30_000);
  do {
    if (++pages > 20) throw new AiError('模型列表分页过多，请在连接中心缩小可见模型范围');
    const path = settings.protocol === 'anthropic' ? '/v1/models' : '/models';
    const response = await fetch(`${base}${path}${page}`, { headers, redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw responseError(response.status);
    const data = await response.json() as { data?: { id: string }[]; models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string; has_more?: boolean; last_id?: string };
    if (settings.protocol === 'gemini') {
      for (const model of data.models ?? []) if (!model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent')) models.push(model.name.replace(/^models\//, ''));
      page = data.nextPageToken ? `?pageToken=${encodeURIComponent(data.nextPageToken)}` : '';
    } else {
      models.push(...(data.data ?? []).map((model) => model.id));
      page = settings.protocol === 'anthropic' && data.has_more && data.last_id ? `?after_id=${encodeURIComponent(data.last_id)}` : '';
    }
  } while (page && models.length < 2000);
  return [...new Set(models)].sort();
}

/** Claude models that accept the server-side refusal fallback ("default" form) on the first-party API. */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

/** Ask the model one question about one or more PNG images; returns its text answer. */
export async function askVision(settings: AiSettings, prompt: string, images: Buffer[], signal?: AbortSignal): Promise<string> {
  settings = await resolved(settings);
  if (!settings.baseUrl || !settings.model) throw new AiError('还没有填模型地址或模型名');
  const base = modelBase(settings);
  const timeout = AbortSignal.timeout(120_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  if (settings.protocol === 'responses' || settings.protocol === 'gemini') {
    const gemini = settings.protocol === 'gemini';
    response = await fetch(gemini ? `${base}/models/${encodeURIComponent(settings.model.replace(/^models\//, ''))}:generateContent` : `${base}/responses`, {
      method: 'POST', signal: combined, redirect: 'error',
      headers: { 'content-type': 'application/json', ...(settings.apiKey ? gemini ? { 'x-goog-api-key': settings.apiKey } : { authorization: `Bearer ${settings.apiKey}` } : {}) },
      body: JSON.stringify(gemini ? {
        contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map((image) => ({ inlineData: { mimeType: 'image/png', data: image.toString('base64') } }))] }],
        generationConfig: { maxOutputTokens: 16000 },
      } : {
        model: settings.model, store: false, max_output_tokens: 16000,
        input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, ...images.map((image) => ({ type: 'input_image', image_url: `data:image/png;base64,${image.toString('base64')}` }))] }],
      }),
    });
    if (!response.ok) throw responseError(response.status);
    const data = await response.json() as { status?: string; output?: { content?: { type: string; text?: string }[] }[]; candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    if (data.status === 'incomplete' || data.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new AiError('模型输出被截断，请减少单次内容后重试');
    const answer = gemini ? (data.candidates?.[0]?.content?.parts ?? []).filter((part) => !part.thought).map((part) => part.text ?? '').join('\n') : (data.output ?? []).flatMap((item) => item.content ?? []).filter((part) => part.type === 'output_text').map((part) => part.text ?? '').join('\n');
    if (!answer.trim()) throw new AiError('模型没有返回文字，可能拒绝了请求或不支持看图');
    return answer;
  }
  if (settings.protocol === 'anthropic') {
    const firstParty = /^https:\/\/api\.anthropic\.com$/.test(base);
    const fallback = firstParty && FALLBACK_MODELS.has(settings.model);
    response = await fetch(`${base}/v1/messages`, {
      method: 'POST', signal: combined, redirect: 'error',
      headers: {
        'content-type': 'application/json', 'anthropic-version': '2023-06-01',
        ...(settings.apiKey ? { 'x-api-key': settings.apiKey } : {}),
        ...(fallback ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}),
      },
      body: JSON.stringify({
        model: settings.model, max_tokens: 16000,
        ...(fallback ? { fallbacks: 'default' } : {}),
        messages: [{ role: 'user', content: [...images.map((image) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') } })), { type: 'text', text: prompt }] }],
      }),
    }).catch((error: unknown) => { throw new AiError(`连不上模型服务：${error instanceof Error ? error.message : String(error)}`); });
    const data = await response.json().catch(() => ({})) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string; error?: { message?: string } };
    if (!response.ok) throw responseError(response.status);
    if (data.stop_reason === 'refusal') throw new AiError('模型拒绝回答这次请求');
    const answer = (data.content ?? []).filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');
    if (!answer.trim()) throw new AiError('模型没有返回文字，请确认模型支持看图');
    return answer;
  }
  response = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal: combined, redirect: 'error',
    headers: { 'content-type': 'application/json', ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}) },
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map((image) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}` } }))] }],
    }),
  }).catch((error: unknown) => { throw new AiError(`连不上模型服务：${error instanceof Error ? error.message : String(error)}`); });
  const data = await response.json().catch(() => ({})) as { choices?: Array<{ message?: { content?: string | Array<{ type: string; text?: string }> } }>; error?: { message?: string } | string };
  if (!response.ok) throw responseError(response.status);
  const content = data.choices?.[0]?.message?.content;
  const answer = typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join('\n');
  if (!answer.trim()) throw new AiError('模型没有返回文字，请确认模型支持看图');
  return answer;
}

/** The first JSON object in a model answer (models like to wrap JSON in prose or code fences). */
export function parseJson<T>(text: string): T | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { return undefined; }
}

/** Width and height of a PNG, read from its header. */
export function pngSize(image: Buffer): { width: number; height: number } {
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}
