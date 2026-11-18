import { createServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// A disposable service for the two example journeys. All identities, time and data live in memory.
export function createFixture(fault) {
  let hour = 0, published = 24;
  const registrations = new Map();
  let assigned = [['old', 'A']];
  let preview = [];
  const button = (name, caption) => `<form method="post" action="/${name}"><button>${caption}</button></form>`;
  const list = (rows) => `<ul id="tasks" data-total="${rows.length}">${(fault === 'partial' ? rows.slice(1) : rows).map(([item, actor]) => `<li data-stage="S" data-item="${item}" data-actor="${actor}">${item} / ${actor}</li>`).join('')}</ul>`;
  return createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    const actor = /(?:^|; )actor=(owner|A|B|target|control)(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    const end = (body) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<main>' + body + '</main>'); };
    if (path.startsWith('/session/')) {
      const identity = path.slice(9);
      if (!['owner', 'A', 'B', 'target', 'control'].includes(identity)) { res.writeHead(404).end(); return; }
      res.setHeader('set-cookie', 'actor=' + identity + '; HttpOnly; SameSite=Strict; Path=/');
      return end('<output>' + identity + '</output>');
    }
    if (path === '/') return end('Business journey fixture');
    if (!actor) { res.writeHead(403).end(); return; }
    if (actor === 'owner' && path === '/settings') return end(`<form action="/publish" method="post"><label>Hours<input name="hours" value="${published}"></label><button>Publish</button></form>`);
    if (actor === 'owner' && path === '/publish' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const hours = Number(new URLSearchParams(body).get('hours'));
      if (hours !== 48) { res.writeHead(400).end(); return; }
      published = hours;
      return end('<output>Published 48</output>');
    }
    if (actor === 'owner' && path === '/clock') return end(button('advance', 'Advance 25h'));
    if (actor === 'owner' && path === '/advance' && req.method === 'POST') { hour += 25; return end('<output>' + hour + '</output>'); }
    if (actor === 'control' || actor === 'target') {
      const limit = actor === 'target' || fault === 'scope' ? published : 24;
      if (path === '/event') return end('<output>' + limit + ' hours</output>' + button('register', 'Register'));
      if (path === '/register' && req.method === 'POST') {
        registrations.set(actor, { deadline: hour + (fault === 'stale' ? 24 : limit), complete: false });
        return end('<output>Registered · ' + limit + ' hours</output>');
      }
      const record = registrations.get(actor);
      if (record && path === '/complete') return end(button('save', 'Save details'));
      if (record && path === '/save' && req.method === 'POST') { record.complete = hour < record.deadline; return end('<output>Saved</output>'); }
      if (record && path === '/eligibility') return end('<output>' + (record.complete ? 'Eligible' : hour >= record.deadline ? 'Expired' : 'Pending') + '</output>');
    }
    if (path === '/tasks') return end(list(actor === 'owner' ? assigned : assigned.filter(([, to]) => to === actor)));
    if (actor === 'owner') {
      if (path === '/allocate') return end(button('preview', 'Preview'));
      if (path === '/preview' && req.method === 'POST') {
        const items = randomInt(2) ? ['one', 'two'] : ['two', 'one'];
        preview = [[items[0], 'A'], [items[1], 'B']];
        return end(list(preview) + button('confirm', 'Confirm') + button('cancel', 'Cancel'));
      }
      if (path === '/pending') return end(list(preview) + button('confirm', 'Confirm') + button('cancel', 'Cancel'));
      if (path === '/confirm' && req.method === 'POST') {
        assigned = fault === 'swapped' ? preview.map(([item, to]) => [item, to === 'A' ? 'B' : 'A']) : [...preview];
        if (fault === 'duplicate') assigned = [assigned[0], assigned[0]];
        preview = [];
        return end('<output>Confirmed</output>');
      }
      if (path === '/cancel' && req.method === 'POST') {
        if (fault === 'cancel') assigned = [...preview];
        preview = [];
        return end('<output>Cancelled</output>');
      }
    }
    res.writeHead(404).end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createFixture().listen(4189, '127.0.0.1', () => console.log('Disposable test service at http://127.0.0.1:4189. Restart to reset the data.'));
}
