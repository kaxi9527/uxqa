import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceSnapshot } from '../src/library/snapshot.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'uxqa-snapshot-test-'));
  roots.push(root);
  return root;
}

test('hashes a large native authority manifest and detects changes to it', async () => {
  const root = await fixtureRoot();
  const file = join(root, 'frontend-local-authority-manifest.json');
  await writeFile(file, JSON.stringify({ evidence: 'a'.repeat(1_200_000) }));
  const before = await sourceSnapshot(root);
  expect(before['frontend-local-authority-manifest.json']).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(file, JSON.stringify({ evidence: 'a'.repeat(1_200_000), revision: 2 }));
  const after = await sourceSnapshot(root);
  expect(after['frontend-local-authority-manifest.json']).not.toBe(before['frontend-local-authority-manifest.json']);
});

test('keeps the single-file bound', async () => {
  const root = await fixtureRoot();
  await writeFile(join(root, 'oversized.json'), 'a'.repeat(2_000_001));
  await expect(sourceSnapshot(root)).rejects.toThrow('Verification snapshot exceeds limits');
});

test('keeps the aggregate byte bound', async () => {
  const root = await fixtureRoot();
  const content = 'a'.repeat(1_100_000);
  for (let index = 0; index < 30; index++) await writeFile(join(root, `${index}.json`), content);
  await expect(sourceSnapshot(root)).rejects.toThrow('Verification snapshot exceeds limits');
});
