import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCheck, type CheckResult } from '../src/check/run.js';
import { family } from '../src/check/variants.js';

let product: string;
let result: CheckResult;

const BUTTON = `import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex items-center rounded-md text-sm", {
  variants: {
    variant: { default: "bg-primary text-white hover:bg-primary/90", outline: "border bg-white hover:bg-muted", ghost: "hover:bg-muted" },
    size: { default: "h-9 px-4", sm: "h-8 px-3" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button() { return <button className={buttonVariants({})} />; }
`;

const PAGE = `export function Toolbar() {
  return (
    <div>
      <button className="border bg-white h-8 px-3">筛选</button>
      <button className="text-gray-500 hover:bg-muted">更多</button>
      <button className="bg-orange-500 text-white h-9 px-4 rounded-full">立即抢购</button>
      <button className="bg-primary text-white h-9 px-4 w-full text-left">保存</button>
      <button onClick={() => {}}>没有样式</button>
    </div>
  );
}
`;

beforeAll(async () => {
  product = await mkdtemp(join(tmpdir(), 'uxqa-variants-'));
  await cp(resolve('examples/check-fixture'), product, { recursive: true });
  await writeFile(join(product, 'src/components/ui/button.tsx'), BUTTON);
  await writeFile(join(product, 'src/pages/Toolbar.tsx'), PAGE);
  result = await runCheck({ source: product, files: [join(product, 'src/pages/Toolbar.tsx')] });
});

afterAll(async () => { await rm(product, { recursive: true, force: true }); });

const at = (line: number) => result.violations.find((violation) => violation.rule === 'basic/use-library-component' && violation.line === line)!;

describe('matching hand-written styling to library style options', () => {
  it('sorts class names into kinds of styling', () => {
    expect(['text-sm', 'text-white', 'text-left', 'hover:bg-muted', 'px-3', 'rounded-md'].map(family)).toEqual(['text-size', 'text-color', 'text-align', 'hover:bg', 'px', 'rounded']);
  });

  it('names the exact existing options when they already give this look', () => {
    expect(at(4).suggestion!.props).toEqual({ variant: 'outline', size: 'sm' });
    expect(at(4).fix).toBe('换成组件库里的 <Button variant="outline" size="sm">（颜色和尺寸用现有的样式选项就行）。');
  });

  it('keeps small adjustments in className instead of asking for a new option', () => {
    expect(at(7).suggestion!.missing).toBeUndefined();
    expect(at(7).fix).toContain('<Button>，text-left w-full 这类小调整写在它的 className 上');
  });

  it('picks the plain option for a button without a background', () => {
    expect(at(5).suggestion!.props).toMatchObject({ variant: 'ghost' });
  });

  it('proposes adding one option to the library when none gives the look, never styling the page by hand', () => {
    const fix = at(6).fix;
    expect(at(6).suggestion!.missing).toEqual(['bg-orange-500']);
    expect(fix).toContain('src/components/ui/button.tsx 的 buttonVariants 里给 variant 加一个新选项');
    expect(fix).toContain('不要在页面里手写样式');
  });

  it('does not claim a match when there is no styling to compare', () => {
    expect(at(8).suggestion!.props).toBeUndefined();
    expect(at(8).fix).toContain('换成组件库里的 Button');
  });
});
