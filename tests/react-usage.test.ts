import { describe, expect, it } from 'vitest';
import { summarizeReactUsage } from '../src/components/react-usage.js';

const instance = (file: string, props: Record<string,unknown>, spread = false, module = '@acme/ui') => ({
  importInfo:{moduleName:module,imported:'Button'},props,propsSpread:spread,
  location:{file:`/snapshot/${file}`,start:{line:12}},
});

describe('React reuse and attribute patterns', () => {
  it('counts cross-file reuse, distinct literal values, and unknown spread attributes separately', () => {
    const report = {Button:{instances:[
      instance('one.tsx',{size:{kind:'literal',value:'small'},disabled:{kind:'shorthand',value:true}}),
      instance('two.tsx',{size:{kind:'literal',value:'large'},onClick:{kind:'expression',value:'(ArrowFunctionExpression)'}}),
      instance('two.tsx',{},true),
    ]}};
    const result = summarizeReactUsage(report,'/snapshot');
    expect(result.components[0]).toMatchObject({count:3,fileCount:2,spreadInstances:1});
    expect(result.components[0].propPatterns.find((pattern) => pattern.prop==='size')).toMatchObject({
      supplied:2,missing:0,spreadUnknown:1,dynamic:0,
      values:expect.arrayContaining([{kind:'literal',value:'small',count:1},{kind:'literal',value:'large',count:1}]),
    });
    expect(result.components[0].propPatterns.find((pattern) => pattern.prop==='onClick')?.dynamic).toBe(1);
    expect(result.reuse.sharedComponents).toBe(1);
  });

  it('flags same names from different modules for review without merging their usage', () => {
    const result = summarizeReactUsage({Button:{instances:[instance('a.tsx',{}),instance('b.tsx',{},false,'@other/ui')]}},'/snapshot');
    expect(result.components).toHaveLength(2);
    expect(result.importConflicts).toEqual([expect.objectContaining({name:'Button',modules:['@acme/ui','@other/ui']})]);
  });
});
