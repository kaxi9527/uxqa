'use strict';

function assuranceCenter() {
  const t = accessText, projectId = state.current, round = state.round;
  const endpoint = '/projects/' + projectId + '/assurance';
  const panel = h('section', { class: 'quality-main assurance-panel', 'aria-label': t('专项检测', 'Specialist checks') });
  const fail = e => toast(e.message, 'error');
  async function refresh() {
    try {
      const [data, history] = await Promise.all([api(endpoint), api('/projects/' + projectId + '/diagnosis')]);
      if (!panel.isConnected) return;
      const id = state.assuranceSuite || 'fidelity';
      const suite = data.suites.find(s => s.id === id) || data.suites[0];
      const select = h('select', { class: 'input', 'aria-label': t('检测类别','Check category'), onchange: () => { state.assuranceSuite = select.value; draw(); panel.querySelector('select').focus(); } },
        data.suites.map(s => h('option', { value: s.id, selected: suite.id === s.id, text: s.title })));
      function draw() {
        const expanded = new Set([...panel.querySelectorAll('details[data-reference][open]')].map(el => el.dataset.reference));
        const active = data.suites.find(s => s.id === select.value);
        const refs = data.clauses.filter(c => c.suites.includes(active.id));
        const findings = freshViolations().filter(item => item.quality?.suite === active.id);
        const samples = data.samples.filter(item => item.roundId === round?.id && item.suite === active.id).sort((a,b) => b.at.localeCompare(a.at));
        const results = data.comparisons.filter(c => c.roundId === round?.id).sort((a,b) => b.at.localeCompare(a.at));
        const plans = history.plans.filter(p => p.roundId === round?.id && p.focus === active.id && p.knowledgeVersion === 'uxqa-assurance-1');
        const actions = h('div', { class: 'quality-actions' },
          antButton(t('新建验证任务','Create verification tasks'), async event => {
            const button = event.currentTarget; button.disabled = true;
            try {
              const { plan } = await api(endpoint + '/plan', { method: 'POST', body: { suite: active.id, roundId: round.id } });
              if (panel.isConnected) { history.plans.unshift(plan); draw(); showDiagnosisPlan(plan, 'verification'); }
            } catch (e) { fail(e); button.disabled = false; }
          }, { type: 'primary', disabled: !round }),
          antButton(t('关联文档条款','Link a source clause'), () => editAssuranceSource(endpoint, active, data.suites, refresh)),
          active.id === 'fidelity' ? antButton(t('对比设计稿','Compare design frame'), () => compareAssuranceFrame(endpoint, round, refresh), { disabled: !round }) : null);
        fill(panel, h('label', { class: 'workflow-field' }, t('检测类别','Check category'), select),
          h('p', { class: 'muted', text: active.inputs }),
          h('details', {}, h('summary', { text: t('运行步骤与判定依据','Run steps and decision rules') }),
            h('ol', {}, active.checks.map(([name, procedure, decision]) => h('li', {}, h('strong', { text: name }), h('p', { text: procedure }), h('p', {class:'muted',text: decision})))),
            h('p', { text: active.boundary }), h('ul', {}, active.sources.map(url => h('li', {}, h('a', { href: url, target: '_blank', rel: 'noreferrer', text: new URL(url).hostname + ' · ' + decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()) }))))),
          evidencePanel(endpoint,active,data.suites,data.sources || [],round,refresh),
          actions, ['interaction','accessibility','compatibility','performance'].includes(active.id) ? assuranceSample(endpoint, active, round, samples, data.sampling, refresh) : null,
          active.id === 'usability' && round ? usabilitySessions(endpoint, round, data.sessions.filter(s => s.roundId === round.id), refresh) : null,
          findings.length ? antButton(t('查看相关发现（','View related findings (') + findings.length + ')', () => {
            resetFindingFilters(); state.suiteFilter = active.id; switchWorkflowTab('issues');
          }) : null,
          !round ? h('p', { class: 'muted', text: t('可先关联文档。完成一轮检查后即可对照实测页面。','Link sources now. Run a check to select observed page evidence.') }) : null,
          refs.length ? h('section', { class: 'stack-tight' }, h('strong', { text: t('本类项目依据','Linked project sources') }), refs.map(c =>
            h('details', { 'data-reference':c.id, open:expanded.has(c.id) }, h('summary', { text: c.source + ' · ' + c.locator }),
              h('p', { text: ({ imported:t('已核对本地导入快照','Verified against local snapshot'), current:t('已核对文件原文','File verified'), stale:t('文件已变更或不可访问，请重新关联','File changed or unavailable. Link its current clause.'), reported:t('人工提供摘录','User-supplied excerpt') })[c.status] + (c.line ? ' · L' + c.line : '') }),
              h('p', { text: c.quote }), h('p',{class:'muted',text:c.purpose==='observation'?t('这是当前行为的观察记录。请另选定义预期的要求来编排场景。','This is a record of observed behavior. Choose a requirement to prepare a scenario.'):t('生成场景会将此条款和项目检测上下文发往设置中选择的模型。离线使用请选择本机模型。','Scenario generation sends this clause and check context to your configured model. Choose a local model for offline use.')}), h('div', { class: 'quality-actions' },
                antButton(t('用所选模型编排场景','Prepare scenario with selected model'), async event => {
                  const button = event.currentTarget; button.disabled = true;
                  try {
                    await api(endpoint + '/scenario', { method: 'POST', body: { roundId: round.id, suite: active.id, clauseId: c.id } });
                    if (state.current === projectId) openProjectAgent();
                  } catch (e) { fail(e); button.disabled = false; }
                }, { disabled: !round || c.status === 'stale' || c.purpose==='observation' }),
                antButton(t('移除此条依据','Remove clause'), async () => {
                  try { await api(endpoint + '/clauses/' + c.id, { method: 'DELETE' }); await refresh(); } catch (e) { fail(e); }
                }))))) : null,
          active.id === 'fidelity' && results.length ? h('details', { open: true }, h('summary', { text: t('本轮设计稿比对','Frame comparisons this round') }), results.map(result =>
            h('div', { class: 'stack-tight' }, h('p', { text: result.reference + ' · ' + result.locator + ' → ' + result.route + ' · ' + result.viewportWidth + 'px' }), designComparisonResult(result)))) : null,
          specialistReview(endpoint, active, data.suites, round, refs),
          plans.length ? h('details', { open: true }, h('summary', { text: t('本轮验证记录','Verification records for this round') }),
            plans.map(plan => antButton(plan.title + ' · ' + timeText(plan.at), () => showDiagnosisPlan(plan, 'verification')))) : null);
      }
      draw();
    } catch (e) { fill(panel, h('p', { role: 'alert', text: e.message }), antButton(t('重试读取','Retry'), refresh)); }
  }
  panel.append(h('p', { class: 'muted', text: t('正在读取项目检测依据…','Loading project sources…') }));
  refresh();
  return panel;
}

function usabilitySessions(endpoint, round, sessions, refresh) {
  const t = accessText;
  const outcomes = { independent:t('独立完成','Completed independently'), assisted:t('协助后完成','Completed with help'), abandoned:t('未完成','Did not complete') };
  const difficulties = {none:t('未观察到困难','No difficulty observed'), discovery:t('找不到入口','Could not find the action'), language:t('误解文案','Misunderstood wording'), effort:t('重复劳动','Repeated effort'), recovery:t('难以恢复','Struggled to recover')};
  const advice = {discovery:t('在任务起点提供可见入口，复测首次操作能否找到。','Expose the action at the task entry and retest first-click discovery.'), language:t('用目标用户的词汇重写标签，复测其对下一步的理解。','Try the participant’s terminology and retest their understanding of the next step.'), effort:t('保留已有输入或消除重复步骤，比较同一任务的往返和耗时。','Retain prior input or remove a repeated step. Compare backtracking and time on the same task.'), recovery:t('在错误位置说明下一步并保存有效输入，复测独立恢复。','Offer a recovery action at the error and preserve valid input, then retest unaided recovery.')};
  const option = values => h('select',{class:'input'},Object.entries(values).map(([value,text]) => h('option',{value,text})));
  const groups = new Map();
  for (const session of sessions) {
    const key = JSON.stringify([session.task, session.cohort]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(session);
  }
  return h('section',{class:'stack-tight'},antButton(t('记录任务体验','Record task observation'),() => openOverlay((panel,close) => {
    const label = (text,el) => h('label',{class:'workflow-field'},text,el);
    const task = h('input',{class:'input',required:true,maxlength:300}), cohort = h('input',{class:'input',required:true,maxlength:300});
    const outcome = option(outcomes), friction = option(difficulties), note = h('textarea',{class:'input',required:true,maxlength:2000,rows:3}), time = h('input',{class:'input',type:'number',min:'0.01',step:'any'});
    const ease=h('select',{class:'input'},h('option',{value:'',text:t('未询问或未回答','No participant response')}),
      [1,2,3,4,5,6,7].map(n=>h('option',{value:String(n),text:String(n)+(n===1?t(' · 非常困难',' · Very difficult'):n===7?t(' · 非常容易',' · Very easy'):'')})));
    const error = h('p',{role:'alert',hidden:true});
    const submit = h('button',{class:'btn primary',type:'submit',text:t('保存观察记录','Save observation record')});
    append(panel,[h('h2',{text:t('任务体验观察','Task observation')}),h('form',{class:'assurance-form',onsubmit:async e=>{
      e.preventDefault(); submit.disabled=true;
      try { await api(endpoint+'/session',{method:'POST',body:{roundId:round.id,task:task.value,cohort:cohort.value,outcome:outcome.value,friction:friction.value,evidence:note.value,...(time.value ? {seconds:time.valueAsNumber} : {}),...(ease.value?{reportedEase:Number(ease.value)}:{})}}); close(true); await refresh(); }
      catch(err){error.hidden=false; error.textContent=err.message; submit.disabled=false;}
    }},label(t('测试任务','Task tested'),task),label(t('用户群与设备条件','Participant group and device conditions'),cohort),label(t('实际结果','Observed outcome'),outcome),
      label(t('观察到的困难','Observed difficulty'),friction),label(t('观察过程或证据位置','Observation or evidence location'),note),label(t('实测耗时（秒，可选）','Measured duration (seconds, optional)'),time),
      label(t('请参与者回答：刚才的任务有多容易？','Ask the participant: How easy was that task?'),ease),
      error,h('div',{class:'row'},submit,antButton(t('取消','Cancel'),()=>close(false))))]);
  },{label:t('任务体验观察','Task observation')})),[...groups.values()].map(group=>h('details',{open:true},
    h('summary',{text:group[0].task+' · '+group[0].cohort}),h('p',{text:t('独立完成 ','Independent completions: ')+group.filter(s=>s.outcome==='independent').length+' / '+group.length}),
    group.map(s=>h('div',{class:'stack-tight'},h('strong',{text:outcomes[s.outcome]+(s.seconds ? ' · '+s.seconds+' s' : '')}),
      s.reportedEase?h('p',{text:t('参与者自评容易程度 · ','Participant-rated ease · ')+s.reportedEase+'/7'}):null,h('p',{text:s.evidence}),advice[s.friction] ? h('p',{text:t('待验证建议：','Suggestion to test: ')+advice[s.friction]}) : null)))));
}

function assuranceSample(endpoint, suite, round, samples, running, refresh) {
  const t = accessText, pages = project().pages;
  const route = h('input', { class:'input', required:true, value:pages?.routes?.[0] || '/', 'aria-label':t('实测页面路径','Page route to sample') });
  const status = h('p', { class:'muted', role:'status' });
  const motion=suite.id==='performance';
  const trigger=h('select',{class:'input'},[['idle',t('静止基线','Idle baseline')],['scroll',t('滚动','Scroll')],['focus',t('聚焦','Focus')],['hover',t('悬停','Hover')]].map(([value,text])=>h('option',{value,text})));
  const selector=h('input',{class:'input',value:'body',maxlength:500,required:motion});
  const reduce=h('input',{type:'checkbox'});
  const action = h('button', { type:'submit', class:'btn', disabled:running || !round || !pages, text:t('运行页面实测','Run page sample') });
  const form = h('form', { class:'stack-tight', onsubmit: async event => {
    event.preventDefault(); action.disabled = true; status.textContent = t('正在采集此路径的页面证据…','Collecting evidence from this route…');
    try { await api(endpoint + '/sample', { method:'POST', body:{ suite:suite.id, roundId:round.id, route:route.value,
      ...(motion?{trigger:trigger.value,selector:selector.value,reducedMotion:reduce.checked}:{}) } }); await refresh(); }
    catch (e) { status.textContent = e.message; action.disabled = false; }
  } }, h('label', { class:'workflow-field' }, t('实测页面路径','Page route to sample'), route),
    motion?[reviewField(t('采样触发方式','Sample trigger'),trigger),reviewField(t('目标元素选择器','Target CSS selector'),selector),
      h('label',{},reduce,' ',t('使用减少动态效果偏好','Use reduced-motion preference'))]:null,h('div', { class:'quality-actions' },action,
    running ? antButton(t('刷新进度','Refresh status'), refresh) : null),status);
  const labels = {pass:t('通过','Pass'), fail:t('发现偏差','Failed'), blocked:t('阻塞','Blocked'), 'not-verified':t('待验证','Unverified'), 'not-applicable':t('不适用','Not applicable')};
  return h('section', {class:'stack-tight'}, form, !pages ? h('p',{class:'muted',text:t('先设置项目预览地址。','Configure the project preview URL first.')}) : null,
    samples.map(item => h('details', {}, h('summary', {text:t('实测记录','Page sample') + ' · ' + item.route + ' · ' + timeText(item.at)}),
      item.reason ? h('p',{text:labels.blocked + ' · '+item.reason}) : null,
      item.sample ? h('pre', { class:'mono', text:JSON.stringify(item.sample,null,2) }) : null,
      (item.checks || []).map(c => h('p', { text:labels[c.status] + ' · ' + c.check + ' · ' + c.viewport + ' · ' + c.detail })),
      (item.findings || []).map(f => h('p', {text:f.message + ' · ' + (f.evidence || []).join(', ')})))));
}

function editAssuranceSource(endpoint, active, suites, refresh, seed) {
  const t = accessText;
  openOverlay((panel, close) => {
    const label = (name, input) => h('label', { class: 'workflow-field' }, name, input);
    const path = h('input', { class: 'input', required: true, maxlength: 500, placeholder: t('例：docs/acceptance.md','e.g. docs/acceptance.md') });
    const location = h('input', { class: 'input', required: true, maxlength: 500 });
    const quote = h('textarea', { class: 'input', required: true, rows: 4, maxlength: 4000 });
    const linked = h('input', { type: 'checkbox', checked: true });
    const purpose=h('select',{class:'input'},h('option',{value:'requirement',text:t('定义预期的要求','Requirement defining expected behavior')}),
      h('option',{value:'observation',selected:seed?.observation,text:t('描述已有行为的观察','Observation of current behavior')}));
    const boxes = suites.map(s => h('input', { type: 'checkbox', value: s.id, checked: seed?.suites?.length ? seed.suites.includes(s.id) : s.id === active.id }));
    if(seed){path.value=seed.name;path.readOnly=true;location.value=seed.locator;location.readOnly=true;quote.value=seed.quote;linked.checked=false;}
    const alert = h('p', { class: 'notice error', role: 'alert', hidden: true });
    const suggestions = h('div', { class: 'assurance-source-list stack-tight' });
    const feedback = e => { alert.hidden = false; alert.textContent = e.message; };
    async function inspect(offset = 0) {
      try {
        const source = path.value;
        const data = await api(endpoint + '/document', { method: 'POST', body: { path: source, offset } });
        if (source !== path.value) return;
        alert.hidden = true;
        fill(suggestions, h('p', { class: 'muted', text: t('选择原文后可调整推荐类别。','Choose a passage, then review its suggested categories.') }), data.candidates.map(row =>
          h('button', { class: 'btn', type: 'button', onclick: () => {
            quote.value = row.quote; location.value = 'L' + row.line; linked.checked = true;
            for (const box of boxes) box.checked = row.suites.length ? row.suites.includes(box.value) : box.value === active.id;
            fill(suggestions); quote.focus();
          }, text: 'L' + row.line + ' · ' + row.quote.slice(0,140) })), data.next !== null ? antButton(t('下一组原文','Next passages'), () => inspect(data.next)) : null);
      } catch (e) { feedback(e); }
    }
    const form = h('form', { class: 'assurance-form', onsubmit: async e => {
      e.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
      try {
        await api(endpoint + '/clauses', { method: 'POST', body: { source: path.value, locator: location.value, quote: quote.value, suites: boxes.filter(b => b.checked).map(b => b.value), purpose:purpose.value, verifyFile: linked.checked, evidenceId:seed?.evidenceId,index:seed?.index } });
        close(true); await refresh();
      } catch (err) { feedback(err); button.disabled = false; }
    } }, label(t('项目文件路径或资料名称','Project file path or source title'), path),
      seed ? null : antButton(t('从项目文本选择原文','Select a passage from project text'), () => inspect()),
      suggestions, label(t('版本、章节、页码或设计节点','Revision, section, page or design node'), location),
      label(t('适用于项目的原文','Source excerpt'), quote),label(t('条款用途','Clause purpose'),purpose),
      seed ? null : h('label', {}, linked, ' ', t('核对项目文本文件；外部文档、PDF 或设计节点可取消并手动摘录。','Verify against a project text file. For external documents, PDFs or design nodes, uncheck and enter an excerpt.')),
      h('fieldset', {}, h('legend', { text: t('适用检测（可多选）','Applicable checks (select all that apply)') }),
        h('div', { class: 'filters' }, boxes.map((box, i) => h('label', {}, box, ' ', suites[i].title)))),
      alert, h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: t('保存依据','Save source') }), antButton(t('取消','Cancel'), () => close(false))));
    append(panel, [h('h2', { text: t('关联文档条款','Link a source clause') }), form]);
  }, { label: t('关联文档条款','Link a source clause') });
}

function designComparisonResult(result) {
  const t = accessText;
  if (result.status === 'missing') return h('p', { role: 'status', text: t('截图不可用，请重新检测。','Capture unavailable. Run a new check.') });
  if (result.status === 'unaligned') return h('p', { role: 'status', text: t('尺寸未对齐，待重新配对','Dimensions differ. Match the frames before comparing.') + ' · ' + result.expected.join('×') + ' / ' + result.observed.join('×') });
  const url = '/api/projects/' + state.current + '/assurance/reference-image/' + result.id;
  const observed = shotUrl(result.capture);
  const pair = h('div',{class:'assurance-pair'});
  const compare = h('details',{ontoggle:async () => {
    if (!compare.open) { fill(pair); return; }
    try {
      const response = await fetch(url,{headers:{'x-uxqa-token':token}});
      if (!response.ok) throw new Error(t('设计原图不可用或版本已变化。','The design frame is unavailable or its revision has changed.'));
      const reader = new FileReader();
      reader.onload = () => {
        if (!compare.open || !compare.isConnected) return;
        const frame = (src,title) => h('figure',{},h('figcaption',{text:title}),h('img',{src,alt:title,class:'assurance-diff',onerror:e=>e.currentTarget.replaceWith(h('p',{text:t('截图不可用，请重新检测。','Capture unavailable. Run a new check.')}))}));
        fill(pair,frame(reader.result,t('设计帧','Design frame')),frame(observed,t('实测画面','Observed view')));
      };
      reader.readAsDataURL(await response.blob());
    } catch (e) { if (compare.open) pair.textContent=e.message; }
  }},h('summary',{text:t('并排查看设计与页面','Compare design and observed view side by side')}),pair);
  return h('div', {}, h('p', { role: 'status', text: (result.changedPixels ? t('差异待核对','Differences to review') : t('容差内一致','Matched within tolerance')) + ' · ' + result.changedPixels + ' / ' + result.totalPixels + t(' 像素；颜色通道容差 24。',' pixels; RGB channel tolerance 24.') }),compare,
    result.diff ? h('details', {}, h('summary', { text: t('查看差异图','View pixel differences') }),
      h('img', { class: 'assurance-diff', loading: 'lazy', src: shotUrl(result.diff), alt: t('红色标记发生变化的像素','Changed pixels highlighted in red'), onerror: e => {
        e.currentTarget.replaceWith(h('p', { text: t('差异图不可用或已过期。','The difference image is unavailable or expired.') }));
      } })) : null);
}

function compareAssuranceFrame(endpoint, round, refresh, source) {
  const t = accessText;
  openOverlay((panel, close) => {
    const views = round.capture?.views || [];
    const path = h('input', { class: 'input', required: true, placeholder: 'design/frame.png' });
    const locator = h('input', { class: 'input', required: true, maxlength: 500 });
    if(source){path.value=source.name;path.readOnly=true;locator.value=source.revision.slice(0,12);}
    const select = h('select', { class: 'input' }, views.map(v => h('option', { value: v.image, text: v.route + ' · ' + v.width + 'px' })));
    const aligned = h('input', { type: 'checkbox', required: true });
    const result = h('div', { 'aria-live': 'polite' });
    const label = (name, input) => h('label', { class: 'workflow-field' }, name, input);
    const submit = h('button', { class: 'btn primary', type: 'submit', disabled: !views.length, text: t('开始比对','Compare images') });
    const form = h('form', { class: 'assurance-form', onsubmit: async e => {
      e.preventDefault(); submit.disabled = true; result.textContent = t('正在比较像素…','Comparing pixels…');
      try { const data = await api(endpoint + '/compare', { method:'POST', body:{ path:path.value, evidenceId:source?.id, locator:locator.value, view:select.value, roundId:round.id, aligned:aligned.checked } });
        fill(result, designComparisonResult(data)); await refresh();
      } catch (err) { result.textContent = err.message; }
      finally { submit.disabled = false; }
    } }, label(source?t('已导入画面','Imported frame'):t('项目内的设计稿 PNG','Design PNG in this project'),path), label(t('帧版本或节点','Frame revision or node'),locator),
      label(t('本轮实测画面','Observed view in this round'),select), views.length ? null : h('p', { text:t('本轮没有可用页面截图，请配置预览并重新检查。','This round has no available view. Configure a preview and run a new check.') }),
      h('label', {}, aligned, ' ', t('已核对角色、内容、主题、字体、比例和裁切范围。','I matched role, content, theme, fonts, scale and crop.')), result,
      h('div', { class:'row' }, submit, antButton(t('关闭','Close'), () => close(false))));
    append(panel,[h('h2',{text:t('对比设计稿','Compare design frame')}),form]);
  }, { label:t('对比设计稿','Compare design frame') });
}
