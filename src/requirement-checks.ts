import type { BusinessJourney, JourneyAssertion, JourneyList, JourneyObservation, Step } from './types.js';

type Label = [string,string];
type InputField = [string,string,string,string,boolean?];
interface Template {
  title: Label; method: Label; fields: InputField[];
  group?: {key:string; title:Label; min:number; fields:InputField[]};
}
export const requirementChecks: Record<string,Template> = {
  'setting-propagation': {
    title:['配置发布与生效','Published setting propagation'],
    method:['记录原值和独立对照，更改一个值并发布。重新打开设置，逐一读取使用它的入口，复核对照未变。','Record the original and control values, change one setting and publish it. Reopen settings, check each reader and compare the unaffected control.'],
    fields:[['route','设置页面','Settings route','/settings'],['field','设置输入框','Setting input','#limit'],['value','本次测试值','New test value','48'],['publish','发布按钮','Publish control','#publish'],['saved','发布后才出现的成功提示','New publish confirmation','#published'],['controlRoute','独立对照页面','Unaffected control route','/other'],['control','对照值','Control value','#limit']],
    group:{key:'readers',title:['读取此配置的入口','Setting readers'],min:1,fields:[['route','读取页面','Reader route','/registration'],['selector','显示生效值的控件','Effective value control','#limit']]}
  },
  'role-outcomes': {
    title:['确认、取消与角色结果','Confirm, cancel and recipient outcomes'],
    method:['记录各角色原清单；取消预览后逐项核对原清单。再次预览，按最新清单确认，逐项比对各角色收到的对象。','Read each recipient’s original list, cancel a preview and compare again. Capture a fresh preview, confirm it and compare every recipient’s assigned items.'],
    fields:[['route','分配操作页面','Assignment route','/assignments'],['open','生成预览','Open preview','#preview'],['previewRoute','预览跳转路径（同页可留空）','Preview destination route (omit for inline previews)','/preview',true],['preview','预览清单容器','Preview list container','#plan'],['cancel','取消按钮','Cancel control','#cancel'],['confirm','确认按钮','Confirm control','#confirm'],['rows','各清单内的数据行','Row selector in each list','[data-item]'],['total','容器声明的完整总数属性','Full list total attribute','data-total'],['keys','对象标识属性，可用逗号分隔','Item key attributes, comma-separated','data-stage,data-item'],['recipient','数据行的接收方属性','Row recipient attribute','data-recipient'],['cancelledReady','取消完成标识（可选）','Cancel completion indicator (optional)','#cancelled',true],['confirmedReady','确认完成标识（可选）','Confirm completion indicator (optional)','#confirmed',true]],
    group:{key:'recipients',title:['需验证的接收方','Recipients to verify'],min:2,fields:[['id','接收方标识值','Recipient ID','reviewer-a'],['route','该角色的页面','Recipient route','/tasks/a'],['identity','显示当前角色标识的控件','Current identity control','#identity'],['list','实际任务清单容器','Actual list container','#tasks']]}
  },
  'return-state': {
    title:['中断返回与状态保留','Return to a task after interruption'],
    method:['记录对象标识和原值，输入一个不同的测试值，离开并打开另一页，再返回原对象。按原文核对保留编辑值或恢复原值。','Capture the object ID and original value, enter a distinct value, visit another page and return. Check retained edits or the original value as required.'],
    fields:[['route','编辑页面','Edit route','/edit'],['identity','对象标识控件','Object identity control','#record-id'],['field','编辑输入框','Editable input','#title'],['value','本次编辑值','Test edit','Updated title'],['awayRoute','离开期间打开的页面','Away route','/overview'],['awayReady','另一页就绪标识','Away page ready indicator','#overview']]
  }
};

type Phase = BusinessJourney['phases'][number];
const obj=(v:unknown):Record<string,unknown>=>{
  if (!v || typeof v!=='object' || Array.isArray(v)) throw new Error('缺少场景绑定 / Missing scenario binding');
  return v as Record<string,unknown>;
};
function required(record:Record<string,unknown>,key:string) {
  const value=record[key];
  if (typeof value!=='string' || !value.trim()) throw new Error('请填写 / Missing: '+key);
  return value;
}
const display=(id:string,css:string):JourneyObservation=>({id,target:{css},read:'display'});
const inputValue=(id:string,css:string):JourneyObservation=>({id,target:{css},read:'value'});
const click=(css:string):Step=>({action:'click',target:{css}});
const visible=(css:string):Step=>({action:'waitFor',target:{css}});
const relation=(name:string,left:string,op:'eq'|'ne',ref:string):JourneyAssertion=>({name,left,op,right:{ref}});

/** Compile reviewed project bindings; the runner validates the resulting routes, steps and references. */
export function buildRequirementCheck(raw:unknown,requirement:string):BusinessJourney {
  const binding=obj(raw),kind=required(binding,'kind');
  if (!Object.hasOwn(requirementChecks,kind)) throw new Error('未知验收类型 / Unknown requirement check');
  const spec=requirementChecks[kind],get=(key:string)=>required(binding,key);
  for (const [key,,,,optional] of spec.fields) if(!optional) get(key);
  const groups=spec.group ? binding[spec.group.key] : [];
  if (!Array.isArray(groups) || groups.length<(spec.group?.min ?? 0)) throw new Error('请补齐入口或角色 / Missing readers or recipients');
  const entries=groups.map(value=>{
    const row=obj(value);
    return Object.fromEntries(spec.group!.fields.map(([key])=>[key,required(row,key)]));
  });
  const route=get('route'), phases:Phase[]=[];
  function phase(name:string,path:string,params:Partial<Phase>,actor='operator') {
    phases.push({name,actor,route:path,steps:[],exactRoute:true,...params});
  }
  if (kind==='setting-propagation') {
    const field=get('field'), controlRoute=get('controlRoute'), control=get('control');
    const points=[{route,selector:field},...entries,{route:controlRoute,selector:control}];
    if(new Set(points.map(p=>JSON.stringify([new URL(p.route,'https://project.invalid').href,p.selector]))).size!==points.length)
      throw new Error('设置、读取入口和对照需要独立绑定 / Use distinct setting, reader and control bindings');
    phase('对照原值 / Control baseline',controlRoute,{observe:[display('control.before',control)]});
    entries.forEach((r,i)=>phase('入口原值 / Reader baseline '+(i+1),r.route,{observe:[display('initial.'+i,r.selector)]}));
    phase('设置原值 / Setting baseline',route,{steps:[visible(field)],observe:[inputValue('before',field)]});
    phase('改变单个值 / Change one value',route,{continueOnPage:true,steps:[{action:'fill',target:{css:field},value:get('value')}],observe:[inputValue('edited',field)],
      requires:[{name:'测试值已输入 / Requested edit applied',left:'edited',op:'eq',right:{value:get('value')}},relation('实际发生变化 / Distinct edit','edited','ne','before'),relation('对照可区分 / Distinguishable control','edited','ne','control.before'),
        ...entries.map((_,i)=>relation('确认入口原值 / Establish reader baseline '+(i+1),'initial.'+i,'eq','before'))]});
    phase('发布 / Publish',route,{continueOnPage:true,steps:[{action:'waitForHidden',target:{css:get('saved')}},click(get('publish')),visible(get('saved'))]});
    phase('重新读取设置 / Reopen setting',route,{observe:[display('stored',field)],assert:[relation('发布值持久化 / Persisted value','stored','eq','edited')]});
    entries.forEach((r,i)=>phase('读取入口 / Reader '+(i+1),r.route,{observe:[display('read.'+i,r.selector)],assert:[relation('生效值 / Effective value','read.'+i,'eq','edited')]}));
    phase('复核对照 / Recheck control',controlRoute,{observe:[display('control.after',control)],assert:[relation('对照未变 / Control unchanged','control.after','eq','control.before')]});
  } else if(kind==='return-state') {
    const field=get('field'),identity=get('identity'),away=get('awayRoute'),outcome=get('outcome');
    if(!['retain','restore'].includes(outcome) || new URL(route,'https://project.invalid').href===new URL(away,'https://project.invalid').href || identity===field)
      throw new Error('请指定独立的对象标识、离开页面与返回预期 / Choose an independent identity, away route and return expectation');
    phase('原对象和原值 / Original object and value',route,{steps:[visible(field)],observe:[display('object.before',identity),inputValue('before',field)]});
    phase('编辑 / Edit',route,{continueOnPage:true,steps:[{action:'fill',target:{css:field},value:get('value')}],observe:[inputValue('edited',field)],requires:[relation('实际编辑 / Distinct edit','before','ne','edited')]});
    phase('离开 / Leave',away,{steps:[visible(get('awayReady'))]});
    phase('返回并核对 / Return and check',route,{steps:[visible(field)],observe:[display('object.returned',identity),inputValue('returned',field)],
      requires:[relation('同一对象 / Same object','object.returned','eq','object.before')],assert:[relation('返回后的值 / Value after return','returned','eq',outcome==='retain'?'edited':'before')]});
  } else {
    const ids=entries.map(r=>r.id),keys=get('keys').split(',').map(s=>s.trim());
    if(new Set(ids).size!==ids.length || keys.some(k=>!k || k===get('recipient')) || new Set(keys).size!==keys.length)
      throw new Error('对象键和角色标识必须独立 / Item keys and recipient identities must be distinct');
    const fields={...Object.fromEntries(keys.map((k,i)=>['key'+i,k])),recipient:get('recipient')};
    const list=(container:string):JourneyList=>({container,rows:get('rows'),totalAttribute:get('total'),fields});
    function recipients(stage:'before'|'cancelled'|'confirmed') {
      entries.forEach((r,i)=>{
        const id=stage+'.identity.'+i;
        phase(stage+' · '+r.id,r.route,{observe:[display(id,r.identity)],requires:[{name:'核实接收方 / Verify recipient',left:id,op:'eq',right:{value:r.id}}],
          list:{...list(r.list),...(stage==='before'?{saveAs:'before.'+i}:stage==='cancelled'?{equals:'before.'+i}:{equals:'confirmed.preview',where:{recipient:r.id}})}},'recipient:'+r.id);
      });
    }
    recipients('before');
    const partitionWitness={field:'recipient',baselines:Object.fromEntries(ids.map((id,i)=>[id,'before.'+i]))};
    for(const stage of ['cancelled','confirmed'] as const) {
      phase('预览 / Preview · '+stage,route,{steps:[click(get('open')),visible(get('preview'))],list:{...list(get('preview')),saveAs:stage+'.preview',partitionWitness}});
      const marker=binding[stage+'Ready'], action=click(get(stage==='cancelled'?'cancel':'confirm'));
      const steps:Step[]=typeof marker==='string' && marker.trim()
        ? [{action:'waitForHidden',target:{css:marker}},action,visible(marker)]
        : [action,{action:'waitForHidden',target:{css:get('preview')}}];
      const destination=typeof binding.previewRoute==='string' && binding.previewRoute.trim() ? binding.previewRoute : route;
      phase(stage==='cancelled'?'取消 / Cancel':'确认 / Confirm',destination,{continueOnPage:true,steps});
      recipients(stage);
    }
  }
  return {name:typeof binding.name==='string' && binding.name.trim()?binding.name:spec.title.join(' / '),requirement,phases,gaps:[]};
}
