'use strict';

function reviewGrades() {
  const t=accessText;
  return {pass:t('符合预期','Meets expectation'),friction:t('有困难，仍可完成','Friction, task still achievable'),
    blocker:t('任务受阻或严重误操作','Blocked or serious unintended outcome'),unknown:t('证据不足','Insufficient evidence')};
}
function reviewField(name,input) { return h('label',{class:'workflow-field'},name,input); }
function comparisonLabel(role) {
  const t=accessText;
  return {baseline:t('变更前','Before the change'),changed:t('变更并触发生效后','After activation'),control:t('同条件下的未改对象','Untouched control')}[role];
}
function procedureGuidance(suite,index) {
  return h('details',{},h('summary',{text:accessText('核验步骤与判断依据','Procedure and decision rule')}),
    ...suite.checks[index].slice(1).map(text=>h('p',{text})),h('p',{class:'muted',text:suite.boundary}));
}
function specialistReview(endpoint, suite, suites, round, clauses) {
  const t=accessText, base=endpoint+'/reviews';
  const section=h('section',{class:'review-section','aria-label':t('任务验收','Task acceptance')});
  if(!round)return h('p',{class:'muted',text:t('完成一次项目检查后，即可按规程记录任务验收。','Run a project check to record acceptance cases for each procedure.')});
  const heading=h('h3',{text:t('任务验收','Task acceptance')});
  const body=h('div',{class:'stack-tight','aria-live':'polite'});
  append(section,[heading,body]);
  async function load(){
    try{
      const data=await api(base+'?round='+encodeURIComponent(round.id)+'&suite='+encodeURIComponent(suite.id));
      const current=data.cases.filter(c=>c.roundId===round.id);
      const past=data.cases.filter(c=>c.roundNumber<round.number);
      const closed=new Set(current.filter(c=>c.final && c.final!=='unknown').map(c=>c.procedure));
      const pending=current.filter(c=>c.reviewCount<2);
      const start=(i,previous)=>editReviewCase(base,suite,round,clauses,data,i,previous,load);
      const details=c=>showReviewCase(base,c,suite,load);
      const status=c=>c.final?reviewGrades()[c.final]:c.needsDecision?t('分歧待裁定','Disagreement to resolve'):t('盲评 ','Blind reviews ')+c.reviewCount+'/2';
      fill(body,h('p',{class:'muted',text:t('已有明确人工结论的规程 ','Procedures with a definite human result ')+closed.size+'/3 · '+t('案例 ','Cases ')+current.length}),
        h('div',{class:'quality-actions'},pending.length?antButton(t('抽取下一件盲评','Sample a case for blind review'),()=>details(pending[Math.floor(Math.random()*pending.length)])):null,
          antButton(t('查看校准指标','View calibration metrics'),()=>showCalibrationMetrics(base,suite,suites))),
        h('details',{},h('summary',{text:t('本轮八类验收进度','Round coverage across all eight checks')}),data.coverage.map(s=>
          h('p',{text:s.title+' · '+s.assessed+'/'+s.total+' · '+t('案例 ','Cases ')+s.cases}))),
        h('details',{class:'review-procedures'},h('summary',{text:t('按三项规程验收','Review the three procedures')}),
          suite.checks.map(([name],index)=>h('article',{class:'review-procedure'},
            h('div',{class:'quality-actions'},h('strong',{class:'grow',text:name}),
              antButton(t('建立案例','Create case'),()=>start(index))),
            current.filter(c=>c.procedure===index).map(c=>antButton(c.task+' · '+status(c),()=>details(c)))))),
        past.length?h('details',{},h('summary',{text:t('从上轮案例复检','Retest an earlier case')}),
          past.map(c=>antButton(t('第 ','Round ')+c.roundNumber+' · '+c.task,()=>start(c.procedure,c)))):null);
    }catch(e){fill(body,h('p',{role:'alert',text:e.message}),antButton(t('重试','Retry'),load));}
  }
  load();return section;
}

function editReviewCase(base,suite,round,clauses,data,procedure,previous,refresh){
  const t=accessText;
  openOverlay((panel,close)=>{
    const task=h('input',{class:'input',required:true,maxlength:300,value:previous?.task,readonly:!!previous});
    const scope=h('input',{class:'input',required:true,maxlength:500,value:previous?.scope,readonly:!!previous});
    const field=(name,el)=>reviewField(name,el);
    const clause=h('select',{class:'input'},h('option',{value:'',text:t('填写项目约定','Enter a project criterion')}),
      clauses.filter(c=>c.status!=='stale' && c.purpose!=='observation').map(c=>h('option',{value:c.id,text:c.source+' · '+c.locator})));
    const expected=h('textarea',{class:'input',required:true,rows:3,maxlength:4000}),source=h('input',{class:'input',required:true,maxlength:500});
    function updateSource(){
      const selected=clauses.find(c=>c.id===clause.value);
      expected.value=previous?.expected ?? selected?.quote ?? '';
      source.value=previous?.source ?? (selected?selected.source+' · '+selected.locator:'');
      source.readOnly=expected.readOnly=!!(previous || selected);
    }
    clause.onchange=updateSource;updateSource();
    const partition=h('select',{class:'input',required:true,disabled:!!data.partition},
      h('option',{value:'',text:t('选择项目用途','Choose a project set')}),
      h('option',{value:'development',text:t('调规则项目','Rule development')}),
      h('option',{value:'holdout',text:t('独立盲测项目','Held-out evaluation')}));
    partition.value=data.partition || '';
    const variant=h('select',{class:'input',disabled:!!previous},
      h('option',{value:'target',text:t('目标行为','Target behavior')}),h('option',{value:'control',text:t('对照或反例','Control or counterexample')}),
      h('option',{value:'missing',text:t('证据不足场景','Missing-evidence scenario')}));
    if(previous)variant.value=previous.variant;
    const selected=new Set();
    const applicable=data.facts.filter(f=>!f.procedures || f.procedures.includes(procedure));
    const search=h('input',{class:'input',type:'search','aria-label':t('搜索本轮观测','Search round observations'),placeholder:t('搜索路径或观测文字','Search path or observation')});
    const factList=h('div',{class:'review-facts'});
    function showFacts(){
      const q=search.value.toLowerCase();
      const matches=applicable.filter(f=>(f.location+' '+f.text).toLowerCase().includes(q));
      fill(factList,matches.slice(0,40).map(f=>h('label',{class:'review-fact'},h('input',{type:'checkbox',checked:selected.has(f.id),onchange:e=>{
        if(e.target.checked)selected.add(f.id);else selected.delete(f.id);
      }}),h('span',{},h('strong',{text:f.location}),h('span',{text:f.text.slice(0,250)})))),
      matches.length>40?h('small',{text:t('请搜索以缩小范围，共 ','Narrow your search. Matches: ')+matches.length}):null);
    }
    search.oninput=showFacts;showFacts();
    const observation=h('textarea',{class:'input',rows:2,maxlength:2000});
    const location=h('input',{class:'input',maxlength:500});observation.oninput=()=>location.required=!!observation.value.trim();
    const comparison=suite.id==='logic' && procedure===1?['baseline','changed','control'].map(role=>({
      role,text:h('textarea',{class:'input',rows:2,maxlength:2000}),location:h('input',{class:'input',maxlength:500})
    })):[];
    const error=h('p',{role:'alert',class:'notice error',hidden:true});
    const submit=h('button',{type:'submit',class:'btn primary',text:t('保存验收案例','Save acceptance case')});
    append(panel,[h('h2',{text:suite.checks[procedure][0]}),procedureGuidance(suite,procedure),h('form',{class:'assurance-form',onsubmit:async e=>{
      e.preventDefault();submit.disabled=true;
      try{
        const item=await api(base,{method:'POST',body:{suite:suite.id,roundId:round.id,procedure,task:task.value,scope:scope.value,expected:expected.value,
          source:source.value,clauseId:clause.value || undefined,partition:partition.value,variant:variant.value,factIds:[...selected],observation:observation.value.trim(),
          location:location.value,previous:previous?.id,comparison:comparison.filter(r=>r.text.value.trim() || r.location.value.trim()).map(r=>({role:r.role,text:r.text.value,location:r.location.value}))}});
        close(true);refresh();showReviewCase(base,item,suite,refresh);
      }catch(err){error.hidden=false;error.textContent=err.message;submit.disabled=false;}
    }},field(t('目标任务','Task goal'),task),field(t('角色、页面和条件','Role, page and conditions'),scope),
      !previous?field(t('预期来源','Expectation source'),clause):null,field(t('可观察的验收条件','Observable acceptance criterion'),expected),
      field(t('条款或约定出处','Criterion reference'),source),field(t('整个项目的评测用途','Evaluation set for this project'),partition),
      h('p',{class:'muted',text:t('已经参与调规则的项目请选择「调规则项目」。首个案例保存后整个项目沿用同一分组。','Choose rule development if this project informed your rules. Saving the first case fixes the set for the entire project.')}),
      field(t('样本类型','Case type'),variant),
      h('fieldset',{},h('legend',{text:t('本轮观测，可多选','Observations from this round')}),applicable.length?[search,factList]:h('p',{text:t('本轮此规程还没有实测记录。','No recorded observations for this procedure and round.')})),
      comparison.map(r=>h('fieldset',{},h('legend',{text:comparisonLabel(r.role)}),
        field(t('实际结果','Observed result'),r.text),field(t('记录位置或事件编号','Record location or event ID'),r.location))),
      field(t('补充实际观察（可选）','Additional firsthand observation (optional)'),observation),
      field(t('观察位置或记录编号','Observation location or record ID'),location),
      error,h('div',{class:'quality-actions'},submit,antButton(t('取消','Cancel'),()=>close(false))))]);
  },{label:t('建立验收案例','Create acceptance case')});
}

function showReviewCase(base,item,suite,refresh){
  const t=accessText, grades=reviewGrades();
  openOverlay((panel,close)=>{
    const title=h('h2',{text:item.task}),content=h('div',{class:'assurance-form'});
    append(panel,[title,content]);
    function render(){
      const err=h('p',{class:'notice error',role:'alert',hidden:true});
      const action=async(button,operation,input)=>{
        button.disabled=true;err.hidden=true;
        try{item=await api(base+'/'+item.id+'/'+operation,{method:'POST',body:input});render();refresh();}
        catch(e){button.disabled=false;err.hidden=false;err.textContent=e.message;}
      };
      const reviewer=h('input',{class:'input',required:true,maxlength:80,autocomplete:'off'});
      const grade=h('select',{class:'input',required:true},h('option',{value:'',text:t('请选择结果','Choose a result')}),Object.entries(grades).map(([value,text])=>h('option',{value,text})));
      const reason=h('textarea',{class:'input',required:true,rows:2,maxlength:2000});
      const basis=h('select',{class:'input'},h('option',{value:'packet',text:t('使用相同案例证据','Used the same evidence packet')}),h('option',{value:'additional',text:t('另有用户实测或现场证据','Used additional user or field evidence')}));
      const location=h('input',{class:'input',maxlength:500});
      const extra=reviewField(t('额外证据位置','Additional evidence location'),location);
      extra.hidden=true;basis.onchange=()=>{extra.hidden=basis.value!=='additional';location.required=!extra.hidden;};
      const save=h('button',{class:'btn primary',type:'submit',text:item.needsDecision?t('保存分歧裁定','Save adjudication'):t('提交独立评分','Submit blind rating')});
      const pred=item.prediction;
      const imagePairs=item.facts.filter(f=>f.frame && f.limit!=='gap');
      const sendFrames=h('input',{type:'checkbox'});
      fill(content,h('p',{text:suite.checks[item.procedure][0]+' · '+item.scope}),procedureGuidance(suite,item.procedure),h('section',{},h('strong',{text:t('验收预期','Expectation')}),h('p',{text:item.expected}),h('small',{text:item.source})),
        h('details',{open:true},h('summary',{text:t('本轮证据','Round evidence')+' ('+item.facts.length+')'}),
          item.facts.length?item.facts.map(f=>h('p',{class:'review-observation'},h('strong',{text:(f.comparisonRole?comparisonLabel(f.comparisonRole)+' · ':'')+f.location}),h('span',{text:f.text}),
            f.reportedEase?h('span',{text:t('参与者自评容易程度 · ','Participant-rated ease · ')+f.reportedEase+'/7'}):null)):h('p',{text:t('尚无实测证据。','No observed evidence.')})),
        imagePairs.map(f=>designComparisonResult({id:f.id,...f.frame})),
        item.hasPrediction?h('p',{class:'muted',text:pred?t('模型结果已揭示','Model assessment revealed'):t('模型判断已封存，取得人工结论后揭示。','Model assessment is sealed until the human result is settled.')}):
          item.partition==='holdout' && item.reviewCount>0?h('p',{class:'muted',text:t('此盲测案例已开始人工评审，仅计人工结果。','Human review has started. This holdout case contributes human ratings only.')}):
          h('section',{},imagePairs.length===1?h('label',{},sendFrames,' ',t('同时发送这组设计与实测图片','Also send this design and observed image pair')):null,
            antButton(t('请所选模型独立判断','Assess with selected model'),e=>action(e.currentTarget,'model',{includeFrames:sendFrames.checked})),
            h('p',{class:'muted',text:t('将任务、预期及所选观测发往设置中的模型。人工评分保存在本机。盲测项目请在首位评审提交前运行模型。','Sends the task, criterion and selected evidence to your model. Ratings stay local. For a holdout, run the model before the first human submission.')})),
        pred?h('details',{open:true},h('summary',{text:pred.model+' · '+grades[pred.grade]}),h('p',{text:pred.reason}),
          h('small',{text:pred.looks===0?t('证据未达到判断条件，模型调用 0 次','Evidence gate stopped assessment before any model call'):t('独立模型判断次数 · ','Independent model readings · ')+pred.looks}),
          pred.expectedQuote?h('p',{text:t('预期原文 · ','Criterion · ')+pred.expectedQuote}):null,pred.citations.map(c=>h('p',{text:(item.facts.find(f=>f.id===c.id)?.location || c.id)+' · '+c.quote}))):null,
        item.ratings?h('details',{open:true},h('summary',{text:t('两位评审的记录','Independent ratings')}),
          item.ratings.map(r=>h('p',{text:r.reviewer+' · '+grades[r.grade]+' · '+r.reason+(r.location?' · '+r.location:'')}))):null,
        item.final?h('p',{class:'notice',text:t('人工结论 · ','Human result · ')+grades[item.final]+(item.decision?' · '+item.decision.reason:'')}):null,
        item.final==='blocker' || item.final==='friction'?antButton(t('转到问题处理','Record as a project issue'),()=>{
          close(true);openObservation({name:item.task,domain:suite.domain,assuranceSuite:suite.id,location:item.scope,
            detail:[item.expected,item.decision?.reason || item.ratings.map(r=>r.reason).join('\n'),t('验收案例 ','Acceptance case ')+item.id].join('\n')});
        }):null,
        item.reviewCount<2 || item.needsDecision?h('form',{class:'assurance-form',onsubmit:e=>{e.preventDefault();action(save,item.needsDecision?'resolve':'rate',{reviewer:reviewer.value,grade:grade.value,reason:reason.value,basis:basis.value,location:location.value});}},
          h('strong',{text:item.needsDecision?t('请第三位评审裁定分歧','Third-reviewer adjudication'):t('独立评审 ','Independent review ')+(item.reviewCount+1)+'/2'}),
          reviewField(t('评审代号','Reviewer alias'),reviewer),reviewField(t('任务结果','Task outcome'),grade),
          reviewField(t('判定依据','Review evidence basis'),basis),extra,
          reviewField(t('观察到什么，依据在哪里','Observed behavior and evidence location'),reason),save):null,
        err,antButton(t('关闭','Close'),()=>close(false)));
    }
    render();
  },{label:t('任务验收案例','Task acceptance case')});
}

function showCalibrationMetrics(base,suite,suites){
  const t=accessText;
  openOverlay((panel,close)=>{
    const groupSelect=h('select',{class:'input'},h('option',{value:'holdout',text:t('盲测项目','Held-out projects')}),h('option',{value:'development',text:t('调规则项目','Development projects')}));
    const which=h('select',{class:'input'},suites.map(s=>h('option',{value:s.id,text:s.title,selected:s.id===suite.id})));
    const body=h('div',{class:'stack-tight','aria-live':'polite'});
    const ratio=(label,x,y)=>h('p',{},h('strong',{text:label+' · '}),y?x+'/'+y+' ('+Math.round(100*x/y)+'%)':t('暂无可比样本','No comparable samples'));
    let rows=[];
    function draw(){
      const subset=rows.filter(r=>r.partition===groupSelect.value && r.suite===which.value);
      fill(body,subset.length?subset.map(r=>{
        const c=r.counts;
        return h('article',{class:'review-procedure'},h('h3',{text:(r.model || t('未评模型','No model assessment'))+' · '+r.rubric+(r.model?' · '+r.configuration.slice(0,8):'')}),
          h('p',{text:t('项目 ','Projects ')+c.projects+' · '+t('案例 ','Cases ')+c.cases+' · '+t('待双评 ','Awaiting two reviews ')+c.pending+' · '+t('待裁定 ','Disputed ')+c.unresolved}),
          h('p',{text:t('目标 / 对照 / 证据不足样本','Target / control / missing-evidence cases')+' · '+[c.target,c.control,c.missing].join(' / ')}),
          ratio(t('双评覆盖','Double-review coverage'),c.doubleReviewed,c.cases),
          ratio(t('两位评审一致','Human agreement'),c.humanAgree,c.doubleReviewed),
          ratio(t('人机严重度一致','Exact human–model agreement'),c.matched,c.comparable),
          ratio(t('严重问题漏放（AI 判通过且有明确人工结论）','Blockers among adjudicated model passes'),c.escapedBlockers,c.reviewedPasses),
          ratio(t('漏报（人工确认有问题）','Misses among human-confirmed issues'),c.missedIssues,c.humanIssues),
          ratio(t('误报（人工确认符合预期）','False alarms among human passes'),c.falseAlarms,c.humanPasses),
          r.suite==='usability'?ratio(t('AI 判通过但有参与者自评困难（1–3 / 7）','Model passes with a participant rating difficulty (1–3 of 7)'),c.difficultPasses,c.passesWithEase):null,
          ratio(t('漏放中使用了额外现场证据','Escaped blockers with additional field evidence'),c.extraEvidenceEscapes,c.escapedBlockers),
          ratio(t('模型待验证（人工已定案的预测）','Model abstentions among settled predictions'),c.unknown,c.gradedPredictions));
      }):h('p',{text:t('所选专项和项目分组暂无样本。','No cases in this check and project set.')}));
    }
    groupSelect.onchange=which.onchange=draw;
    append(panel,[h('h2',{text:t('人机校准','Human–model calibration')}),h('p',{class:'muted',text:t('汇总本机登记项目。复检单独保留；同一案例只计一次。未完成双评时隐藏模型结论。','Aggregates registered local projects. Retests are excluded. Each case counts once. Model verdicts stay sealed during blind review.')}),
      reviewField(t('项目分组','Project set'),groupSelect),reviewField(t('专项','Specialist check'),which),body,antButton(t('关闭','Close'),()=>close(false))]);
    api(base+'/metrics').then(data=>{rows=data.groups;draw();}).catch(e=>fill(body,h('p',{role:'alert',text:e.message})));
  },{label:t('人机校准','Human–model calibration')});
}
