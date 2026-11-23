import { posix } from 'node:path';
import type { CheckResult } from './run.js';
import { ruleDescription } from '../rules/catalog.js';

export function directoryCounts(files: Iterable<string>): Record<string, number> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const dir = posix.dirname(file);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => a.localeCompare(b)));
}

export interface SourceCoverage {
  requested: string;
  directories: Record<string, number>;
  contextDirectories: Record<string, number>;
  excludedDirectories: string[];
  reachedFileLimit: boolean;
  ruleSkips: Array<{ rule: string; reason: 'scope' | 'library' | 'library-intrinsics' | 'no-components' | 'no-files'; directories: Record<string, number> }>;
}

export function coverageLines(result: CheckResult, language: 'en' | 'zh' = 'zh'): string[] {
  const en = language === 'en', c = result.coverage;
  if (!c) return [en ? 'This older report did not record directory or rule coverage.' : '此历史报告未记录目录和规则覆盖范围。'];
  const dirs = (counts: Record<string, number>) => Object.entries(counts).map(([dir, n]) => dir + ' (' + n + ')').join(', ') || '—';
  const lines = [
    (en ? 'Project root · ' : '项目根目录 · ') + result.productRoot,
    (en ? 'Requested path (relative to project root) · ' : '请求路径（相对项目根目录）· ') + c.requested,
    (en ? 'Scanned directories (files) · ' : '实际扫描目录（文件数）· ') + dirs(c.directories),
  ];
  if (Object.keys(c.contextDirectories).length) lines.push((en ? 'Additional context only (files) · ' : '仅作比对的其他目录（文件数）· ') + dirs(c.contextDirectories));
  if (c.excludedDirectories.length) lines.push((en ? 'Excluded directories · ' : '遍历时排除的目录 · ') + c.excludedDirectories.join(', '));
  if (c.reachedFileLimit) lines.push(en ? 'File discovery reached its limit. Coverage may be incomplete.' : '已达文件遍历上限，覆盖可能不完整。');
  if (result.library.source === 'convention' && !result.library.components && !result.library.tokens) lines.push(en ? 'Library inferred from its path; no components or tokens identified.' : '组件库由目录惯例推断，识别到 0 个组件和 0 个 Token。');
  const reasons = en ? {scope:'outside rule scope',library:'library excluded','library-intrinsics':'native elements excluded inside library','no-components':'no library components available for mapping','no-files':'no scanned files'} : {scope:'超出规则适用范围', library:'跳过组件库文件','library-intrinsics':'组件库内仅跳过原生元素','no-components':'未识别到可用于映射的组件','no-files':'没有成功扫描的文件'};
  const label = (id: string) => en ? id : ruleDescription(id);
  const skips = [...result.rules.disabled.map(d => label(d.id) + ' · ' + d.reason),
    ...c.ruleSkips.map(s => label(s.rule) + ' · ' + reasons[s.reason] + ' · ' + dirs(s.directories))];
  if (result.rules.basic === null) skips.unshift(en ? 'Basic rules pack disabled by project configuration; only configured rules run.' : '项目关闭了默认基础规则包，本轮只运行已配置的规则。');
  lines.push((en ? 'Skipped rules / scopes · ' : '跳过的规则及范围 · ') + (skips.shift() ?? (en ? 'None' : '无')), ...skips);
  return lines;
}
