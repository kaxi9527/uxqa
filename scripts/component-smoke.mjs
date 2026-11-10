import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createComponentSite } from '../examples/component-site.mjs';
import { loadConfig } from '../dist/src/config.js';
import { auditComponents } from '../dist/src/components/audit.js';
import { writeComponentReports } from '../dist/src/components/reports.js';

const root = fileURLToPath(new URL('../',import.meta.url));
const server = createComponentSite();
await new Promise((done) => server.listen(0,'127.0.0.1',done));
try {
  const raw = JSON.parse(await readFile(resolve(root,'examples/component-audit.json'),'utf8'));
  raw.baseUrl = `http://127.0.0.1:${server.address().port}`;
  const outDir = resolve(root,`artifacts/component-smoke-${Date.now()}`);
  const audit = await auditComponents(loadConfig(raw),{outDir,sourceDir:resolve(root,'examples/component-source')});
  const reports = await writeComponentReports(audit,outDir);
  const card = audit.candidates.find((candidate) => candidate.family==='card');
  if (audit.status!=='complete' || !card || !audit.source.duplicates.length || !audit.source.components.length ||
      !audit.source.css.analyses.length || audit.source.reuse.sharedComponents<1) throw new Error('Component smoke did not meet acceptance criteria');
  console.log(JSON.stringify({status:audit.status,candidates:audit.candidates.length,observations:audit.observations.length,
    coverage:audit.coverage.length,sourceClones:audit.source.duplicates.length,existingReactComponents:audit.source.components.length,
    tools:audit.tools.map(({name,version,status}) => ({name,version,status})),report:reports.htmlPath},null,2));
} finally { await new Promise((done) => server.close(done)); }
