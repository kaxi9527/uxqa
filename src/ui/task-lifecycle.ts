export const stages=['untested','testing','unfixed','repairing','unreviewed','done'] as const;
export type Stage=typeof stages[number];
interface Event {from:Stage;to:Stage;at:string;by:'manual'|'system';note:string;ref:string;gap?:boolean}
interface Attempt {id:string;status:string;repairOf?:string}
export type Priority='P0'|'P1'|'P2'|'P3';
export type PriorityMode='auto'|'manual';
export type Impact='critical'|'major'|'friction'|'minor';
export interface LifecycleTask {
  attempts:Attempt[];repair?:string;events?:Event[];priority?:Priority;priorityMode?:PriorityMode;impact?:Impact;
  priorityChanges?:{at:string;from:string;to:string;mode:PriorityMode;note:string;reason?:string}[]
}

export const moves:Record<Stage,Stage[]>={
  untested:['testing','untested'], testing:['unfixed','done','testing'], unfixed:['repairing'],
  repairing:['unreviewed','unfixed'], unreviewed:['done','unfixed','unreviewed'], done:['untested','unfixed']
};
export function taskStage(task:LifecycleTask):Stage{
  const event=task.events?.at(-1);
  if(event)return event.to;
  // Tasks saved before the board already have trustworthy replay results.
  const attempt=task.attempts.at(-1);
  if(!attempt)return 'untested';
  if(attempt.status==='pass')return 'done';
  if(attempt.status==='fail')return task.repair===attempt.id?'unreviewed':'unfixed';
  return attempt.repairOf?'unreviewed':'testing';
}
export function stamp(task:LifecycleTask){
  return [task.events?.length??0,task.attempts.at(-1)?.id??'',taskStage(task),task.priorityChanges?.length??0,task.priorityMode,task.priority].join('/');
}
export function assessPriority(t:LifecycleTask,reportedImpact:boolean){
  if(t.impact==='critical')return {level:'P0',reason:'critical'} as const;
  if(t.impact==='major'||reportedImpact)return {level:'P1',reason:t.impact==='major'?'major':'feedback'} as const;
  if(t.impact==='minor')return {level:'P3',reason:'minor'} as const;
  if(t.impact==='friction')return {level:'P2',reason:'friction'} as const;
  if(t.attempts.some(a=>a.status==='fail'))return {level:'P2',reason:'failed'} as const;
  return {level:'P2',reason:'unknown'} as const;
}
export function logStage(task:LifecycleTask,to:Stage,by:Event['by'],note:string,ref:string,gap=false){
  const from=taskStage(task);
  (task.events??=[]).push({from,to,by,note,ref,at:new Date().toISOString(),...(gap?{gap:true}:{})});
}
export function logAttempt(task:LifecycleTask,attempt:Attempt,review:boolean){
  const to=attempt.status==='pass'?'done':attempt.status==='fail'?'unfixed':review?'unreviewed':'testing';
  logStage(task,to,'system',attempt.status,attempt.id,!['pass','fail'].includes(attempt.status));
}
