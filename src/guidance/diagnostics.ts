import { GUIDES } from './guides.js';
import { localizedGuide } from './guides.en.js';
import { ENGLISH_DIAGNOSTIC_CASES, ENGLISH_FOCUS_TITLES } from './diagnostics.en.js';
import { issueGuidance } from './issues.js';
import type { Round } from '../ui/store.js';
import { ISSUE_STATES, type IssueWorkflow } from '../ui/issue-workflow.js';
import type { IssueDomain } from './types.js';

export const KNOWLEDGE_VERSION = 'uxqa-quality-2';
export interface DiagnosisTask { id: string; topic: string; domain: IssueDomain; check: string; fix: string; verify: string }
export interface DiagnosisFocus { id: string; title: string; topics: string[] }
export const DIAGNOSIS_FOCUSES: DiagnosisFocus[] = [
  { id: 'overall', title: '完整质量诊断', topics: GUIDES.map((guide) => guide.id) },
  { id: 'hierarchy', title: '信息层级与布局', topics: ['hierarchy', 'spacing', 'patterns', 'navigation', 'typography', 'craft'] },
  { id: 'system', title: '设计一致性与组件', topics: ['context', 'components', 'color', 'typography', 'spacing', 'assets', 'charts', 'platforms'] },
  { id: 'task', title: '任务流程与文案', topics: ['navigation', 'forms', 'states', 'copy', 'onboarding', 'localization', 'accessibility'] },
  { id: 'resilience', title: '边界状态与恢复', topics: ['forms', 'states', 'localization', 'responsive', 'accessibility', 'review'] },
  { id: 'adaptive', title: '跨屏与平台体验', topics: ['responsive', 'platforms', 'gestures', 'motion-accessibility', 'localization', 'assets'] },
  { id: 'motion', title: '动效与连续操作', topics: ['motion-purpose', 'motion-timing', 'motion-interruption', 'motion-accessibility', 'performance', 'gestures'] },
  { id: 'performance', title: '响应与渲染性能', topics: ['performance', 'assets', 'components', 'charts', 'motion-timing', 'motion-interruption'] },
  { id: 'polish', title: '视觉细节与表达', topics: ['craft', 'typography', 'color', 'spacing', 'assets', 'copy', 'charts'] },
  { id: 'alternatives', title: '方案取舍与修复评估', topics: ['context', 'patterns', 'prototype', 'craft', 'platforms', 'review'] },
];

/** Independently authored scenario knowledge; none of these checks is marked passed merely by generating a plan. */
export const DIAGNOSTIC_CASES: Record<string, string[]> = {
  context: ['用一句话写出目标用户、任务终点与失败代价；不同角色分别说明。', '核对设计稿、现有组件、业务规则和实现；冲突先记录，不能由通用建议替用户决策。', '区分品牌必须保留的部分、允许调整的部分，以及本轮明确不涉及的范围。'],
  hierarchy: ['首屏隐藏装饰后，用户仍能指出当前任务、关键信息和下一步。', '对大量同权重内容执行一次查找和一次比较任务，判断列表、分组或渐进展开是否更合适。', '检查主按钮、次要操作、警告和说明的阅读顺序，避免每块内容都争夺最高优先级。'],
  typography: ['使用最短、最长、中英混排、连续数字及缩放后的真实文本检查换行与基线。', '检查字体回退、数字对齐和文本加载前后位移；不要把未安装字体当作设计事实。', '按标题、正文、辅助信息核对字号、字重和行高；长内容优先调整容器，不以缩字掩盖溢出。'],
  color: ['分别核对常态、悬停、选中、焦点、禁用、错误和高对比偏好；语义不能只靠颜色。', '用项目 Token 对照前景/背景/边框组合，发现偏离时区分错误和已批准的品牌例外。', '新配色建议说明语义用途与对比验证方法，不把个人喜欢的风格强制套给项目。'],
  spacing: ['检查同一任务区域的对齐锚点、组内与组间距离，说明空间关系而非只列像素差。', '容器边距、阅读宽度与操作密度应随可用空间调整；检查侧栏、工具栏和长内容共同出现的状态。', '区分有业务含义的不同尺寸和无意的漂移；先使用项目已有间距档位。'],
  components: ['确认相同业务语义是否使用已有组件及变体，不能只凭外观相似要求合并。', '检查默认、加载、禁用、错误、空状态以及键盘行为是否由组件共同维护。', '新能力优先提出对现有组件的改动方案，列出调用方、兼容性和组件同步验证，不直接写库。'],
  responsive: ['在窄屏、横屏、放大文本和内容变长时分别验证，而不是只缩小截图。', '检查固定/粘性区域是否遮挡内容、焦点和底部操作，必要时调整布局层级。', '表格、图表和长代码可以有局部滚动；导航和主任务不能被页面级横向溢出隐藏。'],
  assets: ['检查图标在纯图形、图文、禁用与窄屏状态中的名称和点击区域。', '核对图片比例、裁切焦点、加载失败与占位空间，说明素材更换对上下文的影响。', '大图和装饰资源的加载策略先测量；修复方案保留许可、来源和产品已有资产。'],
  patterns: ['按用户是在操作、阅读还是作决定来核对页面结构，避免把营销布局用于高频操作。', '检查列表、详情、筛选与返回是否保留用户上下文，常用动作不被装饰推离工作区。', '提出布局候选时写清保留什么任务、减少什么步骤以及需要怎样验证取舍。'],
  navigation: ['从真实入口完成一项任务，再返回、更换项目或取消，核对当前位置与状态恢复。', '分别使用鼠标、键盘与浏览器后退；路径含弹窗、标签页和深链接时检查焦点去向。', '操作不可用时解释条件并给出可执行的下一步，避免只有一个灰色按钮。'],
  forms: ['使用空值、极长文本、Unicode、输入法组合、复制粘贴和边界数字验证输入与提交。', '错误提示同时回答错在哪里、如何修复；失败后保留已输入内容并定位到相关字段。', '测试重复提交、请求超时、重试和取消；确认成功反馈对应真实保存结果。'],
  states: ['分别重现首次空数据、筛选无结果、加载中、部分成功、网络失败和权限不足。', '恢复操作保留上下文，明确重试是否可能重复写入；不能用假成功隐藏错误。', '离开页面、关闭弹层或取消后，过期请求不应覆盖新状态；通过实际重现确认。'],
  copy: ['操作名称说明结果；同一个对象与状态在列表、详情、通知中使用一致称呼。', '删去不帮助用户决策的实现细节，把限制、影响和恢复方式放在需要它的位置。', '通知检查目的、时机、持续时间、关闭和读屏提示；不能用短暂 toast 承担唯一关键证据。'],
  accessibility: ['从入口开始仅用键盘完成主任务，检查顺序、焦点可见性、弹层限制和关闭后焦点恢复。', '核对可访问名称、角色、状态与错误关联；图标或占位文字不能替代必要标签。', '文字缩放、系统对比、减少动态与辅助技术分别验证，自动扫描通过不替代真实使用。'],
  localization: ['用明显更长的翻译、复数、日期、金额与不同数字长度检查布局和语义。', '核对 RTL 阅读顺序、方向图标和运动方向，不能简单镜像所有内容。', '检查输入法组合和快捷键冲突，提交行为不应打断尚未完成的输入。'],
  charts: ['先确认用户要比较、看趋势还是看分布，再检查图表选择与基准是否误导。', '验证零值、负值、空数据、极值、长标签和单位；图例与颜色需有可访问替代。', '交互图表检查键盘、触屏与数据表替代；性能问题要用真实数据量测量。'],
  onboarding: ['第一次使用时能否开始主任务，准备步骤是否真的必要，能否稍后配置。', '空状态说明此处会出现什么、为什么为空及下一步；示例必须和真实数据区分。', '返回用户和已完成配置用户不应反复经历引导；检查跳过、继续与恢复进度。'],
  'motion-purpose': ['为每段动画标明用途：反馈、空间关系、状态解释或装饰；没有任务价值的候选可提出移除方案。', '先描述起点、终点和触发动作，再讨论曲线；瞬时切换也可以是正确方案。', '比较保留、简化和移除的效果，确保必要反馈与产品表达仍在。'],
  'motion-timing': ['实际播放进入、退出和状态变化，核对节奏是否符合操作频率，而非统一套用同一时长。', '多元素动画明确先后、并行和完全静止的元素，避免无意义的串行等待。', '动效规格写出属性、起止值、时长/弹簧、触发、退出与偏好分支，建议才可实施。'],
  'motion-interruption': ['动画进行中再次点击、反向或取消，检查是否从当前位置连续衔接。', '连续通知、快速标签切换和抽屉开关不应堆积旧动画或回到过时状态。', '离开页面、组件卸载或目标被替换时，检查清理与最终状态；记录复现次数。'],
  'motion-accessibility': ['切换系统减少动态偏好后重放同一操作，检查必要反馈是否保留。', '触屏不应残留悬停状态，只有 hover 才出现的信息要有焦点或点击路径。', '高频键盘操作、重复提示及大幅缩放/位移应分别核对，不能只检查一条媒体查询。'],
  performance: ['先记录目标设备、内容规模和具体慢操作，再采集加载、输入或帧轨迹。', '区分资源等待、主线程工作、布局绘制与重复更新，属性风险只提示测量方向。', '优化前后使用相同状态和操作，比较响应和帧表现，不能以代码更短代替性能证据。'],
  gestures: ['拖动和滑动核对手指跟随、释放速度、边界与反向接手，取消不能留下半完成状态。', '处理页面滚动、返回、拖拽和浮层手势冲突，同时提供可访问的替代操作。', '触感、安全区、软键盘和系统返回需要目标设备证据；模拟器结果单独标注。'],
  platforms: ['从当前依赖和工程文件确认平台及组件库，不根据文件夹名猜版本。', '方案先适配项目现有架构、状态与样式约定；跨技术栈建议注明哪些步骤仍需人工核实。', '原生交互与网页交互分别验证；不得把网页截图当成原生平台接受结果。'],
  prototype: ['需要比较方案时，为每个候选写明同一任务、约束、状态与成功条件。', '候选可以是布局、文案或交互调整方案；模拟数据、未实现行为与风险明确标注。', '在选定方向前不改源码；修复方案说明对现有组件、状态和后续验证的影响。'],
  craft: ['检查重复卡片、边框、阴影和装饰是否帮助内容关系，明确删减或增强的目的。', '视觉精修先确定一个目标：更清晰、更简洁或更鲜明，并保留已确认品牌约束。', '用真实内容、目标尺寸与完整状态比较建议；审美建议单列，不伪装成确定性缺陷。'],
  review: ['每条问题绑定位置、状态、证据、影响、处理方向和验证方法，缺证据先标待验证。', '优先处理阻断任务、错误状态和可访问性，再处理一致性与表达；不要只按出现顺序排序。', '检查范围变化、规则关闭、基线/忽略和未执行项目分别记录，不能合并成通过。'],
};

export interface DiagnosisContext { stacks: string[]; checks: string[]; scripts: string[] }

export function buildDiagnosis(round: Round, projectName: string, workflow: IssueWorkflow, focus: DiagnosisFocus, objective: string, context: DiagnosisContext, locale: 'zh' | 'en' | null = null) {
  const relevance = (keywords: string) => keywords.split(' ').filter((word) => objective.toLowerCase().includes(word.toLowerCase())).length;
  const procedures = GUIDES.filter((guide) => focus.topics.includes(guide.id)).sort((a, b) => relevance(b.keywords) - relevance(a.keywords)).map((guide) => localizedGuide(guide, locale));
  const findings = round.result.violations.filter((issue) => issue.status === 'new' && focus.topics.includes(issueGuidance(issue).guide.id))
    .sort((a, b) => ['must', 'default', 'reference'].indexOf(a.level) - ['must', 'default', 'reference'].indexOf(b.level));
  const cases = locale === 'en' ? ENGLISH_DIAGNOSTIC_CASES : DIAGNOSTIC_CASES;
  const tasks: DiagnosisTask[] = procedures.flatMap((guide) => cases[guide.id].map((check, index) => ({ id: `${guide.id}-${index + 1}`, topic: guide.title, domain: guide.domain, check, fix: guide.fix, verify: guide.verify })));
  const platform = localizedGuide(GUIDES.find((guide) => guide.id === 'platforms')!, locale);
  tasks.push(...context.checks.map((check, index) => ({ id: `stack-${index + 1}`, topic: locale === 'en' ? 'Technology stack checks' : '技术栈专项核对', domain: platform.domain, check, fix: platform.fix, verify: platform.verify })));
  if (locale === 'en') return { focus: focus.id, title: ENGLISH_FOCUS_TITLES[focus.id], language: 'en' as const, knowledgeVersion: KNOWLEDGE_VERSION, findings: findings.length, pendingChecks: tasks.length, tasks, markdown: englishDiagnosis(round, projectName, workflow, focus, objective, context, procedures, findings) };
  const markdown = [
    `# ${projectName} · ${focus.title}`, '', `依据：第 ${round.number} 轮；知识版本 ${KNOWLEDGE_VERSION}。`,
    `本次目标：${objective || '按当前项目约束生成诊断与修复方案'}`,
    '本方案不会修改源码，也不将待验证项标为通过。先处理实际证据，再实施适用建议。', '',
    '项目规则和组件信息使用所选轮次的快照；配置变化后先重新检测。技术栈线索来自当前工程文件。', '',
    '## 项目约束与证据边界',
    `- 源码范围：${round.result.scope}；已扫描 ${round.result.filesScanned} 个文件。`,
    `- 组件库：${round.result.library.path || '尚未确认'}；组件 ${round.result.library.components}；Token ${round.result.library.tokens}。`,
    `- 技术栈线索：${context.stacks.join('、') || '未能自动确认，按项目工程说明核对'}。`,
    `- 页面截图：${round.capture?.views?.length || 0} 份；${round.partial || '访问范围以本轮报告为准，不能推断未访问状态。'}`,
    ...round.result.rules.guidance.map((rule) => `- 项目规则：${rule.text}`),
    ...round.result.rules.disabled.map((rule) => `- 已关闭 ${rule.id}：${rule.reason}；不得以通用知识绕过该决定。`),
    '', '## 已发现的问题与处理顺序',
    ...(!findings.length ? ['本轮没有与此目标匹配的已发现问题。下面的检查项仍未验证，不代表此目标通过。'] : findings.flatMap((issue, index) => {
      const quality = issueGuidance(issue), disposition = workflow.dispositions[issue.fingerprint];
      const settled = disposition?.state === 'accepted' || disposition?.state === 'confirmed';
      return [`### ${index + 1}. ${issue.name}`, `分类：${quality.label}；证据：${quality.evidence}；处理标记：${ISSUE_STATES[disposition?.state || 'open']}。`,
        `位置：${issue.file}${issue.line ? ':' + issue.line : ''}`, `观察：${issue.what}`, `影响：${issue.consequence}`,
        ...(settled ? ['处理要求：该项已有人工决定；先复核已有理由和证据，不自动要求重新修改。'] : [`修复步骤：${issue.fix}`, `实施约束：${quality.guide.fix}`]), `复检：${quality.guide.verify}`,
        ...(disposition?.note ? [`已有处理证据：${disposition.note}`] : []), ''];
    })),
    '', '## 专项验证任务（尚未执行）',
    ...procedures.flatMap((guide) => [`### ${guide.title}`, ...DIAGNOSTIC_CASES[guide.id].map((check) => `- [ ] ${check}`), `修复方向：${guide.fix}`, `验收方法：${guide.verify}`, '']),
    ...(context.checks.length ? ['## 技术栈专项核对', ...context.checks.map((check) => `- [ ] ${check}`), ''] : []),
    '## 修复后复检',
    '- 先确认项目原有规则、组件和业务行为，再由授权的开发者实施；UXQA 不执行源码写回。',
    `- 可用验证脚本：${context.scripts.join('、') || '未发现标准脚本，请按项目说明确认'}。本方案没有运行它们。`,
    '- 使用相同页面、数据、窗口、设备和操作复测；按问题记录证据、未通过原因或接受偏差的理由。',
    '- 将人工观察录入问题处理。重新检测只产生新证据，不自动证明全部问题已修复。',
  ].join('\n');
  return { focus: focus.id, title: focus.title, language: 'zh' as const, knowledgeVersion: KNOWLEDGE_VERSION, findings: findings.length, pendingChecks: tasks.length, tasks, markdown };
}

function englishDiagnosis(round: Round, projectName: string, workflow: IssueWorkflow, focus: DiagnosisFocus, objective: string, context: DiagnosisContext, procedures: typeof GUIDES, findings: Round['result']['violations']) {
  const status: Record<string, string> = { open: 'Open', working: 'In progress', recheck: 'Needs recheck', accepted: 'Deviation accepted', confirmed: 'Manually confirmed' };
  const domains = { ui: 'UI · visual design', ux: 'UX · tasks and interaction', experience: 'Experience · feedback and motion' };
  return [
    `# ${projectName} · ${ENGLISH_FOCUS_TITLES[focus.id]}`, '', `Based on round ${round.number}; knowledge version ${KNOWLEDGE_VERSION}.`,
    `Objective: ${objective || 'Create a diagnosis and repair plan using current project constraints.'}`,
    'This plan does not edit source or mark pending checks as passed. Address actual evidence before applying recommendations.', '',
    'Project rules and components use the selected round’s snapshot; rerun the check after configuration changes. Stack clues come from current project files.',
    'Project-supplied rules, existing findings, and notes below are preserved in their recorded language.', '',
    '## Project constraints and evidence limits',
    `- Source scope: ${round.result.scope}; ${round.result.filesScanned} files scanned.`,
    `- Component library: ${round.result.library.path || 'not confirmed'}; ${round.result.library.components} components; ${round.result.library.tokens} tokens.`,
    `- Stack clues: ${context.stacks.join(', ') || 'not automatically identified; check the project documentation'}.`,
    `- Page screenshots: ${round.capture?.views?.length || 0}; ${round.partial || 'coverage is limited to the recorded round and cannot establish unvisited states.'}`,
    ...round.result.rules.guidance.map((rule) => `- Project rule (original): ${rule.text}`),
    ...round.result.rules.disabled.map((rule) => `- Disabled rule ${rule.id} (original reason): ${rule.reason}; do not override this decision with general guidance.`),
    '', '## Findings and handling order',
    ...(!findings.length ? ['No recorded findings match this focus. The checks below remain unverified; this does not establish a pass.'] : findings.flatMap((issue, index) => {
      const quality = issueGuidance(issue), guide = localizedGuide(quality.guide, 'en'), disposition = workflow.dispositions[issue.fingerprint];
      const settled = disposition?.state === 'accepted' || disposition?.state === 'confirmed';
      const evidence = issue.origin === 'manual' ? 'Manual observation; not automatically verified' : issue.origin === 'ai' ? 'AI screenshot suggestion' : issue.rule.startsWith('visual/') ? 'Page check' : 'Source check';
      return [`### ${index + 1}. ${issue.name}`, `Category: ${domains[quality.domain]}; evidence: ${evidence}; status: ${status[disposition?.state || 'open']}.`,
        `Location: ${issue.file}${issue.line ? ':' + issue.line : ''}`, `Observation (original): ${issue.what}`, `Impact (original): ${issue.consequence}`,
        ...(settled ? ['Handling: a human decision already exists; review its reason and evidence before requesting a change.'] : [`Repair (original): ${issue.fix}`, `Implementation guidance: ${guide.fix}`]), `Recheck: ${guide.verify}`,
        ...(disposition?.note ? [`Existing handling evidence (original): ${disposition.note}`] : []), ''];
    })),
    '', '## Focused verification tasks (not yet performed)',
    ...procedures.flatMap((guide) => [`### ${guide.title}`, ...ENGLISH_DIAGNOSTIC_CASES[guide.id].map((check) => `- [ ] ${check}`), `Repair direction: ${guide.fix}`, `Acceptance method: ${guide.verify}`, '']),
    ...(context.checks.length ? ['## Technology stack checks', ...context.checks.map((check) => `- [ ] ${check}`), ''] : []),
    '## Recheck after repair',
    '- Confirm existing project rules, components, and business behavior; an authorized developer carries out changes. UXQA does not write project source.',
    `- Available verification scripts: ${context.scripts.join(', ') || 'none identified; check the project documentation'}. This plan has not run them.`,
    '- Retest the same pages, data, viewports, devices, and actions; record evidence, failures, or reasons for accepted deviations.',
    '- Add manual observations to issue handling. A new check supplies evidence; it does not automatically prove every issue is fixed.',
  ].join('\n');
}
