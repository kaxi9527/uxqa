import { startConsole } from '../ui/server.js';
import { stopEngine } from '../ai/engine.js';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./uxqa.mjs', import.meta.url));
if (existsSync(cli)) process.env.UXQA_CLI_ENTRY = cli;
const server = await startConsole();
// Private pipe to the native host. This URL contains an ephemeral token; never log it to disk.
process.stdout.write(`${JSON.stringify({ url: server.url })}\n`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  await stopEngine();
  await server.close();
  clearTimeout(force);
  process.exit(0);
}
process.once('SIGTERM', () => void close());
process.once('SIGINT', () => void close());
// If the app crashes or is force-quit, its pipe closes; the child does not outlive it.
process.stdin.resume();
process.stdin.once('end', () => void close());
