import { contrast } from '../figma/audit.js';
import type { Color } from '../figma/types.js';

export type ReadEvidence = Map<string, Array<{ start: number; content: string }>>;

/** Generate a candidate specification; it is not a project design authority or a rendered check. */
export function makeDesignCandidate(input: unknown, readEvidence: ReadEvidence = new Map()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('设计候选必须是对象');
  const candidate = input as Record<string, unknown>;
  const required = ['name', 'basis', 'typography', 'spacing', 'unknowns'] as const;
  for (const key of required) if (typeof candidate[key] !== 'string' || !(candidate[key] as string).trim() || (candidate[key] as string).length > 1000) throw new Error(`设计候选缺少 ${key}`);
  if (!candidate.colors || typeof candidate.colors !== 'object' || Array.isArray(candidate.colors)) throw new Error('设计候选缺少颜色');
  const colors = candidate.colors as Record<string, unknown>;
  const roles = ['background', 'foreground', 'primary', 'onPrimary', 'surface', 'onSurface', 'secondary', 'onSecondary', 'success', 'onSuccess', 'warning', 'onWarning', 'danger', 'onDanger', 'focus'] as const;
  for (const role of ['background', 'foreground', 'primary', 'onPrimary']) if (!(role in colors)) throw new Error(`设计候选缺少颜色 ${role}`);
  for (const [role, value] of Object.entries(colors)) if (!roles.includes(role as typeof roles[number]) || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`颜色 ${role} 需要受支持的角色和六位十六进制值`);
  const chosenColors = Object.fromEntries(roles.filter((role) => role in colors).map((role) => [role, colors[role] as string]));
  const scaleUnits: Record<string, RegExp> = {
    fontSize: /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh))$/,
    lineHeight: /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%)?$/,
    space: /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vw|vh))$/,
    radius: /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%))$/,
    duration: /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s))$/,
  };
  const scales: Record<string, Record<string, string>> = {};
  if (candidate.scales !== undefined) {
    if (!candidate.scales || typeof candidate.scales !== 'object' || Array.isArray(candidate.scales)) throw new Error('设计变量必须是对象');
    for (const [category, raw] of Object.entries(candidate.scales)) {
      if (!Object.hasOwn(scaleUnits, category) || !raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 16) throw new Error(`不支持设计变量 ${category}`);
      scales[category] = {};
      for (const [name, value] of Object.entries(raw)) {
        if (!/^[a-z][a-z0-9-]{0,30}$/.test(name) || typeof value !== 'string' || !scaleUnits[category].test(value)) throw new Error(`设计变量 ${category}.${name} 的值无效`);
        scales[category][name] = value;
      }
    }
  }
  const sourceEvidence: Array<{ path: string; line: number; excerpt: string }> = [];
  if (candidate.sourceEvidence !== undefined) {
    if (!Array.isArray(candidate.sourceEvidence) || candidate.sourceEvidence.length > 6) throw new Error('设计依据引用格式无效');
    for (const raw of candidate.sourceEvidence) {
      if (!raw || typeof raw !== 'object' || typeof raw.path !== 'string' || typeof raw.excerpt !== 'string' || !raw.excerpt.trim() || raw.excerpt.length > 500) throw new Error('设计依据引用需要文件路径和原文');
      const chunk = readEvidence.get(raw.path)?.find((item) => item.content.includes(raw.excerpt));
      if (!chunk) throw new Error('设计依据原文未在本轮读取的文件中找到');
      const offset = chunk.content.indexOf(raw.excerpt);
      sourceEvidence.push({ path: raw.path, line: chunk.start + (chunk.content.slice(0, offset).match(/\n/g)?.length ?? 0), excerpt: raw.excerpt });
    }
  }
  const rgba = (hex: string): Color => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).concat(1) as Color;
  const pairs = [['foreground', 'background'], ['onPrimary', 'primary'], ['onSurface', 'surface'], ['onSecondary', 'secondary'], ['onSuccess', 'success'], ['onWarning', 'warning'], ['onDanger', 'danger']];
  const missingColorPairs = pairs.filter(([front, back]) => Boolean(chosenColors[front]) !== Boolean(chosenColors[back])).map(([front, back]) => ({ foregroundRole: front, backgroundRole: back, missing: chosenColors[front] ? back : front }));
  const contrastChecks = pairs.filter(([front, back]) => chosenColors[front] && chosenColors[back]).map(([front, back]) => {
    const foreground = chosenColors[front], background = chosenColors[back];
    const ratio = contrast(rgba(foreground), rgba(background));
    return { foregroundRole: front, backgroundRole: back, foreground, background, ratio: Number(ratio.toFixed(3)), normalText45: ratio >= 4.5, largeText30: ratio >= 3 };
  });
  const cssName = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const declarations = [
    ...Object.entries(chosenColors).map(([role, value]) => `  --candidate-${cssName(role)}: ${value};`),
    ...Object.entries(scales).flatMap(([category, entries]) => Object.entries(entries).map(([name, value]) => `  --candidate-${cssName(category)}-${name}: ${value};`)),
  ];
  return {
    status: 'candidate' as const,
    name: candidate.name, basis: candidate.basis, typography: candidate.typography, spacing: candidate.spacing, unknowns: candidate.unknowns,
    colors: chosenColors, scales, sourceEvidence, provenance: sourceEvidence.length ? 'quoted-from-read' as const : 'unverified' as const,
    css: `:root {\n${declarations.join('\n')}\n}`,
    contrastChecks, missingColorPairs,
    limitations: '候选颜色的纯色对比计算，不代表实际页面、透明度、状态、视觉效果或可访问性已通过；候选不会自动写入项目。',
  };
}
