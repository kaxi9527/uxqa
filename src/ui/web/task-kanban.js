'use strict';

function kanbanStages(){
  const t=accessText;
  return {
    untested:[t('未测试','Untested'),t('新建、导入或需求发生变化','New, imported or changed requirement'),t('核对验收预期、页面和环境。缺资料时记录缺项。','Check the expected outcome, page and environment. Record any missing input.'),t('条件齐备 → 测试中','Ready → Testing')],
    testing:[t('测试中','Testing'),t('测试人员或执行器已开始检查','A reviewer or runner started the check'),t('按条件执行并记录实际结果。预览打不开或证据不足时留在本列。','Run the check and record what happened. Stay here if the preview or evidence is unavailable.'),t('通过 → 已完成；失败 → 未修复','Pass → Completed · Fail → Needs repair')],
    unfixed:[t('未修复','Needs repair'),t('初测失败、复查失败或已证实回归','Failed test, failed retest or reproduced regression'),t('查看失败证据与上次改动，按优先级开始处理。','Review the failure and previous changes, then pick up the repair by priority.'),t('开始处理 → 修复中','Start repair → Repairing')],
    repairing:[t('修复中','Repairing'),t('已开始处理确认的问题','Work started on a confirmed issue'),t('手动处理或打开项目修复对话。提交时记录改动与文件位置。','Repair manually or in the project chat. Record the change and file location.'),t('提交改动 → 未复查；修复失败 → 未修复','Submit change → Awaiting retest · Unsuccessful → Needs repair')],
    unreviewed:[t('未复查','Awaiting retest'),t('已提交改动及其证据','Change and evidence submitted'),t('按原失败条件重跑并核对必要对照。环境不一致时补证据。','Replay the original failing conditions and controls. Resolve mismatched environments before deciding.'),t('通过 → 已完成；不通过 → 未修复','Pass → Completed · Fail → Needs repair')],
    done:[t('已完成','Completed'),t('初测通过或复查通过','Passed initial test or retest'),t('查看验收记录。发现回归时在原卡补充复现证据。','Review the acceptance record. Reopen the same card with evidence if the issue returns.'),t('需求变化 → 未测试；确认回归 → 未修复','Requirement changed → Untested · Regression → Needs repair')]
  };
}
function kanbanMoveLabel(from,to){
  const t=accessText;
  if(from===to)return t('记录阻塞或缺证据','Record a blocker or evidence gap');
  if(to==='done')return from==='testing'?t('初测通过','Pass initial test'):t('复查通过','Pass retest');
  if(to==='unfixed')return ({testing:t('初测失败','Fail initial test'),repairing:t('修复未成功','Repair unsuccessful'),unreviewed:t('复查不通过','Fail retest'),done:t('确认回归','Reopen regression')})[from];
  return ({testing:t('开始测试','Start testing'),repairing:t('开始修复','Start repair'),unreviewed:t('提交复查','Submit for retest'),untested:t('需求变化，重新测试','Retest changed requirement')})[to];
}
function kanbanPriorityReason(reason){
  const t=accessText;
  return ({critical:t('已确认关键任务无替代路径或有不可逆影响','Evidence confirms a critical blocker or irreversible impact'),
    major:t('关键任务明显受损，已记录实际影响','A major task impact was recorded'),feedback:t('该任务有高影响的人工反馈','A reviewer reported high impact'),
    friction:t('已复现可完成任务中的困难','Friction reproduced in an achievable task'),minor:t('已确认属于局部改善','Evidence identifies a local improvement'),
    failed:t('已有失败实测，具体影响仍待核定','A test failed. The scope of impact is still unconfirmed.'),
    unknown:t('暂排 P2，等待影响证据','Provisional P2 pending evidence of impact')})[reason];
}
function kanbanField(label,control){return h('label',{class:'workflow-field'},label,control);}
const kbPriorityValues=['P0','P1','P2','P3'];
function kanbanPrioritySelect(first){
  return h('select',{class:'input'},h('option',{value:'',text:first}),kbPriorityValues.map(p=>h('option',{value:p,text:p})));
}
async function newKanbanTask(projectId,finding,roundId){
  const t=accessText;
  if(finding){
    try{
      const endpoint='/projects/'+projectId+'/acceptance-tasks',board=await api(endpoint+'/board');
      const existing=board.tasks.find(task=>task.originKey?.slice(task.originKey.indexOf('/')+1)===finding.fingerprint);
      if(existing){
        await api(endpoint,{method:'POST',body:{op:'board-create',title:existing.title,expected:existing.expected,locator:existing.locator,fingerprint:finding.fingerprint,roundId}});
        toast(t('本轮发现已关联原任务','This round is linked to the existing task'));return true;
      }
    }catch(error){toast(error.message);return false;}
  }
  return openOverlay((panel,close)=>{
    const title=h('input',{class:'input',required:true,maxlength:160,value:finding?.name||''});
    const expected=h('textarea',{class:'input',required:true,rows:2,maxlength:4000});
    const locator=h('input',{class:'input',required:true,maxlength:500,value:finding?[finding.file,finding.line].filter(Boolean).join(':'):''});
    const actor=h('input',{class:'input',maxlength:1000}),condition=h('textarea',{class:'input',rows:2,maxlength:1000});
    const priority=kanbanPrioritySelect(t('采用项目默认方式','Use the project default'));
    const err=h('p',{role:'alert',class:'notice error',hidden:true}),submit=h('button',{class:'btn primary',type:'submit',text:t('创建任务','Create task')});
    append(panel,[h('h2',{text:t('新建看板任务','New board task')}),h('form',{class:'assurance-form',onsubmit:async e=>{
      e.preventDefault();submit.disabled=true;
      try{await api('/projects/'+projectId+'/acceptance-tasks',{method:'POST',body:{op:'board-create',title:title.value,expected:expected.value,locator:locator.value,
        actor:actor.value,condition:condition.value,priority:priority.value,...(finding?{fingerprint:finding.fingerprint,roundId}:{})}});close(true);}
      catch(error){submit.disabled=false;err.hidden=false;err.textContent=error.message;}
    }},kanbanField(t('任务名称','Task name'),title),kanbanField(t('验收预期','Expected outcome'),expected),
      kanbanField(t('页面或依据位置','Page or source location'),locator),kanbanField(t('优先级','Priority'),priority),
      h('details',{},h('summary',{text:t('角色与测试条件（可选）','Role and test conditions (optional)')}),
        kanbanField(t('目标用户或角色','Target user or role'),actor),kanbanField(t('测试环境与前置条件','Test environment and preconditions'),condition)),err,
      h('div',{class:'quality-actions'},submit,antButton(t('取消','Cancel'),()=>close(false))))]);
  },{label:t('新建看板任务','New board task')});
}

function renderTaskKanban(panel){
  const t=accessText,stages=kanbanStages(),id=state.current,endpoint='/projects/'+id+'/acceptance-tasks';
  let board,signature='',dragged,timer,sequence=0;
  panel.classList.add('kb');
  const header=h('div',{class:'kb-head'}),lanes=h('div',{class:'kb-lanes',role:'region',tabindex:0,'aria-label':t('任务状态列','Task status lanes')});
  const notice=h('p',{role:'status',class:'kb-status'}),gapText=t('待补条件','Blocked');
  const loadNotice=h('p',{role:'status',class:'kb-status',text:t('正在加载看板…','Loading board…')});
  fill(panel,header,lanes,loadNotice,notice);
  async function load(){
    clearTimeout(timer);const ticket=++sequence;
    try{
      const data=await api(endpoint+'/board');if(ticket!==sequence||!panel.isConnected)return;
      loadNotice.textContent='';
      const sig=JSON.stringify(data);if(signature!==sig){signature=sig;board=data;draw();}
    }catch(err){if(ticket===sequence && panel.isConnected)loadNotice.textContent=err.message;}
    finally{if(panel.isConnected && ticket===sequence)timer=setTimeout(()=>{if(panel.isConnected)load();},board?.busy?900:4500);}
  }
  async function post(input){await api(endpoint,{method:'POST',body:input});await load();}
  function focusCard(taskId){
    const b=[...lanes.querySelectorAll('button[data-task]')].find(el=>el.dataset.task===taskId);
    b?.focus({preventScroll:true});b?.scrollIntoView({inline:'nearest',block:'nearest'});
  }
  function guide(){
    openOverlay((p,close)=>{
      append(p,[h('h2',{text:t('各阶段如何处理','Stage guidance')}),...Object.values(stages).map(([name,up,action,down])=>
        h('section',{class:'kb-guide'},h('h3',{text:name}),h('small',{text:up}),h('p',{text:action}),h('strong',{text:down}))),
        antButton(t('关闭','Close'),()=>close(false))]);
    },{label:t('各阶段如何处理','Stage guidance')});
  }
  function settings(){
    openOverlay((p,close)=>{
      const select=h('select',{class:'input'},h('option',{value:'auto',text:t('系统安排','System assigned')}),h('option',{value:'manual',text:t('用户设置','Manually assigned')}));
      select.value=board.defaultPriority;
      const err=h('p',{role:'alert'});
      append(p,[h('h2',{text:t('项目排期','Project scheduling')}),kanbanField(t('新任务的默认优先级方式','Priority mode for new tasks'),select),
        h('p',{class:'muted',text:t('系统根据影响证据建议 P0–P3。人工模式的新任务进入待分级；每张卡都可单独修改。','The system uses impact evidence to suggest P0–P3. New manual tasks await triage. You can override any card.')}),
        err,h('div',{class:'quality-actions'},antButton(t('保存','Save'),async e=>{const b=e.currentTarget;b.disabled=true;try{await post({op:'priority-default',mode:select.value});close(true);}catch(ex){b.disabled=false;err.textContent=ex.message;}},{type:'primary'}),
          antButton(t('取消','Cancel'),()=>close(false)))]);
    },{label:t('项目排期','Project scheduling')});
  }
  function move(task,to,resume=false){
    if(task.gap && to!==task.stage){notice.textContent=t('请先补充条件，再推进任务。','Resolve the blocker before moving this task.');return;}
    if(!board.moves[task.stage].includes(to) && !(task.gap && resume && to===task.stage)){notice.textContent=t('请按阶段顺序操作。','Follow the available transitions.');return;}
    const title=resume?t('条件已补齐','Unblock task'):kanbanMoveLabel(task.stage,to);
    const handoff=task.stage==='untested'&&to==='testing' || task.stage==='unfixed'&&to==='repairing';
    if(handoff){
      return post({op:'move',id:task.id,stamp:task.stamp,to}).then(()=>focusCard(task.id)).catch(e=>{notice.textContent=e.message;load();});
    }
    return openOverlay((p,close)=>{
      const note=h('textarea',{class:'input',rows:3,required:true,maxlength:2000});
      const ref=h('input',{class:'input',required:true,maxlength:500});
      const impact=h('select',{class:'input'},[['',t('沿用原影响判断','Keep current assessment')],['critical',t('关键任务完全受阻且无替代，或有不可逆影响','Critical task blocked without an alternative, or irreversible impact')],
        ['major',t('重要任务明显受损','Major task impact')],['friction',t('有困难，仍可完成','Friction, task achievable')],['minor',t('局部改善','Local improvement')]].map(([value,text])=>h('option',{value,text})));
      const err=h('p',{role:'alert',class:'kb-status'}),save=h('button',{class:'btn primary',type:'submit',text:title});
      append(p,[h('h2',{text:title}),h('p',{class:'muted',text:task.title+' · '+stages[task.stage][0]+' → '+stages[to][0]}),
        h('form',{class:'assurance-form',onsubmit:async e=>{
          e.preventDefault();save.disabled=true;
          try{await post({op:'move',id:task.id,stamp:task.stamp,to,note:note.value,ref:ref.value,resume,impact:to==='unfixed'?impact.value:undefined});close(true);focusCard(task.id);}
          catch(ex){save.disabled=false;err.textContent=ex.message;await load();}
        }},kanbanField(to==='unreviewed'&&task.stage==='repairing'?t('改了什么','What changed'):t('实际结果或原因','Outcome or reason'),note),
        kanbanField(t('证据位置或记录编号','Evidence location or record ID'),ref),to==='unfixed'?kanbanField(t('已核实的影响','Verified impact'),impact):null,err,
        h('div',{class:'quality-actions'},save,antButton(t('取消','Cancel'),()=>close(false))))]);
    },{label:title});
  }
  function detail(initial){
    openOverlay((p,close)=>{
      const err=h('p',{role:'alert',class:'kb-status'});
      function drawDetail(task){
        const [stage,,action,down]=stages[task.stage],latest=task.events.at(-1);
        const priority=kanbanPrioritySelect(t('恢复系统安排','Use system priority'));
        const priorityNote=h('input',{class:'input',maxlength:1000});
        priority.value=task.mode==='manual' && task.priority?task.priority:'';
        const next=board.moves[task.stage].filter(to=>to!==task.stage);
        const real=task.ready && (['untested','testing','unfixed'].includes(task.stage) || task.stage==='unreviewed'&&task.canReplay);
        async function withResult(button,op){
          button.disabled=true;err.textContent='';
          try{
            await post(op);const current=board.tasks.find(i=>i.id===task.id);
            if(p.isConnected && current){
              drawDetail(current);
              p.querySelector(op.op==='priority' ? '[data-priority-summary]' : 'button:not(:disabled)')?.focus();
            }
          }
          catch(e){button.disabled=false;err.textContent=e.message;await load();}
        }
        fill(p,h('div',{class:'kb-detail-id'},'QA-'+task.id.slice(0,6).toUpperCase()+' · '+stage),
          h('h2',{text:task.title}),h('section',{class:'kb-detail-section'},h('strong',{text:t('验收预期','Expected outcome')}),h('p',{text:task.expected}),
            h('small',{text:task.locator}),task.actor?h('small',{text:task.actor}):null,task.condition?h('small',{text:task.condition}):null,
            task.findingRounds?.length?h('details',{},h('summary',{text:t('关联检查轮次','Linked check rounds')+' · '+task.findingRounds.length}),
              task.findingRounds.map(round=>antButton(round,async()=>{close(false);try{await openRound(round,false);if(state.current===id){switchWorkflowTab('issues');showFinding(task.originKey.slice(task.originKey.indexOf('/')+1));}}catch(e){toast(e.message);}}))):null),
          h('div',{class:'kb-advice'},h('strong',{text:stage}),h('p',{text:action}),h('small',{text:down})),
          latest?.note?h('p',{class:'kb-last',text:(task.gap?gapText:t('最近结果','Latest result'))+' · '+latest.note}):null,
          h('div',{class:'quality-actions'},...next.map((to,i)=>antButton(kanbanMoveLabel(task.stage,to),()=>{close(false);move(task,to);},{type:i===0?'primary':'default',disabled:board.busy||task.gap})),
            task.gap||board.moves[task.stage].includes(task.stage)?antButton(task.gap?t('补充条件','Unblock task'):t('记录阻塞','Record blocker'),()=>{close(false);move(task,task.stage,task.gap);}):null),
          h('div',{class:'quality-actions'},real?antButton(task.stage==='unreviewed'?t('运行原场景复查','Replay for verification'):task.stage==='unfixed'?t('重现原问题','Reproduce issue'):t('运行已绑定测试','Run bound scenario'),e=>withResult(e.currentTarget,{op:task.stage==='unreviewed'?'verify':'run',id:task.id}),{disabled:board.busy}):null,
            task.stage==='repairing' && task.ready && task.latest==='fail'?antButton(t('让 Agent 修改并复查','Repair with agent and retest'),e=>withResult(e.currentTarget,{op:'repair',id:task.id}),{disabled:board.busy,title:t('使用配置的模型处理当前项目文件，并重跑绑定场景','Use the configured model on project files and replay the bound scenario')}):null,
            task.stage==='repairing'?antButton(t('打开修复对话','Open repair chat'),async()=>{
              try{
                const fail=await api(endpoint+'/repair-context/'+task.id);if(state.current!==id || !p.isConnected)return;
                if(fail.roundId && state.round?.id!==fail.roundId)await openRound(fail.roundId,false);
                if(state.current!==id || !p.isConnected)return;
                const prompt=[t('修复任务 · ','Repair task · ')+task.title,task.expected,task.locator,fail.observed,fail.ref,
                  fail.change?t('上次改动 · ','Previous change · ')+fail.change:''].filter(Boolean).join('\n');
                const previous=state.agentDrafts[id]||'';if(!previous.includes(prompt))state.agentDrafts[id]=[previous,prompt].filter(Boolean).join('\n\n');
                close(false);delete state.agentFindings[id];openProjectAgent();
              }catch(ex){err.textContent=ex.message;}
            }):null,antButton(t('验收依据与场景','Evidence and scenarios'),()=>{close(false);taskDesk(id,task.id);})),
          h('details',{class:'kb-guide'},h('summary',{'data-priority-summary':'',text:t('优先级 · ','Priority · ')+(task.priority||t('待定','Unassigned'))+' · '+(task.mode==='manual'?t('人工','Manual'):t('系统','System'))}),
            h('p',{text:t('系统建议 · ','System suggestion · ')+task.suggested.level+' · '+kanbanPriorityReason(task.suggested.reason)}),
            kanbanField(t('调整优先级','Change priority'),priority),kanbanField(t('调整理由（可选）','Reason for change (optional)'),priorityNote),
            antButton(t('应用优先级','Apply priority'),e=>withResult(e.currentTarget,{op:'priority',id:task.id,stamp:task.stamp,mode:priority.value?'manual':'auto',priority:priority.value,note:priorityNote.value})),
            task.priorityChanges.slice().reverse().map(v=>h('small',{text:[timeText(v.at),(v.from||'—')+' → '+v.to,v.mode==='manual'?t('人工','Manual'):t('系统','System'),v.reason?kanbanPriorityReason(v.reason):v.note].filter(Boolean).join(' · ')}))),
          h('details',{class:'kb-guide'},h('summary',{text:t('流转记录','Transition history')+' · '+task.events.length}),
            task.events.length?task.events.slice().reverse().map(v=>h('p',{},h('strong',{text:stages[v.from][0]+' → '+stages[v.to][0]}),
              h('small',{text:timeText(v.at)+' · '+(v.by==='system'?t('系统','System'):t('人工','Manual'))}),h('span',{text:[v.note,v.ref].filter(Boolean).join(' · ')}))):
            h('p',{class:'muted',text:task.latest?t('历史实测 · ','Historical observation · ')+task.latest:t('尚无流转记录','No transitions yet')})),
          err,antButton(t('关闭','Close'),()=>close(false)));
      }
      drawDetail(initial);
    },{label:initial.title});
  }
  function draw(){
    const selected=document.activeElement?.dataset?.task,scroll=lanes.scrollLeft;
    const offsets=new Map([...lanes.querySelectorAll('.kb-stack')].map(el=>[el.dataset.stage,el.scrollTop]));
    const next=board.tasks.find(task=>task.id===board.next);
    fill(header,h('div',{},h('h2',{text:t('任务看板','Task board')}),h('span',{class:'muted',text:t('项目任务','Project tasks')+' · '+board.tasks.length})),
      h('div',{class:'quality-actions'},antButton(t('阶段说明','Stage guide'),guide),antButton(t('项目排期','Scheduling'),settings),
        antButton(t('处理下一项','Next task'),()=>{if(next)detail(next);},{disabled:!next||board.busy,title:next?(next.priority+' · '+next.title):t('暂无可排期的任务','No eligible tasks')}),
        antButton(t('新建任务','New task'),async()=>{if(await newKanbanTask(id))await load();},{type:'primary'})));
    fill(lanes,...Object.entries(stages).map(([key,[name]])=>{
      const tasks=board.tasks.filter(task=>task.stage===key);
      const lane=h('section',{class:'kb-lane kb-'+key,'aria-label':name,'data-stage':key,
        ondragover:e=>{if(dragged&&board.moves[dragged.stage].includes(key)&&dragged.stage!==key){e.preventDefault();e.dataTransfer.dropEffect='move';}},
        ondrop:e=>{e.preventDefault();const task=dragged;dragged=null;if(task && task.stage!==key)move(task,key);}});
      append(lane,[h('header',{},h('i',{'aria-hidden':'true'}),h('h3',{text:name}),h('span',{class:'kb-count',text:String(tasks.length)})),
        h('div',{class:'kb-stack','data-stage':key},tasks.length?tasks.map(task=>
          h('button',{class:'kb-card',type:'button','data-task':task.id,draggable:!board.busy?'true':'false',onclick:()=>detail(task),
            onfocus:e=>e.currentTarget.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}),
            ondragstart:e=>{dragged=task;e.dataTransfer.setData('text/plain',task.id);e.dataTransfer.effectAllowed='move';},ondragend:()=>{dragged=null;}},
            h('span',{class:'kb-card-top'},h('small',{text:'QA-'+task.id.slice(0,6).toUpperCase()}),h('b',{class:'kb-pri '+(task.priority||''),text:task.priority||t('待分级','Unassigned')})),
            h('strong',{text:task.title}),h('span',{class:'kb-card-foot'},h('time',{datetime:task.at,text:new Date(task.at).toLocaleDateString(accessSettings.locale==='en'?'en-US':'zh-CN')}),
              h('span',{text:task.gap?gapText:task.origin==='document'?t('文档任务','Document'):task.origin==='finding'?t('检查发现','Finding'):t('手动创建','Manual task')})))):
          h('p',{class:'kb-empty',text:t('暂无任务','No tasks')}))]);return lane;
    }));
    lanes.scrollLeft=scroll;for(const el of lanes.querySelectorAll('.kb-stack'))el.scrollTop=offsets.get(el.dataset.stage)||0;
    if(selected)focusCard(selected);
  }
  load();
}
