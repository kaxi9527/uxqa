// Native workflows reuse the console's controls, overlays and project state.
const WORKFLOW_DOMAINS = { get ui() { return accessText('UI · 视觉呈现', 'UI · visual design'); }, get ux() { return accessText('UX · 任务与交互', 'UX · tasks and interaction'); }, get experience() { return accessText('体验 · 响应与动效', 'Experience · feedback and motion'); } };
const ISSUE_STATE_EN = { open: 'Open', working: 'In progress', recheck: 'Needs recheck', accepted: 'Deviation accepted', confirmed: 'Manually confirmed' };
function issueStateLabel(value, fallback) { return accessText(fallback || state.issueStates?.[value] || '待处理', ISSUE_STATE_EN[value] || 'Open'); }
function switchWorkflowTab(tab) {
  Object.assign(state, { global: false, tab });
  renderRail(); renderWorkspace();
}
function renderCheckCenter(body) {
  body.classList.add('quality-page');
  const entry = project(), round = state.round, fresh = freshViolations();
  const modules = [
    ['ui', accessText('视觉与布局', 'Visual design and layout'), accessText('层级、文字、配色和空间关系', 'Hierarchy, typography, color and spacing'), accessText('检查对比度、换行、遮挡、对齐、卡片密度及宽窄屏布局。', 'Check contrast, wrapping, overlap, alignment, card density, and responsive layouts.')],
    ['ux', accessText('任务与交互', 'Tasks and interaction'), accessText('能找到、能操作、能恢复', 'Find, act, and recover'), accessText('检查控件命名、表单标签、标题结构与打开状态；任务路径结合实际操作验证。', 'Check control names, form labels, headings, and open states; validate task paths through actual use.')],
    ['experience', accessText('响应与动效', 'Feedback and motion'), accessText('及时反馈，连续操作不被打断', 'Timely feedback and uninterrupted interaction'), accessText('检查减弱动态偏好、过渡属性与布局动画；流畅度和操作时序需要实际测量。', 'Check reduced-motion preferences, transitions, and layout animation; measure smoothness and timing separately.')],
  ];
  fill(body,
    h('header', { class: 'quality-heading' }, h('span', { class: 'quality-eyebrow', text: accessText('项目检查', 'Project checks') }), h('h2', { text: accessText('把界面问题变成可验证的改进', 'Turn interface issues into verifiable improvements') }), h('p', { class: 'muted', text: accessText('从项目的组件和规范出发，检查页面、处理问题，再验证修复。', 'Use the project’s components and rules to check pages, address issues, and verify fixes.') })),
    h('div', { class: 'quality-layout' },
      h('section', { class: 'quality-main', 'aria-label': accessText('检查能力', 'Check capabilities') }, modules.map(([domain, title, subtitle, description], index) =>
        h('article', { class: 'quality-module' }, h('span', { class: 'quality-number', 'aria-hidden': 'true', text: '0' + (index + 1) }),
          h('div', { class: 'grow' }, h('div', { class: 'row' }, h('h3', { class: 'grow', text: title }), h('span', { class: 'faint', text: round ? accessText(fresh.filter((issue) => issue.quality?.domain === domain).length + ' 项待查看', fresh.filter((issue) => issue.quality?.domain === domain).length + ' to review') : accessText('等待检查', 'Awaiting check') })),
            h('p', { class: 'quality-subtitle', text: subtitle }), h('p', { class: 'muted', text: description }),
            h('button', { class: 'btn small', type: 'button', disabled: !round, onclick: () => { state.domain = domain; state.issueState = 'all'; switchWorkflowTab('issues'); } }, accessText('查看' + WORKFLOW_DOMAINS[domain].split(' · ')[0] + '问题', 'View ' + WORKFLOW_DOMAINS[domain].split(' · ')[0] + ' issues')))))),
      h('aside', { class: 'quality-setup', 'aria-label': accessText('检查准备', 'Check setup') }, h('h3', { text: accessText('检查准备', 'Check setup') }),
        h('div', { class: 'quality-setting' }, h('strong', { text: accessText('组件与规范', 'Components and rules') }), h('p', { class: 'muted', text: state.library ? (state.library.library ? accessText('已发现 ' + state.library.components + ' 个组件', state.library.components + ' components found') : accessText('组件库待确认，通用规则可用', 'Component library not confirmed; general rules are available')) : accessText('正在读取…', 'Loading…') }), h('button', { class: 'btn small', type: 'button', onclick: () => switchWorkflowTab('rules') }, accessText('查看项目规范', 'View project rules'))),
        h('div', { class: 'quality-setting' }, h('strong', { text: accessText('预览页面', 'Page preview') }), h('p', { class: 'muted where', text: entry.pages?.baseUrl || accessText('添加地址后启用页面检查', 'Add a URL to enable page checks') }), h('button', { class: 'btn small', type: 'button', onclick: () => switchWorkflowTab('settings') }, accessText('设置预览', 'Configure preview'))),
        h('div', { class: 'quality-setting' }, h('strong', { text: accessText('AI 设计诊断 · 可选', 'AI design review · optional') }), h('p', { class: 'muted', text: accessText('内置评审规则补充截图诊断，建议单独标明。', 'Built-in review guidance supplements screenshot diagnosis.') }), h('button', { class: 'btn small', type: 'button', onclick: openGlobal }, accessText('配置模型', 'Configure model'))))),
    round ? h('footer', { class: 'quality-footer' }, h('div', { class: 'grow' }, h('strong', { text: accessText('最近查看：第 ' + round.number + ' 轮', 'Viewing round ' + round.number) }), h('p', { class: 'muted', text: round.partial || accessText('检查了 ' + round.filesScanned + ' 个文件。页面、AI 与人工验证的覆盖分别记录。', 'Checked ' + round.filesScanned + ' files. Page, AI, and manual coverage are recorded separately.') })),
      h('button', { class: 'btn primary', type: 'button', onclick: () => { state.domain = 'all'; switchWorkflowTab('issues'); } }, accessText('处理检查结果', 'Review findings')),
      h('button', { class: 'btn', type: 'button', onclick: () => switchWorkflowTab('recheck') }, accessText('复检记录', 'Recheck history')))
      : h('p', { class: 'quality-footnote', text: accessText('点击右上角“开始检测”。未设置预览地址时，先执行源码检查。', 'Select “Start check” above. Without a preview URL, UXQA checks source first.') }));
}

function issueWorkflowFilters(fresh) {
  return h('div', { class: 'workflow-filters' },
    h('label', {}, h('span', { class: 'sr-only', text: accessText('问题分类', 'Issue category') }), h('select', { class: 'input', 'aria-label': accessText('问题分类', 'Issue category'), onchange: (event) => { state.domain = event.target.value; state.shown = PAGE_SIZE; renderWorkspace(); } },
      h('option', { value: 'all', text: accessText('全部分类', 'All categories'), selected: state.domain === 'all' }), Object.entries(WORKFLOW_DOMAINS).map(([value, label]) => h('option', { value, selected: state.domain === value, text: `${label} · ${fresh.filter((item) => item.quality?.domain === value).length}` })))),
    h('select', { class: 'input', 'aria-label': accessText('处理状态', 'Handling status'), onchange: (event) => { state.issueState = event.target.value; state.shown = PAGE_SIZE; renderWorkspace(); } }, h('option', { value: 'all', text: accessText('全部处理状态', 'All statuses'), selected: state.issueState === 'all' }), Object.entries(state.issueStates || {}).map(([value, label]) => h('option', { value, selected: state.issueState === value, text: issueStateLabel(value, label) }))),
    h('div', { class: 'workflow-filter-actions' },
      h('button', { class: 'btn small', type: 'button', onclick: () => openObservation() }, accessText('记录观察', 'Record observation')),
      h('button', { class: 'btn small', type: 'button', onclick: () => openDiagnosis() }, accessText('专项修复方案', 'Focused repair plan'))));
}

async function openDiagnosis(initialView = 'plan') {
  try {
    const [knowledge, history] = await Promise.all([api('/quality'), api(`/projects/${state.current}/diagnosis`)]);
    openOverlay((panel, close) => {
      const focus = h('select', { class: 'input', 'aria-label': accessText('专项诊断目标', 'Review focus') }, knowledge.focuses.map((item) => h('option', { value: item.id, text: item.title })));
      const objective = h('textarea', { class: 'input', rows: '3', 'aria-label': accessText('本次诊断目标', 'Review objective'), placeholder: accessText('例如：减少首页的信息负担，保留现有品牌与主要任务。', 'For example: reduce visual clutter while preserving the brand and primary tasks.') });
      const error = h('p', { class: 'notice error', hidden: true, role: 'alert' });
      append(panel, [h('h2', { text: accessText('生成专项修复方案', 'Create a focused repair plan') }), h('p', { class: 'muted', text: accessText('结合本轮问题、项目规范与内置知识，整理修复顺序和待验证项。方案保存在 UXQA 本地，不修改项目源码。', 'Combine findings, project rules and built-in guidance into a prioritized plan. It is saved locally and does not modify project source.') }),
        h('label', { class: 'workflow-field' }, accessText('诊断重点', 'Focus'), focus), h('label', { class: 'workflow-field' }, accessText('目标与约束（可选）', 'Objective and constraints (optional)'), objective), error,
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, accessText('取消', 'Cancel')), h('button', { class: 'btn primary', type: 'button', onclick: async (event) => {
          const button = event.currentTarget; button.disabled = true;
          try { const { plan } = await api(`/projects/${state.current}/diagnosis`, { method: 'POST', body: { roundId: state.round.id, focus: focus.value, objective: objective.value } }); close(true); showDiagnosisPlan(plan); }
          catch (failure) { error.hidden = false; error.textContent = failure.message; button.disabled = false; }
        } }, accessText('生成并保存', 'Create and save'))),
        history.plans.length ? h('section', { class: 'diagnosis-history' }, h('h3', { text: accessText('已有方案', 'Saved plans') }), history.plans.map((plan) => h('button', { class: 'diagnosis-history-row', type: 'button', onclick: () => { close(false); showDiagnosisPlan(plan, initialView); } }, h('span', { text: plan.title }), h('span', { class: 'faint', text: timeText(plan.at) })))) : null]);
    }, { label: accessText('生成专项修复方案', 'Create a focused repair plan') });
  } catch (error) { toast(error.message, 'error'); }
}

function showDiagnosisPlan(plan, initialView = 'plan') {
  const projectId = state.current;
  const sourceRound = state.rounds.find((round) => round.id === plan.roundId);
  openOverlay((panel, close) => {
    const body = h('div', { class: 'drawer-body stack' });
    append(panel, [h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: plan.title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭', 'Close'), onclick: () => close(false) }, icon('close'))), body]);
    let view, mode = initialView, filter = 'all', expanded = null;
    const drafts = new Map();
    const endpoint = `/projects/${projectId}/diagnosis/${plan.id}/verification`;
    const render = () => {
      const totals = view.summary;
      const latest = new Map(view.verification.events.map((record) => [record.taskId, record]));
      const actions = h('div', { class: 'row verification-actions', role: 'group', 'aria-label': accessText('方案查看方式', 'Plan view') },
        ['plan', 'verification'].map((value) => h('button', { class: `btn small${mode === value ? ' primary' : ''}`, type: 'button', 'aria-pressed': String(mode === value), onclick: () => { mode = value; render(); body.querySelector('[aria-pressed="true"]').focus(); } }, value === 'plan' ? accessText('修复方案', 'Repair plan') : accessText('逐项验证', 'Verify tasks'))),
        h('button', { class: 'btn small', type: 'button', onclick: () => copy(view.markdown, accessText('方案与验证记录', 'Plan and verification records')) }, icon('copy'), accessText('复制方案与记录', 'Copy plan and records')));
      const content = h('div', { class: 'stack' });
      fill(body, h('p', { class: 'muted', text: accessText(`依据${sourceRound ? `第 ${sourceRound.number} 轮` : '已保存的历史检查'} · ${timeText(plan.at)} · ${plan.findings} 项已有问题`, `Based on ${sourceRound ? `round ${sourceRound.number}` : 'a saved check'} · ${timeText(plan.at)} · ${plan.findings} findings`) }),
        state.round?.id !== plan.roundId ? h('p', { class: 'notice warn', text: accessText('此方案与当前查看的轮次不同。验证记录属于生成时的检查证据，请确认验证对象；新一轮检查不会自动更新这些记录。', 'This plan belongs to a different round. Verify the target: new checks do not automatically update these records.') }) : null,
        accessText(false, plan.language !== 'en') ? h('p', { class: 'notice', text: 'This saved plan is shown in its original language. Create a new plan for English guidance; the original remains unchanged.' }) : null, actions, content);
      if (mode === 'plan') { fill(content, h('p', { class: 'muted', text: accessText('以下保留生成时的方案与待验证要求；最新进度见“逐项验证”。', 'The original plan and verification requirements are preserved below. See Verify tasks for current progress.') }), diagnosisDocument(plan.markdown)); return; }
      if (!plan.tasks) { fill(content, h('p', { class: 'notice', text: accessText('此旧版方案只有文字记录。重新生成方案后即可逐项记录；原方案保持不变。', 'This older plan contains text only. Create a new plan to record individual tasks; the original remains unchanged.') })); return; }
      const statusFilter = h('select', { class: 'input', 'data-verification-filter': '', 'aria-label': accessText('筛选验证结果', 'Filter verification results'), onchange: (event) => { filter = event.target.value; expanded = null; render(); body.querySelector('[data-verification-filter]').focus(); } },
        h('option', { value: 'all', text: accessText('全部验证任务', 'All verification tasks'), selected: filter === 'all' }), Object.entries(view.states).map(([key, label]) => h('option', { value: key, selected: filter === key, text: `${label} · ${totals[key]}` })));
      append(content, [h('p', { class: 'verification-summary', role: 'status', text: accessText(`待验证 ${totals.pending} · 记录通过 ${totals.passed} · 发现问题 ${totals.failed} · 不适用 ${totals['not-applicable']}`, `Pending ${totals.pending} · Passed ${totals.passed} · Failed ${totals.failed} · Not applicable ${totals['not-applicable']}`) }),
        h('p', { class: 'muted', text: accessText('结果依据填写的过程与证据，不是自动检测结论。请在相同页面、设备和状态下实际验证，再记录结果。', 'Results reflect the recorded steps and evidence, not an automatic verdict. Verify on the same page, device and state before recording.') }), statusFilter]);
      const tasks = plan.tasks.filter((task) => filter === 'all' || (latest.get(task.id)?.status || 'pending') === filter);
      if (!tasks.length) content.append(h('p', { class: 'muted', text: accessText('没有符合筛选的验证任务。', 'No verification tasks match this filter.') }));
      let topic, group;
      for (const task of tasks) {
        if (task.topic !== topic) { topic = task.topic; group = h('section', { class: 'verification-topic' }, h('h3', { text: topic })); content.append(group); }
        const record = latest.get(task.id), draft = drafts.get(task.id), history = view.verification.events.filter((event) => event.taskId === task.id);
        const details = h('details', { class: 'verification-task', 'data-task-id': task.id, open: expanded === task.id, ontoggle: () => { if (details.open) expanded = task.id; } });
        const status = h('select', { class: 'input', 'aria-label': accessText('验证结果', 'Verification result') }, Object.entries(view.states).map(([key, label]) => h('option', { value: key, selected: key === (draft?.status || record?.status || 'pending'), text: label })));
        const note = h('textarea', { class: 'input short', rows: '4', maxlength: '4000', 'aria-label': accessText('验证过程与证据', 'Verification steps and evidence'), placeholder: accessText('写明页面/控件、设备、操作过程、实际结果与证据位置；不适用时说明理由。', 'Describe the page or control, device, steps, actual result and evidence location; explain if not applicable.') }, draft?.note ?? record?.note ?? '');
        const error = h('p', { class: 'notice error', role: 'alert', hidden: true });
        const save = h('button', { class: 'btn primary small', type: 'submit' }, accessText('保存验证记录', 'Save verification'));
        const form = h('form', { class: 'stack-tight', oninput: () => drafts.set(task.id, { status: status.value, note: note.value }), onsubmit: async (event) => {
          event.preventDefault(); save.disabled = true; error.hidden = true;
          try {
            const updated = await api(endpoint, { method: 'POST', body: { taskId: task.id, status: status.value, note: note.value } });
            if (!body.isConnected) return;
            view = updated; drafts.delete(task.id); expanded = task.id; render();
            (body.querySelector(`[data-task-id="${CSS.escape(task.id)}"] button[type="submit"]`) || body.querySelector('[data-verification-filter]')).focus({ preventScroll: true });
            toast(accessText('验证记录已保存', 'Verification saved'));
          }
          catch (failure) { error.hidden = false; error.textContent = failure.message; }
          finally { save.disabled = false; }
        } }, h('p', { class: 'muted', text: accessText(`修复方向：${task.fix}`, `Suggested fix: ${task.fix}`) }), h('p', { class: 'muted', text: accessText(`验证方法：${task.verify}`, `How to verify: ${task.verify}`) }),
        h('label', { class: 'workflow-field' }, accessText('结果', 'Result'), status), h('label', { class: 'workflow-field' }, accessText('过程与证据 / 适用性理由', 'Steps and evidence / applicability'), note), error,
        h('div', { class: 'row verification-actions' }, save, record?.status === 'failed' ? h('button', { class: 'btn small', type: 'button', onclick: () => { close(false); openObservation({ name: accessText(`${task.topic}核对发现问题`, `Issue found: ${task.topic}`), domain: task.domain, detail: accessText(`检查要求：${task.check}\n观察证据：${record.note}\n来源方案：${plan.id}；任务：${task.id}`, `Check: ${task.check}\nEvidence: ${record.note}\nPlan: ${plan.id}; task: ${task.id}`), fix: task.fix }); } }, accessText('转为问题', 'Create finding')) : null));
        append(details, [h('summary', {}, h('span', { class: 'verification-state', text: view.states[record?.status || 'pending'] }), h('span', { text: task.check })), form,
          history.length ? h('details', { class: 'verification-history' }, h('summary', { text: accessText(`历史记录 · ${history.length}`, `History · ${history.length}`) }), h('ol', {}, [...history].reverse().map((event) => h('li', {}, h('strong', { text: view.states[event.status] }), h('span', { class: 'faint', text: ` · ${timeText(event.at)} · ${event.via === 'mcp' ? accessText('MCP 工具', 'MCP tool') : accessText('界面/API', 'UI/API')}` }), h('p', { text: event.note }))))) : null]);
        group.append(details);
      }
    };
    const load = async () => {
      fill(body, h('p', { class: 'muted', role: 'status', text: accessText('正在读取方案与验证记录…', 'Loading plan and verification records…') }));
      try { const result = await api(endpoint); if (!body.isConnected) return; view = result; render(); }
      catch (error) { if (body.isConnected) fill(body, h('p', { class: 'notice error', role: 'alert', text: error.message }), h('button', { class: 'btn', type: 'button', onclick: load }, accessText('重试读取', 'Retry'))); }
    };
    load();
  }, { kind: 'drawer', label: accessText('专项修复方案', 'Focused repair plan') });
}

function diagnosisDocument(markdown) {
  const document = h('article', { class: 'diagnosis-document', 'aria-label': accessText('方案内容', 'Plan content') });
  let list = null;
  // Render the plan's own limited text format with textContent, never arbitrary HTML.
  for (const line of markdown.split('\n')) {
    if (!line.trim() || line.startsWith('# ')) { list = null; continue; }
    const heading = /^(#{2,3}) (.+)$/.exec(line);
    if (heading) {
      document.append(h(heading[1].length === 2 ? 'h3' : 'h4', { text: heading[2] })); list = null;
    } else if (line.startsWith('- ')) {
      if (!list) { list = h('ul'); document.append(list); }
      const pending = line.startsWith('- [ ] ');
      list.append(h('li', {}, pending ? h('span', { class: 'diagnosis-pending', text: accessText('待验证', 'Pending') }) : null, line.slice(pending ? 6 : 2)));
    } else {
      document.append(h('p', { text: line })); list = null;
    }
  }
  return document;
}

function issueWorkflowDetails(violation) {
  const quality = violation.quality;
  const disposition = state.workflow.dispositions[violation.fingerprint];
  return h('section', { class: 'panel stack-tight' },
    h('div', { class: 'row' }, h('span', { class: 'chip', text: quality?.label || accessText('待分类', 'Uncategorized') }), h('span', { class: 'chip', text: quality?.evidence || accessText('查看原始证据', 'View original evidence') }), h('span', { class: 'grow' }), h('button', { class: 'btn small', type: 'button', onclick: () => openIssueDisposition(violation) }, accessText('处理与分类', 'Handle and classify'))),
    h('p', { class: 'faint', text: accessText(`处理标记：${state.issueStates?.[disposition?.state || 'open'] || '待处理'}。人工标记不改变本轮检查证据。${violation.origin === 'manual' ? '这是项目级观察记录，不是自动检测结果。' : ''}`, `Status: ${issueStateLabel(disposition?.state || 'open')}. A handling status does not alter the original check evidence.${violation.origin === 'manual' ? ' This is a project-level observation, not an automatic finding.' : ''}`) }),
    disposition?.note ? h('p', { text: disposition.note }) : null,
    quality?.guide ? h('div', { class: 'verification-note' }, h('strong', { text: accessText('如何验证这项改动', 'How to verify this change') }), h('p', { class: 'muted', text: quality.guide.verify })) : null);
}

function openIssueDisposition(violation) {
  const current = state.workflow.dispositions[violation.fingerprint] || { state: 'open', note: '' };
  openOverlay((panel, close) => {
    const category = h('select', { class: 'input', 'aria-label': accessText('修改问题分类', 'Change issue category') }, Object.entries(WORKFLOW_DOMAINS).map(([value, label]) => h('option', { value, text: label, selected: value === (current.domain || violation.quality?.domain) })));
    const stage = h('select', { class: 'input', 'aria-label': accessText('修改处理状态', 'Change handling status') }, Object.entries(state.issueStates).map(([value, label]) => h('option', { value, text: issueStateLabel(value, label), selected: current.state === value })));
    const note = h('textarea', { class: 'input', rows: '4', 'aria-label': accessText('处理理由与验证证据', 'Reason and verification evidence'), placeholder: accessText('记录修改内容、验证步骤或接受偏差的理由', 'Record the change, verification steps, or reason for accepting a deviation') }, current.note);
    const error = h('p', { class: 'notice error', hidden: true, role: 'alert' });
    append(panel, [h('h2', { text: accessText('处理与分类', 'Handle and classify') }), h('p', { text: violation.name }),
      h('label', { class: 'workflow-field' }, accessText('问题分类', 'Category'), category), h('label', { class: 'workflow-field' }, accessText('处理状态', 'Status'), stage), h('label', { class: 'workflow-field' }, accessText('理由与证据', 'Reason and evidence'), note),
      h('p', { class: 'faint', text: accessText('接受偏差或人工确认必须填写依据。人工确认不会把仍检出的问题改成自动通过。', 'Provide evidence when accepting a deviation or confirming manually. A manual confirmation does not make an existing finding pass automatically.') }), error,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, accessText('取消', 'Cancel')), h('button', { class: 'btn primary', type: 'button', onclick: async (event) => {
        event.currentTarget.disabled = true;
        try {
          await api(`/projects/${state.current}/issue-workflow`, { method: 'POST', body: { roundId: state.round.id, fingerprint: violation.fingerprint, state: stage.value, domain: category.value, note: note.value } });
          close(true); await openRound(state.round.id); toast(accessText('处理记录已保存', 'Handling record saved'));
        } catch (failure) { error.hidden = false; error.textContent = failure.message; event.target.disabled = false; }
      } }, accessText('保存处理记录', 'Save record')))]);
  }, { label: accessText('处理与分类', 'Handle and classify') });
}

function openObservation(seed = {}) {
  openOverlay((panel, close) => {
    const name = h('input', { class: 'input', 'aria-label': accessText('观察问题名称', 'Observation name'), placeholder: accessText('例如：连续切换时抽屉跳回起点', 'For example: drawer resets when switching repeatedly'), value: seed.name || '' });
    const location = h('input', { class: 'input', 'aria-label': accessText('观察位置', 'Location'), placeholder: accessText('页面、控件及触发状态', 'Page, control, and triggering state') });
    const domain = h('select', { class: 'input', 'aria-label': accessText('观察问题分类', 'Observation category') }, Object.entries(WORKFLOW_DOMAINS).map(([value, label]) => h('option', { value, text: label, selected: value === (seed.domain || 'experience') })));
    const detail = h('textarea', { class: 'input', rows: '5', 'aria-label': accessText('重现步骤与观察证据', 'Reproduction steps and evidence'), placeholder: accessText('写明设备、操作步骤、实际与期望结果，以及证据位置；不要填写账号秘密。', 'Describe the device, steps, actual and expected results, and evidence location. Do not include account secrets.') }, seed.detail || '');
    const error = h('p', { class: 'notice error', hidden: true, role: 'alert' });
    append(panel, [h('h2', { text: accessText('记录观察问题', 'Record an observation') }), h('p', { class: 'muted', text: accessText('人工观察单独标明，不会伪装成自动检查通过或失败。记录保存在本项目的本地问题处理中。', 'Manual observations are identified separately from automatic findings and saved locally with this project.') }),
      h('label', { class: 'workflow-field' }, accessText('名称', 'Name'), name), h('label', { class: 'workflow-field' }, accessText('位置', 'Location'), location), h('label', { class: 'workflow-field' }, accessText('分类', 'Category'), domain), h('label', { class: 'workflow-field' }, accessText('重现步骤与证据', 'Steps and evidence'), detail), error,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, accessText('取消', 'Cancel')), h('button', { class: 'btn primary', type: 'button', onclick: async (event) => {
        event.currentTarget.disabled = true;
        try { await api(`/projects/${state.current}/observations`, { method: 'POST', body: { name: name.value, location: location.value, domain: domain.value, detail: detail.value, fix: seed.fix || '' } }); close(true); await openRound(state.round.id); toast(accessText('观察问题已记录', 'Observation saved')); }
        catch (failure) { error.hidden = false; error.textContent = failure.message; event.target.disabled = false; }
      } }, accessText('保存观察', 'Save observation')))]);
  }, { label: accessText('记录观察问题', 'Record an observation') });
}

function renderRecheck(body) {
  body.classList.add('workflow-page');
  if (!state.round) { fill(body, emptyState('check', accessText('还没有可以复检的记录', 'No checks to review yet'), accessText('先完成一次检查，再处理问题并重新检测。', 'Run a check, handle findings, then check again.'), h('button', { class: 'btn', type: 'button', onclick: () => switchWorkflowTab('checks') }, accessText('回到检查', 'Back to checks')))); return; }
  const results = h('div', { class: 'stack' }, h('p', { class: 'muted', text: accessText('正在读取对比…', 'Loading comparison…') }));
  fill(body, h('div', { class: 'stack' }, h('h2', { text: accessText('复检与验证', 'Recheck and verification') }), h('p', { class: 'muted', text: accessText('“本轮未再检出”只说明当前检查没有再次报告，不自动等于已修复。核对规则、页面、窗口和操作状态；人工观察需要实际重现。', 'A finding not reported in this round is not automatically fixed. Compare the rules, page, viewport and state; reproduce manual observations in person.') }),
    h('div', { class: 'row verification-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: startCheck }, icon('play'), accessText('重新检测', 'Run check again')), h('button', { class: 'btn', type: 'button', onclick: () => switchWorkflowTab('issues') }, accessText('处理问题', 'Handle findings')),
      h('button', { class: 'btn', type: 'button', onclick: () => openDiagnosis('verification') }, accessText('专项验证记录', 'Plan verification')),
      state.round.capture?.changes?.length ? h('button', { class: 'btn', type: 'button', onclick: openChanges }, accessText('查看前后截图', 'Compare screenshots')) : null), results));
  api(`/projects/${state.current}/recheck?round=${encodeURIComponent(state.round.id)}`).then(({ comparison, workflow }) => {
    if (!results.isConnected) return;
    const items = comparison?.items || [];
    const pending = Object.entries(workflow.dispositions).filter(([, item]) => item.state === 'recheck');
    fill(results, state.round.partial ? h('div', { class: 'notice warn', text: state.round.partial }) : null,
      h('p', { text: accessText(`人工标记待复检 ${pending.length} 项 · 项目级观察 ${workflow.observations.length} 项`, `${pending.length} marked for recheck · ${workflow.observations.length} project observations`) }),
      !comparison?.previous ? h('div', { class: 'notice', text: accessText('这是第一轮，尚无上一轮可对比。修复后再运行一次检查。', 'This is the first round; there is no earlier round to compare. Run another check after changes.') })
        : h('div', { class: 'stack' }, h('h3', { text: accessText(`上一轮的 ${items.length} 项问题`, `${items.length} findings in the previous round`) }), ...items.map((item) => h('div', { class: 'panel' }, h('strong', { text: item.name }), h('p', { class: 'faint', text: item.file }), h('p', { text: item.explanation })))),
      workflow.observations.length ? h('section', { class: 'panel' }, h('h3', { text: accessText('人工观察的验证', 'Verify manual observations') }), h('p', { class: 'muted', text: accessText('重新运行截图检查不能自动验证操作时序、动效或手势。请按原步骤操作，在“处理与分类”中记录验证证据。', 'A screenshot check cannot automatically verify timing, motion or gestures. Repeat the original steps and record evidence under Handle and classify.') }), h('button', { class: 'btn', type: 'button', onclick: () => { state.domain = 'all'; state.issueState = 'all'; switchWorkflowTab('issues'); } }, accessText('查看观察记录', 'View observations'))) : null);
  }).catch((error) => { if (results.isConnected) fill(results, h('div', { class: 'notice error', text: error.message }), h('button', { class: 'btn', type: 'button', onclick: () => renderRecheck(body) }, accessText('重试', 'Retry'))); });
}
