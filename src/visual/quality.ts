import type { Page } from 'playwright';

export type QualityKind = 'card-density' | 'unnamed-control' | 'unlabelled-field' | 'heading-order' | 'transition-all' | 'layout-animation' | 'reduced-motion';
export interface QualityIssue {
  kind: QualityKind; key: string; label: string; text: string; detail: string;
  box: { x: number; y: number; width: number; height: number };
}

// UXQA's native observations. Advisory findings describe measured structure, not an aesthetic verdict.
const SCRIPT = `(motionOnly) => {
  const issues = [];
  const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.01; };
  const key = e => { const parts=[]; for(let n=e;n && n!==document.body;n=n.parentElement) { parts.unshift(n.tagName.toLowerCase()+':'+[...n.parentElement.children].indexOf(n)); } return parts.join('>'); };
  const name = e => e.getAttribute('aria-label')?.trim() || (e.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ').trim() || (e.labels ? [...e.labels].map(l => l.textContent).join(' ').trim() : '') || e.getAttribute('title')?.trim() || '';
  const add = (kind,e,detail) => { const r=e.getBoundingClientRect(); issues.push({kind,key:key(e),label:e.tagName.toLowerCase(),text:(e.innerText || e.getAttribute('placeholder') || '').trim().slice(0,80),detail,box:{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}}); };
  if (!motionOnly) {
    for(const e of document.querySelectorAll('button,[role=button],a[href]')) {
      if(!visible(e))continue;
      const ownName = name(e) || (e.innerText || e.textContent || '').trim() || [...e.querySelectorAll('img[alt]')].map(i=>i.alt).join('').trim();
      if(!ownName) add('unnamed-control',e,'可见操作没有可访问名称');
    }
    for(const e of document.querySelectorAll('input:not([type=hidden]):not([type=button]):not([type=submit]):not([type=reset]):not([type=image]),select,textarea')) {
      if(visible(e) && !name(e)) add('unlabelled-field',e,'没有关联标签或可访问名称；placeholder 不代替标签');
    }
    let previous=0;
    for(const e of document.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
      if(!visible(e)) continue;
      const level=Number(e.tagName.slice(1));
      if(previous && level>previous+1) add('heading-order',e,'H'+previous+' 之后直接出现 H'+level);
      previous=level;
    }
    for(const e of document.querySelectorAll('body *')) {
      if(!visible(e) || e.closest('[data-uxqa-overlay]'))continue;
      const s=getComputedStyle(e);
      if(s.display==='grid' && s.gridTemplateColumns.split(' ').length>=3) {
        const children=[...e.children].filter(visible);
        if(children.length>=12 && children.every(c=>c.querySelector('h2,h3,h4') && c.querySelector('button,a'))) add('card-density',e,children.length+' 个同层级条目以多列卡片平铺');
      }
      if(s.transitionProperty.split(',').some(p=>p.trim()==='all') && s.transitionDuration.split(',').some(d=>parseFloat(d)>0)) add('transition-all',e,'transition-property: all; duration: '+s.transitionDuration);
    }
  }
  const seen=new Set();
  for(const animation of document.getAnimations()) {
    const e=animation.effect?.target;
    if(!(e instanceof Element) || !visible(e) || animation.playState!=='running')continue;
    const frames=animation.effect.getKeyframes(), timing=animation.effect.getTiming();
    const moving=frames.some(f=>Object.keys(f).some(p=>/^(transform|translate|rotate|scale|left|right|top|bottom|width|height)$/.test(p)));
    const layout=frames.some(f=>Object.keys(f).some(p=>/^(left|right|top|bottom|width|height|margin|padding)/.test(p)));
    const kind=motionOnly ? 'reduced-motion' : 'layout-animation';
    if((motionOnly ? moving && Number(timing.duration)>=250 : layout) && !seen.has(kind+key(e))) {
      seen.add(kind+key(e)); add(kind,e,motionOnly ? '减少动态效果已启用，仍观察到 '+timing.duration+'ms 的位移/缩放动画' : '运行中的关键帧修改布局属性；需测量实际帧表现');
    }
  }
  return issues;
}`;

export async function inspectQuality(page: Page, checkMotionPreference = false): Promise<QualityIssue[]> {
  const issues = await page.evaluate(`(${SCRIPT})(false)`) as QualityIssue[];
  if (checkMotionPreference) {
    const wasReduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(80);
      issues.push(...await page.evaluate(`(${SCRIPT})(true)`) as QualityIssue[]);
    } finally { await page.emulateMedia({ reducedMotion: wasReduced ? 'reduce' : 'no-preference' }); }
  }
  return issues;
}

export function qualityDescription(issue: QualityIssue) {
  const copy: Record<QualityKind, [string, string, string]> = {
    'card-density': ['大量同权重卡片需要核对阅读顺序', '重复容器可能使查找和比较变慢；这是一项结构建议，不直接判定设计失败。', '先按任务或主题分组；比较型内容考虑列表，次要资料收进详情。用真实查找任务验证。'],
    'unnamed-control': ['操作控件缺少名称', '键盘或读屏用户无法判断这个操作的目的。', '用可见文字或准确的 aria-label 命名操作；窄屏隐藏文字后保留可访问名称。'],
    'unlabelled-field': ['输入项缺少标签', '输入后占位文字消失，用户难以判断字段用途。', '关联可见 label；确需隐藏标签时保留准确的可访问名称。'],
    'heading-order': ['标题层级跳跃', '按标题浏览时，内容结构可能难以理解。', '按内容关系使用连续标题层级，字号样式独立设置。'],
    'transition-all': ['过渡覆盖了所有属性', '后续布局变化可能被意外动画化；此结果不等于已经发生卡顿。', '只声明需要过渡的属性，并用连续操作检查中断与最终状态。'],
    'layout-animation': ['动画正在改变布局属性', '布局工作可能增加帧开销；是否掉帧需要性能测量。', '先测量开销；适用时用 transform 表达位移与缩放，并验证布局和交互结果。'],
    'reduced-motion': ['减少动态效果下仍有明显运动', '用户已选择减弱动态，但当前页面仍播放较长的位移或缩放。', '为减弱动态模式取消非必要位移，保留即时状态反馈；必要动效按项目要求单独确认。'],
  };
  const [name, consequence, fix] = copy[issue.kind];
  return { name, what: issue.detail, consequence, fix };
}
