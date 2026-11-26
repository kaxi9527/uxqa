/** Expand the collector's lossless JSON string-token dictionary, with a hard decoded-size budget. */
export function unpackCapture(raw: unknown): unknown {
  if(raw && typeof raw==='object' && (raw as {encoding?:string}).encoding==='qa-master-rows-v1'){
    const {data,shapes}=raw as {data:unknown;shapes:unknown};
    if(!Array.isArray(shapes)||shapes.length>2000||!shapes.every(s=>Array.isArray(s)&&s.length<=128&&s.every(k=>typeof k==='string')&&new Set(s).size===s.length))throw new Error('Invalid Figma row schema');
    const lengths=shapes.map(s=>Buffer.byteLength(JSON.stringify(s))+s.length);
    let budget=2*1024*1024;
    function expand(v:unknown,depth:number):unknown{
      if(depth>100||budget<0)throw new Error('Expanded Figma rows exceed input budget');
      if(!Array.isArray(v)){if(v!==null&&typeof v==='object')throw new Error('Invalid Figma row value');budget-=Buffer.byteLength(JSON.stringify(v))+1;return v;}
      const [n,...values]=v;budget-=2;
      if(n===-1)return values.map(x=>expand(x,depth+1));
      if(!Number.isInteger(n)||n<0||n>=lengths.length||values.length!==(shapes as string[][])[n].length)throw new Error('Invalid Figma row');
      budget-=lengths[n];return Object.fromEntries((shapes as string[][])[n].map((k,i)=>[k,expand(values[i],depth+1)]));
    }
    const result=expand(data,0);if(budget<0)throw new Error('Expanded Figma rows exceed input budget');return result;
  }
  if (!raw || typeof raw !== 'object' || (raw as { encoding?: unknown }).encoding !== 'uxqa-json-dictionary-v1') return raw;
  const { dictionary, payload } = raw as { dictionary: unknown; payload: unknown };
  if (!Array.isArray(dictionary) || dictionary.length > 20000 || dictionary.some(x => typeof x !== 'string' || x.length > 100000) || typeof payload !== 'string') throw new Error('Invalid Figma transport dictionary');
  let expandedLength = payload.length;
  const expanded = payload.replace(/"(?:\\.|[^"\\])*"|@(\d+)/g, (token, reference: string | undefined) => {
    if (reference === undefined) return token;
    const value = dictionary[Number(reference)]; if (typeof value !== 'string') throw new Error('Invalid Figma transport reference');
    const replacement = JSON.stringify(value); expandedLength += replacement.length - token.length;
    if (expandedLength > 2 * 1024 * 1024) throw new Error('Expanded Figma chunk exceeds 2 MiB');
    return replacement;
  });
  if (expandedLength > 2 * 1024 * 1024) throw new Error('Expanded Figma chunk exceeds 2 MiB');
  return JSON.parse(expanded);
}
