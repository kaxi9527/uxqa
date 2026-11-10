import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { askVision, DEFAULT_AI, listModels, modelBase, type AiProtocol, type AiSettings } from '../src/ai/model.js';

let server: Server;
let base: string;
const seen: { path: string; headers: Record<string, unknown>; body: any }[] = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    seen.push({ path: req.url!, headers: req.headers, body });
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization === 'Bearer fail') { res.writeHead(401); res.end(JSON.stringify({ error: { message: 'secret-key-and-private-content' } })); return; }
    if (req.url?.includes('/models') && req.method === 'GET') {
      res.end(JSON.stringify(req.headers['x-goog-api-key'] ? { models: [{ name: 'models/vision', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }] } : { data: [{ id: 'vision' }] })); return;
    }
    const empty = body.model === 'empty';
    res.end(JSON.stringify(req.url?.endsWith('/responses') ? { output: empty ? [] : [{ type: 'message', content: [{ type: 'output_text', text: '绿色' }] }] } : req.url?.includes(':generateContent') ? { candidates: [{ content: { parts: [{ text: 'private thought', thought: true }, { text: '绿色' }] } }] } : req.url?.endsWith('/messages') ? { content: [{ type: 'text', text: '绿色' }] } : { choices: [{ message: { content: empty ? '' : '绿色' } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
const settings = (protocol: AiProtocol): AiSettings => ({ ...DEFAULT_AI, mode: 'api', protocol, baseUrl: protocol === 'gemini' ? `${base}/v1beta` : `${base}/v1`, model: 'vision', apiKey: 'fixture-only' });
describe('model wire contracts', () => {
  it.each(['openai', 'responses', 'anthropic', 'gemini'] as const)('%s sends images and extracts the actual answer', async (protocol) => {
    expect(await askVision(settings(protocol), '什么颜色', [Buffer.from('fixture-png')])).toBe('绿色');
    const request = seen.at(-1)!;
    expect(JSON.stringify(request.body)).toContain(Buffer.from('fixture-png').toString('base64'));
    if (protocol === 'responses') { expect(request.path).toBe('/v1/responses'); expect(request.body.store).toBe(false); expect(request.body.input[0].content[1].type).toBe('input_image'); }
    if (protocol === 'anthropic') { expect(request.path).toBe('/v1/messages'); expect(request.headers['x-api-key']).toBe('fixture-only'); }
    if (protocol === 'gemini') { expect(request.path).toBe('/v1beta/models/vision:generateContent'); expect(request.headers['x-goog-api-key']).toBe('fixture-only'); }
    if (protocol === 'openai') { expect(request.path).toBe('/v1/chat/completions'); expect(request.headers.authorization).toBe('Bearer fixture-only'); }
  });
  it.each(['openai', 'responses', 'anthropic', 'gemini'] as const)('%s discovers model identifiers', async (protocol) => {
    expect(await listModels(settings(protocol))).toEqual(['vision']);
  });
  it('does not echo upstream secrets or report an empty answer as success', async () => {
    await expect(askVision({ ...settings('responses'), apiKey: 'fail' }, 'x', [])).rejects.toThrow('401');
    await expect(askVision({ ...settings('responses'), apiKey: 'fail' }, 'x', [])).rejects.not.toThrow('secret-key');
    await expect(askVision({ ...settings('responses'), model: 'empty' }, 'x', [])).rejects.toThrow('没有返回文字');
    await expect(askVision({ ...settings('openai'), model: 'empty' }, 'x', [])).rejects.toThrow('没有返回文字');
  });
  it('honours cancellation and rejects credential-bearing URLs', async () => {
    await expect(askVision(settings('gemini'), 'x', [], AbortSignal.abort())).rejects.toThrow();
    expect(() => modelBase({ ...settings('openai'), baseUrl: 'https://user:secret@example.com' })).toThrow('不能包含');
    expect(modelBase({ ...settings('anthropic'), baseUrl: 'https://example.com/v1/messages' })).toBe('https://example.com');
  });
});
