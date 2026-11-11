import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiagnosisContext } from './diagnostics.js';
import { ENGLISH_STACK_CHECKS } from './context.en.js';

export const STACK_KNOWLEDGE = [
  { id: 'react', name: 'React', packages: ['react'], checks: ['检查列表身份、条件渲染与输入状态，切换数据时焦点和用户输入不应错位。', '针对实际慢交互测量更新范围与渲染开销，再提出优化；核对副作用清理。'] },
  { id: 'next', name: 'Next.js', packages: ['next'], checks: ['检查服务器输出与客户端接管后的内容、布局和可交互状态是否一致。', '路由加载、错误、返回和重试分别重现，核对是否丢失用户任务上下文。'] },
  { id: 'astro', name: 'Astro', packages: ['astro'], checks: ['核对交互区域激活前后可访问名称、焦点及加载反馈。', '检查页面导航和局部交互的生命周期，未激活区域不能呈现假可用操作。'] },
  { id: 'vue', name: 'Vue', packages: ['vue'], checks: ['切换列表、条件内容和组件状态，核对身份、输入绑定与焦点恢复。', '验证过渡中断、异步状态和组件卸载后的清理，记录实际行为而非猜测。'] },
  { id: 'nuxt', name: 'Nuxt', packages: ['nuxt'], checks: ['检查初次渲染、客户端接管和路由导航的状态一致性。', '验证数据失败、重试、缓存恢复和权限变化后的页面出口。'] },
  { id: 'nuxt-ui', name: 'Nuxt UI', packages: ['@nuxt/ui'], checks: ['复用项目现有组件、语义颜色和尺寸变体，核对主题切换和无障碍状态。', '对浮层、表单和导航验证真实键盘行为，不凭库名推定通过。'] },
  { id: 'svelte', name: 'Svelte', packages: ['svelte'], checks: ['在数据替换、列表重排和组件销毁时检查状态、焦点及事件清理。', '验证进入、退出及布局过渡的连续触发和取消结果。'] },
  { id: 'swiftui', name: 'Swift / SwiftUI', packages: [], checks: ['按工程实际架构核对状态生命周期、异步取消和视图身份；只输出诊断及修改方案。', '在目标设备核对动态字体、辅助功能、减少动态、软键盘与系统返回。'] },
  { id: 'react-native', name: 'React Native / Expo', packages: ['react-native', 'expo'], checks: ['用目标设备检查安全区、键盘、滚动与手势竞争，网页截图不能作为通过证据。', '采集输入与动画的帧表现，检查取消、释放速度、连续接手及必要触感。'] },
  { id: 'flutter', name: 'Flutter', packages: [], checks: ['检查布局约束、文字缩放、语义与焦点，覆盖目标设备的尺寸与方向。', '用性能分析验证构建和动画开销，检查路由、取消与生命周期恢复。'] },
  { id: 'html-tailwind', name: 'HTML / Tailwind', packages: ['tailwindcss'], checks: ['核对语义元素、可访问名称和响应式规则，避免工具类掩盖状态与组件重复。', '样式修改按项目已有 Token 和断点验证，覆盖长内容与键盘使用。'] },
  { id: 'shadcn', name: 'shadcn 组件体系', packages: ['shadcn', 'shadcn-ui'], checks: ['以项目现有组件源码和变体为准，不把上游最新默认值强行套用。', '检查组合组件的焦点、错误状态与主题，提出修改时列出受影响调用方。'] },
  { id: 'compose', name: 'Jetpack Compose', packages: [], checks: ['按当前工程核对状态保存、异步生命周期和界面重建后的任务连续性。', '在 Android 设备验证字体缩放、TalkBack、键盘、系统返回和手势边界。'] },
  { id: 'angular', name: 'Angular', packages: ['@angular/core'], checks: ['核对表单校验、加载/错误反馈、列表身份与焦点变化。', '针对实际慢交互检查更新范围、异步订阅和销毁清理，并运行工程已有验证。'] },
  { id: 'laravel', name: 'Laravel 前端', packages: ['laravel-vite-plugin'], checks: ['检查服务器校验、前端提示及重试行为是否一致，失败后保留输入。', '针对实际使用的模板或交互层验证局部更新、焦点与返回状态。'] },
  { id: 'threejs', name: 'Three.js', packages: ['three'], checks: ['为画布交互提供可访问说明与替代路径，核对触屏和键盘操作。', '测量目标设备的渲染、资源与交互开销，验证离开页面和减少动态后的行为。'] },
  { id: 'javafx', name: 'JavaFX', packages: [], checks: ['核对 UI 更新、异步任务与取消路径，避免响应反馈依赖阻塞操作。', '在目标桌面系统验证键盘、焦点、缩放、字体与窗口变化。'] },
  { id: 'wpf', name: 'WPF', packages: [], checks: ['检查绑定、校验与命令可用状态，验证异步结束后是否仍对应当前页面。', '在不同 DPI、窗口尺寸和键盘流程下核对布局、焦点与高对比状态。'] },
  { id: 'winui', name: 'WinUI', packages: [], checks: ['核对导航、状态恢复、主题及窗口尺寸变化，检查系统约定与项目组件一致性。', '在目标 Windows 环境验证键盘、缩放、辅助功能与异步反馈。'] },
  { id: 'uwp', name: 'UWP', packages: [], checks: ['核对页面生命周期、返回与恢复后的任务状态，不凭启动成功判定完成。', '在目标输入方式和窗口尺寸下检查焦点、主题与可访问操作。'] },
  { id: 'avalonia', name: 'Avalonia', packages: [], checks: ['逐个目标系统核对布局、字体、输入和焦点，记录平台差异。', '检查绑定、校验、异步反馈和窗口生命周期，提出方案后要求对应工程测试。'] },
  { id: 'uno', name: 'Uno Platform', packages: [], checks: ['按实际目标平台验证导航、输入、窗口和辅助功能，不能以单平台截图代替全平台。', '检查共享 UI 与平台适配边界，修复方案明确哪些行为需要分别验证。'] },
];

export async function diagnosisContext(root: string, locale: 'zh' | 'en' | null = null): Promise<DiagnosisContext> {
  let packageData: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; scripts?: Record<string, unknown> } = {};
  const notes: string[] = [];
  try { packageData = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') notes.push(locale === 'en' ? 'The project package.json could not be read or parsed; check the project configuration.' : '项目 package.json 未能读取或解析；先核对工程配置。'); }
  const packages = Object.keys({ ...packageData?.dependencies, ...packageData?.devDependencies });
  const files = await readdir(root);
  const selected = new Set(STACK_KNOWLEDGE.filter((item) => item.packages.some((name) => packages.includes(name))).map((item) => item.id));
  if (files.includes('components.json')) selected.add('shadcn');
  if (files.some((name) => name.endsWith('.html'))) selected.add('html-tailwind');
  if (files.includes('Package.swift') || files.some((name) => name.endsWith('.xcodeproj'))) selected.add('swiftui');
  const nativeInputs = files.filter((name) => /^(pubspec\.yaml|composer\.json|pom\.xml|build\.gradle(?:\.kts)?)$|\.(csproj|fsproj)$/.test(name));
  for (const file of nativeInputs) {
    const text = await readFile(join(root, file), 'utf8');
    for (const [id, pattern] of [['flutter', /flutter/], ['laravel', /laravel/], ['compose', /compose/], ['javafx', /javafx/], ['wpf', /UseWPF/], ['winui', /WinUI|WindowsAppSDK/], ['uwp', /UniversalWindowsPlatform/], ['avalonia', /Avalonia/], ['uno', /Uno\./]] as const) if (pattern.test(text)) selected.add(id);
  }
  const stacks = STACK_KNOWLEDGE.filter((item) => selected.has(item.id));
  return { stacks: stacks.map((item) => item.name), checks: [...notes, ...stacks.flatMap((item) => (locale === 'en' ? ENGLISH_STACK_CHECKS[item.id] : item.checks).map((check) => `${item.name}${locale === 'en' ? ': ' : '：'}${check}`))], scripts: Object.keys(packageData?.scripts ?? {}).filter((name) => /^(test|typecheck|lint|check|build)(:|$)/.test(name)) };
}
