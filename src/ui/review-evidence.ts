import { issueGuidance } from '../guidance/issues.js';
import type { CheckResult } from '../types.js';
import { readRecords } from './assurance.js';
import { getProjectAgent } from './project-agent.js';
import type { ProjectEntry, Round } from './store.js';

/** A recorded measurement or observation, never an AI opinion or a project expectation. */
export interface ReviewFact {
  id: string;
  kind?: 'task-session' | 'frame' | 'journey';
  procedures?: number[];
  comparisonRole?: 'baseline' | 'changed' | 'control';
  reportedEase?: number;
  frame?: {capture:string; captureDigest:string; referenceDigest:string; changedPixels?:number; totalPixels?:number};
  location: string;
  text: string;
  limit?: 'gap' | 'adverse';
}

interface Comparison {
  id: string; roundId: string; route: string; locator: string; status: string;
  expected: number[]; observed: number[]; changedPixels?: number; totalPixels?: number; channelTolerance?: number;
  capture:string; captureDigest:string; referenceDigest:string;
}
interface Sample {
  id: string; roundId: string; route: string; suite: string;
  checks?: CheckResult[]; sample?: Record<string, unknown>; reason?: string;
}
interface Session {
  id: string; roundId: string; task: string; cohort: string; outcome: string;
  evidence: string; friction: string; seconds?: number; reportedEase?: number;
}

export async function reviewFacts(entry: ProjectEntry, round: Round, suite: string): Promise<ReviewFact[]> {
  const facts: ReviewFact[] = [];
  if (suite === 'fidelity') {
    for (const frame of await readRecords<Comparison>(entry, 'comparisons')) {
      if (frame.roundId !== round.id) continue;
      facts.push({id:frame.id, kind:'frame', location:frame.route+' · '+frame.locator,
        frame:{capture:frame.capture,captureDigest:frame.captureDigest,referenceDigest:frame.referenceDigest,changedPixels:frame.changedPixels,totalPixels:frame.totalPixels},
        text:JSON.stringify({dimensions:[frame.expected,frame.observed], changedPixels:frame.changedPixels,
          totalPixels:frame.totalPixels, channelTolerance:frame.channelTolerance, result:frame.status}),
        ...(frame.status==='unaligned'?{limit:'gap' as const}:{})});
    }
  } else if (suite === 'logic') {
    const chat=await getProjectAgent(entry.id);
    for (const msg of chat.messages) {
      if (msg.kind !== 'journey-result' || msg.data?.roundId !== round.id) continue;
      const {name,status,phases}=msg.data;
      facts.push({id:msg.id, kind:'journey', location:String(name || msg.data.planId),
        text:JSON.stringify({status,phases}), limit:status==='fail'?'adverse':status==='pass'?undefined:'gap'});
    }
  } else if (suite === 'usability') {
    for (const session of await readRecords<Session>(entry,'sessions')) {
      if (session.roundId !== round.id) continue;
      facts.push({id:session.id, kind:'task-session', location:session.task+' · '+session.cohort, reportedEase:session.reportedEase,
        text:JSON.stringify({outcome:session.outcome, friction:session.friction, seconds:session.seconds, observed:session.evidence}),
        limit:session.outcome==='independent' && session.friction==='none'?undefined:'adverse'});
    }
  } else if (suite === 'components') {
    for (const [index,usage] of (round.capture?.reuse ?? []).entries()) {
      facts.push({id:'reuse-'+index, location:usage.route, text:JSON.stringify(usage),limit:usage.total===0?'gap':undefined});
    }
    const library=round.result.library;
    facts.push({id:'library',location:'component inventory',text:JSON.stringify({source:library.source,components:library.components,tokens:library.tokens,issues:library.issues}),
      limit:library.source==='none'?'gap':undefined});
  } else {
    for (const sample of await readRecords<Sample>(entry,'samples')) {
      if (sample.roundId !== round.id || sample.suite !== suite) continue;
      for (const [i,check] of (sample.checks ?? []).entries()) {
        if (check.check==='page-load' && check.status==='pass') continue;
        const keyboard=['keyboard-focus','tab-order-logic'].includes(check.check);
        const reflow=['reflow-320','zoom-200','real-device'].includes(check.check);
        const procedures=reflow?[0]:keyboard?(suite==='interaction'?[0,1]:[1]):check.check==='screen-reader'?[2]:undefined;
        facts.push({id:sample.id+'-'+i, procedures, location:check.route+' · '+check.viewport+' · '+check.check,
          text:check.status+' · '+check.detail,limit:check.status==='fail'?'adverse':check.status==='pass'?undefined:'gap'});
      }
      if (sample.sample || sample.reason) facts.push({id:sample.id, location:sample.route,
        procedures:suite==='performance' && sample.sample?.trigger!=='idle'?[1,2]:undefined,
        text:sample.reason || JSON.stringify(sample.sample),
        // An idle frame sample cannot exercise input, loading or an interrupted animation.
        limit:sample.sample?.status==='measured' && sample.sample.trigger!=='idle'?undefined:'gap'});
    }
  }
  for (const hit of round.result.violations) {
    if (hit.status !== 'new' || hit.origin==='ai' || issueGuidance(hit).suite!==suite) continue;
    facts.push({id:'finding-'+hit.fingerprint, location:hit.file+':'+hit.line, text:[hit.rule,hit.what,hit.snippet].filter(Boolean).join(' · '), limit:'adverse'});
  }
  return facts;
}
