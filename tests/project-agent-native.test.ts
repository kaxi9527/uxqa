import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { engineRequest, stopEngine } from '../src/ai/engine.js';
import { writeAiSettings } from '../src/ai/model.js';
import { getProjectAgent, startProjectAgent, stopProjectAgents } from '../src/ui/project-agent.js';
import { addProject } from '../src/ui/store.js';

it.skipIf(!process.env.UXQA_TEST_MODEL_CORE)('converses through the real bundled model core with an isolated provider', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uxqa-agent-native-home-'));
  const projectRoot = await mkdtemp(join(tmpdir(), 'uxqa-agent-native-project-'));
  const previous = { home: process.env.UXQA_HOME, core: process.env.UXQA_MODEL_CORE };
  process.env.UXQA_HOME = home;
  process.env.UXQA_MODEL_CORE = process.env.UXQA_TEST_MODEL_CORE;
  let received = '';
  const vendor = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    received += body;
    const input = JSON.parse(body || '{}');
    const answer = JSON.stringify({ type: 'answer', text: 'Native provider conversation works.' });
    if (input.stream) {
      response.setHeader('content-type', 'text/event-stream');
      response.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ id: 'fixture', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      response.end('data: [DONE]\n\n');
    } else {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    }
  });
  await new Promise<void>((done) => vendor.listen(0, '127.0.0.1', done));
  const address = vendor.address();
  if (!address || typeof address === 'string') throw new Error('Expected fixture listener');
  try {
    await mkdir(join(projectRoot, 'src'));
    const entry = await addProject(projectRoot, 'Native fixture');
    const provider = await engineRequest('/providers', { name: 'Local test provider', protocol: 'openai', baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: 'fixture-only', models: ['test-model'] }) as { id: string };
    await writeAiSettings({ mode: 'api', protocol: 'openai', connection: 'native', baseUrl: '', model: `${provider.id}/test-model`, passes: 1, verify: false, discover: false, maxCalls: 8 });
    await startProjectAgent(entry, { text: 'Review this page.' });
    let final = await getProjectAgent(entry.id);
    for (let i = 0; final.running && i < 200; i++) { await new Promise((done) => setTimeout(done, 50)); final = await getProjectAgent(entry.id); }
    expect(final.running).toBe(false);
    expect(final.messages.at(-1)?.text).toBe('Native provider conversation works.');
    expect(received).toContain('本次没有截图');
  } finally {
    await stopProjectAgents(); await stopEngine();
    await new Promise<void>((done) => vendor.close(() => done()));
    if (previous.home === undefined) delete process.env.UXQA_HOME; else process.env.UXQA_HOME = previous.home;
    if (previous.core === undefined) delete process.env.UXQA_MODEL_CORE; else process.env.UXQA_MODEL_CORE = previous.core;
    await rm(home, { recursive: true, force: true }); await rm(projectRoot, { recursive: true, force: true });
  }
}, 40_000);
