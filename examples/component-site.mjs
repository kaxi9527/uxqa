import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export function createComponentSite() {
  return createServer((request,response) => {
    const events = request.url === '/events';
    response.setHeader('Content-Type','text/html; charset=utf-8');
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${events ? 'Events':'Projects'}</title>
<style>body{margin:0;font:14px/1.5 Arial,sans-serif;color:#20242b;background:#f7f9fa}header{padding:16px 24px;background:white;border-bottom:1px solid #dce2e6}nav{display:flex;gap:20px}a{color:#1269aa}main{padding:24px;max-width:900px;margin:auto}h1{font-size:24px}h2{font-size:18px}article{padding:${events?'20px':'16px'};background:${events?'#e8f5ee':'#fff'};border:1px solid #ccd9d2;border-radius:6px;max-width:400px}button{font:inherit;padding:8px 14px;border:1px solid #1269aa;background:white;color:#1269aa;border-radius:4px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #b35b15;outline-offset:3px}dialog{border:1px solid #ccd9d2;padding:20px;max-width:350px;border-radius:6px}dialog::backdrop{background:#0003}@media(max-width:500px){main{padding:16px}article{max-width:none}}</style></head>
<body><header><nav aria-label="Primary"><a href="/projects">Projects</a><a href="/events">Events</a></nav></header><main><h1>${events?'Events':'Projects'}</h1>
<article><h2>${events?'Community review':'Workspace refresh'}</h2><p>${events?'Friday · 14:00':'Updated today · 3 contributors'}</p><button type="button" onclick="document.querySelector('dialog').showModal()">Details</button></article>
<dialog aria-labelledby="details-title"><h2 id="details-title">Details</h2><p>Review the current record.</p><button type="button" onclick="document.querySelector('dialog').close()">Close</button></dialog></main></body></html>`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.UXQA_DEMO_PORT ?? 9123);
  const server = createComponentSite();
  server.listen(port,'127.0.0.1',() => console.log(`QA fixture: http://127.0.0.1:${port}/projects`));
  process.once('SIGTERM',() => server.close());
  process.once('SIGINT',() => server.close());
}
