import type { Color, FigmaCheck, FigmaChunk, FigmaComponent, FigmaIndex, FigmaReport } from './types.js';

export function composite(foreground: Color, background: Color): Color {
  return [0, 1, 2].map(i => foreground[i] * foreground[3] + background[i] * (1 - foreground[3])).concat(1) as Color;
}
export function contrast(a: Color, b: Color): number {
  const luminance = (c: Color) => c.slice(0, 3).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
    .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
const INPUT = /(?:\bInput\b|\bTextarea\b|\bSelect\b|\bCombobox\b|\bField\b|ChatComposer|输入框|文本域)/i;
const CONTROL = /(?:\bButton\b|IconButton|\bCheckbox\b|\bRadio\b|\bSwitch\b|\bToggle\b|\bRating\b|\bTag\b|SubagentSwitcher)/i;
const NOTICE = /(?:\bToast\b|ToastShell|\bAlert\b)/i;
const PLACEHOLDER = /^(?:按钮|选项|好的|确认|页面标题|标题文本|占位文本|button|label|your text|title here)$/i;
const STATE = /^(?:state|interaction|状态|交互状态)$/i;
const DEFAULT = /^(?:default|normal|rest|idle|enabled|默认|正常)$/i;
const ACTIVE = /^(?:hover|hovered|pressed|active|focus|focused|focus-visible|悬停|按下|聚焦)$/i;

export function auditFigma(index: FigmaIndex, chunks: FigmaChunk[], inputHashes: Record<string, string> = {}): FigmaReport {
  const components = chunks.flatMap(c => c.components), seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.id)) throw new Error(`Duplicate component across chunks: ${c.id}`);
    seen.add(c.id);
  }
  const missingIds = index.componentIds.filter(id => !seen.has(id));
  const checks: FigmaCheck[] = [];
  const add = (c: FigmaComponent, rule: string, status: FigmaCheck['status'], message: string, extra: Partial<FigmaCheck> = {}) => {
    checks.push({ rule, status, nodeId: c.id, component: `${c.setName} / ${c.name}`, message, ...extra });
  };
  for (const token of index.tokenObservations || []) checks.push({ rule: 'brand-token-contract', status: token.actual === null ? 'not-verified' : token.actual.every((v, i) => Math.abs(v - token.expected[i]) < .0001) ? 'pass' : 'fail', nodeId: index.pageId, component: index.pageName, theme: token.theme, message: `${token.id}: expected ${JSON.stringify(token.expected)}, actual ${JSON.stringify(token.actual)}` });
  for (const c of components) {
    for (const font of c.fonts || []) if ((index.forbiddenFonts || []).some(x => font.toLowerCase().startsWith(x.toLowerCase()))) add(c, 'brand-font-contract', 'fail', `使用了项目明确禁用的字体：${font}`);
    if (index.allowedColorPrefixes?.length) {
      const outside = (c.paintBindings || []).filter(b => !index.allowedColorPrefixes!.some(prefix => b.name.startsWith(prefix)));
      if (outside.length) add(c, 'color-binding-contract', 'review', `颜色未走声明的产品别名前缀：${outside.map(b => b.name).join(', ')}；需确认继承或例外。`);
      if (c.unboundPaints) add(c, 'unbound-paint', 'review', `${c.unboundPaints} 处实色画笔未绑定变量；包含图标内部笔画，需区分业务配色与保留笔触。`);
    }
    if (c.disabled) { add(c, 'disabled-exclusion', 'excluded', '禁用变体不适用对比度、点击尺寸及状态反馈要求。'); continue; }
    if (CONTROL.test(c.setName)) {
      const size = Math.min(c.width, c.height);
      add(c, 'target-size', size >= 24 ? 'pass' : 'review', size >= 24 ? '组件设计边界至少 24×24；实际点击绑定仍需代码验证。' : '组件边界小于 24；需核对是否有外部热区或适用例外。', { observed: +size.toFixed(2), threshold: 24 });
    }
    for (const h of c.hitRegions) {
      add(c, 'hit-region-size', Math.min(h.width, h.height) >= 24 ? 'pass' : 'review', '命名热区的设计尺寸；不证明它已绑定点击行为。', { nodeId: h.id, observed: Math.min(h.width, h.height), threshold: 24 });
    }
    for (let i = 0; i < c.hitRegions.length; i++) for (let j = i + 1; j < c.hitRegions.length; j++) {
      const a = c.hitRegions[i], b = c.hitRegions[j];
      if (Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y))
        add(c, 'hit-region-overlap', 'review', `命名热区 ${a.id} 与 ${b.id} 的矩形相交；核对层级与预期命中。`, { nodeId: a.id });
    }
    for (const t of c.themes) {
      for (const reason of t.unknown) add(c, 'capture-coverage', /^(missing-variable|alias-cycle|missing-collection):/.test(reason) ? 'fail' : 'not-verified', reason, { theme: t.theme });
      for (const s of t.texts) {
        if (s.disabled) { add(c, 'disabled-exclusion', 'excluded', '嵌套禁用控件文字不参与对比度检查。', { nodeId: s.id, theme: t.theme }); continue; }
        if (!s.foreground || !s.background || s.background[3] !== 1 || s.fontSize === null || (s.bold === null && s.fontSize < 24)) {
          add(c, 'text-contrast', 'not-verified', '文字颜色、背景或字号/字重未完整解析，不能计算可靠对比度。', { nodeId: s.id, theme: t.theme });
        } else {
          const ratio = contrast(composite(s.foreground, s.background), s.background);
          const threshold = s.fontSize >= 24 || (s.bold && s.fontSize >= 18.6667) ? 3 : 4.5;
          add(c, 'text-contrast', ratio >= threshold ? 'pass' : 'fail', '按当前主题、透明度和文字大小计算的设计对比度。', { nodeId: s.id, theme: t.theme, observed: +ratio.toFixed(3), threshold });
        }
        if (s.clipped) add(c, 'text-clipping', 'review', '文字边界超出启用裁切的祖先；需截图核对实际字形与裁切意图。', { nodeId: s.id, theme: t.theme });
      }
      if (INPUT.test(c.setName)) {
        const b = t.boundary;
        if (!b?.color || !b.inside || !b.outside || !b.weight || b.color[3] === 0) {
          add(c, 'control-boundary', 'not-verified', '未找到可可靠计算的输入边界；需核对容器、填充差异或语义识别。', { theme: t.theme });
        } else {
          const ratio = Math.min(contrast(composite(b.color, b.inside), b.inside), contrast(composite(b.color, b.outside), b.outside));
          add(c, 'control-boundary', ratio >= 3 ? 'pass' : 'review', '描边相对内外背景的最小对比度；失败候选需核对是否由其他可见边界承担识别。', { nodeId: b.id, theme: t.theme, observed: +ratio.toFixed(3), threshold: 3 });
        }
      }
    }
    for (const s of c.themes[0].texts) if (PLACEHOLDER.test(s.text.trim()))
      add(c, 'copy-placeholder', 'review', `泛化或占位文案“${s.text.trim()}”；结合业务语义判断，不能自动替换。`, { nodeId: s.id });
    for (const icon of c.icons) if (icon.startsWith('MISSING:')) add(c, 'icon-reference', 'fail', '图标主组件引用无法解析。', { nodeId: icon.slice(8) });
    if (NOTICE.test(c.setName) && !c.icons.length) add(c, 'notice-icon', 'review', '未找到可识别的图标实例；可能使用了向量图形，需要人工确认语气是否只靠颜色。');
  }
  for (const c of components.filter(c => !c.disabled)) {
    const stateEntry = Object.entries(c.properties).find(([k]) => STATE.test(k));
    if (!stateEntry || !ACTIVE.test(stateEntry[1])) continue;
    const [key, state] = stateEntry;
    const equivalent = (other: FigmaComponent) => other.setId === c.setId && Object.keys(other.properties).length === Object.keys(c.properties).length && Object.entries(c.properties).every(([k, v]) => k === key || other.properties[k] === v);
    const bases = components.filter(other => !other.disabled && equivalent(other) && DEFAULT.test(other.properties[key] || ''));
    if (bases.length !== 1) { add(c, 'state-feedback', 'not-verified', `${state} 找不到唯一的同组默认变体。`); continue; }
    for (const t of c.themes) {
      const base = bases[0].themes.find(x => x.theme === t.theme)!;
      add(c, 'state-feedback', !t.appearance || !base.appearance ? 'not-verified' : t.appearance === base.appearance ? 'review' : 'pass',
        !t.appearance || !base.appearance ? '存在未解析样式，无法比较完整外观。' : t.appearance === base.appearance ? `${state} 与默认变体的可见外观相同；核对是否缺少反馈。` : `${state} 与同组默认变体的可见外观有区别。`, { theme: t.theme });
    }
  }
  const notices = components.filter(c => NOTICE.test(c.setName) && !c.disabled && c.icons.length);
  for (const c of notices) {
    const entry = Object.entries(c.properties).find(([k]) => /^(tone|intent|severity|语气)$/i.test(k));
    if (!entry) continue;
    const [key, tone] = entry;
    const collision = notices.find(other => other.id !== c.id && other.setId === c.setId && other.properties[key] !== tone && Object.entries(c.properties).every(([k, v]) => k === key || other.properties[k] === v) && JSON.stringify(other.icons) === JSON.stringify(c.icons));
    if (collision) add(c, 'notice-tone-icons', 'review', `${tone} 与 ${collision.properties[key]} 使用同一组图标，需核对非颜色语义。`);
  }
  const summary = { pass: 0, fail: 0, review: 0, 'not-verified': 0, excluded: 0 };
  for (const check of checks) summary[check.status]++;
  const captureEnd = [index.capturedAt, ...chunks.map(c => c.capturedAt)].sort().at(-1)!;
  const sets = new Map<string, FigmaComponent[]>();
  for (const c of components) { const id = c.setId || c.id; sets.set(id, [...(sets.get(id) || []), c]); }
  const catalog = [...sets].map(([id, variants]) => ({ id, name: variants[0].setName, variants: variants.length, componentIds: variants.map(c => c.id), dependencies: [...new Set(variants.flatMap(c => (c.dependencies || []).map(d => d.name)))].sort(), fonts: [...new Set(variants.flatMap(c => c.fonts || []))].sort() }));
  const shapes = new Map<string, Map<string, string>>();
  for (const c of components) if (c.structure && c.structure.nodes >= 4) {
    const groups = shapes.get(c.structure.signature) || new Map<string, string>(); groups.set(c.setId || c.id, c.setName); shapes.set(c.structure.signature, groups);
  }
  const candidateKeys = new Set<string>(), mergeCandidates: FigmaReport['mergeCandidates'] = [];
  for (const groups of shapes.values()) if (groups.size > 1) {
    const ids = [...groups.keys()].sort(), key = ids.join('|'); if (candidateKeys.has(key)) continue; candidateKeys.add(key);
    mergeCandidates.push({ sets: ids, names: ids.map(id => groups.get(id)!), reason: '至少一个变体具有相同的可见节点类型/层级骨架。需进一步核对业务目的、信息模型、交互行为和属性合同；结构相同本身不构成合并结论。', requiresSemanticReview: true });
  }
  return {
    schemaVersion: 1, source: { schemaVersion: 1, exportId: index.exportId, fileKey: index.fileKey, pageId: index.pageId, capturedAt: index.capturedAt, pageName: index.pageName, captureEnd, inputHashes },
    status: missingIds.length ? 'partial' : 'complete', verdict: summary.fail ? 'issues-found' : missingIds.length || summary.review || summary['not-verified'] ? 'needs-review' : 'limited-pass',
    coverage: { expectedComponents: index.componentIds.length, capturedComponents: components.length, missingIds, themes: index.themes }, summary, checks, catalog, mergeCandidates,
    limitations: [
      '仅审计索引中的原生组件主件；页面中的独立实例、模板组合和运行时代码不包含在此覆盖中。',
      '分批采集不是原子快照；报告记录采集窗口和每个输入文件哈希。重新设计后必须重新采集。',
      '尺寸、边界、外观指纹、裁切与图标检查是设计证据；不证明实际点击、Tab 顺序、焦点管理、ARIA 或读屏行为。',
      '渐变、图片背景、复杂效果、混合文字和分组透明度无法可靠计算时明确标记未验证，不推测颜色。',
      '文案及交互角色识别采用保守的名称启发式；业务语义、图标视觉辨识与状态是否齐全仍需人工审查。',
      '即使 limited-pass 也只表示已执行的设计规则通过，不是整库或产品可访问性认证。',
    ],
  };
}
