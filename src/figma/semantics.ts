// Shared by the local checker and the generated Plugin API scripts. Keep these functions self-contained.
export function inventoryFingerprint(ids: string[]): string {
  const input = JSON.stringify([...ids].sort());
  let a = 2166136261, b = 5381;
  for (let i=0;i<input.length;i++) {a=Math.imul(a^input.charCodeAt(i),16777619);b=Math.imul(b,33)^input.charCodeAt(i);}
  return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+':'+input.length;
}

export function disabledProperties(properties: Record<string,unknown>): boolean {
  return Object.entries(properties).some(([name,raw])=>{
    const key=name.split('#')[0].trim();
    const value=String(raw && typeof raw==='object' && 'value' in raw ? raw.value : raw).trim();
    if (/^(disabled|isDisabled|禁用|是否禁用|禁用状态)$/i.test(key)) return /^(true|yes|on|是|开|开启|disabled|禁用)$/i.test(value);
    if (/^(enabled|isEnabled|启用|是否启用)$/i.test(key)) return /^(false|no|off|否|关|关闭)$/i.test(value);
    return /^(state|status|状态|交互状态)$/i.test(key) && /^(disabled|inactive|禁用|已禁用|不可用)$/i.test(value);
  });
}

export function contentFingerprint(value: Record<string,unknown>): string {
  const {contentFingerprint: _stored,...body}=value;
  const json=JSON.stringify(body);let a=2166136261,b=5381;
  for(let i=0;i<json.length;i++){a=Math.imul(a^json.charCodeAt(i),16777619);b=Math.imul(b,33)^json.charCodeAt(i);}
  return (a>>>0).toString(16)+'-'+(b>>>0).toString(16)+':'+json.length;
}
