'use strict';

function openProjectAgent(finding) {
  const id = state.current;
  if (finding) {
    const prompt = accessText(`请结合本轮检查，分析并修复这个问题：${finding.name}\n位置：${finding.file}${finding.line ? `:${finding.line}` : ''}`, `Analyze and repair this finding from the current check: ${finding.name}\nLocation: ${finding.file}${finding.line ? `:${finding.line}` : ''}`);
    state.agentDrafts[id] = state.agentDrafts[id] ? `${state.agentDrafts[id]}\n\n${prompt}` : prompt;
    state.agentFindings[id] = finding.fingerprint;
  }
  state.tab = 'agent';
  renderWorkspace();
}

function renderAgentEvidence(item, options = {}) {
  const data = item.data;
  if (!data) return null;
  if (item.kind === 'design') {
    const labels = { background: accessText('背景', 'Background'), foreground: accessText('文字', 'Text'), primary: accessText('主色', 'Primary'), onPrimary: accessText('主色文字', 'On primary'), surface: accessText('表面', 'Surface'), onSurface: accessText('表面文字', 'On surface'), secondary: accessText('次要色', 'Secondary'), onSecondary: accessText('次要色文字', 'On secondary'), success: accessText('成功', 'Success'), onSuccess: accessText('成功文字', 'On success'), warning: accessText('警告', 'Warning'), onWarning: accessText('警告文字', 'On warning'), danger: accessText('危险', 'Danger'), onDanger: accessText('危险文字', 'On danger'), focus: accessText('焦点', 'Focus') };
    return h('div', { class: 'agent-evidence' },
      h('strong', { text: data.name }),
      h('p', { text: `${accessText('依据', 'Basis')}：${data.basis}` }),
      data.sourceEvidence?.length ? h('details', {}, h('summary', { text: accessText('查看本轮读取的项目依据', 'View project evidence read this turn') }), data.sourceEvidence.map((source) => h('div', {}, h('p', { text: `${source.path}:${source.line}` }), h('pre', { text: source.excerpt })))) : h('p', { class: 'faint', text: accessText('未引用本轮读取的项目原文；设计依据尚未核对。', 'No project excerpt read this turn was cited; the design basis is unverified.') }),
      h('div', { class: 'agent-colors' }, Object.entries(data.colors).map(([role, color]) => {
        const swatch = h('span', { class: 'agent-swatch' });
        swatch.style.backgroundColor = color;
        return h('div', { class: 'agent-color' }, swatch, h('span', { text: `${labels[role]} ${color}` }));
      })),
      h('p', { text: `${accessText('字体', 'Typography')}：${data.typography}` }),
      h('p', { text: `${accessText('间距', 'Spacing')}：${data.spacing}` }),
      data.scales && Object.keys(data.scales).length ? h('details', {}, h('summary', { text: accessText('查看候选变量', 'View candidate tokens') }), h('pre', { text: Object.entries(data.scales).map(([category, values]) => `${category}: ${Object.entries(values).map(([name, value]) => `${name} = ${value}`).join(', ')}`).join('\n') })) : null,
      h('p', { text: `${accessText('纯色对比', 'Solid color contrast')}：${data.contrastChecks.map((check) => `${check.foregroundRole ? `${labels[check.foregroundRole] || check.foregroundRole} / ${labels[check.backgroundRole] || check.backgroundRole}: ` : ''}${check.ratio}:1 ${check.normalText45 ? accessText('达到普通文字 4.5:1', 'meets 4.5:1 for normal text') : accessText('低于普通文字 4.5:1', 'below 4.5:1 for normal text')}`).join(' · ')}` }),
      data.missingColorPairs?.length ? h('p', { class: 'faint', text: `${accessText('缺少配对颜色，未计算对比', 'Missing paired colors; contrast not calculated')}：${data.missingColorPairs.map((pair) => `${labels[pair.foregroundRole] || pair.foregroundRole} / ${labels[pair.backgroundRole] || pair.backgroundRole}`).join('、')}` }) : null,
      h('p', { text: `${accessText('待验证', 'To verify')}：${data.unknowns}` }),
      h('p', { class: 'faint', text: accessText('仅计算候选纯色；实际页面、状态和可访问性尚未验证。', 'Only candidate solid colors were calculated; rendered pages, states and accessibility remain unverified.') }),
      h('details', {}, h('summary', { text: accessText('查看候选 CSS', 'View candidate CSS') }), h('pre', { text: data.css })));
  }
  if (item.kind === 'motion') return h('div', { class: 'agent-evidence' },
    h('p', { text: `${data.route} · ${data.selector} · ${data.trigger} · ${data.browser} · ${data.viewport.width} × ${data.viewport.height}` }),
    typeof data.reducedMotion === 'boolean' ? h('p', { text: data.reducedMotion ? accessText('已模拟减少动态效果', 'Reduced motion emulated') : accessText('未模拟减少动态效果', 'Reduced motion not emulated') }) : null,
    h('p', { text: accessText(`采样 ${data.durationMs} ms，${data.frameIntervals} 个帧间隔；中位 ${data.medianFrameMs} ms，P95 ${data.p95FrameMs} ms，最长 ${data.longestFrameMs} ms。`, `${data.durationMs} ms sampled, ${data.frameIntervals} frame intervals; median ${data.medianFrameMs} ms, P95 ${data.p95FrameMs} ms, longest ${data.longestFrameMs} ms.`) }),
    h('p', { text: accessText(`观察到 ${data.observedAnimations} 个同时运行的动画；长任务：${data.longTasks === null ? '浏览器不支持' : data.longTasks.length}。`, `Observed ${data.observedAnimations} simultaneous animations; long tasks: ${data.longTasks === null ? 'not supported' : data.longTasks.length}.`) }),
    data.targetAnimations !== undefined ? h('p', { text: accessText(`目标元素及后代同时运行动画：${data.targetAnimations === null ? '目标已移除，无法确定' : data.targetAnimations}。`, `Simultaneous animations on the target and descendants: ${data.targetAnimations === null ? 'target removed; unavailable' : data.targetAnimations}.`) }) : null,
    data.scroll ? h('p', { text: accessText(`实际滚动 ${data.scroll.delta} px（${data.scroll.container === 'window' ? '页面' : '祖先滚动容器'}）。`, `Observed scroll: ${data.scroll.delta} px (${data.scroll.container === 'window' ? 'page' : 'ancestor scroll container'}).`) }) : null,
    data.mainThread ? h('p', { text: accessText(`浏览器主线程：任务 ${data.mainThread.taskMs} ms，脚本 ${data.mainThread.scriptMs} ms，布局 ${data.mainThread.layoutMs} ms（${data.mainThread.layoutCount} 次），样式 ${data.mainThread.styleMs} ms（${data.mainThread.styleCount} 次）。这些计数可能重叠。`, `Browser main thread: tasks ${data.mainThread.taskMs} ms, scripts ${data.mainThread.scriptMs} ms, layout ${data.mainThread.layoutMs} ms (${data.mainThread.layoutCount}), styles ${data.mainThread.styleMs} ms (${data.mainThread.styleCount}). These counters can overlap.`) }) : data.mainThread === null ? h('p', { class: 'faint', text: accessText('浏览器主线程计数不可用。', 'Browser main-thread counters are unavailable.') }) : null,
    data.comparison ? h('p', { text: accessText(`与基线比较：中位变化 ${data.comparison.medianDeltaMs} ms，P95 变化 ${data.comparison.p95DeltaMs} ms。`, `Compared with baseline: median ${data.comparison.medianDeltaMs} ms, P95 ${data.comparison.p95DeltaMs} ms change.`) }) : null,
    data.comparison?.mainThreadDelta ? h('p', { text: accessText(`主线程与基线相比：任务 ${data.comparison.mainThreadDelta.taskMs} ms，脚本 ${data.comparison.mainThreadDelta.scriptMs} ms，布局 ${data.comparison.mainThreadDelta.layoutMs} ms，样式 ${data.comparison.mainThreadDelta.styleMs} ms。`, `Main-thread change from baseline: tasks ${data.comparison.mainThreadDelta.taskMs} ms, scripts ${data.comparison.mainThreadDelta.scriptMs} ms, layout ${data.comparison.mainThreadDelta.layoutMs} ms, styles ${data.comparison.mainThreadDelta.styleMs} ms.`) }) : null,
    h('p', { class: 'faint', text: accessText('仅覆盖本次浏览器触发场景，计数包含采样开销；不能代表 GPU 掉帧、真机性能或全部交互。', 'This browser sample covers only the selected trigger and includes measurement overhead; it does not establish GPU dropped frames, device performance or other interactions.') }));
  if (item.kind === 'preview') return h('div', { class: 'agent-evidence' },
    h('p', { text: `${data.route} · ${data.selector} · ${data.variants.join(' / ')}` }),
    data.proposals ? h('details', {}, h('summary', { text: accessText('查看各方案修改', 'View proposal changes') }), h('pre', { text: JSON.stringify(data.proposals, null, 2) })) : null,
    h('p', { class: 'faint', text: accessText('在独立浏览器标签中比较，回到对话说明选择。预览可临时调整多个现有元素，不写源码；框架重渲染可能撤销修改。写请求和 WebSocket 已阻止，GET 仍可能有副作用，请使用测试环境。', 'Compare the independent browser tabs and share your choice. Existing elements can be changed temporarily without writing source; framework rerenders may undo changes. Write requests and WebSockets are blocked, but GET requests can have side effects. Use a test environment.') }));
  if (item.kind === 'code-preview-plan') return h('div', { class: 'agent-evidence' },
    h('p', { text: `${accessText('页面', 'Page')}：${data.route} · ${data.selector}` }),
    h('p', { text: accessText('候选代码在独立浏览器运行，不导入登录状态。拦截常规跨域、重定向和写请求；GET 仍可能改数据。浏览器不是安全沙箱，请核对改动并使用可信测试环境。', 'Candidate code runs in separate browsers without saved login state. Ordinary cross-origin requests, redirects and writes are blocked; GET can still change data. The browser is not a security sandbox. Review the changes and use a trusted test environment.') }),
    data.variants.map((variant) => h('details', { class: 'agent-code-diff' }, h('summary', { text: `${variant.name} · ${variant.patches.length} ${accessText('处资源修改', variant.patches.length === 1 ? 'resource change' : 'resource changes')}` }), variant.patches.map((patch) => h('div', {}, h('strong', { text: `${patch.resource}${patch.requestKind ? ` · ${patch.requestKind}` : ''}` }), h('p', { text: accessText('原文', 'Original') }), h('pre', { tabindex: '0', role: 'region', 'aria-label': accessText('原始代码', 'Original code'), text: patch.search }), h('p', { text: accessText('候选', 'Candidate') }), h('pre', { tabindex: '0', role: 'region', 'aria-label': accessText('候选代码', 'Candidate code'), text: patch.replace }))))),
    h('button', { class: 'btn small', type: 'button', disabled: options.codeDisabled, onclick: () => options.startCodePreview(item.id) }, accessText('运行代码方案并比较', 'Run code alternatives')),
    h('p', { class: 'faint', text: accessText('只替换本次浏览器加载的资源，不改项目源码；选择后仍需实现并复检。', 'Only resources loaded in these browsers are replaced. Project source still needs implementation and rechecking after your choice.') }));
  if (item.kind === 'code-preview') return h('div', { class: 'agent-evidence' },
    h('p', { text: data.status === 'opened-with-errors' ? accessText('主页面初始加载发现错误或请求失败；不能视为通过。', 'The main page had errors or failed requests during initial loading; it is not a pass.') : accessText('资源替换已加载；交互尚需检查。', 'Resource replacements loaded; interactions still need checking.') }),
    data.variants.map((variant) => h('p', { text: accessText(`${variant.name}：应用 ${variant.applied} 处；主页面初始脚本错误 ${variant.runtimeErrors}，控制台错误 ${variant.consoleErrors}，失败请求 ${variant.failedRequests}（含被阻止请求）。`, `${variant.name}: ${variant.applied} applied; initial main-page script errors ${variant.runtimeErrors}, console errors ${variant.consoleErrors}, failed requests ${variant.failedRequests} (including blocked requests).`) })),
    h('p', { class: 'faint', text: accessText('这些计数仅覆盖主页面初始加载，不代表子页面、后续交互或真实设备已验证。', 'These counts cover initial loading of the main page only; child pages, later interactions and real devices are not verified.') }));
  if (item.kind === 'component-plan') return h('div', { class: 'agent-evidence' },
    h('strong', { text: `${data.component} · ${data.library}` }),
    h('p', { text: `${accessText('实现文件', 'Implementation')}：${data.implementation.join(', ')}` }),
    h('p', { text: `${accessText('调用位置', 'Consumers')}：${data.consumers.join(', ')}` }),
    h('p', { text: accessText('验证会运行以下项目脚本并执行浏览器场景；场景可能改变测试数据。核对后再运行。', 'Verification runs these project scripts and the browser scenario; the scenario can change test data. Review them before running.') }),
    h('pre', { text: item.privateData.scripts.map((script) => `${item.privateData.manager} run ${script.name}\n  ${script.command}`).join('\n') }),
    h('details', {}, h('summary', { text: `${accessText('查看浏览器场景', 'View browser scenario')} · ${data.scenario}` }), h('pre', { text: item.privateData.scenario })),
    h('button', { class: 'btn small', type: 'button', disabled: options.disabled || options.synced, onclick: () => options.sync(data.planId) }, options.synced ? accessText('已同步', 'Synchronized') : accessText('运行验证并同步', 'Run checks and synchronize')));
  if (item.kind === 'component-sync') return h('div', { class: 'agent-evidence' }, data.status === 'synced'
    ? h('p', { text: `${accessText('组件目录', 'Component catalog')}：${data.componentCatalog} · ${accessText('规格', 'Specification')}：${data.specification}` })
    : h('details', {}, h('summary', { text: accessText('查看失败详情', 'View failure details') }), h('pre', { text: item.privateData?.error || '' })));
  return null;
}

function renderProjectAgent(body) {
  const id = state.current;
  const thread = h('div', { class: 'agent-thread', 'aria-label': accessText('项目修复对话记录', 'Project repair conversation') });
  thread.addEventListener('focusin', (event) => {
    if (event.target.matches(':focus-visible')) event.target.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
  const status = h('p', { class: 'agent-status muted', role: 'status' });
  const modelStatus = h('p', { class: 'agent-model-status muted', role: 'status', text: accessText('正在读取模型设置…', 'Loading model settings…') });
  const error = h('div', { role: 'alert' });
  const prompt = h('textarea', { class: 'input agent-input', id: 'agent-message', rows: '3', maxlength: '12000', placeholder: accessText('描述想检查或修复的页面问题…', 'Describe the page issue to inspect or repair…') });
  prompt.value = state.agentDrafts[id] || '';
  prompt.addEventListener('input', () => { state.agentDrafts[id] = prompt.value; });
  let selected = state.agentFindings[id];
  const selectedFinding = state.round?.result?.violations?.find((item) => item.fingerprint === selected);
  if (selected && !selectedFinding) { delete state.agentFindings[id]; selected = undefined; }
  const capture = state.round?.capture;
  const hasScreenshot = !!(capture?.captures?.[selected]?.shots?.length || capture?.views?.length || capture?.pages?.some((page) => page.screenshot) || (!selected && Object.values(capture?.captures || {}).some((item) => item.shots?.length)));
  const screenshot = h('input', { type: 'checkbox', id: 'agent-screenshot', checked: hasScreenshot, disabled: !hasScreenshot });
  const allowClick = h('input', { type: 'checkbox', id: 'agent-allow-click' });
  const send = h('button', { class: 'btn primary', type: 'submit' }, accessText('发送', 'Send'));
  const stop = h('button', { class: 'btn', type: 'button', hidden: true }, accessText('停止', 'Stop'));
  const closePreview = h('button', { class: 'btn small', type: 'button', hidden: true, onclick: async () => {
    try { await api(`/projects/${id}/agent/close-preview`, { method: 'POST', body: {} }); await refresh(); }
    catch (failure) { showError(failure.message); }
  } }, accessText('关闭方案预览', 'Close previews'));
  let running = false, syncing = false, previewStarting = false, sending = false, timer;
  const showError = (value) => fill(error, value ? h('p', { class: 'notice error', text: value }) : null);
  const controls = () => { send.disabled = running || syncing || previewStarting || sending; stop.hidden = !running; };
  const refresh = async () => {
    if (!body.isConnected) return;
    try {
      const data = await api(`/projects/${id}/agent`);
      if (!body.isConnected) return;
      running = data.running;
      syncing = data.componentSyncRunning;
      previewStarting = data.codePreviewStarting;
      closePreview.hidden = !data.previewActive && !previewStarting;
      closePreview.textContent = previewStarting ? accessText('取消打开方案', 'Cancel opening alternatives') : accessText('关闭方案预览', 'Close previews');
      status.textContent = previewStarting ? accessText('正在打开代码方案，可以取消。', 'Opening code alternatives; you can cancel.') : syncing ? accessText('正在运行组件验证与同步，请等待完成。', 'Running component verification and synchronization; please wait.') : running ? accessText('正在处理；修改后会尝试源码复检，你可以离开本页再查看。', 'Working; source is rechecked after edits. You can leave this page and return for the result.') : accessText('以操作记录为准；源码复检不能代替页面截图复检。', 'Check the tool records; a source recheck cannot replace a page screenshot recheck.');
      const follow = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
      const previousTop = thread.scrollTop;
      const syncedPlans = new Set(data.messages.filter((item) => item.kind === 'component-sync' && item.data?.status === 'synced').map((item) => item.data.planId));
      fill(thread, data.messages.length ? data.messages.map((item) => h('article', { class: `agent-message ${item.role}${item.status === 'error' ? ' failed' : ''}` },
        h('div', { class: 'agent-message-head' }, h('strong', { text: item.role === 'user' ? accessText('你', 'You') : item.role === 'tool' ? accessText('操作记录', 'Tool record') : accessText('项目 Agent', 'Project agent') }),
          item.backupId ? h('button', { class: 'btn small quiet', type: 'button', disabled: running || item.undone, onclick: async () => {
            try { await api(`/projects/${id}/agent/undo`, { method: 'POST', body: { backupId: item.backupId } }); showError(''); await refresh(); }
            catch (failure) { showError(failure.message); }
          } }, item.undone ? accessText('已撤销', 'Undone') : item.created ? accessText('撤销创建', 'Undo creation') : accessText('撤销修改', 'Undo edit')) : null),
        h('div', { class: 'agent-message-text', text: item.text }), renderAgentEvidence(item, { disabled: running || syncing || previewStarting, codeDisabled: running || syncing || previewStarting || data.previewActive, startCodePreview: async (planId) => {
          try { await api(`/projects/${id}/agent/code-preview`, { method: 'POST', body: { planId } }); previewStarting = true; await refresh(); }
          catch (failure) { showError(failure.message); }
        }, synced: syncedPlans.has(item.data?.planId), sync: async (planId) => {
          try { await api(`/projects/${id}/agent/component-sync`, { method: 'POST', body: { planId } }); syncing = true; await refresh(); }
          catch (failure) { showError(failure.message); }
        } }))) : h('div', { class: 'agent-empty' },
        h('strong', { text: accessText('从一个页面问题开始', 'Start with a page issue') }),
        h('p', { class: 'muted', text: accessText('询问当前项目的检查结果、交互或修复。也可以从问题详情进入。', 'Ask about this project’s findings, interactions or fixes. You can also start from a finding.') })));
      if (follow) thread.scrollTop = thread.scrollHeight; else thread.scrollTop = previousTop;
      controls();
      clearTimeout(timer);
      if (running || syncing || previewStarting || data.previewActive) timer = setTimeout(refresh, running || syncing || previewStarting ? 1200 : 3000);
    } catch (failure) { if (body.isConnected) { showError(failure.message); controls(); } }
  };
  const form = h('form', { class: 'agent-compose', onsubmit: async (event) => {
    event.preventDefault();
    const text = prompt.value.trim();
    if (!text || running || syncing || previewStarting || sending) return;
    sending = true; controls(); showError('');
    try {
      await api(`/projects/${id}/agent/messages`, { method: 'POST', body: { text, roundId: state.round?.id, includeScreenshot: screenshot.checked, allowClick: allowClick.checked, ...(selected ? { fingerprint: selected } : {}) } });
      if (prompt.value.trim() === text) { prompt.value = ''; state.agentDrafts[id] = ''; }
      screenshot.checked = hasScreenshot;
      allowClick.checked = false;
      running = true; await refresh();
    } catch (failure) { showError(failure.message); }
    finally { sending = false; controls(); }
  } }, h('label', { for: 'agent-message', text: accessText('给项目 Agent 发消息', 'Message the project agent') }), prompt,
    h('div', { class: 'agent-compose-actions' }, h('label', { class: 'agent-attach' }, screenshot, accessText('附本轮问题截图或页面总览', 'Attach a finding screenshot or page overview')), h('span', { class: 'grow' }), stop, send),
    h('details', { class: 'agent-options' }, h('summary', { text: accessText('动效测量选项', 'Motion measurement options') }), h('label', { class: 'agent-attach' }, allowClick, accessText('允许本次动效测量点击页面（请使用测试环境）', 'Allow page clicks for this motion measurement (use a test environment)'))),
    !hasScreenshot ? h('p', { class: 'faint agent-shot-hint', text: accessText('本轮暂无可用截图；设置预览地址并重新检查后可附图。', 'No screenshot is available for this round. Configure a preview and run a new check to attach one.') }) : null);
  stop.addEventListener('click', async () => {
    try { await api(`/projects/${id}/agent/cancel`, { method: 'POST', body: {} }); status.textContent = accessText('正在停止；已发生的修改不会自动撤销。', 'Stopping; completed edits will not be undone automatically.'); }
    catch (failure) { showError(failure.message); }
  });
  fill(body, h('div', { class: 'agent-page' },
    h('div', { class: 'agent-heading' }, h('div', {}, h('h2', { text: accessText('项目修复对话', 'Project repair chat') }), h('p', { class: 'muted', text: accessText('围绕当前项目的 UI、UX 与体验问题沟通、修改、复检。', 'Discuss, edit and recheck this project’s UI, UX and experience issues.') })),
      h('div', { class: 'row' }, closePreview, h('button', { class: 'btn small', type: 'button', onclick: openGlobal }, accessText('模型设置', 'Model settings')))),
    modelStatus,
    selectedFinding ? h('div', { class: 'agent-selected' }, h('span', { text: `${accessText('当前问题', 'Current finding')}：${selectedFinding.name}` }), h('button', { class: 'btn small quiet', type: 'button', onclick: () => { delete state.agentFindings[id]; renderWorkspace(); } }, accessText('清除', 'Clear'))) : null,
    h('p', { class: 'agent-disclosure', text: accessText('可修改项目文本并保留本地备份。发送时会与所选模型共享问题、对话及读取的文件和预览资源；有截图时默认附带，可取消。', 'Project text can be edited with local backups. Sending shares findings, conversation, files and preview resources read with the selected model. Screenshots are attached by default when available and can be deselected.') }),
    error, thread, status, form));
  void refresh();
  api('/ai').then(({ settings }) => {
    if (!body.isConnected) return;
    const requestLimit = Math.max(1, Math.min(24, Math.trunc(Number(settings.maxCalls)) || 1));
    modelStatus.textContent = settings.mode === 'api' && settings.model ? accessText(`已配置模型：${settings.model} · 每条消息最多 ${requestLimit} 次请求`, `Configured model: ${settings.model} · Up to ${requestLimit} requests per message`) : accessText('尚未配置可用模型，请先打开模型设置。', 'No model is configured. Open model settings first.');
  }).catch(() => { if (body.isConnected) modelStatus.textContent = accessText('无法读取模型设置，请打开设置检查。', 'Could not read model settings. Open Settings to check.'); });
}
