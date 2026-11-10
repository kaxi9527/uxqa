// Serves examples/check-fixture-site as a stand-in "product preview" for console demos and tests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const html = await readFile(join(dirname(fileURLToPath(import.meta.url)), '../examples/check-fixture-site/index.html'), 'utf8');
const port = Number(process.env.PORT ?? 4871);
createServer((request, response) => {
  if (request.url !== '/' && request.url !== '/orders') { response.writeHead(404); response.end('not found'); return; }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
}).listen(port, '127.0.0.1', () => console.log(`fixture site: http://127.0.0.1:${port}/`));
