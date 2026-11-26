'use strict';

async function failedTaskActions(header,projectId,roundId){
  const t=accessText,base='/projects/'+projectId+'/acceptance-tasks';
  try{
    const {tasks}=await api(base+'/failed?round='+encodeURIComponent(roundId));
    if(!header.isConnected||!tasks.length)return;
    const box=h('details',{},h('summary',{text:t('未通过的验收任务','Failing acceptance tasks')+' · '+tasks.length}));
    for(const task of tasks){
      const msg=h('span',{role:'status'});
      box.append(h('div',{class:'quality-actions'},h('strong',{class:'grow',text:task.title}),
        antButton(t('查看证据','View evidence'),()=>taskDesk(projectId,task.id)),
        antButton(t('让 AI 修复并复检','Repair with AI and retest'),async e=>{
          const btn=e.currentTarget;btn.disabled=true;msg.textContent=t('正在修复并验证…','Repairing and replaying…');
          try{await api(base,{method:'POST',body:{op:'repair',id:task.id}});if(header.isConnected){renderWorkspace();taskDesk(projectId,task.id);}}
          catch(err){msg.textContent=err.message;btn.disabled=false;}
        }),msg));
    }
    header.append(box);
  }catch(err){if(header.isConnected)toast(err.message);}
}

function designRegionPicker(source,views,select){
  const t=accessText,el=h('details',{}),inputs={},marker=h('span',{class:'design-region-marker',hidden:true});
  const component=h('input',{class:'input',maxlength:150}),stateName=h('input',{class:'input',maxlength:100}),info=h('p',{role:'status'});
  const img=h('img',{alt:t('设计图：点击映射组件或拖动选择比对区域','Design frame: click a mapped component or drag a comparison region'),draggable:'false'});
  const preview=h('div',{class:'design-region-image'},img,marker);
  let from=null;
  function set(box){
    for(const key of Object.keys(inputs))inputs[key].value=box?box[key]:'';
    marker.hidden=!box||!img.naturalWidth;
    if(!marker.hidden)Object.assign(marker.style,{left:100*box.x/img.naturalWidth+'%',top:100*box.y/img.naturalHeight+'%',width:100*box.width/img.naturalWidth+'%',height:100*box.height/img.naturalHeight+'%'});
  }
  function point(e){const b=img.getBoundingClientRect();return {x:Math.max(0,Math.min(img.naturalWidth-1,Math.floor((e.clientX-b.left)*img.naturalWidth/b.width))),y:Math.max(0,Math.min(img.naturalHeight-1,Math.floor((e.clientY-b.top)*img.naturalHeight/b.height)))};}
  img.onpointerdown=e=>{if(img.naturalWidth){from=point(e);img.setPointerCapture(e.pointerId);}};
  img.onpointercancel=()=>{from=null;};
  img.onpointerup=e=>{
    if(!from)return;
    const a=from,b=point(e);from=null;
    const view=views.find(v=>v.image===select.value),regions=view?.regions||[];
    const hit=regions.filter(r=>a.x>=r.x&&a.y>=r.y&&a.x<r.x+r.width&&a.y<r.y+r.height).sort((a,b)=>a.width*a.height-b.width*b.height)[0];
    if(Math.abs(b.x-a.x)+Math.abs(b.y-a.y)<5){
      if(!hit){info.textContent=t('此处未采集到组件标识。可拖选区域并手工关联。','No component marker at this point. Drag a region and map it manually.');return;}
      const x=Math.max(0,hit.x),y=Math.max(0,hit.y);
      set({x,y,width:Math.min(hit.x+hit.width,img.naturalWidth)-x,height:Math.min(hit.y+hit.height,img.naturalHeight)-y});component.value=hit.name;
    }else{set({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x)+1,height:Math.abs(b.y-a.y)+1});component.value='';}
    info.textContent=component.value;
  };
  for(const key of ['x','y','width','height'])inputs[key]=h('input',{class:'input',type:'number',min:key==='x'||key==='y'?0:1,step:1});
  select.addEventListener('change',()=>{set(null);component.value='';stateName.value='';info.textContent='';});
  el.ontoggle=async()=>{
    if(!el.open||!source||img.hasAttribute('src'))return;
    try{const res=await fetch('/api/projects/'+state.current+'/acceptance-tasks/image/'+source.id,{headers:{'x-uxqa-token':token}});if(!res.ok)throw Error(t('设计图不可用','Design frame unavailable'));
      const reader=new FileReader();reader.onload=()=>{img.src=reader.result;};reader.readAsDataURL(await res.blob());
    }catch(e){info.textContent=e.message;}
  };
  append(el,[h('summary',{text:t('选择组件区域','Select component region')}),source?preview:null,info,
    h('div',{class:'design-region-fields'},Object.entries(inputs).map(([k,v])=>reviewField(k,v))),
    reviewField(t('组件名（无运行时标识时手动关联）','Component name (manual fallback)'),component),
    reviewField(t('实测状态（如加载、报错）','Observed state (e.g. loading or error)'),stateName),
    antButton(t('使用整张图','Use full frame'),()=>{set(null);component.value='';stateName.value='';})]);
  return {element:el,value:()=>Object.values(inputs).some(i=>i.value!=='')?{region:Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value===''?null:Number(v.value)])),component:component.value,state:stateName.value}:{}};
}

function requirementForm(catalog,task,run,t,busy) {
  const select=h('select',{class:'input'},h('option',{value:'',text:t('选择要核验的行为','Choose a behavior to verify')}),
    Object.entries(catalog).map(([value,spec])=>h('option',{value,text:t(...spec.title)})));
  const content=h('div',{class:'stack-tight'});
  select.onchange=()=>{
    fill(content);
    const spec=catalog[select.value];if(!spec)return;
    function inputs(fields,container) {
      const elements={};
      for(const [key,zh,en,placeholder,optional] of fields){
        const input=h('input',{class:'input',required:!optional,placeholder});elements[key]=input;
        container.append(reviewField(t(zh,en),input));
      }
      return ()=>Object.fromEntries(Object.entries(elements).map(([key,input])=>[key,input.value]));
    }
    const form=h('form',{class:'assurance-form'}),read=inputs(spec.fields,form),rows=new Map();
    let readBehavior;
    if(select.value==='page-behavior'){
      const action=h('select',{class:'input','aria-label':t('页面操作','Page action')},[['none','无需操作','No action'],['click','点击','Click'],['fill','填写','Fill']].map(([value,zh,en])=>h('option',{value,text:t(zh,en)})));
      const assertion=h('select',{class:'input','aria-label':t('预期结果','Expected result')},[['visible','结果可见','Visible'],['text','文字完全匹配','Exact text'],['hidden','操作后隐藏','Hidden after action']].map(([value,zh,en])=>h('option',{value,text:t(zh,en)})));
      const target=h('input',{class:'input',placeholder:'#open'}),value=h('input',{class:'input'}),text=h('input',{class:'input'});
      const targetRow=reviewField(t('操作对象 CSS 选择器','Action CSS selector'),target);
      const valueRow=reviewField(t('输入值','Value to fill'),value);
      const textRow=reviewField(t('预期看到的文字','Expected visible text'),text);
      const sync=()=>{
        targetRow.hidden=action.value==='none';target.required=!targetRow.hidden;
        valueRow.hidden=action.value!=='fill';
        textRow.hidden=assertion.value!=='text';text.required=!textRow.hidden;
        assertion.options[2].disabled=action.value==='none';
        if(assertion.options[2].disabled&&assertion.value==='hidden'){assertion.value='visible';textRow.hidden=true;text.required=false;}
      };
      action.onchange=assertion.onchange=sync;sync();
      append(form,[reviewField(t('页面操作','Page action'),action),targetRow,valueRow,reviewField(t('预期结果','Expected result'),assertion),textRow]);
      readBehavior=()=>({action:action.value,target:target.value,value:value.value,assertion:assertion.value,text:text.value});
    }
    if(spec.group){
      const group=h('fieldset',{class:'stack-tight'},h('legend',{text:t(...spec.group.title)}));
      const add=()=>{
        const row=h('div',{class:'stack-tight'});rows.set(row,inputs(spec.group.fields,row));
        if(rows.size>spec.group.min)row.append(antButton(t('移除此项','Remove entry'),()=>{rows.delete(row);row.remove();}));
        group.append(row);
      };
      for(let i=0;i<spec.group.min;i++)add();
      form.append(group,antButton(t('增加一项','Add entry'),add));
    }
    const outcome=h('select',{class:'input',required:true},[['',t('按条款选择','Choose from the requirement')],['retain',t('保留编辑值','Retain the edit')],['restore',t('恢复原值','Restore original value')]].map(([value,text])=>h('option',{value,text})));
    if(select.value==='return-state')form.append(reviewField(t('返回后的预期','Expected on return'),outcome));
    const save=h('button',{type:'submit',class:'btn primary',disabled:busy,text:t('保存并绑定方案','Save and bind plan')});
    form.onsubmit=e=>{
      e.preventDefault();const binding={kind:select.value,...read(),...readBehavior?.()};
      if(spec.group)binding[spec.group.key]=[...rows.values()].map(readRow=>readRow());
      if(select.value==='return-state')binding.outcome=outcome.value;
      run('prepare-requirement',{id:task.id,binding},save);
    };
    form.append(save);
    content.append(h('blockquote',{text:task.quote}),h('small',{text:task.locator}),h('p',{text:t(...spec.method)}),h('p',{class:'muted',text:t('按原文选择预期，填写测试路径和 CSS 选择器。绑定后用测试数据运行。','Choose the expectation from the source, then enter test routes and CSS selectors. Run the bound plan with test data.')}),form);
  };
  return h('details',{},h('summary',{text:t('从这条要求创建验收场景','Create a check from this requirement')}),reviewField(t('验收类型','Verification type'),select),content);
}

function taskDesk(projectId,initialId,regionId,fingerprint,issueRound,baselineId){
  const t=accessText,base='/projects/'+projectId,endpoint=base+'/acceptance-tasks';
  openOverlay((panel,close)=>{
    const body=h('div',{class:'stack-tight'}),status=h('p',{role:'status'});let selected=initialId;
    const run=async (op,input,button)=>{
      button.disabled=true;status.textContent=t('处理中…','Working…');
      try{await api(endpoint,{method:'POST',body:{op,...input}});status.textContent='';await load();}
      catch(e){status.textContent=e.message;button.disabled=false;}
    };
    async function load(){
      try{
        const [data,assurance]=await Promise.all([api(endpoint),api(base+'/assurance')]);
        if(!panel.isConnected)return;
        const task=data.tasks.find(v=>v.id===selected)||data.tasks[0];
        const sources=assurance.sources.filter(s=>s.kind==='text'&&s.count);
        const source=h('select',{class:'input','aria-label':t('任务来源','Task source')},sources.map(s=>h('option',{value:s.id,text:s.name})));
        const picker=h('select',{class:'input','aria-label':t('选择验收任务','Choose acceptance task'),onchange:e=>{selected=e.target.value;load();}},data.tasks.map(v=>h('option',{value:v.id,selected:v===task,text:v.action})));
        const m=data.metrics;
        const calibration=data.calibration.filter(g=>g.partition==='holdout'&&g.model);
        const rate=(n,total)=>total?n+'/'+total:t('暂无已裁定样本','No adjudicated samples');
        const insights=h('details',{},h('summary',{text:t('项目成效','Project measures')}),
          h('p',{text:t('导入到首次有效运行，中位耗时','Median import to first conclusive run')+' · '+(m.timed?Math.round(m.medianMs/1000)+' s':'—')+' · '+m.timed+'/'+data.importedDocuments+t(' 份正文文档',' text documents')}),
          h('p',{text:t('原场景复检通过','Repairs verified on the same scenario')+' · '+m.verified+'/'+m.repairs+' · '+t('待验证 ','Unverified ')+m.unverified}),
          calibration.length?calibration.map(g=>h('p',{text:[g.suite,g.model,g.configuration.slice(0,8),t('误报','False alarms')+' '+rate(g.counts.falseAlarms,g.counts.humanPasses),t('漏报','Misses')+' '+rate(g.counts.missedIssues,g.counts.humanIssues),t('盲测严重漏放','Held-out blockers among model passes')+' '+rate(g.counts.escapedBlockers,g.counts.reviewedPasses),t('待双评 / 裁定 ','Pending / disputed ')+g.counts.pending+' / '+g.counts.unresolved].join(' · ')})):h('p',{text:t('严重漏放：尚无独立盲测样本','Escaped blockers · No held-out samples')}));
        const add=sources.length?h('div',{class:'quality-actions'},source,antButton(t('从文档生成任务','Generate tasks from document'),()=>{
          const selectedSource=sources.find(s=>s.id===source.value);
          close(false);
          draftTasks(projectId,selectedSource);
        })):
          h('p',{class:'muted',text:t('在项目检查中拖入需求文档后，可以从原文生成任务。','Drop a requirements document in Check to generate tasks from its passages.')});
        fill(body,add,insights,task?picker:null);
        if(data.disagreements.length)body.append(h('details',{},h('summary',{text:t('优先复盘','Priority reviews')+' · '+data.disagreements.length}),data.disagreements.map(r=>
          antButton(r.task+' · '+(r.blocked?t('AI 放行、任务受阻','Model pass, task blocked'):t('AI 放行、用户自评困难','Model pass, participant found it difficult')),async()=>{
            try{const path=base+'/assurance/reviews';const w=await api(path+'?suite='+r.suite+'&round='+r.roundId);
              const item=w.cases.find(c=>c.id===r.id);if(item)showReviewCase(path,item,assurance.suites.find(s=>s.id===r.suite),load);
            }catch(e){status.textContent=e.message;}
          }))));
        if(task){
          const plans=data.plans.filter(plan=>plan.clauseId===task.clauseId);
          const latest=baselineId&&task.id===initialId?task.attempts.find(a=>a.id===baselineId):task.attempts.at(-1),linked=plans.find(p=>p.id===task.planId);
          const action=(name,op,options={},disabled=false)=>antButton(name,e=>run(op,{id:task.id,...options},e.currentTarget),{disabled:disabled||data.busy});
          const regions=assurance.comparisons.filter(c=>c.region && c.roundId===latest?.roundId);
          const visual=h('select',{class:'input'},h('option',{value:'',text:t('未选择','None selected')}),regions.map(c=>h('option',{value:c.id,selected:c.id===regionId,text:[c.component,c.state,c.viewportWidth+'px',c.locator].filter(Boolean).join(' · ')})));
          append(body,[h('dl',{class:'task-fields'},[['角色','Role',task.actor],['条件','Conditions',task.condition],['操作','Action',task.action],['预期','Expected',task.expected]].flatMap(([zh,en,v])=>[h('dt',{text:t(zh,en)}),h('dd',{text:v})])),
            h('details',{},h('summary',{text:task.locator}),h('blockquote',{text:task.quote}),h('small',{text:task.revision})),
            !task.origin && task.clauseId ? requirementForm(data.requirementChecks,task,run,t,data.busy) : null,
            !linked?action(t('用所选模型编排场景','Prepare scenario with selected model'),'prepare'):null,
            plans.map(p=>{
              const configure=h('input',{type:'checkbox',checked:p.id===task.planId&&!!task.controls});
              const roles=[t('变更前','Baseline'),t('激活后','After activation'),t('未改对象','Untouched control')];
              const phaseSelects=roles.map((_,i)=>h('select',{class:'input'},h('option',{value:'',text:t('选择实测阶段','Choose observed phase')}),
                p.plan.phases.map(ph=>h('option',{value:ph.name,selected:task.controls?.[i]===ph.name,text:ph.name}))));
              const fields=h('div',{hidden:!configure.checked},roles.map((role,i)=>reviewField(role,phaseSelects[i])));
              configure.onchange=()=>fields.hidden=!configure.checked;
              return h('details',{},h('summary',{text:(p.id===task.planId?t('已绑定场景','Bound scenario'):t('审核场景','Review scenario'))+' · '+p.plan.name}),
                h('ol',{},p.plan.phases.map(ph=>h('li',{},h('strong',{text:ph.name}),h('small',{text:ph.actor+' · '+ph.route}),...(ph.requires||[]).map(rule=>h('p',{text:t('前置证据 · ','Prerequisite · ')+rule.name})),...(ph.assert||[]).map(rule=>h('p',{text:t('验收 · ','Check · ')+rule.name}))))),
                h('details',{},h('summary',{text:t('查看完整绑定','View all bindings')}),h('pre',{class:'mono',text:JSON.stringify(p.plan,null,2)})),h('label',{},configure,' ',t('配置传播：验证三组对照','Configuration propagation: check three controls')),fields,
                antButton(t('确认步骤和对照，可重复执行','Approve steps and controls for replay'),e=>run('bind',{id:task.id,planId:p.id,controls:configure.checked?phaseSelects.map(s=>s.value):undefined},e.currentTarget)));
            }),
            regions.length?reviewField(t('本次修复的设计区域','Design region for this repair'),visual):null,
            h('div',{class:'quality-actions'},action(t('运行任务','Run task'),'run',{},!linked),
              antButton(t('修复问题并自动复检','Repair and automatically retest'),e=>run('repair',{id:task.id,regionId:visual.value,fingerprint,issueRound,baselineId:latest?.id},e.currentTarget),{disabled:data.busy||latest?.status!=='fail'}),
              action(t('验证修复','Verify repair'),'verify',{},!task.repair)),
            task.attempts.slice().reverse().map(a=>h('details',{},h('summary',{text:(a.repairOf?t('修后复检','After repair'):t('运行任务','Task run'))+' · '+a.status+' · '+timeText(a.at)}),
              a.edited?.length?h('p',{text:a.edited.join(', ')}):null,
              h('div',{class:a.repairOf?'task-comparison':''},a.repairOf?attemptEvidence(task.attempts.find(x=>x.id===a.repairOf),t('修复前','Before repair')):null,attemptEvidence(a,a.repairOf?t('修复后','After repair'):t('观测','Observations'))))),
            state.round?antButton(t('记录体验反馈','Record experience feedback'),()=>quickTaskFeedback(projectId,task.id,state.round.id,'logic',load)):null]);
        }
        const disputed=data.feedback.filter(f=>f.caseId||f.impact||data.feedback.some(g=>g.target===f.target&&g.roundId===f.roundId&&g.choice!==f.choice));
        if(data.feedback.length)body.append(h('details',{},h('summary',{text:t('日常反馈','Everyday feedback')+' · '+data.feedback.length}),
          data.feedback.slice().reverse().map(f=>h('p',{text:[f.observer,{issue:t('确实有问题','Confirmed issue'),acceptable:t('可以接受','Acceptable'),missed:t('漏掉了问题','Missed issue')}[f.choice],f.note,f.assistive].filter(Boolean).join(' · ')}))));
        const unique=[...new Map(disputed.map(f=>[f.roundId+'/'+f.target,f])).values()];
        if(unique.length)append(body,[h('details',{},h('summary',{text:t('需要双人盲评','Needs blind review')+' · '+unique.length}),
          unique.map(f=>antButton(t('进入双人盲评','Open blind review')+' · '+f.target.slice(0,12),()=>escalateFeedback(projectId,f,assurance.suites.find(s=>s.id===f.suite),load))))]);
      }catch(e){status.textContent=e.message;}
    }
    append(panel,[h('h2',{text:t('验收任务','Acceptance tasks')}),status,body,antButton(t('关闭','Close'),()=>close(false))]);load();
  },{label:t('验收任务','Acceptance tasks')});
}

function attemptEvidence(record,title){
  if(!record)return null;
  const t=accessText;let parsed;
  try{parsed=JSON.parse(record.detail);}catch{}
  const phases=Array.isArray(parsed?.observed)?parsed.observed:[];
  const first=phases.find(p=>p.status==='fail') || phases.find(p=>p.status==='blocked'||p.status==='not-verified');
  const highlight=first?h('div',{class:'notice'},h('strong',{text:first.status==='fail'?t('优先处理的偏差','First discrepancy'):t('先补齐这一步的证据','First missing evidence')}),
    h('p',{text:[first.actor,first.phase,first.route].join(' · ')}),h('p',{text:first.detail})):null;
  return h('section',{},h('strong',{text:title+' · '+record.status}),highlight,Array.isArray(parsed?.observed)?parsed.observed.map(p=>
    h('article',{class:'task-phase'},h('strong',{text:[p.actor,p.phase,p.route].filter(Boolean).join(' · ')}),
      h('p',{text:p.status+' · '+(p.detail||'')}),Object.entries(p.observations||{}).map(([name,value])=>h('p',{text:name+' · '+JSON.stringify(value)})))):h('p',{text:record.detail}),
    parsed?.gaps?.length?h('p',{class:'notice warn',text:t('仍待验证 · ','Still unverified · ')+parsed.gaps.join(' · ')}):null);
}

function regionCoverage(comparisons){
  const t=accessText,rows=comparisons.filter(c=>c.region&&c.component);
  if(!rows.length)return null;
  return h('details',{},h('summary',{text:t('组件、状态与断点','Components, states and breakpoints')}),[...new Set(rows.map(c=>c.component))].map(name=>{
    const matches=rows.filter(c=>c.component===name),pages=[...new Set(matches.flatMap(c=>c.impacted||[]))];
    const stateOf=c=>({默认:'default',加载:'loading',报错:'error',错误:'error'}[c.state]||c.state||'unlabeled');
    const states=[...new Set(['default','loading','error',...matches.map(stateOf)])];
    const widths=[...new Set(comparisons.map(c=>c.viewportWidth).filter(Boolean))].sort((a,b)=>a-b);
    return h('article',{class:'task-phase'},h('h4',{text:name}),h('p',{text:t('已观察页面 · ','Observed pages · ')+(pages.join(', ')||'—')}),
      h('p',{text:[...new Set(matches.flatMap(c=>c.implementations||[]))].join(', ')}),
      [...new Set(matches.map(c=>c.route))].map(route=>h('div',{class:'region-matrix'},h('table',{},h('caption',{text:route}),
        h('thead',{},h('tr',{},h('th',{scope:'col',text:t('状态','State')}),widths.map(w=>h('th',{scope:'col',text:w+'px'})))),
        h('tbody',{},states.map(s=>h('tr',{},h('th',{scope:'row',text:({default:t('默认','Default'),loading:t('加载','Loading'),error:t('报错','Error')})[s]||s}),
          widths.map(w=>{const c=matches.find(c=>c.route===route&&stateOf(c)===s&&c.viewportWidth===w);return h('td',{text:c?c.changedPixels+'/'+c.totalPixels+' px':t('待验证','Unverified')});}))))))),
      h('small',{text:t('未采集的状态和断点仍待验证。','Unobserved states and widths remain unverified.')}));
  }));
}

function draftTasks(projectId,source,refresh=()=>{}){
  const t=accessText,base='/projects/'+projectId+'/acceptance-tasks';
  openOverlay((panel,close)=>{
    const rows=h('div',{class:'stack-tight'}),status=h('p',{role:'status'});let offset=0;
    async function show(model=false){
      try{
        const data=await api(base+'/drafts',{method:'POST',body:{source:source.id,offset,model}});
        if(!panel.isConnected)return;
        fill(rows,data.drafts.map(d=>{
          const controls={};
          const form=h('form',{class:'assurance-form',onsubmit:async e=>{
            e.preventDefault();const btn=e.submitter;btn.disabled=true;
            try{const {createdTaskId}=await api(base,{method:'POST',body:{op:'create',...d,...Object.fromEntries(Object.entries(controls).map(([k,v])=>[k,v.value]))}});
              const saved=h('p',{role:'status',tabindex:'-1',text:t('任务已保存到工作流','Task saved to workflow')});
              form.replaceWith(saved,antButton(t('绑定此任务','Bind this task'),()=>{
                close(true);
                taskDesk(projectId,createdTaskId);
              }));
              saved.focus();
              await refresh();
            }catch(err){status.textContent=err.message;btn.disabled=false;}
          }});
          for(const [key,zh,en] of [['actor','谁','Who'],['condition','什么条件下','Conditions'],['action','做什么','Action'],['expected','应该看到什么','Expected result']]){
            controls[key]=h('textarea',{class:'input',required:true,rows:1,maxlength:key==='expected'?4000:1000,placeholder:t('需要确认','Needs clarification')});controls[key].value=d[key];
            form.append(reviewField(t(zh,en),controls[key]));
          }
          form.append(h('button',{class:'btn primary',type:'submit',text:t('保存任务','Save task')}));
          return h('details',{open:data.drafts.length===1},h('summary',{text:d.locator+' · '+(d.action||d.quote.slice(0,65))}),h('p',{text:d.expected?t('候选预期，需人工确认并绑定','Candidate expectation · needs review and binding'):t('未抽取预期，需人工绑定','Expectation not extracted · manual binding needed')}),h('blockquote',{text:d.quote}),form);
        }),h('div',{class:'quality-actions'},offset?antButton(t('上一组','Previous'),()=>{offset-=25;show();}):null,offset+25<data.total?antButton(t('下一组','Next'),()=>{offset+=25;show();}):null));
      }catch(e){status.textContent=e.message;}
    }
    append(panel,[h('h2',{text:t('从原文生成任务','Generate tasks from passages')}),h('p',{text:source.name}),
      antButton(t('发送本页摘录给所选模型识别','Extract fields with the selected model'),()=>show(true)),status,rows,antButton(t('关闭','Close'),()=>close(false))]);show();
  },{label:t('从原文生成任务','Generate tasks from passages')});
}

function quickTaskFeedback(projectId,target,roundId,suite,refresh=()=>{}){
  const t=accessText;
  openOverlay((panel,close)=>{
    const select=h('select',{class:'input'},[['issue','确实有问题','Confirmed issue'],['acceptable','可以接受','Acceptable'],['missed','漏掉了问题','Missed issue']].map(([value,zh,en])=>h('option',{value,text:t(zh,en)})));
    if(target==='round')select.value='missed';
    const observer=h('input',{class:'input',required:true,maxlength:80,value:sessionStorage.getItem('uxqa-feedback-alias')||'local'}),note=h('textarea',{class:'input'}),at=h('input',{class:'input',maxlength:200});
    const high=h('input',{type:'checkbox'}),error=h('p',{role:'alert'});
    append(panel,[h('h2',{text:t('体验反馈','Experience feedback')}),h('form',{class:'assurance-form',onsubmit:async e=>{
      e.preventDefault();e.submitter.disabled=true;
      try{await api('/projects/'+projectId+'/acceptance-tasks',{method:'POST',body:{op:'feedback',target,roundId,suite,observer:observer.value,note:note.value,choice:select.value,impact:high.checked,assistive:at.value}});sessionStorage.setItem('uxqa-feedback-alias',observer.value);close(true);await refresh();toast(t('反馈已保存','Feedback saved'));}
      catch(ex){error.textContent=ex.message;e.submitter.disabled=false;}
    }},reviewField(t('判断','Decision'),select),reviewField(t('观察者代号','Observer alias'),observer),reviewField(t('实际遇到了什么','What happened'),note),
      reviewField(t('实际使用的辅助技术与版本（如有）','Assistive technology and version used (optional)'),at),
      h('label',{},high,' ',t('任务受阻或影响严重，进入盲评队列','Blocked or high impact; queue for blind review')),error,h('button',{class:'btn primary',text:t('保存反馈','Save feedback')}),antButton(t('取消','Cancel'),()=>close(false)))]);
  },{label:t('体验反馈','Experience feedback')});
}

function storageDesk(projectId){
  const t=accessText,url='/projects/'+projectId+'/project-storage';
  openOverlay((panel,close)=>{
    const box=h('div',{class:'stack-tight'}),status=h('p',{role:'status'});
    const size=n=>n<1048576?Math.ceil(n/1024)+' KiB':(n/1048576).toFixed(1)+' MiB';
    async function load(){
      try{const d=await api(url);
        fill(box,h('p',{text:t('项目本地数据','Local project data')+' · '+size(d.total)}),
          [['screenshots',d.images,'检查截图','Check screenshots'],['traces',d.recordings,'失败录制','Failure traces']].map(([key,n,zh,en])=>{
            const row=h('div',{class:'quality-actions'},h('strong',{class:'grow',text:t(zh,en)+' · '+n+' · '+size(d[key])}));
            const button=antButton(t('清理','Clean'),()=>{
              fill(row,h('span',{text:t('删除这组媒体？检查历史、人工结论和对话将保留。','Delete these media files? History, ratings and conversations are retained.')}),
                antButton(t('确认清理','Confirm cleanup'),async e=>{e.currentTarget.disabled=true;try{const r=await api(url,{method:'POST',body:{clean:key}});status.textContent=t('已清理 ','Removed ')+r.removed;await load();}catch(ex){status.textContent=ex.message;load();}}),antButton(t('取消','Cancel'),load));
            },{disabled:!n});row.append(button);return row;
          }),h('p',{class:'muted',text:t('范围为 QA大师 管理的本项目数据；手工导出的文件由保存位置管理。','Covers QA Master–managed project data. Manually exported files remain at their chosen location.')}));
      }catch(e){status.textContent=e.message;}
    }
    append(panel,[h('h2',{text:t('项目存储','Project storage')}),box,status,antButton(t('关闭','Close'),()=>close(false))]);load();
  },{label:t('项目存储','Project storage')});
}

async function escalateFeedback(projectId,feedback,suite,refresh){
  const t=accessText,base='/projects/'+projectId+'/assurance/reviews';
  const load=()=>api(base+'?suite='+encodeURIComponent(suite.id)+'&round='+encodeURIComponent(feedback.roundId));
  try{
    const data=await load();
    if(feedback.caseId){
      const item=data.cases.find(c=>c.id===feedback.caseId);
      if(item)showReviewCase(base,item,suite,refresh);
      return;
    }
    openOverlay((panel,close)=>{
      const procedure=h('select',{class:'input'},suite.checks.map(([s],i)=>h('option',{value:i,text:s})));
      const group=h('select',{class:'input',required:true,disabled:!!data.partition},h('option',{value:'',text:t('选择项目用途','Choose project set')}),
        h('option',{value:'development',text:t('调规则','Development')}),h('option',{value:'holdout',text:t('独立盲测','Holdout')}));
      group.value=data.partition||'';
      const fields={},msg=h('p',{role:'alert'});
      const form=h('form',{class:'assurance-form',onsubmit:async e=>{
        e.preventDefault();const button=e.submitter;button.disabled=true;
        try{await api('/projects/'+projectId+'/acceptance-tasks',{method:'POST',body:{op:'escalate',target:feedback.target,roundId:feedback.roundId,procedure:Number(procedure.value),partition:group.value,...Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,v.value]))}});
          close(true);await refresh();toast(t('盲评案例已建立','Blind review case created'));
        }catch(err){msg.textContent=err.message;button.disabled=false;}
      }});
      append(form,[reviewField(t('规程','Procedure'),procedure),reviewField(t('项目分组','Project set'),group)]);
      for(const [k,zh,en] of [['goal','用户任务','User task'],['scope','角色、页面和条件','Role, page and conditions'],['expected','验收条件','Acceptance criterion'],['source','条件出处','Criterion reference'],['observation','中立观测（不含先前评分）','Neutral observation without ratings'],['location','观测位置','Observation location']]){
        fields[k]=h('textarea',{class:'input',required:true,rows:1});form.append(reviewField(t(zh,en),fields[k]));
      }
      append(form,[msg,h('button',{type:'submit',class:'btn primary',text:t('建立独立盲评','Create blind review')}),antButton(t('取消','Cancel'),()=>close(false))]);
      append(panel,[h('h2',{text:t('提交双人盲评','Submit for independent review')}),form]);
    },{label:t('提交双人盲评','Submit for independent review')});
  }catch(e){toast(e.message);}
}
