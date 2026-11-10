import { access } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { formatPrompt } from './check/format.js';
import { runCheck } from './check/run.js';
import { isScannable } from './check/scan.js';
import { findProductRoot } from './inventory/read.js';

interface ClaudeHookEvent {
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; edits?: unknown[] };
  cwd?: string;
}

/**
 * Claude Code PostToolUse hook for Write/Edit/MultiEdit.
 * - New "must" problems: exit 2 with a precise fix prompt on stderr, which Claude Code hands back to the model.
 * - Only softer problems: exit 0 with additionalContext so the model sees them without being interrupted.
 * - Anything unrelated (other tools, non-code files, files outside a product): exit 0 silently.
 */
export async function runClaudeHook(fallbackSource: string, stdin: string, rulesPath?: string): Promise<number> {
  let event: ClaudeHookEvent;
  try { event = JSON.parse(stdin || '{}'); } catch { return 0; }
  const raw = event.tool_input?.file_path;
  if (!raw || !['Write', 'Edit', 'MultiEdit'].includes(event.tool_name ?? '')) return 0;
  const file = isAbsolute(raw) ? raw : resolve(event.cwd ?? fallbackSource, raw);
  if (!isScannable(file) || !(await access(file).then(() => true, () => false))) return 0;
  const productRoot = await findProductRoot(dirname(file));
  const baseline = join(productRoot, '.uxqa/baseline.json');
  const result = await runCheck({
    source: dirname(file), files: [file], rulesPath,
    baselinePath: await access(baseline).then(() => baseline, () => undefined),
  });
  const fresh = result.violations.filter((violation) => violation.status === 'new');
  if (!fresh.length) return 0;
  if (result.summary.newMust) {
    process.stderr.write(`uxqa：刚写入的 ${result.violations[0]?.file ?? raw} 绕过了组件库或项目规则，请先修好再继续。\n\n${formatPrompt(result)}`);
    return 2;
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `uxqa 提醒（不阻断）：\n${formatPrompt(result)}`,
    },
  }));
  return 0;
}
