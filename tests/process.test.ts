import { describe, expect, it } from 'vitest';
import { runProcess } from '../src/components/process.js';

describe('analysis subprocesses', () => {
  it('reports exit failure and terminates a timed-out process', async () => {
    await expect(runProcess(process.execPath, ['-e', 'process.exit(7)'], process.cwd(), 3000)).rejects.toThrow(/7/);
    await expect(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), 100)).rejects.toThrow(/timed out/i);
  });
});
