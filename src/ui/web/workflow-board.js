'use strict';

function renderWorkflowBoard(panel){
  const t=accessText,projectId=state.current,base='/projects/'+projectId+'/workflow-board';
  let board,selected,dragged,saving=false,timer,resize,x=0,refreshedRound='';
  panel.classList.add('flow-board');
  const content=h('div',{class:'flow-body'}),error=h('p',{class:'notice error',role:'alert',hidden:true});
  fill(panel,content,error);
  const button=(text,click,props={})=>antButton(text,click,props);
  const modeText=mode=>mode==='auto'?t('自动推进','Automatic'):t('逐步推进','Step by step');
  const scopeText=scope=>{const item=board.catalog.find(s=>s.id===scope);return item?t(item.zh,item.en):t('项目综合检查','Project check');};
  const typeText=s=>s.kind==='repair'?t('修复','Repair'):t('测试','Test');
  const title=s=>s.name || (s.kind==='repair'?(s.scope==='full'?t('项目修复','Project repair'):scopeText(s.scope)+' · '+typeText(s)):scopeText(s.scope));
  const automatic=s=>s.kind==='test' && !['usability','fidelity','logic'].includes(s.scope);
  const outcome=r=>({observed:t('已取得实测结果','Measurement recorded'),findings:t('发现问题，需查看','Review findings'),
    limited:t('覆盖不完整','Partial coverage'),manual:t('已记录人工结论','Human result recorded')})[r.outcome];
  const active=()=>board?.runs.at(-1)?.status==='active'?board.runs.at(-1):null;
  function failure(e){if(panel.isConnected){error.hidden=false;error.textContent=e.message;}}
  async function load(){
    try{
      const data=await api(base);if(!panel.isConnected || saving)return;
      if(board?.revision===data.revision && board.busy===data.busy){
        if(data.busy)timer=setTimeout(()=>{if(panel.isConnected)load();},650);
        return;
      }
      const was=active(),follow=!selected || selected===was?.steps[was.index]?.id;
      board=data;if(follow && active())selected=active().steps[active().index].id;
      draw(false,follow);
      const recent=board.runs.at(-1)?.steps.filter(s=>s.result?.roundId).at(-1)?.result.roundId;
      if(recent && recent!==refreshedRound && panel.isConnected){
        refreshedRound=recent;await loadProjects();
        if(panel.isConnected && state.current===projectId)await roundFor(recent);
      }
    }
    catch(e){failure(e);}
  }
  async function change(action,input={},focus){
    if(saving)return;saving=true;error.hidden=true;clearTimeout(timer);
    const run=active(),step=run?.steps[run.index];
    try{
      const data=await api(base,{method:'POST',body:{action,revision:board.revision,runId:run?.id,stepId:step?.id,...input}});
      if(!panel.isConnected)return;
      board=data;selected=focus || active()?.steps[active().index]?.id || selected;
      draw(!!focus || action==='next' || action==='start');
    }catch(e){if(e.status===409 && panel.isConnected){board=await api(base);draw();}failure(e);}
    finally{saving=false;}
  }
  function move(id,index){
    const steps=board.steps.slice(),from=steps.findIndex(s=>s.id===id);
    if(active() || from<0 || index<0 || index>=steps.length || from===index)return;
    steps.splice(index,0,steps.splice(from,1)[0]);return change('save',{steps},id);
  }
  async function editor(existing,after){
    // Saving an acceptance task changes the scope catalog independently of the board revision.
    try{
      const latest=await api(base);
      if(!panel.isConnected)return;
      board.catalog=latest.catalog;
    }catch(e){failure(e);return;}
    openOverlay((p,close)=>{
      const kind=h('select',{class:'input'},h('option',{value:'test',text:t('测试','Test')}),h('option',{value:'repair',text:t('修复','Repair')}));
      const scope=h('select',{class:'input'},h('option',{value:'full',text:t('整个项目','Whole project')}),board.catalog.map(s=>h('option',{value:s.id,text:t(s.zh,s.en)})));
      const name=h('input',{class:'input',maxlength:100,value:existing?.name || '',placeholder:t('例如 A、配置传播、修复表单','For example: A, configuration, or repair form')});
      kind.value=existing?.kind || 'test';scope.value=existing?.scope || 'full';
      const field=(label,el)=>h('label',{class:'workflow-field'},label,el);
      const position=existing?board.steps.findIndex(s=>s.id===existing.id):after?board.steps.findIndex(s=>s.id===after)+1:board.steps.length;
      const prior=board.steps.slice(0,position).filter(s=>s.kind==='test');
      const source=h('select',{class:'input'},h('option',{value:'',text:t('最近的同范围测试，没有则使用项目上下文','Latest matching test, otherwise project context')}),
        prior.map(s=>h('option',{value:s.id,text:(board.steps.indexOf(s)+1)+' · '+title(s)})));
      source.value=prior.some(s=>s.id===existing?.from)?existing.from:'';
      const inputField=field(t('修复依据','Repair input'),source);
      const route=h('input',{class:'input',maxlength:2000,value:existing?.route || '',placeholder:project().pages?.routes?.[0] || '/'});
      const routeField=field(t('预览路径（可选）','Preview route (optional)'),route);
      function fields(){
        inputField.hidden=kind.value!=='repair';
        routeField.hidden=kind.value!=='test' || !['accessibility','interaction','compatibility','performance'].includes(scope.value);
      }
      kind.onchange=scope.onchange=fields;fields();
      const submit=h('button',{type:'submit',class:'btn primary',text:t('保存步骤','Save step')});
      append(p,[h('h2',{text:existing?t('编辑步骤','Edit step'):t('添加步骤','Add step')}),
        h('form',{class:'assurance-form',onsubmit:e=>{
          e.preventDefault();const s={id:existing?.id || crypto.randomUUID(),kind:kind.value,scope:scope.value,name:name.value.trim(),
            ...(kind.value==='repair' && source.value?{from:source.value}:{}),...(!routeField.hidden && route.value.trim()?{route:route.value.trim()}:{})};
          const steps=board.steps.slice();
          if(existing)steps[steps.findIndex(i=>i.id===s.id)]=s;
          else steps.splice(after?steps.findIndex(i=>i.id===after)+1:steps.length,0,s);
          close(true);change('save',{steps},s.id);
        }},field(t('步骤类型','Step type'),kind),field(t('检测或修复范围','Check or repair scope'),scope),inputField,routeField,
        field(t('步骤名称（可选）','Step name (optional)'),name),h('div',{class:'quality-actions'},submit,button(t('取消','Cancel'),()=>close(false))))]);
    },{label:t('工作流步骤','Workflow step')});
  }
  async function roundFor(id){
    const {rounds}=await api('/projects/'+projectId+'/rounds');
    if(state.current!==projectId)return false;
    state.rounds=rounds;
    const target=id || rounds[0]?.id;
    if(target && state.round?.id!==target)await openRound(target,false);
    return state.current===projectId;
  }
  async function openTool(run,s){
    try{
      const prior=run.steps.slice(0,run.index).filter(i=>i.result);
      const source=s.from?prior.find(i=>i.id===s.from):prior.filter(i=>i.kind==='test' && (s.scope==='full' || i.scope===s.scope || i.scope==='full'||(s.scope==='logic'&&i.scope.startsWith('task-')))).at(-1);
      const taskScope=s.scope.startsWith('task-')?s.scope:s.kind==='repair'?source?.scope:null;
      if(taskScope?.startsWith('task-')){taskDesk(projectId,taskScope.slice(5),null,null,null,source?.scope===taskScope?source.result?.ref:null);return;}
      if(!await roundFor(source?.result.roundId))return;
      if(s.kind==='repair'){
        const lines=[t('当前工作流修复步骤','Workflow repair step')+' · '+title(s),t('范围','Scope')+' · '+scopeText(s.scope)];
        if(source)lines.push(t('依据步骤','Source step')+' · '+title(source),t(source.result.zh,source.result.en),t('证据','Evidence')+' · '+source.result.ref);
        else lines.push(t('此前没有匹配的测试结果，请基于当前项目确认问题。','No matching preceding test. Confirm the issue in this project.'));
        lines.push(t('请在这个项目范围内处理，并说明需要如何复检。','Work within this project and describe how to verify the change.'));
        const prompt=lines.join('\n'),draft=state.agentDrafts[projectId] || '';
        if(!draft.includes(prompt))state.agentDrafts[projectId]=[draft,prompt].filter(Boolean).join('\n\n');
        delete state.agentFindings[projectId];openProjectAgent();
      }else{
        state.assuranceSuite=s.scope;switchWorkflowTab('checks');
        document.querySelector('.assurance-panel')?.scrollIntoView({block:'start'});
      }
    }catch(e){failure(e);}
  }
  function manualRecord(){
    openOverlay((p,close)=>{
      const note=h('textarea',{class:'input',required:true,rows:3,maxlength:2000}),ref=h('input',{class:'input',required:true,maxlength:500});
      append(p,[h('h2',{text:t('记录人工结果','Record a human result')}),h('form',{class:'assurance-form',onsubmit:e=>{
        e.preventDefault();if(!note.value.trim()||!ref.value.trim())return;close(true);change('record',{note:note.value,ref:ref.value});
      }},h('label',{class:'workflow-field'},t('实际操作与结果','Observed action and outcome'),note),
      h('label',{class:'workflow-field'},t('证据位置或记录编号','Evidence location or record ID'),ref),
      h('button',{type:'submit',class:'btn primary',text:t('保存记录','Save record')}))]);
    },{label:t('记录人工结果','Record a human result')});
  }
  function evidenceActions(run,s){
    const box=h('div',{class:'flow-evidence'}),items=h('div',{class:'quality-actions'});
    api(base+'/evidence').then(({items:records})=>{
      if(!items.isConnected)return;
      fill(items,records.map(r=>button(t('采用记录 · ','Use record · ')+t(r.zh,r.en),()=>change('adopt',{ref:r.ref}))));
    }).catch(failure);
    append(box,[h('p',{class:'muted',text:s.kind==='repair'?t('打开项目专属对话，发送前可修改任务。返回工作流后，选择实际改动或记录处理结果。','Open this project’s chat and review the draft. Return to select a recorded edit or document the outcome.'):
      t('在专项检查中取得本步的新证据，再返回选择记录。也可以填写有出处的人工观察。','Collect fresh evidence for this step, then return to select it, or record a sourced observation.')}),
      h('div',{class:'quality-actions'},button(s.kind==='repair'?t('打开项目修复对话','Open project repair chat'):t('打开专项检查','Open specialist check'),()=>openTool(run,s),{type:'primary'}),
        button(t('记录人工结果','Record a human result'),manualRecord)),items]);
    return box;
  }
  function draw(reveal=false,followCurrent=false){
    clearTimeout(timer);
    resize?.disconnect();
    const old=content.querySelector('.flow-track');if(old)x=old.scrollLeft;
    const run=active(),steps=run?run.steps:board.steps,last=board.runs.at(-1),current=run?.steps[run.index];
    if(!steps.some(s=>s.id===selected))selected=current?.id || steps[0]?.id;
    const chosen=steps.find(s=>s.id===selected),index=steps.indexOf(chosen);
    const heading=h('header',{class:'flow-heading'},h('div',{},h('h2',{text:t('工作流','Workflow')}),h('p',{class:'muted',text:t('从左到右安排测试与修复，同一能力可以重复使用。','Arrange checks and repairs from left to right. A capability can be used more than once.')})));
    const modes=h('div',{class:'flow-modes',role:'group','aria-label':t('运行模式','Run mode')},['manual','auto'].map(value=>
      h('button',{type:'button','aria-pressed':String(board.mode===value),onclick:()=>change('mode',{mode:value}),text:modeText(value)})));
    const actions=h('div',{class:'flow-toolbar'},modes,h('div',{class:'quality-actions'},run?
      button(t('结束本次运行','End run'),()=>change('stop'),{disabled:board.busy}):[button(t('添加步骤','Add step'),()=>editor()),button(t('开始运行','Start run'),()=>change('start'),{type:'primary',disabled:!steps.length})]));
    const track=h('ol',{class:'flow-track','aria-label':t('步骤顺序','Step sequence')});
    steps.forEach((s,i)=>{
      const isCurrent=current?.id===s.id;
      const status=s.result?outcome(s.result):isCurrent?(board.busy?t('运行中','Running'):t('当前步骤','Current step')):run?t('等待前置步骤','Queued'):scopeText(s.scope);
      const choose=()=>{selected=s.id;draw(true);};
      const card=h('li',{class:'flow-card'+(s.kind==='repair'?' repair':'')+(selected===s.id?' selected':'')+(isCurrent?' current':''),
        draggable:run?'false':'true',ondragstart:e=>{dragged=s.id;e.dataTransfer.setData('text/plain',s.id);e.dataTransfer.effectAllowed='move';},
        ondragend:()=>{dragged=null;},ondragover:e=>{if(dragged && !run)e.preventDefault();},ondrop:e=>{e.preventDefault();if(dragged)move(dragged,i);dragged=null;}},
        h('button',{type:'button',class:'flow-select','data-step':s.id,'aria-pressed':String(selected===s.id),onclick:choose,
          onfocus:e=>e.currentTarget.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})},
          h('span',{class:'flow-card-top'},h('span',{text:typeText(s)}),h('span',{text:String(i+1).padStart(2,'0')})),
          h('strong',{text:title(s)}),h('small',{text:status})));
      track.append(card);
    });
    const area=h('div',{class:'flow-canvas'},steps.length?track:h('div',{class:'flow-empty'},h('h3',{text:t('从第一步开始','Choose the first step')}),
      button(t('添加第一步','Add first step'),()=>editor(),{type:'primary'})));
    const detail=h('section',{class:'flow-detail'});
    if(chosen){
      const s=chosen;
      const dependency=s.from?steps.findIndex(i=>i.id===s.from):-1;
      append(detail,[h('h3',{text:title(s)}),h('p',{class:'muted',text:typeText(s)+' · '+(s.scope==='full' && s.kind==='repair'?t('整个项目','Whole project'):scopeText(s.scope))}),
        s.route?h('small',{text:s.route}):null,
        s.from?h('small',{text:dependency>=0 && dependency<index?t('依据第 ','Uses step ')+(dependency+1)+' · '+title(steps[dependency]):t('请编辑本步，重新选择前置测试','Edit this step to select an earlier source test')}):null]);
      if(!run)detail.append(h('div',{class:'quality-actions'},button(t('编辑','Edit'),()=>editor(s)),
        button(t('前移','Move earlier'),()=>move(s.id,index-1),{disabled:index===0}),button(t('后移','Move later'),()=>move(s.id,index+1),{disabled:index===steps.length-1}),
        button(t('在后面插入','Insert after'),()=>editor(null,s.id)),button(t('复制步骤','Duplicate step'),()=>{
          const copied={...s,id:crypto.randomUUID()},list=steps.slice();list.splice(index+1,0,copied);change('save',{steps:list},copied.id);
        }),button(t('移除步骤','Remove step'),()=>change('save',{steps:steps.filter(i=>i.id!==s.id)},steps[index+1]?.id || steps[index-1]?.id))));
      else if(s.result){
        detail.append(h('p',{class:'flow-result',text:outcome(s.result)+' · '+t(s.result.zh,s.result.en)}),h('small',{class:'muted',text:s.result.ref}));
        if(s.id===current?.id)detail.append(button(run.index===steps.length-1?t('完成本次运行','Finish run'):t('继续到下一步','Continue to next step'),()=>change('next'),{type:'primary',disabled:board.busy}));
      }else if(s.id!==current?.id)detail.append(button(t('回到当前步骤','Go to current step'),()=>{selected=current.id;draw(true);}));
      else if(automatic(s)){
        if(s.hold){
          detail.append(h('p',{class:'notice warn',text:s.hold}));
          if(s.scope.startsWith('task-'))detail.append(button(t('打开此验收任务','Open this acceptance task'),()=>taskDesk(projectId,s.scope.slice(5))));
        }
        const pageStep=!['full','components'].includes(s.scope);
        if(pageStep && !project().pages)detail.append(button(t('设置项目预览','Configure project preview'),()=>switchWorkflowTab('settings')));
        detail.append(button(board.busy?t('检测进行中','Check in progress'):s.hold?t('重试本步','Retry this step'):t('执行本步','Run this step'),()=>change('execute'),{type:'primary',disabled:board.busy}));
      }else detail.append(evidenceActions(run,s));
    }
    const history=h('details',{class:'flow-history'},h('summary',{text:t('运行记录','Run history')+' · '+board.runs.filter(r=>r.status!=='active').length}),
      board.runs.filter(r=>r.status!=='active').slice().reverse().map(r=>h('details',{},h('summary',{text:timeText(r.at)+' · '+modeText(r.mode)+' · '+(r.status==='done'?t('已完成','Completed'):t('已结束','Stopped'))}),
        h('ol',{},r.steps.map(s=>h('li',{text:title(s)+' · '+(s.result?outcome(s.result)+' · '+t(s.result.zh,s.result.en):t('无结果','No result'))}))))));
    fill(content,heading,actions,h('p',{class:'flow-mode-note',text:board.mode==='auto'?t('连续执行可自动运行的测试。发现问题、证据不足或进入修复时会暂停。','Runs eligible checks in sequence. Findings, evidence gaps and repairs pause the run.'):
      t('每列由你启动，查看结果后再继续。','Start each step and review its outcome before continuing.')}),area,chosen?detail:null,
      !run && last?h('p',{class:'muted',role:'status',text:last.status==='done'?t('上次运行已完成','Last run completed'):t('上次运行已结束','Last run stopped')}):null,
      board.runs.some(r=>r.status!=='active')?history:null);
    track.scrollLeft=x;
    const target=track.querySelector('[data-step="'+selected+'"]');
    const bringIntoView=()=>{
      if(!target || !track.isConnected)return;
      const card=target.getBoundingClientRect(),lane=track.getBoundingClientRect();
      if(card.right>lane.right-12)track.scrollLeft+=card.right-lane.right+12;
      else if(card.left<lane.left+12)track.scrollLeft+=card.left-lane.left-12;
    };
    if(reveal)target?.focus({preventScroll:true});
    if(reveal || followCurrent)bringIntoView();
    if(current && target){
      resize=new ResizeObserver(()=>{if(!track.isConnected){resize.disconnect();return;}bringIntoView();});
      resize.observe(track);
    }
    if(board.busy)timer=setTimeout(()=>{if(panel.isConnected)load();},650);
  }
  load();
}
