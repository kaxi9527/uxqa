import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from './targets.mjs';

// Build only UXQA's private entry point. No upstream app or account files are copied.
export async function buildModelCore(target, into) {
  const [platform, architecture] = target.split('-');
  const goos = platform === 'win' ? 'windows' : platform;
  const goarch = architecture === 'x64' ? 'amd64' : architecture;
  const go = process.env.UXQA_GO ?? 'go';
  const source = join(ROOT, 'native/model-core');
  await mkdir(into, { recursive: true });
  const binary = join(into, goos === 'windows' ? 'uxqa-model-core.exe' : 'uxqa-model-core');
  const env = { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: '0', GOMAXPROCS: '2', GOTOOLCHAIN: 'local' };
  // CI explicitly downloads locked modules before this step. Local builds reuse cache offline.
  env.GOPROXY = 'off';
  env.GOSUMDB = 'off';
  const args = ['build', '-p', '2', '-mod=readonly', '-trimpath', '-buildvcs=false', '-ldflags=-s -w', '-o', binary, './cmd/uxqa-core'];
  const result = spawnSync(go, args, { cwd: source, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`model core ${target}: ${(result.stderr || result.error?.message || '').slice(0, 2200)}`);
  for (const file of ['LICENSE', 'NOTICE.md', 'UPSTREAM-MANIFEST.json']) await copyFile(join(source, file), join(into, file));
  // Keep license texts for dependencies actually reachable from the shipped entry point.
  const modules = spawnSync(go, ['list', '-deps', '-f', '{{if .Module}}{{.Module.Dir}}{{end}}', './cmd/uxqa-core'], { cwd: source, env, encoding: 'utf8' });
  if (modules.status !== 0) throw new Error(`Cannot collect model-core license provenance: ${modules.stderr.slice(0, 1000)}`);
  const notices = [];
  for (const dir of [...new Set(modules.stdout.trim().split(/\r?\n/).filter(Boolean))].sort()) {
    if (dir === source) continue;
    const files = (await readdir(dir)).filter((name) => /^(license|copying|notice)(\.|$)/i.test(name));
    if (!files.length) throw new Error(`Dependency has no root license: ${dir.split(/[\\/]/).pop()}`);
    for (const name of files) notices.push(`=== ${dir.split(/[\\/]pkg[\\/]mod[\\/]/).pop().replaceAll('\\', '/')} / ${name} ===\n${await readFile(join(dir, name), 'utf8')}`);
  }
  await writeFile(join(into, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n'));
  return binary;
}
