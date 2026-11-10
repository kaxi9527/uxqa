import { createInterface } from 'node:readline/promises';
import { browserInfo, formatBytes, installBrowser, type BrowserInfo, type BrowserKind } from './install.js';

function describe(info: BrowserInfo): string {
  const lines = [`浏览器组件：${info.ready ? '已就绪' : '还没有下载'}`, `  用途：${info.purpose}`, `  位置：${info.location}`];
  if (!info.ready) {
    for (const file of info.files) lines.push(`  文件：${file.name}（${formatBytes(file.bytes)}）`, `  来源：${file.url}${file.servedBy ? `（实际从 ${file.servedBy} 下载）` : ''}`);
    lines.push(`  合计：${info.totalBytes ? formatBytes(info.totalBytes) : '大小未知'}`);
  }
  return lines.join('\n');
}

/** `uxqa browser [install] [--login] [--yes]`: shows what the screenshot browser is, and downloads it only after a yes. */
export async function runBrowserCommand(argv: string[]): Promise<number> {
  const kind: BrowserKind = argv.includes('--login') ? 'chromium' : 'shell';
  if (argv.includes('--help')) {
    console.log('用法：\n  uxqa browser              看浏览器组件在不在、下载的话要下什么\n  uxqa browser install      下载（先显示文件名、来源、大小，确认后才下载）\n    --yes                   不再询问，直接下载\n    --login                 换成带窗口的浏览器（"打开浏览器登录"用）');
    return 0;
  }
  const info = await browserInfo(kind);
  console.log(describe(info));
  if (argv[0] !== 'install') {
    if (!info.ready) console.log('\n要下载请运行：uxqa browser install');
    return 0;
  }
  if (info.ready) return 0;
  if (!argv.includes('--yes')) {
    if (!process.stdin.isTTY) { console.error('\n没有确认，所以没有下载。确认要下载请加 --yes。'); return 1; }
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await prompt.question('\n同意下载吗？输入 y 回车开始，其他键取消：')).trim().toLowerCase();
    prompt.close();
    if (answer !== 'y' && answer !== 'yes') { console.log('已取消，没有下载任何东西。'); return 1; }
  }
  let last = '';
  const result = await installBrowser(kind, (state) => { if (state.message !== last) { last = state.message; console.log(state.message); } });
  if (result.state === 'done') return 0;
  console.error(`${result.message}：${result.error ?? '原因不明'}`);
  return 1;
}
