'use strict';

// ---------- basics ----------
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('t') || sessionStorage.getItem('uxqa-token') || '';
if (params.get('t')) { sessionStorage.setItem('uxqa-token', token); history.replaceState(null, '', `${location.pathname}${location.search}`); }
// Opening the start link in a tab already on this page only changes the hash: reload to pick up the new token.
window.addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).get('t')) location.reload(); });

const LEVEL = { get must() { return accessText('需要改', 'Must fix'); }, get default() { return accessText('建议改', 'Should fix'); }, get reference() { return accessText('可以看看', 'Advisory'); } };
const PAGE_SIZE = 80;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers: { 'x-uxqa-token': token, ...(options.body ? { 'content-type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    const error = new Error(data.error || accessText(`请求失败（${response.status}）`, `Request failed (${response.status})`));
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function append(element, children) {
  for (const child of [children].flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

function h(tag, attrs, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2), value);
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  return append(element, children);
}

/** replaceChildren that skips empty slots instead of printing "null". */
function fill(element, ...children) {
  element.replaceChildren();
  return append(element, children);
}

const ICONS = {
  gear: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z'],
  plus: ['M12 5v14', 'M5 12h14'],
  play: ['M7 5l12 7-12 7z'],
  copy: ['M9 9h11v11H9z', 'M5 15V5a1 1 0 0 1 1-1h10'],
  search: ['M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z', 'M20 20l-4-4'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  back: ['M15 6l-6 6 6 6'],
  image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4'],
  code: ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  check: ['M5 12l5 5 9-10'],
  scan: ['M4 8V5a1 1 0 0 1 1-1h3', 'M16 4h3a1 1 0 0 1 1 1v3', 'M20 16v3a1 1 0 0 1-1 1h-3', 'M8 20H5a1 1 0 0 1-1-1v-3', 'M4 12h16'],
  info: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 11v5', 'M12 8h.01'],
  file: ['M7 3h7l5 5v13H7z', 'M14 3v5h5'],
  wand: ['M5 19L17 7', 'M15 5l4 4', 'M19 13v2', 'M18 14h2', 'M9 3v2', 'M8 4h2'],
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name] || []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

function toast(message) {
  const root = document.getElementById('toast');
  const item = h('div', { text: message });
  root.append(item);
  setTimeout(() => item.remove(), 3200);
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast(accessText(`已复制${what}`, `Copied ${what}`));
  } catch {
    const area = h('textarea', { class: 'sr-only' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    toast(ok ? accessText(`已复制${what}`, `Copied ${what}`) : accessText('复制失败，请手动选中文字复制', 'Copy failed; select and copy the text manually.'));
  }
}

function timeText(iso) {
  const date = new Date(iso);
  if (accessSettings.locale === 'en') return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const AVATARS = [['#e8f0fb', '#224f8f'], ['#e5f3ea', '#23663e'], ['#fbf2dd', '#7a5200'], ['#f1e9fb', '#5b2a86'], ['#fbeae9', '#9c2a26'], ['#e6f4f4', '#1f5f60']];
function avatar(name) {
  let sum = 0;
  for (const char of name) sum += char.codePointAt(0);
  const [bg, fg] = AVATARS[sum % AVATARS.length];
  const element = h('span', { class: 'avatar', 'aria-hidden': 'true', text: [...name][0].toUpperCase() });
  element.style.background = bg;
  element.style.color = fg;
  return element;
}

// ---------- overlays: modal sheet and side drawer (focus stays inside, Escape closes, focus returns) ----------
function openOverlay(build, { kind = 'sheet', label, dismissible = true } = {}) {
  return new Promise((resolve) => {
    const trigger = document.activeElement;
    const root = document.getElementById('overlay-root');
    const background = [...document.querySelectorAll('body > .skip, body > .app')];
    const close = (value) => {
      root.replaceChildren();
      for (const element of background) element.inert = false;
      document.removeEventListener('keydown', onKey, true);
      if (trigger && trigger.isConnected && trigger.focus) trigger.focus();
      resolve(value);
    };
    const panel = h('div', { class: kind === 'drawer' ? 'drawer' : 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
    build(panel, close);
    const wrap = h('div', { class: kind === 'drawer' ? 'drawer-wrap' : 'backdrop', onclick: (event) => { if (dismissible && event.target === wrap) close(false); } }, panel);
    function onKey(event) {
      if (event.key === 'Escape' && dismissible) { event.preventDefault(); close(false); }
      if (event.key === 'Tab') {
        const items = [...panel.querySelectorAll('button, [href], input, textarea, select')];
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    root.replaceChildren(wrap);
    // Everything behind the dialog is out of reach for Tab, clicks and screen readers until it closes.
    for (const element of background) element.inert = true;
    const focusTarget = panel.querySelector('[data-autofocus]') || panel.querySelector('button, input, textarea, select');
    if (focusTarget) focusTarget.focus();
  });
}

function confirmSheet({ title, body, confirmText, cancelText = accessText('取消', 'Cancel') }) {
  return openOverlay((panel, close) => {
    append(panel, [
      h('h2', { text: title }), body,
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', 'data-autofocus': true, onclick: () => close(false) }, cancelText),
        h('button', { class: 'btn primary', type: 'button', onclick: () => close(true) }, confirmText)),
    ]);
  }, { label: title });
}

// ---------- browser component (downloaded only after the person agrees) ----------
const OFFICIAL_HOSTS = ['cdn.playwright.dev', 'playwright.download.prss.microsoft.com', 'playwright.azureedge.net'];
const mib = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)} MiB` : accessText('大小未知', 'Size unknown'));

function browserFacts(info) {
  const official = info.files.every((file) => OFFICIAL_HOSTS.includes(new URL(file.url).host));
  return h('ul', { class: 'facts' },
    h('li', {}, h('b', { text: accessText('用途：', 'Purpose: ') }), accessText(info.purpose, info.kind === 'shell' ? 'Background browser for screenshots and page checks' : 'Browser window for signing in to your product')),
    h('li', {}, h('b', { text: accessText('文件：', 'Files: ') }), info.files.map((file, index) => [index ? ', ' : '', h('span', { class: 'mono', text: file.name }), ` (${mib(file.bytes)})`])),
    h('li', {}, h('b', { text: accessText('来源：', 'Source: ') }), h('span', { class: 'mono', text: info.source }), official ? accessText('（Playwright 官方下载地址）', ' (official Playwright download)') : accessText('（你设置的下载镜像）', ' (your configured mirror)'), info.servedBy ? [accessText('，实际从 ', ', served by '), h('span', { class: 'mono', text: info.servedBy })] : ''),
    h('li', {}, h('b', { text: accessText('保存到：', 'Location: ') }), h('span', { class: 'mono', text: info.location })),
    h('li', {}, h('b', { text: accessText('合计：', 'Total: ') }), info.totalBytes ? mib(info.totalBytes) : accessText('大小未知（连不上下载地址时读不到大小）', 'Unknown (download source could not report its size)'), accessText('。下载一次，以后不用再下。', '. This component can be reused after download.')));
}

/** Shows what would be downloaded and waits for a clear yes. Resolves 'installed', 'skip' (go on without screenshots) or false. */
function browserSheet(info, { purpose = 'check' } = {}) {
  const title = purpose === 'login' ? accessText('打开登录窗口需要先下载浏览器组件', 'Download the browser component to sign in') : accessText('给页面截图需要先下载浏览器组件', 'Download the browser component for screenshots');
  return openOverlay((panel, close) => {
    const skipText = purpose === 'login' ? accessText('先不下', 'Not now') : accessText('先不下，只检查源码', 'Not now, check source only');
    const ask = () => fill(panel,
      h('h2', { text: title }),
      h('p', { text: accessText('uxqa 要用一个浏览器打开你的页面。它比较大，所以没有放进安装包，第一次用到时才下载，下载前先问你。', 'UXQA uses a browser to open your pages. It is downloaded separately when first needed, with your permission.') }),
      browserFacts(info),
      h('div', { class: 'notice', role: 'note', text: purpose === 'login' ? accessText('不下载的话，也可以在"页面地址"里填一个已有的登录状态文件。', 'You can instead enter an existing login state file under Page URLs.') : accessText('不下载也可以：源码检查照常进行，只是这一轮没有截图和页面检查。', 'You can continue with source checks; this round will not include screenshots or page checks.') }),
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', 'data-autofocus': true, onclick: () => close('skip') }, skipText),
        h('button', { class: 'btn primary', type: 'button', onclick: download }, accessText('同意下载', 'Download'))));
    const download = async () => {
      const bar = h('span', {});
      const meter = h('span', { class: 'dl-bar', role: 'progressbar', 'aria-label': accessText('下载进度', 'Download progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar);
      const message = h('p', { class: 'muted', role: 'status', text: accessText('正在开始下载…', 'Starting download…') });
      fill(panel, h('h2', { text: accessText('正在下载浏览器组件', 'Downloading browser component') }), browserFacts(info), meter, message,
        h('div', { class: 'row' }, h('span', { class: 'grow faint', text: accessText('可以先关掉这个窗口，下载会在后台继续。', 'You can close this window while the download continues.') }), h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, accessText('关闭', 'Close'))));
      let install;
      try { install = (await api('/browser/install', { method: 'POST', body: { kind: info.kind, confirm: true } })).install; }
      catch (error) { install = error.data && error.data.install ? error.data.install : { state: 'failed', error: error.message, percent: 0 }; }
      while (install && install.state === 'running' && panel.isConnected) {
        bar.style.width = `${Math.max(3, install.percent)}%`;
        meter.setAttribute('aria-valuenow', String(install.percent));
        message.textContent = install.message;
        await new Promise((resolve) => setTimeout(resolve, 700));
        try { install = (await api('/browser/install')).install; } catch (error) { install = { state: 'failed', error: error.message, percent: 0 }; }
      }
      if (!panel.isConnected) return;
      if (install && install.state === 'done') { toast(accessText('浏览器组件已下载好', 'Browser component downloaded')); close('installed'); return; }
      fill(panel, h('h2', { text: accessText('浏览器组件没有下载成功', 'Browser download failed') }),
        h('div', { class: 'notice error', role: 'alert', text: (install && install.error) || accessText('原因不明', 'Unknown error') }),
        h('p', { class: 'muted', text: accessText('网络不通时可以稍后再试；也可以设置 PLAYWRIGHT_DOWNLOAD_HOST 用镜像下载（见安装说明）。', 'Try again later if the network is unavailable, or configure PLAYWRIGHT_DOWNLOAD_HOST as described in the installation guide.') }),
        h('div', { class: 'row' }, h('span', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', 'data-autofocus': true, onclick: () => close('skip') }, skipText),
          h('button', { class: 'btn primary', type: 'button', onclick: download }, accessText('再试一次', 'Try again'))));
    };
    ask();
  }, { label: title });
}

/** Global settings panel: is the browser here, and a way to download it ahead of time. */
async function renderBrowserPanel(panel) {
  let data;
  try { data = await api('/browser'); } catch (error) { fill(panel, h('h2', { text: accessText('浏览器组件', 'Browser component') }), h('div', { class: 'notice error', text: error.message })); return; }
  const info = data.browser;
  if (info.ready) {
    fill(panel, h('h2', { text: accessText('浏览器组件', 'Browser component') }),
      h('div', { class: 'row' }, h('span', { class: 'chip ok', text: accessText('已就绪', 'Ready') }), h('span', { class: 'grow muted', text: accessText('截图和页面检查可以直接用。', 'Available for screenshots and page checks.') })),
      h('p', { class: 'faint' }, accessText('位置：', 'Location: '), h('span', { class: 'mono', text: info.location })));
    return;
  }
  fill(panel, h('h2', { text: accessText('浏览器组件', 'Browser component') }),
    h('p', { class: 'muted', text: accessText('还没有下载。只检查源码不需要它；要截图和检查页面时才需要，下载前会先问你。', 'Not downloaded. Source checks do not need it; screenshots and page checks do. UXQA asks before downloading.') }),
    browserFacts(info),
    h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: async () => { await browserSheet(info, { purpose: 'settings' }); renderBrowserPanel(panel); } }, accessText('查看并下载', 'Review and download'))));
}

// ---------- state ----------
const state = {
  projects: [],
  current: null,
  tab: 'checks',
  domain: 'all',
  issueState: 'all',
  workflow: { dispositions: {}, observations: [] },
  library: null,
  rounds: [],
  round: null,
  prompt: '',
  job: null,
  level: 'all',
  title: 'all',
  query: '',
  withShot: false,
  focusField: null,
  selected: null,
  view: 'crop',
  shown: PAGE_SIZE,
  error: '',
};

function project() { return state.projects.find((entry) => entry.id === state.current) || null; }

// ---------- rail ----------
function renderRail() {
  const rail = document.getElementById('rail');
  fill(rail,
    h('div', { class: 'rail-head' }, h('img', { class: 'logo', src: '/icon.png', alt: '' }), h('span', { class: 'brand' }, 'UXQA', h('small', { text: accessText('UI / UX / 体验检查', 'UI / UX / experience review') }))),
    h('div', { class: 'rail-label', text: accessText('项目', 'Projects') }),
    h('div', { class: 'rail-list' }, state.projects.length ? state.projects.map((entry) => {
      const last = entry.lastRound;
      return h('button', { class: 'project', type: 'button', 'data-button-wrap': 'allow', 'aria-current': entry.id === state.current && !state.global ? 'true' : 'false', title: entry.root, onclick: () => selectProject(entry.id) },
        avatar(entry.name),
        h('span', { class: 'project-text' }, h('span', { class: 'project-name ellipsis', text: entry.name }), h('span', { class: 'project-sub ellipsis', text: last ? accessText(`上次检测 ${timeText(last.at)}`, `Last checked ${timeText(last.at)}`) : accessText('还没检测过', 'Not checked yet') })),
        last ? h('span', { class: `count${last.newMust ? '' : ' zero'}`, 'aria-label': accessText(`${last.newMust} 个需要改`, `${last.newMust} must-fix issues`), text: last.newMust ? String(last.newMust) : '✓' }) : null);
    }) : h('p', { class: 'faint', text: accessText('还没有项目', 'No projects yet') })),
    h('div', { class: 'rail-foot' },
      accessSettings.checks.some((item) => item.result !== 'accessible') ? h('button', { class: 'access-alert', type: 'button', onclick: openGlobal }, accessText('项目位置不可访问，查看设置', 'A project location is unavailable. Open Settings.')) : null,
      h('button', { class: 'btn block', type: 'button', onclick: openAddProject, title: accessText('添加项目', 'Add project') }, icon('plus'), h('span', { class: 'label', text: accessText('添加项目', 'Add project') })),
      h('button', { class: `rail-settings${state.global ? ' active' : ''}`, type: 'button', 'aria-current': state.global ? 'page' : undefined, title: accessText('设置（所有项目通用）', 'Settings (all projects)'), onclick: openGlobal }, icon('gear'), h('span', { class: 'label', text: accessText('设置', 'Settings') }))));
}

function openAddProject() {
  let candidates = null;
  let scanning = false;
  let scanError = '';
  let folder = '~/Projects';
  let error = '';
  let value = '';
  let preview = '';
  return openOverlay((panel, close) => {
    const submit = async (path) => {
      let data;
      try { data = await api('/projects', { method: 'POST', body: { path } }); }
      catch (failure) { if (failure.status === 403) { try { accessSettings = await api('/access'); renderRail(); } catch {} } error = accessSettings.locale === 'en' ? (failure.status === 403 ? 'Cannot read this folder. Check system folder permissions and try again.' : 'Could not add the folder. Check that the path exists and is accessible.') : failure.message; value = path; render(); panel.querySelector('#add-path').focus(); return; }
      close(true);
      await afterAdd(data, preview);
    };
    const render = () => {
      const input = h('input', { id: 'add-path', class: 'input mono', type: 'text', placeholder: '/Users/you/Projects/my-app', autocomplete: 'off', value, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': 'add-note', oninput: (event) => { value = event.target.value; } });
      const found = candidates || [];
      fill(panel,
        h('div', { class: 'row' }, h('h2', { class: 'grow', text: accessText('添加项目', 'Add project') }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭', 'Close'), onclick: () => close(false) }, icon('close'))),
        // Found projects come first: one click is easier than typing a folder path.
        h('div', { class: 'stack-tight' },
          h('div', { class: 'row' }, h('span', { class: 'section-title grow' }, icon('scan'), scanning ? accessText('正在你电脑上找前端项目…', 'Finding frontend projects…') : candidates === null ? accessText('按需发现项目', 'Discover projects on request') : accessText(`在 ${folder} 里找到 ${found.length} 个前端项目`, `Found ${found.length} frontend projects in ${folder}`)),
            h('button', { class: 'btn small quiet', type: 'button', 'aria-disabled': scanning ? 'true' : undefined, onclick: () => { if (!scanning) scan(); } }, candidates === null ? accessText('扫描 ~/Projects', 'Scan ~/Projects') : accessText('重新扫描', 'Scan again'))),
          scanError ? h('p', { class: 'notice error', role: 'alert', text: scanError }) : null,
          h('p', { class: 'faint', text: accessText('仅在点击扫描后读取 ~/Projects；桌面、文稿、下载或其他位置请在下面手动填写。', 'Scanning reads ~/Projects only after you select it. Enter Desktop, Documents, Downloads, or another location below.') }),
          scanning || candidates === null ? null
            : found.length ? h('div', { class: 'candidates' }, found.map((candidate) => h('div', { class: 'candidate' },
              avatar(candidate.name),
              h('div', { class: 'grow' }, h('div', { class: 'ellipsis', text: candidate.name }), h('div', { class: 'faint ellipsis', title: candidate.root, text: `${candidate.why} · ${candidate.root}` })),
              candidate.added
                ? h('button', { class: 'btn small', type: 'button', onclick: () => { close(false); selectProject(candidate.id); } }, accessText('已添加，打开', 'Open project'))
                : h('button', { class: 'btn small primary', type: 'button', 'data-autofocus': !found.some((other) => !other.added && found.indexOf(other) < found.indexOf(candidate)) ? true : undefined, onclick: () => submit(candidate.root) }, accessText('添加', 'Add')))))
            : h('p', { class: 'muted', text: accessText('没找到前端项目。可以在下面写项目文件夹。', 'No frontend projects found. Enter a project folder below.') })),
        h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); submit(value); } },
          h('div', { class: 'field' },
            h('label', { for: 'add-path', text: accessText('或者写项目文件夹', 'Or enter a project folder') }), input,
            error ? h('span', { class: 'error-text', id: 'add-note', role: 'alert', text: error }) : h('span', { class: 'hint', id: 'add-note', text: accessText('有 package.json 的那一层或它下面任意一层都可以。在访达里选中文件夹按 ⌥⌘C 可以复制它的路径。', 'Enter the folder containing package.json or a folder within it. In Finder, select a folder and press Option-Command-C to copy its path.') })),
          h('div', { class: 'field' },
            h('label', { for: 'add-preview', text: accessText('本地预览地址（可不填）', 'Local preview URL (optional)') }),
            h('input', { id: 'add-preview', class: 'input', type: 'text', inputmode: 'url', placeholder: 'localhost:5173', autocomplete: 'off', value: preview, oninput: (event) => { preview = event.target.value; } }),
            h('span', { class: 'hint', text: accessText('不填也行：添加后会自动去找这个项目在本机的预览地址。', 'If omitted, UXQA looks for a running local preview after adding the project.') })),
          h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', type: 'submit' }, accessText('添加', 'Add')))));
    };
    const scan = () => {
      scanning = true;
      scanError = '';
      render();
      api('/discover', { method: 'POST', body: {} })
        .then((result) => { candidates = result.candidates; folder = result.folder || folder; })
        .catch((failure) => { candidates = []; scanError = accessSettings.locale === 'en' ? 'Could not scan this location. Check folder access and try again.' : failure.message; })
        .finally(() => { scanning = false; if (panel.isConnected) { const focused = document.activeElement && document.activeElement.id; render(); const again = focused && document.getElementById(focused); if (again) again.focus(); else (panel.querySelector('[data-autofocus]') || panel.querySelector('input'))?.focus(); } });
    };
    render();
  }, { label: accessText('添加项目', 'Add project') });
}

async function addProjectPath(path) {
  try { await afterAdd(await api('/projects', { method: 'POST', body: { path } }), ''); }
  catch (failure) { toast(failure.message); }
}

/** After a project is added: save a typed preview address, or look for the running dev server by itself. */
async function afterAdd(data, preview) {
  await loadProjects();
  let previewProblem = '';
  let found = null;
  if (preview.trim()) {
    try { await api(`/projects/${data.project.id}/settings`, { method: 'POST', body: { baseUrl: preview, routes: '/', discover: true } }); await loadProjects(); }
    catch (failure) { previewProblem = failure.message; }
  } else {
    try {
      const search = await api(`/projects/${data.project.id}/find-preview`, { method: 'POST', body: {} });
      if (search.found && search.found.sure) {
        await api(`/projects/${data.project.id}/settings`, { method: 'POST', body: { baseUrl: search.found.url, routes: '/', discover: true } });
        found = search.found.url;
        await loadProjects();
      }
    } catch { found = null; }
  }
  toast(accessText(`已添加 ${data.project.name}${data.library.library ? '' : '（没有找到组件库）'}${found ? `，自动找到预览地址 ${found}` : ''}`, `Added ${data.project.name}${data.library.library ? '' : ' (no component library found)'}${found ? `; preview found at ${found}` : ''}`));
  await selectProject(data.project.id);
  if (previewProblem) { state.tab = 'settings'; renderWorkspace(); toast(accessText(`预览地址没保存：${previewProblem}`, `Preview URL was not saved: ${previewProblem}`)); }
}

async function loadProjects() {
  state.projects = (await api('/projects')).projects;
  renderRail();
}

async function selectProject(id) {
  Object.assign(state, { global: false, current: id, tab: 'checks', domain: 'all', issueState: 'all', workflow: { dispositions: {}, observations: [] }, round: null, rounds: [], library: null, level: 'all', title: 'all', query: '', withShot: false, selected: null, shown: PAGE_SIZE, error: '' });
  renderRail();
  renderWorkspace();
  try {
    const [library, rounds] = await Promise.all([api(`/projects/${id}/library`), api(`/projects/${id}/rounds`)]);
    state.library = library;
    state.rounds = rounds.rounds;
    if (state.rounds[0]) await openRound(state.rounds[0].id, false);
  } catch (error) { state.error = error.message; toast(error.message); }
  renderWorkspace();
}

// ---------- workspace ----------
const TABS = [['checks', '检查', 'Check'], ['issues', '问题处理', 'Issues'], ['recheck', '复检', 'Recheck'], ['components', '组件库', 'Components'], ['rules', '项目规范', 'Project rules'], ['settings', '预览设置', 'Preview settings']];

function rememberPlace() {
  const query = new URLSearchParams();
  if (state.global) query.set('settings', '1');
  else {
    if (state.current) query.set('project', state.current);
    if (state.tab !== 'issues') query.set('tab', state.tab);
  }
  const next = `${location.pathname}${query.toString() ? `?${query}` : ''}`;
  if (`${location.pathname}${location.search}` !== next) history.replaceState(null, '', next);
}

function openGlobal() {
  state.global = true;
  renderRail();
  renderWorkspace();
}

/** Settings shared by every project: AI screenshot review, connecting AI assistants, where data lives. */
function renderGlobal(workspace) {
  const access = h('div', { class: 'panel' });
  const ai = h('div', { class: 'panel' }, h('h2', { text: accessText('AI 看图复核（可选）', 'AI image review (optional)') }), h('p', { class: 'muted', text: accessText('正在读取…', 'Loading…') }));
  const agent = h('div', { class: 'panel' }, h('h2', { text: accessText('连接你的 AI 助手', 'Connect an AI assistant') }), h('p', { class: 'muted', text: accessText('正在读取…', 'Loading…') }));
  const data = h('div', { class: 'panel' }, h('h2', { text: accessText('数据存放', 'Data storage') }), h('p', { class: 'muted', text: accessText('正在读取…', 'Loading…') }));
  const retention = h('div', { role: 'status' });
  const browser = h('div', { class: 'panel' }, h('h2', { text: accessText('浏览器组件', 'Browser component') }), h('p', { class: 'muted', text: accessText('正在读取…', 'Loading…') }));
  fill(workspace,
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, h('div', { class: 'title grow' }, h('h1', { text: accessText('设置', 'Settings') }), h('span', { text: accessText('这里的设置所有项目通用', 'Settings apply to all projects') })))),
    h('section', { class: 'content' }, h('div', { class: 'page settings-page' }, access, ai, agent, browser, data)));
  renderAccessPanel(access);
  renderAiPanel(ai);
  renderBrowserPanel(browser);
  api('/ai').then((info) => {
    const quote = (value) => (/[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
    const argv = [...info.mcp.args, 'mcp'];
    const claude = `claude mcp add uxqa -- ${[info.mcp.command, ...argv].map(quote).join(' ')}`;
    const codex = `[mcp_servers.uxqa]\ncommand = ${JSON.stringify(info.mcp.command)}\nargs = ${JSON.stringify(argv)}`;
    const cursor = JSON.stringify({ mcpServers: { uxqa: { command: info.mcp.command, args: argv } } }, null, 2);
    const block = (title, text, what) => h('li', {}, title, h('pre', { class: 'mono code-snippet', text }), h('button', { class: 'btn small', type: 'button', onclick: () => copy(text, what) }, icon('copy'), accessText('复制', 'Copy')));
    fill(agent, h('h2', { text: accessText('连接你的 AI 助手', 'Connect an AI assistant') }),
      h('p', { class: 'muted', text: accessText('接上以后，AI 写界面前会先查组件库、写完会自己检查；用订阅会员的 AI 助手也能帮你"看图复核"。只需要接一次：AI 助手在哪个项目里打开，就检查哪个项目。', 'Connect once so your AI assistant can find project components, run checks, and optionally review screenshots in the project where it is used.') }),
      h('ol', { class: 'howto' },
        block(accessText('Claude Code：在终端运行', 'Claude Code: run in a terminal'), claude, accessText('命令', 'command')),
        block(accessText('Codex：加到 ~/.codex/config.toml', 'Codex: add to ~/.codex/config.toml'), codex, accessText('配置', 'configuration')),
        block(accessText('Cursor 等：加到 MCP 配置（mcp.json）', 'Cursor and others: add to MCP configuration (mcp.json)'), cursor, accessText('配置', 'configuration'))),
      h('p', { class: 'faint', text: accessText('接好后可以对 AI 说："用 uxqa 检测一下页面"、"用 uxqa 复核截图"、"写按钮前先用 uxqa 找组件"。', 'After connecting, ask your assistant to check a page, review screenshots, or find an existing component.') }));
    fill(data, h('h2', { text: accessText('数据存放', 'Data storage') }),
      h('p', {}, accessText('项目列表、检测记录和 AI 设置保存在这台电脑的 ', 'Project lists, check records and AI settings are stored on this computer at '), h('code', { class: 'mono', text: info.home }), accessText(' 里，不会写进你的项目。启用 AI 看图后，截图会发送给你选择的模型服务。', ', outside your project. Optional AI review sends screenshots to your chosen model provider.')),
      h('p', { class: 'faint', text: accessText('应用截图和已登记的命令行截图保留 48 小时。运行时定期清理，关闭期间到期的在下次运行时清理；检查记录和手动另存的副本保留。', 'App screenshots and registered CLI screenshots are kept for 48 hours. Cleanup runs periodically and catches up on the next launch; check records and manually saved copies remain.') }),
      retention,
      h('p', { class: 'faint', text: accessText('保存项目规则、基线或执行组件同步时，UXQA 会按对应操作提示写入项目。', 'Saving project rules or baselines, or running component sync, can write to your project as explained by each action.') }));
    api('/screenshot-retention').then((status) => {
      if (!retention.isConnected) return;
      fill(retention, status.error ? h('p', { class: 'notice error', text: accessText(`截图清理失败，下次会重试：${status.error}`, `Screenshot cleanup failed and will be retried: ${status.error}`) }) : h('p', { class: 'faint', text: accessText(`截图清理最近检查：${timeText(status.checkedAt)}`, `Screenshot cleanup last checked: ${timeText(status.checkedAt)}`) }));
    }, (error) => { if (retention.isConnected) fill(retention, h('p', { class: 'notice error', text: error.message })); });
  }, (error) => fill(agent, h('h2', { text: accessText('连接你的 AI 助手', 'Connect an AI assistant') }), h('div', { class: 'notice error', text: error.message })));
}

function renderWorkspace() {
  rememberPlace();
  const workspace = document.getElementById('workspace');
  if (state.global) { renderGlobal(workspace); return; }
  const entry = project();
  if (!entry) {
    fill(workspace, h('div'), h('div', { class: 'content' }, h('div', { class: 'welcome' },
      h('h1', { text: accessText('从发现问题到验证修复', 'From finding issues to verifying fixes') }),
      h('p', { class: 'muted', text: accessText('检查项目，把发现的问题分成 UI、UX 和体验，结合证据处理，再复检。内置规则与知识在本地运行，AI 看图按需连接。普通检查只读项目代码。', 'Check a project, classify UI, UX and experience issues, work from evidence, then recheck. Built-in rules run locally; AI image review is optional. Ordinary checks read project source without changing it.') }),
      h('ol', { class: 'steps' },
        step(1, accessText('添加项目', 'Add a project'), accessText('填写项目文件夹，或按需扫描 ~/Projects。', 'Enter a project folder or scan ~/Projects on request.'), h('button', { class: 'btn', type: 'button', onclick: openAddProject }, icon('plus'), accessText('自己选文件夹', 'Choose a folder'))),
        step(2, accessText('预览地址（自动找）', 'Preview URL (discovered automatically)'), accessText('添加时会自动找项目在本机跑着的地址；没跑起来会告诉你用哪条命令启动。有了地址，问题就能配上截图。', 'UXQA looks for a running local preview. A preview lets checks attach screenshots.')),
        step(3, accessText('开始检测，让 AI 修', 'Run a check and address issues'), accessText('看完问题，点"让 AI 修"复制给写代码的 AI，改完再检测一次。', 'Review the findings, optionally copy them for a coding assistant, then check again.'))))));
    return;
  }
  const library = state.library;
  const chip = !library ? h('span', { class: 'chip', text: accessText('正在读取组件库…', 'Loading component library…') })
    : library.library ? h('span', { class: 'chip ok', title: accessText(`组件库目录：${library.library}`, `Component library: ${library.library}`), text: accessText(`组件库 · ${library.components} 个组件`, `Components · ${library.components}`) })
      : h('span', { class: 'chip warn', text: accessText('没有找到组件库', 'No component library found') });
  const nav = h('div', { class: 'nav', role: 'tablist', 'aria-label': accessText('项目功能', 'Project features') }, TABS.map(([id, label, english]) => h('button', {
    type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': state.tab === id ? 'true' : 'false', tabindex: state.tab === id ? '0' : '-1',
    onclick: () => { state.tab = id; renderWorkspace(); },
    onkeydown: (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const index = TABS.findIndex(([key]) => key === id);
      const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      state.tab = next; renderWorkspace(); document.getElementById(`tab-${next}`).focus();
    },
  }, accessText(label, english))));
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-row' },
      h('div', { class: 'title grow' }, h('h1', { class: 'ellipsis', text: entry.name }), h('span', { class: 'ellipsis', title: entry.root, text: entry.root })),
      chip,
      state.round ? h('button', { class: 'btn quiet', type: 'button', onclick: openPrompt }, icon('wand'), accessText('让 AI 修', 'Copy for AI')) : null,
      runner()),
    nav,
    state.error ? h('div', { class: 'notice error row', role: 'alert' }, h('span', { class: 'grow', text: state.error }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭提示', 'Dismiss message'), onclick: () => { state.error = ''; renderWorkspace(); } }, icon('close'))) : null);
  const body = h('section', { class: state.tab === 'issues' ? '' : 'content', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` });
  body.style.minHeight = '0';
  fill(workspace, topbar, body);
  if (state.tab === 'checks') renderCheckCenter(body);
  if (state.tab === 'issues') renderIssues(body);
  if (state.tab === 'recheck') renderRecheck(body);
  if (state.tab === 'components') renderComponents(body);
  if (state.tab === 'rules') renderRules(body);
  if (state.tab === 'settings') renderSettings(body);
}

function step(number, title, text, action) {
  return h('li', { class: 'step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: String(number) }), h('div', { class: 'grow' }, h('strong', { text: title }), h('p', { class: 'muted', text })), action || null);
}

function emptyState(iconName, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-box' }, h('div', { class: 'empty-icon' }, icon(iconName)), h('h2', { text: title }), h('p', { text }), action || null));
}

// ---------- running a check ----------
function runner() {
  const job = state.job;
  if (!job || job.state !== 'running') return h('button', { id: 'runner', class: 'btn primary', type: 'button', onclick: startCheck }, icon('play'), accessText('开始检测', 'Start check'));
  const percent = job.phase === 'source' ? 6 : job.phase === 'saving' ? 100 : job.total ? Math.max(8, Math.round((job.done / job.total) * 100)) : 8;
  const fillBar = h('span');
  fillBar.style.width = `${percent}%`;
  return h('div', { id: 'runner', class: 'runner', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'ellipsis', text: job.phase === 'source' ? accessText('检查源码…', 'Checking source…') : job.phase === 'pages' ? accessText(job.message, 'Checking pages…') : job.phase === 'ai' ? accessText(job.message, 'Reviewing screenshots…') : accessText('保存结果…', 'Saving results…') }),
    h('span', { class: 'bar', role: 'progressbar', 'aria-label': accessText('检测进度', 'Check progress'), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) }, fillBar),
    h('button', { type: 'button', onclick: cancelCheck }, accessText('取消', 'Cancel')));
}

function updateRunner() {
  const current = document.getElementById('runner');
  if (current) current.replaceWith(runner());
}

async function startCheck(options = {}) {
  if (state.job && state.job.state === 'running') return;
  state.error = '';
  // The first start may check whether the screenshot browser is here, which can take a few seconds.
  const slow = setTimeout(() => toast(accessText('正在准备检测…', 'Preparing check…')), 700);
  try { state.job = (await api(`/projects/${state.current}/check`, { method: 'POST', body: options.skipPages ? { skipPages: true } : undefined })).job; clearTimeout(slow); }
  catch (error) {
    clearTimeout(slow);
    if (error.status === 409 && error.data.job) state.job = error.data.job;
    else if (error.status === 409 && error.data.browser) {
      const answer = await browserSheet(error.data.browser);
      if (answer === 'installed') return startCheck();
      if (answer === 'skip') return startCheck({ skipPages: true });
      return;
    }
    else {
      if (error.status === 403) { try { accessSettings = await api('/access'); renderRail(); } catch {} }
      state.error = error.status === 403 ? accessText(error.message, 'Cannot read the project location. It may have moved, be unavailable, or have lost permission. Review access in Settings.') : error.message;
      renderWorkspace(); toast(state.error); return;
    }
  }
  updateRunner();
  pollJob(state.current);
}

async function pollJob(projectId) {
  while (state.job && state.job.state === 'running' && state.current === projectId) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    try { state.job = (await api(`/projects/${projectId}/jobs/${state.job.id}`)).job; }
    catch (error) { toast(error.message); break; }
    if (state.current === projectId) updateRunner();
  }
  if (!state.job || state.current !== projectId) return;
  const job = state.job;
  state.job = null;
  if (job.state === 'failed') {
    state.error = job.errorCode === 'EACCES' || job.errorCode === 'EPERM'
      ? accessText(`检测失败：${job.error}`, `Check failed: cannot read ${job.errorPath || 'a project file'}. Review file and folder permissions, then retry.`)
      : accessText(`检测失败：${job.error}`, `Check failed: ${job.error}`);
    renderWorkspace(); toast(state.error); updateRunner(); return;
  }
  state.rounds = (await api(`/projects/${projectId}/rounds`)).rounds;
  if (job.roundId) await openRound(job.roundId, false);
  await loadProjects();
  state.tab = 'issues';
  renderWorkspace();
  toast(job.state === 'cancelled' ? accessText('已取消，保留了已完成的部分', 'Canceled; completed results were kept') : job.phase === 'ai' && job.message ? accessText(job.message, 'AI review finished; check the results.') : accessText('检测完成', 'Check complete'));
}

/** Ask the configured vision model to look at this round's screenshots (runs in the background like a check). */
async function startReview() {
  if (state.job && state.job.state === 'running') return;
  try { state.job = (await api(`/projects/${state.current}/rounds/${state.round.id}/ai-review`, { method: 'POST' })).job; }
  catch (error) { toast(error.message); return; }
  updateRunner();
  pollJob(state.current);
}

const AI_WORD = { get real() { return accessText('AI 看图：确实有', 'AI: likely real'); }, get ['not-real']() { return accessText('AI 看图：可能是误报', 'AI: possible false positive'); }, get unsure() { return accessText('AI 看图：看不准', 'AI: uncertain'); } };

async function cancelCheck() {
  if (!state.job) return;
  try { state.job = (await api(`/projects/${state.current}/jobs/${state.job.id}/cancel`, { method: 'POST' })).job; updateRunner(); }
  catch (error) { toast(error.message); }
}

async function openRound(id, render = true) {
  const data = await api(`/projects/${state.current}/rounds/${id}`);
  state.round = data.round;
  // Rounds saved before problems had their own names fall back to the kind of problem.
  for (const violation of state.round.result.violations) if (!violation.name) violation.name = violation.title;
  state.prompt = data.prompt;
  state.promptFirst = data.promptFirst || data.prompt;
  state.prompts = data.prompts || {};
  state.review = data.review || { mode: 'off', pending: 0 };
  state.workflow = data.workflow || { dispositions: {}, observations: [] };
  state.issueStates = data.issueStates || {};
  state.shown = PAGE_SIZE;
  const fresh = freshViolations();
  if (!fresh.some((violation) => violation.fingerprint === state.selected)) state.selected = window.innerWidth > 820 && fresh[0] ? fresh[0].fingerprint : null;
  if (render) renderWorkspace();
}

function openPrompt() {
  // A short first batch works better with coding AIs; everything is one click away.
  const FIRST = 10;
  const total = state.round.result.violations.filter((violation) => violation.status === 'new').length;
  let all = total <= FIRST;
  const text = h('pre', { class: 'mono' });
  const hint = h('p', { class: 'muted' });
  const show = () => {
    text.textContent = all ? state.prompt : state.promptFirst;
    hint.textContent = all ? accessText('一次发太多，AI 容易漏改或改乱；问题多时建议分批。', 'For many findings, smaller batches can be easier to review.') : accessText(`先把最要紧的 ${FIRST} 个发给 AI，改完检测一次，再复制下一批。`, `Send the first ${FIRST} findings, recheck, then copy the next batch.`);
    for (const button of document.querySelectorAll('.drawer .seg [data-prompt-choice]')) button.setAttribute('aria-pressed', String((button.dataset.promptChoice === 'all') === all));
  };
  queueMicrotask(show);
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: accessText('给 AI 的修复提示', 'Repair prompt for AI') }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭', 'Close'), onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' },
        h('ol', { class: 'howto' },
          h('li', { text: accessText('点下面的"复制"。', 'Select Copy below.') }),
          h('li', { text: accessText('粘贴给帮你写代码的 AI（Claude Code、Cursor、Codex 等），发送。', 'Paste it into your coding assistant and send it.') }),
          h('li', { text: accessText('AI 改完后回到这里，点右上角"开始检测"，看问题有没有变少。', 'After changes, return and run another check to review the results.') })),
        total > FIRST ? h('div', { class: 'seg', role: 'group', 'aria-label': accessText('复制多少个问题', 'Number of findings to copy') },
          h('button', { type: 'button', 'data-prompt-choice': 'first', 'aria-pressed': String(!all), onclick: () => { all = false; show(); } }, accessText(`先修最重要的 ${FIRST} 个（推荐）`, `First ${FIRST} findings (recommended)`)),
          h('button', { type: 'button', 'data-prompt-choice': 'all', 'aria-pressed': String(all), onclick: () => { all = true; show(); } }, accessText(`全部 ${total} 个`, `All ${total} findings`))) : null,
        hint, text),
      h('div', { class: 'drawer-foot' }, h('span', { class: 'grow faint', text: accessText(`第 ${state.round.number} 轮`, `Round ${state.round.number}`) }), h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => copy(all ? state.prompt : state.promptFirst, accessText('修复提示', 'repair prompt')) }, icon('copy'), accessText('复制', 'Copy'))),
    ]);
  }, { kind: 'drawer', label: accessText('给 AI 的修复提示', 'Repair prompt for AI') });
}

// ---------- issues ----------
function freshViolations() {
  return state.round ? state.round.result.violations.filter((violation) => violation.status === 'new') : [];
}

function renderIssues(body) {
  if (!state.round) {
    const entry = project();
    const library = state.library;
    fill(body, h('div', { class: 'content' }, h('div', { class: 'welcome' },
      h('h1', { text: accessText('准备好了就开始检测', 'Start a check when you are ready') }),
      h('ol', { class: 'steps' },
        h('li', { class: 'step done' }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, icon('check')), h('div', { class: 'grow' }, h('strong', { text: accessText('已添加项目', 'Project added') }),
          h('p', { class: 'muted', text: library ? (library.library ? accessText(`找到了组件库 ${library.library}，共 ${library.components} 个组件。`, `Found ${library.library} with ${library.components} components.`) : accessText('没有找到组件库，只能检查写死的颜色和尺寸。可以在"规则"里指定组件库目录。', 'No component library was found. Hard-coded colors and sizes can still be checked; specify a library in Project rules.')) : accessText('正在读取组件库…', 'Loading component library…') }))),
        h('li', { class: `step${entry.pages ? ' done' : ''}` }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, entry.pages ? icon('check') : '2'), h('div', { class: 'grow' }, h('strong', { text: entry.pages ? accessText(`预览地址：${entry.pages.baseUrl}`, `Preview: ${entry.pages.baseUrl}`) : accessText('填预览地址（可选）', 'Add a preview URL (optional)') }),
          h('p', { class: 'muted', text: entry.pages ? accessText('检测时会打开这些页面截图，并把页面从宽到窄检查一遍。', 'Checks will capture these pages at multiple widths.') : accessText('不填也能检测源码；填了以后，问题会配上截图，还能检查窄屏时文字换行、没对齐这些问题。', 'Source checks work without a URL. A preview enables screenshots and narrow-screen checks.') })),
          entry.pages ? null : h('button', { class: 'btn', type: 'button', onclick: () => { state.tab = 'settings'; state.focusField = 'base-url'; renderWorkspace(); } }, accessText('去填写', 'Add preview'))),
        h('li', { class: 'step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: '3' }), h('div', { class: 'grow' }, h('strong', { text: accessText('开始检测', 'Start check') }), h('p', { class: 'muted', text: accessText('源码检查几秒钟；打开页面截图会多花一些时间，可以随时取消。', 'Source checks take a few seconds; page screenshots take longer. You can cancel at any time.') })),
          h('button', { class: 'btn primary', type: 'button', onclick: startCheck }, icon('play'), accessText('开始检测', 'Start check')))))));
    return;
  }
  const fresh = freshViolations();
  const numbered = new Map(fresh.map((violation, index) => [violation.fingerprint, index + 1]));
  const query = state.query.trim().toLowerCase();
  const hasShot = (violation) => { const capture = state.round.capture && state.round.capture.captures[violation.fingerprint]; return !!(capture && capture.shots && capture.shots.length); };
  const filtered = fresh.filter((violation) => (state.level === 'all' || violation.level === state.level)
    && (state.domain === 'all' || violation.quality?.domain === state.domain)
    && (state.issueState === 'all' || (state.workflow.dispositions[violation.fingerprint]?.state || 'open') === state.issueState)
    && (!state.withShot || hasShot(violation))
    && (!state.aiDoubt || (violation.ai && violation.ai.verdict === 'not-real'))
    && (state.title === 'all' || violation.title === state.title)
    && (!query || `${violation.file}:${violation.line} ${violation.name} ${violation.title} ${violation.what}`.toLowerCase().includes(query)));
  if (state.selected && !filtered.some((violation) => violation.fingerprint === state.selected) && window.innerWidth > 820) state.selected = filtered[0] ? filtered[0].fingerprint : null;
  const selected = fresh.find((violation) => violation.fingerprint === state.selected) || null;
  body.style.height = '100%';
  fill(body, h('div', { class: `split${selected ? ' has-selection' : ''}` }, issueList(fresh, filtered, numbered), detailPane(selected, filtered, numbered)));
}

function rowId(fingerprint) {
  return `row-${fingerprint.replace(/[^a-z0-9]/gi, '')}`;
}

function issueList(fresh, filtered, numbered) {
  const round = state.round;
  const titles = [...new Set(fresh.map((violation) => violation.title))];
  const roundSelect = h('select', { class: 'round-select', 'aria-label': accessText('选择检测轮次', 'Select check round'), onchange: (event) => openRound(event.target.value) },
    state.rounds.map((entry) => h('option', { value: entry.id, text: accessText(`第 ${entry.number} 轮 · ${timeText(entry.at)}`, `Round ${entry.number} · ${timeText(entry.at)}`), selected: entry.id === round.id })));
  const doubted = fresh.filter((violation) => violation.ai && violation.ai.verdict === 'not-real').length;
  const review = state.review || { mode: 'off', pending: 0 };
  const reviewBar = !review.pending ? null
    : review.mode === 'api' ? h('div', { class: 'tip' }, h('span', { class: 'grow', text: accessText(`有 ${review.pending} 项截图还没让 AI 看过。AI 会再看一遍，确认问题是不是真的，并找程序漏掉的问题。`, `${review.pending} screenshots are ready for AI review of existing and potentially missed findings.`) }), h('button', { class: 'btn small primary', type: 'button', onclick: startReview }, accessText('AI 看图复核', 'AI image review')))
    : review.mode === 'agent' ? h('div', { class: 'tip' }, h('span', { class: 'grow' }, accessText(`有 ${review.pending} 项截图等你的 AI 助手复核：在 Claude Code、Codex 等里说“用 uxqa 复核截图”。`, `${review.pending} screenshots are ready for review. Ask your connected assistant to review them with UXQA.`)))
    : null;
  const levelFilters = [['all', accessText(`全部 ${fresh.length}`, `All ${fresh.length}`), null], ...['must', 'default', 'reference'].map((level) => [level, `${LEVEL[level]} ${fresh.filter((violation) => violation.level === level).length}`, level])];
  const list = h('div', { class: 'issues', role: 'listbox', 'aria-label': accessText('问题列表', 'Issue list'), onkeydown: (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const index = filtered.findIndex((violation) => violation.fingerprint === state.selected);
    const next = filtered[Math.max(0, Math.min(filtered.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) selectIssue(next.fingerprint, true);
  } });
  for (const violation of filtered.slice(0, state.shown)) {
    const capture = round.capture && round.capture.captures ? round.capture.captures[violation.fingerprint] : null;
    const isSelected = violation.fingerprint === state.selected;
    list.append(h('button', {
      class: 'issue-row', type: 'button', role: 'option', 'data-button-wrap': 'allow', id: rowId(violation.fingerprint),
      'aria-selected': isSelected ? 'true' : 'false', tabindex: isSelected || (!state.selected && violation === filtered[0]) ? '0' : '-1',
      onclick: () => selectIssue(violation.fingerprint, false),
    },
      h('span', { class: 'num', text: String(numbered.get(violation.fingerprint)) }),
      h('span', { class: 'grow' }, h('div', { class: 'row-title ellipsis', title: violation.name, text: violation.name }), h('div', { class: 'row-sub ellipsis', text: `${violation.quality?.domain ? WORKFLOW_DOMAINS[violation.quality.domain] : violation.title} · ${issueStateLabel(state.workflow.dispositions[violation.fingerprint]?.state || 'open')} · ${violation.line ? `${violation.file.split('/').pop()}:${violation.line}` : violation.file}${violation.ai ? ` · ${AI_WORD[violation.ai.verdict]}` : ''}` })),
      h('span', { class: 'row-end' }, capture && capture.shots && capture.shots.length ? h('span', { title: accessText('有截图', 'Screenshot available') }, icon('image')) : null, h('span', { class: `dot ${violation.level}`, title: LEVEL[violation.level] }))));
  }
  const emptyNote = filtered.length ? null : h('p', { class: 'muted list-empty', text: fresh.length ? accessText('没有符合筛选的问题。', 'No issues match the filters.') : accessText('这一轮没有新问题。', 'No new issues in this round.') });
  const foot = (h('div', { class: 'list-foot row' },
    filtered.length > state.shown ? h('button', { class: 'btn small', type: 'button', onclick: () => { state.shown += PAGE_SIZE; renderWorkspace(); } }, accessText(`再显示 ${Math.min(PAGE_SIZE, filtered.length - state.shown)} 个`, `Show ${Math.min(PAGE_SIZE, filtered.length - state.shown)} more`)) : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'btn small quiet', type: 'button', onclick: openRoundNotes }, icon('info'), accessText('本轮说明', 'Round details'))));
  const scroller = h('div', { class: 'list-scroll' }, emptyNote, list, foot);
  return h('div', { class: 'list-pane' },
    h('div', { class: 'list-head' },
      h('div', { class: 'row' }, roundSelect),
      h('div', { class: 'delta' }, round.number > 1
        ? [accessText('比上一轮：', 'Compared with previous: '), h('span', { class: round.appeared ? 'up' : '', text: accessText(`新出现 ${round.appeared}`, `${round.appeared} new`) }), ' · ', h('span', { class: round.resolved ? 'down' : '', text: accessText(`未再检出 ${round.resolved}`, `${round.resolved} not reported`) })]
        : accessText(`检查了 ${round.filesScanned} 个文件${round.screenshots ? `，${round.screenshots} 个问题配了截图` : ''}`, `Checked ${round.filesScanned} files${round.screenshots ? `; ${round.screenshots} findings have screenshots` : ''}`)),
      round.partial ? h('div', { class: 'notice warn', role: 'status', text: round.partial }) : null,
      changedBar(round),
      reuseBar(round),
      reviewBar,
      issueWorkflowFilters(fresh),
      fresh.length && localStorage.getItem('uxqa-tip-next') !== 'hidden' ? h('div', { class: 'tip' },
        h('span', { class: 'grow' }, accessText('下一步：点右上角“复制给 AI”复制修复提示；修改后再检测，确认问题变化。', 'Next, select “Copy for AI” to copy a repair prompt. Run another check after changes to review the results.')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('不再提示', 'Dismiss tip'), onclick: () => { localStorage.setItem('uxqa-tip-next', 'hidden'); renderWorkspace(); } }, icon('close'))) : null,
      h('div', { class: 'filters', role: 'group', 'aria-label': accessText('按严重程度筛选', 'Filter by severity') }, levelFilters.map(([value, label, dot]) => h('button', {
        class: 'filter', type: 'button', 'aria-pressed': state.level === value ? 'true' : 'false',
        onclick: () => { state.level = value; state.shown = PAGE_SIZE; renderWorkspace(); },
      }, dot ? h('span', { class: `dot ${dot}` }) : null, label)),
        round.screenshots ? h('button', { class: 'filter', type: 'button', 'aria-pressed': state.withShot ? 'true' : 'false', onclick: () => { state.withShot = !state.withShot; state.shown = PAGE_SIZE; renderWorkspace(); } }, icon('image'), accessText(`有截图 ${round.screenshots}`, `With screenshots ${round.screenshots}`)) : null,
        doubted ? h('button', { class: 'filter', type: 'button', 'aria-pressed': state.aiDoubt ? 'true' : 'false', onclick: () => { state.aiDoubt = !state.aiDoubt; state.shown = PAGE_SIZE; renderWorkspace(); } }, accessText(`AI 认为可能误报 ${doubted}`, `AI: possible false positives ${doubted}`)) : null),
      h('div', { class: 'row' },
        h('div', { class: 'search grow' }, icon('search'), h('input', { class: 'input', type: 'search', placeholder: accessText('搜问题、文字或文件名', 'Search issues, text, or filenames'), 'aria-label': accessText('搜索问题', 'Search issues'), value: state.query, oninput: (event) => { state.query = event.target.value; state.shown = PAGE_SIZE; renderKeepingFocus('.search input'); } })),
        h('select', { class: 'input', 'aria-label': accessText('按问题种类筛选', 'Filter by issue type'), onchange: (event) => { state.title = event.target.value; state.shown = PAGE_SIZE; renderWorkspace(); } },
          h('option', { value: 'all', text: accessText('所有种类', 'All types'), selected: state.title === 'all' }),
          titles.map((title) => h('option', { value: title, text: title, selected: state.title === title }))))),
    scroller);
}

/** "Pages that look different from the previous round", for checking that a refactor did not change the look. */
function changedBar(round) {
  const changes = (round.capture && round.capture.changes) || [];
  if (!changes.length) return null;
  const changed = changes.filter((change) => change.percent >= 0.05);
  return h('div', { class: 'delta row' },
    h('span', { class: 'grow', text: changed.length ? accessText(`和上一轮比，${changed.length} 个页面画面有变化`, `${changed.length} pages changed since the previous round`) : accessText(`和上一轮比，${changes.length} 个页面画面都没变`, `No visual changes in ${changes.length} compared pages`) }),
    h('button', { class: 'btn small quiet', type: 'button', onclick: openChanges }, accessText('看对比', 'Compare')));
}

/** How many of the page's controls (those the library covers) really come from the library. */
function reuseBar(round) {
  const pages = (round.capture && round.capture.reuse) || [];
  const known = pages.reduce((sum, page) => sum + page.library + page.handwritten, 0);
  if (!pages.length) return null;
  if (!known) return h('div', { class: 'delta', text: accessText('组件复用率：看不出来源（页面需要用开发模式运行，例如 npm run dev）', 'Component reuse: source unavailable (run the page in development mode).') });
  const used = pages.reduce((sum, page) => sum + page.library, 0);
  return h('div', { class: 'delta row' },
    h('span', { class: 'grow', text: accessText(`组件复用率 ${Math.round((used / known) * 100)}%：页面上 ${known} 个控件里 ${used} 个来自组件库`, `Component reuse ${Math.round((used / known) * 100)}%: ${used} of ${known} controls use the library`) }),
    h('button', { class: 'btn small quiet', type: 'button', onclick: openReuse }, accessText('按页看', 'View by page')));
}

function openReuse() {
  const pages = [...state.round.capture.reuse].sort((a, b) => (a.library / Math.max(1, a.library + a.handwritten)) - (b.library / Math.max(1, b.library + b.handwritten)));
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: accessText('每页的组件复用率', 'Component reuse by page') }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭', 'Close'), 'data-autofocus': true, onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' },
        h('p', { class: 'muted', text: accessText('只数组件库里有对应组件的控件（例如组件库有按钮，就数按钮）。来源从开发模式下 React 记录的"是谁创建了这个元素"读出来；看不出来源的单独列出，不算进去。', 'Counts cover controls with a corresponding library component. React development metadata identifies their source; unknown sources are listed separately and excluded from the percentage.') }),
        pages.map((page) => {
          const known = page.library + page.handwritten;
          return h('div', { class: 'stack-tight' },
            h('strong', { text: `${page.route}: ${known ? `${Math.round((page.library / known) * 100)}%` : accessText('看不出来源', 'Source unknown')}` }),
            h('span', { class: 'muted', text: accessText(`${page.total} 个控件：来自组件库 ${page.library}，手写 ${page.handwritten}${page.unknown ? `，看不出来源 ${page.unknown}` : ''}`, `${page.total} controls: ${page.library} library, ${page.handwritten} handwritten${page.unknown ? `, ${page.unknown} unknown` : ''}`) }),
            page.examples.length ? h('span', { class: 'faint', text: accessText(`手写的例如：${page.examples.map((text) => `「${text}」`).join('、')}`, `Handwritten examples: ${page.examples.join(', ')}`) }) : null);
        })),
    ]);
  }, { kind: 'drawer', label: accessText('每页的组件复用率', 'Component reuse by page') });
}

function openChanges() {
  const changes = [...state.round.capture.changes].sort((a, b) => b.percent - a.percent);
  const url = (round, name) => `/api/projects/${state.current}/shot?round=${encodeURIComponent(round)}&name=${encodeURIComponent(name)}&t=${encodeURIComponent(token)}`;
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: accessText('页面和上一轮对比', 'Compare with previous round') }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭', 'Close'), 'data-autofocus': true, onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' },
        h('p', { class: 'muted', text: accessText('同一个页面、同一个宽度，上一轮和这一轮的截图逐像素比较。重构（比如把重复的写法合成组件）后，页面应该一点都没变；红色是变了的地方。', 'Screenshots of the same page and width are compared pixel by pixel. Red marks differences; review whether they are expected.') }),
        changes.map((change) => h('div', { class: 'stack-tight' },
          h('strong', { text: accessText(`${change.route} · ${change.width} 宽：${change.percent >= 0.05 ? `变了 ${change.percent}%` : '没有变化'}`, `${change.route} · ${change.width}px: ${change.percent >= 0.05 ? `${change.percent}% changed` : 'no change'}`) }),
          change.imagesExpired ? h('p', { class: 'notice', text: accessText('对比截图已按 48 小时保留规则清理，比较数值仍保留。重新检测可生成新截图。', 'Comparison images expired after 48 hours. The recorded comparison remains; run a new check for new images.') }) : change.diff ? h('div', { class: 'compare' },
            h('figure', {}, h('img', { src: url(change.previousRound, change.previousImage), alt: accessText(`${change.route} 上一轮的截图`, `${change.route} previous round`), loading: 'lazy' }), h('figcaption', { text: accessText('上一轮', 'Previous') })),
            h('figure', {}, h('img', { src: url(state.round.id, change.image), alt: accessText(`${change.route} 这一轮的截图`, `${change.route} current round`), loading: 'lazy' }), h('figcaption', { text: accessText('这一轮', 'Current') })),
            h('figure', {}, h('img', { src: url(state.round.id, change.diff), alt: accessText(`${change.route} 变化的地方（红色）`, `${change.route} changes marked in red`), loading: 'lazy' }), h('figcaption', { text: accessText('变化（红色）', 'Changes (red)') }))) : null))),
    ]);
  }, { kind: 'drawer', label: accessText('页面和上一轮对比', 'Compare with previous round') });
}

function renderKeepingFocus(selector) {
  const active = document.activeElement;
  const position = active && 'selectionStart' in active ? active.selectionStart : null;
  renderWorkspace();
  const next = document.querySelector(selector);
  if (next) { next.focus(); if (position !== null) next.setSelectionRange(position, position); }
}

function selectIssue(fingerprint, keepListFocus) {
  state.selected = fingerprint;
  state.view = 'crop';
  const list = document.querySelector('.list-scroll');
  const scroll = list ? list.scrollTop : 0;
  renderWorkspace();
  const nextList = document.querySelector('.list-scroll');
  if (nextList) nextList.scrollTop = scroll;
  const row = document.getElementById(rowId(fingerprint));
  if (row) { row.scrollIntoView({ block: 'nearest' }); if (keepListFocus) row.focus(); }
}

function shotUrl(name) {
  return `/api/projects/${state.current}/shot?round=${encodeURIComponent(state.round.id)}&name=${encodeURIComponent(name)}&t=${encodeURIComponent(token)}`;
}

function detailPane(violation, filtered, numbered) {
  const pane = h('div', { class: 'detail-pane' });
  if (!violation) {
    const any = freshViolations().length;
    append(pane, emptyState('check', any ? accessText('选一个问题看看', 'Select a finding') : accessText('这一轮没有新问题', 'No new findings this round'), any ? accessText('左边是这一轮的问题，点一个就能看到截图、原因和改法。', 'Select a finding on the left to see screenshots, context and suggested changes.') : (state.round.baseline ? accessText(`还有 ${state.round.baseline} 个老问题记录在案。`, `${state.round.baseline} existing findings remain in the baseline.`) : accessText('组件都用对了。', 'No new component issues were reported.'))));
    return pane;
  }
  const number = numbered.get(violation.fingerprint);
  const capture = state.round.capture && state.round.capture.captures ? state.round.capture.captures[violation.fingerprint] : null;
  const index = filtered.findIndex((entry) => entry.fingerprint === violation.fingerprint);
  const codeBox = h('div', {}, h('p', { class: 'faint', text: violation.line ? accessText('正在读取代码…', 'Loading code…') : '' }));
  if (!violation.line) fill(codeBox, h('div', { class: 'notice' }, accessText(`这是在页面上看到的问题，没能确定是哪一行代码。可以在代码里搜索「${violation.snippet || violation.name}」找到它。`, `This finding was observed on the page without a matching source line. Search the code for “${violation.snippet || violation.name}”.`)));
  else api(`/projects/${state.current}/excerpt?file=${encodeURIComponent(violation.file)}&line=${violation.line}`).then((data) => {
    fill(codeBox, h('div', { class: 'code mono', role: 'region', tabindex: '0', 'aria-label': accessText(`${violation.file} 第 ${violation.line} 行附近的代码`, `Code near ${violation.file} line ${violation.line}`) },
      data.lines.map((line, offset) => h('div', { class: `line${data.start + offset === violation.line ? ' hit' : ''}` }, h('span', { class: 'ln', text: String(data.start + offset) }), line || ' '))));
  }, (error) => fill(codeBox, h('div', { class: 'notice error', text: error.message })));

  const single = (state.prompts && state.prompts[violation.fingerprint]) || accessText(`${violation.name}\n位置：${violation.file}${violation.line ? ` 第 ${violation.line} 行` : ''}\n要改成：${violation.fix}`, `${violation.name}\nLocation: ${violation.file}${violation.line ? ` line ${violation.line}` : ''}\nSuggested change: ${violation.fix}`);
  append(pane, h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('button', { class: 'icon-btn back', type: 'button', 'aria-label': accessText('回到问题列表', 'Back to findings'), onclick: () => { state.selected = null; renderWorkspace(); } }, icon('back')),
      h('span', { class: 'big-num', 'aria-hidden': 'true', text: String(number) }),
      h('div', { class: 'grow' },
        h('h2', { text: violation.name }),
        h('div', { class: 'row' }, h('span', { class: `pill ${violation.level}`, text: LEVEL[violation.level] }), h('span', { class: 'chip', text: violation.title }),
          h('span', { class: 'where mono ellipsis', title: violation.file }, icon('file'), violation.line ? `${violation.file}:${violation.line}` : violation.file))),
      h('button', { class: 'btn small', type: 'button', onclick: () => copy(single, accessText('这一条的修复提示', 'repair prompt')) }, icon('copy'), accessText('复制给 AI', 'Copy for AI'))),
    violation.origin === 'manual' ? h('div', { class: 'notice', text: accessText('这条问题来自项目级人工观察。请按记录的操作重现；尚未关联自动截图证据。', 'This is a manual project observation. Reproduce the recorded steps; no automatic screenshot evidence is attached.') }) : stage(number, capture),
    accessText(false, !violation.english && violation.origin !== 'manual') ? h('div', { class: 'notice', text: 'This saved finding is shown in its original language. Run a new check for the latest available English descriptions.' }) : null,
    issueWorkflowDetails(violation),
    violation.ai ? h('div', { class: `notice${violation.ai.verdict === 'not-real' ? ' warn' : ''}`, role: 'note' }, h('strong', { text: `${AI_WORD[violation.ai.verdict]}: ` }), violation.ai.reason || accessText('没有给出理由', 'No reason provided'), h('span', { class: 'faint', text: accessText(`（${violation.ai.by}，看了 ${violation.ai.looks} 遍${violation.ai.verdict === 'unsure' && violation.ai.looks > 1 ? '，结论不一致' : ''}）`, ` (${violation.ai.by}, ${violation.ai.looks} passes${violation.ai.verdict === 'unsure' && violation.ai.looks > 1 ? ', results differ' : ''})`) })) : null,
    violation.origin === 'ai' ? h('div', { class: 'notice', role: 'note', text: accessText('这个问题是看截图时发现的（程序规则没覆盖到），已经复核过一遍；改之前请在页面上确认。', 'This finding came from screenshot review rather than an automatic rule. Confirm it on the page before changing anything.') }) : null,
    h('dl', { class: 'explain' },
      h('div', {}, h('dt', { text: accessText('怎么了', 'What happened') }), h('dd', { text: violation.what })),
      h('div', {}, h('dt', { text: accessText('会怎样', 'Why it matters') }), h('dd', { text: violation.consequence })),
      h('div', {}, h('dt', { text: accessText('怎么改', 'Suggested change') }), h('dd', { text: violation.fix }))),
    violation.plan && violation.plan.length ? h('div', { class: 'stack-tight' }, h('div', { class: 'section-title' }, icon('wand'), accessText('合并方案', 'Merge plan (original language)')),
      h('div', { class: 'plan mono', role: 'region', 'aria-label': accessText('合并方案', 'Merge plan') }, violation.plan.map((step) => h('p', { text: step })))) : null,
    h('div', { class: 'section-title' }, icon('code'), accessText('代码', 'Code')),
    codeBox,
    h('details', { class: 'more-info' }, h('summary', { text: accessText('详细信息', 'Details') }), h('p', { class: 'mono faint', text: accessText(`规则 ${violation.rule}（${violation.origin === 'basic' ? '默认规则' : violation.origin === 'ai' ? 'AI 看图' : '项目规则'}）`, `Rule ${violation.rule} (${violation.origin === 'basic' ? 'built-in' : violation.origin === 'ai' ? 'AI review' : 'project rule'})`) }), h('p', { class: 'mono faint', text: violation.detail })),
    h('div', { class: 'detail-foot' },
      h('button', { class: 'btn small', type: 'button', 'aria-disabled': index <= 0 ? 'true' : undefined, onclick: () => { if (index > 0) selectIssue(filtered[index - 1].fingerprint, false); } }, accessText('上一个', 'Previous')),
      h('button', { class: 'btn small', type: 'button', 'aria-disabled': index >= filtered.length - 1 ? 'true' : undefined, onclick: () => { if (index < filtered.length - 1) selectIssue(filtered[index + 1].fingerprint, false); } }, accessText('下一个', 'Next')),
      h('span', { class: 'faint', text: accessText('在左边列表里按 ↑ ↓ 也能切换', 'Use ↑ and ↓ in the list to navigate') }))));
  return pane;
}

/** A screenshot, with a box drawn over it when the problem came with pixel coordinates (screenshot review). */
function markedImage(src, alt, mark) {
  const img = h('img', { src, alt });
  img.addEventListener('error', () => img.replaceWith(h('p', { class: 'notice', text: accessText('截图已不可用，可能已超过 48 小时。请重新检测。', 'This screenshot is unavailable and may have expired after 48 hours. Run a new check.') })));
  if (!mark) return img;
  const frame = h('span', { class: 'mark', 'aria-hidden': 'true' });
  const place = () => {
    if (!img.naturalWidth) return;
    const pct = (value, total) => `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
    Object.assign(frame.style, { left: pct(mark.x, img.naturalWidth), top: pct(mark.y, img.naturalHeight), width: pct(mark.width, img.naturalWidth), height: pct(mark.height, img.naturalHeight) });
  };
  img.addEventListener('load', place);
  queueMicrotask(place);
  return h('span', { class: 'marked' }, img, frame);
}

function stage(number, capture) {
  if (capture?.screenshotsExpired && !capture.shots.length) return h('div', { class: 'notice', role: 'note', text: accessText('截图已按 48 小时保留规则清理；问题记录仍然保留。重新检测可生成新截图。', 'Screenshots expired after 48 hours; the finding is still available. Run a new check for screenshots.') });
  if (capture && capture.shots && capture.shots.length) {
    const shot = capture.shots[0];
    const full = state.view === 'full';
    return h('figure', { class: 'stage', role: 'group', 'aria-label': accessText('页面截图', 'Page screenshot') },
      h('div', { class: 'stage-bar' },
        icon('image'), h('span', { class: 'grow ellipsis', text: accessText(`页面 ${shot.route} · ${shot.viewport}`, `Page ${shot.route} · ${shot.viewport}`) }),
        h('div', { class: 'seg', role: 'group', 'aria-label': accessText('截图范围', 'Screenshot view') },
          h('button', { type: 'button', 'aria-pressed': full ? 'false' : 'true', onclick: () => { state.view = 'crop'; renderWorkspace(); } }, accessText('附近', 'Nearby')),
          h('button', { type: 'button', 'aria-pressed': full ? 'true' : 'false', onclick: () => { state.view = 'full'; renderWorkspace(); } }, accessText('整页', 'Full page')))),
      h('div', { class: 'stage-img' }, markedImage(shotUrl(full ? shot.full : shot.crop), accessText(`问题 ${number} 在页面 ${shot.route} 上的位置，已用红框圈出`, `Finding ${number} on page ${shot.route}, marked in red`), capture.mark)),
      h('figcaption', { class: 'stage-bar', text: capture.note }));
  }
  // No screenshot: keep the picture's place and say exactly why, with the next step.
  const goSettings = (field) => { state.tab = 'settings'; state.focusField = field; renderWorkspace(); };
  const PLACEHOLDERS = {
    'no-browser': [accessText('这一轮没有截图', 'No screenshots in this round'), accessText('这台电脑还没有浏览器组件，所以这一轮只检查了源码。下载后再检测，这里会显示这个问题在页面上的位置。', 'The browser component is not installed, so only source was checked. Download it and run another check for screenshots.'), [[accessText('下载浏览器组件并重新检测', 'Download browser and recheck'), () => startCheck(), true]]],
    'no-preview': [accessText('还没有页面截图', 'No page screenshot yet'), accessText('设置好本地预览地址后，这里会显示这个问题在页面上的位置。', 'Set a local preview URL to show where this finding appears on the page.'), [[accessText('帮我找预览地址', 'Find preview URL'), () => { state.autoFind = true; goSettings('base-url'); }, true]]],
    'preview-down': [accessText('预览打不开', 'Preview unavailable'), null, [[accessText('帮我找预览地址', 'Find preview URL'), () => { state.autoFind = true; goSettings('base-url'); }, false], [accessText('重新检测', 'Run check again'), startCheck, true]]],
    'login-required': [accessText('要登录才能看到', 'Sign-in required'), null, [[accessText('提供登录状态文件', 'Provide login state'), () => goSettings('storage'), true]]],
    'file-not-opened': [accessText('这一轮没打开用到它的页面', 'The relevant page was not opened'), null, [[accessText('添加要打开的页面', 'Add pages'), () => goSettings('routes'), true]]],
    hidden: [accessText('页面上没找到这个元素', 'Element not found on the page'), null, []],
    'code-only': [accessText('这个问题只在代码里', 'Source-only finding'), null, []],
    'over-limit': [accessText('这个问题没有参与截图', 'No screenshot for this finding'), accessText('这一轮问题太多，超过了截图上限。修掉一些后再检测，或者用筛选先看有截图的问题。', 'This finding exceeded the screenshot limit for the round. Fix some issues and recheck, or filter for findings with screenshots.'), []],
  };
  const reason = capture ? (capture.reason || (capture.status === 'not-locatable' ? 'code-only' : 'hidden')) : state.round.capture ? 'over-limit' : state.round.partialCode === 'browser-missing' || (state.round.partial && state.round.partial.includes('还没有浏览器组件')) ? 'no-browser' : 'no-preview';
  const [title, fallback, actions] = PLACEHOLDERS[reason];
  // Problems that live only in code get a one-line note; the code below is their picture.
  if (reason === 'code-only') return h('div', { class: 'notice', role: 'note' }, h('strong', { text: `${title}：` }), (capture && capture.note) || fallback);
  return h('figure', { class: 'stage', role: 'group', 'aria-label': accessText('页面截图', 'Page screenshot') },
    h('div', { class: 'placeholder' }, h('div', { class: 'placeholder-box' },
      h('div', { class: 'empty-icon' }, icon(reason === 'code-only' ? 'code' : 'image')),
      h('strong', { text: title }),
      h('p', { text: (capture && capture.note) || fallback }),
      actions.length ? h('div', { class: 'row' }, actions.map(([label, run, primary]) => h('button', { class: `btn small${primary ? ' primary' : ''}`, type: 'button', onclick: run }, label))) : null)));
}

function openRoundNotes() {
  const round = state.round;
  const result = round.result;
  const sections = [];
  const section = (title, items) => sections.push(h('div', { class: 'stack' }, h('h3', { text: title }), h('ul', { class: 'list-plain' }, items.map((item) => h('li', { text: item })))));
  section(accessText('这一轮', 'This round'), [accessText(`检查了 ${result.filesScanned} 个文件，用时 ${(round.durationMs / 1000).toFixed(1)} 秒`, `Checked ${result.filesScanned} files in ${(round.durationMs / 1000).toFixed(1)} seconds`), accessText(`${round.newMust} 个需要改，${round.newDefault} 个建议改，${round.newReference} 个可以看看`, `${round.newMust} must fix, ${round.newDefault} should fix, ${round.newReference} advisory`), accessText(`老问题（已记录）${round.baseline} 个`, `${round.baseline} baseline findings`)]);
  const ignored = result.violations.filter((violation) => violation.status === 'ignored');
  if (ignored.length) section(accessText('已按注释忽略', 'Ignored by comments'), ignored.map((violation) => `${violation.file}:${violation.line} ${violation.name} — ${accessText('理由', 'Reason')}: ${violation.ignoreReason}`));
  if (result.ignoreWithoutReason.length) section(accessText('忽略注释没写理由，所以没有生效', 'Ignore comments without a reason did not apply'), result.ignoreWithoutReason.map((entry) => `${entry.file}:${entry.line} (// uxqa-ignore rule -- reason)`));
  if (result.rules.guidance.length) section(accessText('一句话规则（没法自动检查，请自己和 AI 留意）', 'Written guidance (not automatically checked)'), result.rules.guidance.map((entry) => entry.text));
  if (result.rules.disabled.length) section(accessText('已关闭的默认规则', 'Disabled default rules'), result.rules.disabled.map((entry) => `${entry.id}: ${entry.reason}`));
  if (round.capture) section(accessText(`打开的页面（${round.capture.viewport}）`, `Opened pages (${round.capture.viewport})`), round.capture.pages.map((page) => page.status === 'ok' ? accessText(`${page.route}：打开成功，在这里找到 ${page.problems} 个问题`, `${page.route}: opened; ${page.problems} findings`) : accessText(`${page.route}：没打开（${page.error}）`, `${page.route}: not opened (${page.error})`)));
  if (result.skipped.length) section(accessText('没检查的文件', 'Skipped files'), result.skipped.map((entry) => `${entry.file}: ${entry.reason}`));
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: accessText(`第 ${round.number} 轮说明`, `Round ${round.number} details`) }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText('关闭', 'Close'), 'data-autofocus': true, onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' }, sections, h('p', { class: 'faint', text: accessText('截图与源码问题按页面特征匹配，请核对对应位置。', 'Screenshots are matched using page features; verify each match.') })),
      h('div', { class: 'drawer-foot' }, h('button', { class: 'btn', type: 'button', onclick: async () => { close(false); await recordBaseline(); } }, accessText('把现有问题记为老问题', 'Record existing findings as baseline'))),
    ]);
  }, { kind: 'drawer', label: accessText('本轮说明', 'Round details') });
}

async function recordBaseline() {
  const ok = await confirmSheet({
    title: accessText('把现在的问题记为老问题？', 'Record current findings as a baseline?'),
    body: h('div', { class: 'stack' },
      h('p', { text: accessText('会在项目里写入一个文件：.uxqa/baseline.json。以后检测只把新出现的问题算进来，老问题单独计数；未再检出时仍需结合覆盖范围确认修复。', 'This writes .uxqa/baseline.json in the project. Existing findings are counted separately in future checks; absence from a later check still requires coverage review.') }),
      h('p', { class: 'muted', text: accessText('适合老项目刚接入时使用。这个文件可以和代码一起提交，也可以随时删除。', 'Useful when introducing UXQA to an existing project. You can commit or delete this file.') })),
    confirmText: accessText('写入并记录', 'Write baseline'),
  });
  if (!ok) return;
  try {
    const data = await api(`/projects/${state.current}/baseline`, { method: 'POST', body: { confirm: true } });
    toast(accessText(`已记录 ${data.entries} 个老问题，再检测一轮就能看到效果`, `Recorded ${data.entries} baseline findings. Run another check to see the result.`));
  } catch (error) { toast(error.message); }
}

// ---------- components ----------
let componentTimer;
function renderComponents(body) {
  const results = h('div', { class: 'comp-grid', 'aria-live': 'polite' });
  const search = h('input', { id: 'component-search', class: 'input', type: 'search', placeholder: accessText('按钮、标签页、下拉菜单、Dialog…', 'Button, tabs, dropdown, dialog…'), autocomplete: 'off' });
  const load = async () => {
    const query = search.value.trim();
    try {
      const data = await api(`/projects/${state.current}/components${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (!data.library) { fill(results, h('div', { class: 'notice warn', text: accessText('没有找到组件库。可以在"规则"里写 "library": { "root": "组件库目录" } 指定。', 'No component library was found. Specify one in project rules with "library": { "root": "library directory" }.') })); return; }
      if (!data.components.length) { fill(results, h('div', { class: 'notice', text: accessText(`组件库里没有和"${query}"相关的组件。需要的话，请在组件库（${data.library}）里新建，不要写在页面里。`, `No library components match "${query}". If needed, add one to the library (${data.library}) rather than the page.`) })); return; }
      fill(results, data.components.map((component) => h('div', { class: 'comp' },
        h('div', { class: 'row' }, h('span', { class: 'comp-name grow', text: component.label ? `${component.name}（${component.label}）` : component.name }),
          component.duplicateOf ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': accessText(`复制 ${component.name} 的引入写法`, `Copy import for ${component.name}`), title: accessText('复制引入写法', 'Copy import'), onclick: () => copy(component.importHint, accessText('引入写法', 'import')) }, icon('copy'))),
        h('code', { class: 'mono', text: component.importHint }),
        component.duplicateOf ? h('span', { class: 'error-text', text: accessText(`重复的一份，不建议使用；请用 ${component.duplicateOf} 里的 ${component.name}。`, `Duplicate; use ${component.name} from ${component.duplicateOf} instead.`) }) : null,
        component.variantText ? h('span', { class: 'muted', text: component.variantText }) : null,
        component.parts.length ? h('span', { class: 'faint', text: accessText(`还包括 ${component.parts.slice(0, 6).join('、')}${component.parts.length > 6 ? ` 等 ${component.parts.length} 个` : ''}`, `Includes ${component.parts.slice(0, 6).join(', ')}${component.parts.length > 6 ? ` and ${component.parts.length - 6} more` : ''}`) }) : null,
        h('span', { class: 'faint mono ellipsis', title: component.file, text: component.source ? `${component.source} · ${component.file}` : component.file }))));
    } catch (error) { fill(results, h('div', { class: 'notice error', text: error.message })); }
  };
  search.addEventListener('input', () => { clearTimeout(componentTimer); componentTimer = setTimeout(load, 220); });
  const sources = h('div', { class: 'panel' }, h('h2', { text: accessText('组件库来源', 'Component library sources') }), h('p', { class: 'muted', text: accessText('正在读取…', 'Loading…') }));
  fill(body, h('div', { class: 'page' },
    h('div', { class: 'field' }, h('label', { for: 'component-search', text: accessText('找组件', 'Find components') }), h('div', { class: 'search' }, icon('search'), search), h('span', { class: 'hint', text: accessText('写界面之前先查一下，有就用现成的。中文、英文都可以。', 'Look for an existing component before building a new one. Search in Chinese or English.') })),
    results, sources));
  load();
  renderSources(sources, load);
}

const SOURCE_KINDS = { get auto() { return accessText('本项目里', 'This project'); }, get local() { return accessText('本机文件夹', 'Local folder'); }, get package() { return accessText('已安装的 npm 包', 'Installed npm package'); }, get git() { return accessText('Git 仓库', 'Git repository'); } };

/** Where components come from: the project's own library first, then shared ("parent") libraries in the listed order. */
async function renderSources(panel, reloadComponents) {
  let summary, rules;
  try { [summary, rules] = await Promise.all([api(`/projects/${state.current}/library`), api(`/projects/${state.current}/rules`)]); }
  catch (error) { fill(panel, h('h2', { text: accessText('组件库来源', 'Component library sources') }), h('div', { class: 'notice error', text: error.message })); return; }
  let current;
  try { current = JSON.parse(rules.raw || '{}'); } catch { current = null; }
  const configured = current && Array.isArray(current.libraries) ? current.libraries : [];
  const message = h('div', { role: 'status' });
  const save = async (next, done) => {
    if (!current) { fill(message, h('div', { class: 'notice error', text: accessText('项目里的规则文件格式不对，请先在"规则"里改好。', 'The project rules file is invalid. Fix it in Project rules first.') })); return; }
    const raw = JSON.stringify({ ...current, extends: current.extends === undefined ? 'uxqa:basic' : current.extends, libraries: next }, null, 2);
    let checked;
    try { checked = await api(`/projects/${state.current}/rules/preview`, { method: 'POST', body: { raw } }); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); return; }
    const ok = await confirmSheet({ title: accessText('保存组件库来源到项目？', 'Save library sources to the project?'), body: h('div', { class: 'stack' }, h('p', { text: accessText(`会写入 ${project().root}/${checked.path}（只改这一个文件，可以提交到仓库让团队和 AI 共用）：`, `This writes only ${project().root}/${checked.path}, which can be committed for your team and AI assistants:`) }), h('pre', { class: 'mono', text: checked.text })), confirmText: accessText('保存', 'Save'), cancelText: accessText('取消', 'Cancel') });
    if (!ok) return;
    try { await api(`/projects/${state.current}/rules/save`, { method: 'POST', body: { raw, confirm: true } }); toast(accessText('组件库来源已保存，下一轮检测生效', 'Library sources saved for the next check')); if (done) done(); renderSources(panel, reloadComponents); reloadComponents(); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  };
  const pull = async (source, button) => {
    button.setAttribute('aria-disabled', 'true'); button.textContent = accessText('正在拉取…', 'Pulling…');
    try { const result = await api(`/projects/${state.current}/libraries/pull`, { method: 'POST', body: { source } }); toast(accessText(`已拉取到 ${result.commit}`, `Pulled ${result.commit}`)); renderSources(panel, reloadComponents); reloadComponents(); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); button.removeAttribute('aria-disabled'); button.textContent = accessText('拉取 / 更新', 'Pull / update'); }
  };
  const rows = summary.libraries.map((library, index) => {
    const source = configured.find((entry) => entry.name === library.name);
    const position = configured.indexOf(source);
    return h('div', { class: 'rule-row' },
      h('div', { class: 'grow stack-tight' },
        h('div', {}, h('strong', { text: library.name }), h('span', { class: 'faint', text: `　${index === 0 ? accessText('最优先', 'Highest priority') : accessText('母库', 'Parent library')} · ${SOURCE_KINDS[library.kind]}` })),
        h('div', { class: 'mono faint ellipsis', title: library.display, text: library.display }),
        h('div', { class: library.ready ? 'muted' : 'error-text', text: library.ready ? accessText(`${library.components} 个组件${library.importBase ? `，从 ${library.importBase} 引入` : ''}`, `${library.components} components${library.importBase ? `, imported from ${library.importBase}` : ''}`) : library.issue || accessText('还不能用', 'Not available') })),
      h('div', { class: 'row' },
        source && source.git ? h('button', { class: 'btn small', type: 'button', onclick: (event) => pull(source, event.currentTarget) }, accessText('拉取 / 更新', 'Pull / update')) : null,
        source && position > 0 ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => { const next = [...configured]; next.splice(position - 1, 0, next.splice(position, 1)[0]); save(next); } }, accessText('上移', 'Move up')) : null,
        source ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => save(configured.filter((entry) => entry !== source)) }, accessText('移除', 'Remove')) : null));
  });
  // Add a source: one kind at a time, in plain words.
  let kind = 'package';
  const form = h('form', { class: 'stack' });
  const drawForm = () => {
    const fields = {
      local: [['value', accessText('文件夹路径', 'Folder path'), '../shared-ui/src']],
      package: [['value', accessText('npm 包名', 'npm package name'), '@your-company/ui']],
      git: [['value', accessText('仓库链接', 'Repository URL'), 'https://github.com/your-company/ui.git'], ['ref', accessText('分支或标签（可不填）', 'Branch or tag (optional)'), 'main'], ['path', accessText('组件所在的子目录（可不填）', 'Component subdirectory (optional)'), 'packages/ui/src'], ['import', accessText('项目里怎么引入（可不填）', 'Import path (optional)'), '@your-company/ui']],
    }[kind];
    fill(form,
      h('div', { class: 'seg', role: 'group', 'aria-label': accessText('来源类型', 'Source type') }, Object.entries({ package: SOURCE_KINDS.package, git: SOURCE_KINDS.git, local: SOURCE_KINDS.local }).map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(kind === value), onclick: () => { kind = value; drawForm(); } }, label))),
      h('p', { class: 'faint', text: kind === 'package' ? accessText('公司的组件库通常发成 npm 包。先在项目里装好它，这里填包名。', 'Install the package in the project first, then enter its name.') : kind === 'git' ? accessText('填仓库链接后点"添加"，再点"拉取 / 更新"下载到本机（只存在 ~/.uxqa 里）。私有仓库要先在终端里用 git 登录过一次。', 'Add the repository URL, then use Pull / update to download it locally to ~/.uxqa. Authenticate Git for private repositories first.') : accessText('另一个文件夹里的组件库，例如同一个仓库里的共享组件目录。', 'A component library in another local folder, such as a shared folder in the same repository.') }),
      h('div', { class: 'field' }, h('label', { for: 'src-name', text: accessText('叫什么（显示用）', 'Display name') }), h('input', { id: 'src-name', class: 'input', type: 'text', placeholder: accessText('公司组件库', 'Company library'), autocomplete: 'off' })),
      fields.map(([name, label, example]) => h('div', { class: 'field' }, h('label', { for: `src-${name}`, text: label }), h('input', { id: `src-${name}`, class: 'input mono', type: 'text', placeholder: accessText(`例如：${example}`, `Example: ${example}`), autocomplete: 'off' }))),
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', onclick: () => tryOut() }, accessText('试一下', 'Preview')),
        h('button', { class: 'btn primary', type: 'submit' }, accessText('添加', 'Add'))));
  };
  const draft = () => {
    const value = (id) => { const field = document.getElementById(id); return field ? field.value.trim() : ''; };
    const entry = { name: value('src-name') || accessText('公司组件库', 'Company library'), [kind === 'local' ? 'root' : kind]: value('src-value') };
    for (const key of ['ref', 'path', 'import']) if (value(`src-${key}`)) entry[key] = value(`src-${key}`);
    return entry;
  };
  const tryOut = async () => {
    try {
      const result = await api(`/projects/${state.current}/libraries/preview`, { method: 'POST', body: { libraries: [...configured, draft()] } });
      const added = result.libraries[result.libraries.length - 1];
      fill(message, h('div', { class: `notice${added.ready ? '' : ' warn'}`, text: added.ready ? accessText(`能读到：${added.components} 个组件。点"添加"保存。`, `Found ${added.components} components. Select Add to save.`) : added.issue || accessText('还读不到组件', 'Components are not accessible') }));
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); save([...configured, draft()]); });
  drawForm();
  fill(panel,
    h('h2', { text: accessText('组件库来源', 'Component library sources') }),
    h('p', { class: 'muted', text: accessText('可以同时用好几个组件库：排在最上面的最优先（通常是项目自己的"子库"），下面的是公司共用的"母库"。两边都有同名组件时，用上面那个。', 'Multiple libraries can be used in priority order. When components share a name, the highest listed library takes precedence.') }),
    rows,
    summary.overrides.length ? h('div', { class: 'notice', text: accessText(`两个库都有的组件：${summary.overrides.map((entry) => `${entry.name}（用的是「${entry.used}」的）`).join('、')}。如果子库只是改了样式，可以考虑直接用母库的并加一个样式选项。`, `Components in multiple libraries: ${summary.overrides.map((entry) => `${entry.name} (using ${entry.used})`).join(', ')}. If the child library only changes styling, consider a parent-library variant.`) }) : null,
    h('details', { class: 'more-info' }, h('summary', { text: accessText('添加组件库来源', 'Add a library source') }), form),
    message);
}

// ---------- rules ----------
function ruleTemplates() { return {
  element: { label: accessText('某个元素必须用组件库里的组件', 'Require a library component for an element'), fields: [['element', accessText('原生元素', 'Native element'), 'a'], ['role', accessText('角色（可不填）', 'Role (optional)'), 'button'], ['component', accessText('应该用的组件', 'Required component'), 'Button']], build: (v) => ({ id: `use-${v.component || 'component'}`.toLowerCase(), type: 'require-library-component', element: v.element, ...(v.role ? { role: v.role } : {}), component: v.component, level: 'must' }) },
  scale: { label: accessText('间距或字号只能取某些值', 'Restrict spacing or font-size values'), fields: [['property', accessText('哪一类（spacing 或 font-size）', 'Property (spacing or font-size)'), 'spacing'], ['allowed', accessText('允许的值（multiple-of-4 或用逗号分隔的数字）', 'Allowed values (multiple-of-4 or comma-separated numbers)'), 'multiple-of-4']], build: (v) => ({ id: `${v.property || 'spacing'}-scale`, type: 'value-scale', property: v.property || 'spacing', allowed: v.allowed === 'multiple-of-4' || !v.allowed ? 'multiple-of-4' : v.allowed.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)), level: 'must' }) },
  text: { label: accessText('按钮文字不能太长', 'Limit button text length'), fields: [['max', accessText('最多几个字', 'Maximum characters'), '8']], build: (v) => ({ id: 'short-buttons', type: 'text-length', max: Number(v.max) || 8, level: 'default' }) },
  import: { label: accessText('禁止引入某个库', 'Disallow a library import'), fields: [['module', accessText('库名', 'Library name'), 'antd'], ['fix', accessText('应该怎么做（可不填）', 'Suggested change (optional)'), accessText('改用组件库里的组件', 'Use a library component')]], build: (v) => ({ id: `no-${(v.module || 'library').replace(/[^a-z0-9]+/gi, '-')}`, type: 'forbid-import', module: v.module, level: 'must', ...(v.fix ? { fix: v.fix } : {}) }) },
  prop: { label: accessText('组件必须带某个属性', 'Require a component prop'), fields: [['component', accessText('组件', 'Component'), 'Avatar'], ['prop', accessText('属性', 'Prop'), 'alt']], build: (v) => ({ id: `${(v.component || 'x').toLowerCase()}-${v.prop || 'prop'}`, type: 'require-prop', component: v.component, prop: v.prop, level: 'default' }) },
  sentence: { label: accessText('一句话规则（不自动检查，交给 AI 参考）', 'Written guidance (not automatically checked)'), fields: [['text', accessText('规则', 'Rule'), accessText('一屏不超过一个主按钮', 'Use at most one primary action per screen')]], build: (v) => ({ id: `note-${Date.now().toString(36)}`, text: v.text }) },
  off: { label: accessText('关闭或局部关闭某条默认规则', 'Disable a default rule or scope'), fields: [['id', accessText('默认规则', 'Default rule'), '', 'basic'], ['scope', accessText('只在这些目录关闭（可不填，逗号分隔）', 'Limit to these paths (optional, comma-separated)'), 'src/pages/admin/**'], ['reason', accessText('理由（必填，会显示在报告里）', 'Reason (required; shown in reports)'), '']], build: (v) => ({ id: v.id, level: 'off', ...(v.scope ? { scope: v.scope.split(',').map((x) => x.trim()).filter(Boolean) } : {}), reason: v.reason }) },
}; }

async function renderRules(body) {
  const TEMPLATES = ruleTemplates();
  fill(body, h('div', { class: 'page' }, h('p', { class: 'muted', text: accessText('正在读取规则…', 'Loading project rules…') })));
  let data;
  try { data = await api(`/projects/${state.current}/rules`); }
  catch (error) { fill(body, h('div', { class: 'page' }, h('div', { class: 'notice error', role: 'alert', text: error.message }))); return; }
  const levelWord = { must: accessText('必须', 'Must'), default: accessText('建议', 'Recommended'), reference: accessText('参考', 'Advisory'), off: accessText('关闭', 'Off') };
  const message = h('div', { role: 'alert' });
  const editor = h('textarea', { id: 'rules-editor', class: 'input', spellcheck: 'false', 'aria-describedby': 'rules-hint' });
  editor.value = data.raw || JSON.stringify({ extends: 'uxqa:basic', rules: [] }, null, 2);
  const templateSelect = h('select', { id: 'template', class: 'input' }, Object.entries(TEMPLATES).map(([key, template]) => h('option', { value: key, text: template.label })));
  const fieldsBox = h('div', { class: 'stack' });
  const renderFields = () => {
    const template = TEMPLATES[templateSelect.value];
    fill(fieldsBox, template.fields.map(([name, label, example, kind]) => h('div', { class: 'field' },
      h('label', { for: `tpl-${name}`, text: label }),
      kind === 'basic' ? h('select', { id: `tpl-${name}`, class: 'input' }, data.basic.map((rule) => h('option', { value: rule.id, text: `${rule.id} —— ${rule.fix}` })))
        : h('input', { id: `tpl-${name}`, class: 'input', type: 'text', placeholder: example ? accessText(`例如：${example}`, `Example: ${example}`) : '' }))));
  };
  templateSelect.addEventListener('change', renderFields);
  renderFields();
  const addFromTemplate = () => {
    const template = TEMPLATES[templateSelect.value];
    const values = Object.fromEntries(template.fields.map(([name]) => [name, document.getElementById(`tpl-${name}`).value.trim()]));
    let current;
    try { current = JSON.parse(editor.value || '{}'); } catch { fill(message, h('div', { class: 'notice error', text: accessText('下面的规则内容现在格式不对，先改好再添加。', 'Fix the invalid rules JSON before adding a rule.') })); return; }
    current.rules = Array.isArray(current.rules) ? current.rules : [];
    current.rules.push(template.build(values));
    editor.value = JSON.stringify(current, null, 2);
    fill(message, h('div', { class: 'notice', text: accessText('已加到规则内容里，还没保存。', 'Added to the editor; not yet saved.') }));
  };
  const preview = async () => {
    try {
      const result = await api(`/projects/${state.current}/rules/preview`, { method: 'POST', body: { raw: editor.value } });
      fill(message, h('div', { class: 'notice', text: result.unchanged ? accessText('写得没问题，和项目里现有的一样。', 'Valid; no changes from the saved rules.') : accessText('写得没问题，可以保存。', 'Valid and ready to save.') }));
      return result;
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); return null; }
  };
  // ---- switches: every built-in rule as a plain sentence with a level picker ----
  const LEVELS = [['must', accessText('必须改', 'Must fix')], ['default', accessText('建议改', 'Should fix')], ['reference', accessText('可以看看', 'Advisory')], ['off', accessText('不检查', 'Off')]];
  const rank = { must: 3, default: 2, reference: 1, off: 0 };
  const changes = new Map();
  const changeBar = h('div', { class: 'row', hidden: true });
  const switchMessage = h('div', { role: 'alert' });
  const refreshBar = () => {
    changeBar.hidden = changes.size === 0;
    fill(changeBar, h('span', { class: 'grow muted', text: accessText(`改了 ${changes.size} 条，还没保存`, `${changes.size} unsaved changes`) }),
      h('button', { class: 'btn', type: 'button', onclick: () => renderRules(body) }, accessText('撤销', 'Undo')),
      h('button', { class: 'btn primary', type: 'button', onclick: saveSwitches }, accessText('保存修改', 'Save changes')));
  };
  const ruleRow = (entry) => {
    const select = h('select', { class: 'input level-select', 'aria-label': accessText(`${entry.rule}：要不要检查`, `Check level: ${entry.rule}`) }, LEVELS.map(([value, label]) => h('option', { value, text: value === entry.defaultLevel ? accessText(`${label}（默认）`, `${label} (default)`) : label, selected: entry.level === value })));
    const reason = h('input', { class: 'input', type: 'text', placeholder: accessText('为什么放宽这一条？（必填，会写进报告）', 'Reason for relaxing this rule (required; included in the report)'), 'aria-label': accessText(`放宽「${entry.rule}」的理由`, `Reason for relaxing ${entry.rule}`) });
    reason.value = entry.reason || '';
    const reasonBox = h('div', { class: 'field', hidden: !(rank[entry.level] < rank[entry.defaultLevel]) }, reason);
    const update = () => {
      reasonBox.hidden = !(rank[select.value] < rank[entry.defaultLevel]);
      if (select.value === entry.level && reason.value.trim() === (entry.reason || '')) changes.delete(entry.id);
      else changes.set(entry.id, { entry, level: select.value, reason: reason.value.trim() });
      refreshBar();
    };
    select.addEventListener('change', update);
    reason.addEventListener('input', update);
    return h('div', { class: 'rule-row' }, h('div', { class: 'grow stack-tight' }, h('div', { text: entry.rule }), entry.why ? h('div', { class: 'faint', text: entry.why }) : null, reasonBox), select);
  };
  const saveSwitches = async () => {
    const missing = [...changes.values()].find((change) => rank[change.level] < rank[change.entry.defaultLevel] && !change.reason);
    if (missing) { fill(switchMessage, h('div', { class: 'notice error', text: accessText(`「${missing.entry.rule}」放宽了，请写一句理由。`, `Provide a reason for relaxing “${missing.entry.rule}”.`) })); return; }
    let current;
    try { current = JSON.parse(data.raw || '{}'); } catch { fill(switchMessage, h('div', { class: 'notice error', text: accessText('项目里现有的规则文件格式不对，请在下面"自己写规则"里先改好。', 'The existing rules file is invalid. Fix it in the advanced editor first.') })); return; }
    current.extends = current.extends === undefined ? 'uxqa:basic' : current.extends;
    let rules = Array.isArray(current.rules) ? current.rules : [];
    for (const { entry, level, reason } of changes.values()) {
      // Only plain level overrides are replaced; scoped switch-offs and custom rules stay as they are.
      rules = rules.filter((rule) => !(rule && rule.id === entry.id && !rule.scope && !rule.type));
      if (level !== entry.defaultLevel || reason) rules.push({ id: entry.id, level, ...(reason ? { reason } : {}) });
    }
    current.rules = rules;
    editor.value = JSON.stringify(current, null, 2);
    await save();
  };
  const groups = [['code', accessText('写代码时检查', 'Source checks')], ['page', accessText('打开页面时检查（需要填预览地址）', 'Page checks (requires a preview URL)')]];

  const save = async () => {
    const checked = await preview();
    if (!checked || checked.unchanged) return;
    const ok = await confirmSheet({ title: accessText('保存到项目？', 'Save to the project?'), body: h('div', { class: 'stack' }, h('p', { text: accessText(`会写入 ${project().root}/${checked.path}（只改这一个文件）：`, `This writes only ${project().root}/${checked.path}:`) }), h('pre', { class: 'mono', text: checked.text })), confirmText: accessText('保存', 'Save') });
    if (!ok) return;
    try { await api(`/projects/${state.current}/rules/save`, { method: 'POST', body: { raw: editor.value, confirm: true } }); toast(accessText('规则已保存，下一轮检测生效', 'Rules saved for the next check')); renderWorkspace(); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  };
  const custom = data.active.filter((rule) => rule.origin === 'project');
  refreshBar();
  fill(body, h('div', { class: 'page' },
    h('div', { class: 'panel' },
      h('h2', { text: accessText('检查哪些东西', 'What UXQA checks') }),
      h('p', { class: 'muted', text: accessText(`一共 ${data.catalog.length} 条，默认已经按常见做法设好，一般不用改。"必须改"的问题在 AI 写代码时会被当场拦下；"建议改""可以看看"只提醒。`, `${data.catalog.length} built-in rules have default levels. Must-fix findings can block supported AI write hooks; other levels are advisory.`) }),
      groups.map(([kind, title]) => h('div', { class: 'stack-tight' }, h('h3', { text: title }), data.catalog.filter((entry) => entry.kind === kind).map(ruleRow))),
      switchMessage, changeBar),
    custom.length || data.guidance.length ? h('div', { class: 'panel' }, h('h2', { text: accessText('这个项目自己加的规则', 'Project-authored rules') }),
      custom.length ? h('div', {}, custom.map((rule) => h('div', { class: 'rule-row' },
        h('span', { class: `pill ${rule.level}`, text: levelWord[rule.level] }),
        h('div', { class: 'grow' }, h('div', { text: rule.fix || rule.id }), h('div', { class: 'faint mono', text: rule.id }))))) : null,
      data.guidance.length ? h('div', {}, h('h3', { text: accessText('一句话规则（不自动检查，会写进给 AI 的提示）', 'Written guidance (not automatically checked; included in AI prompts)') }), h('ul', { class: 'list-plain' }, data.guidance.map((entry) => h('li', { text: entry.text })))) : null) : null,
    h('details', { class: 'panel' }, h('summary', { text: accessText('高级：自己写规则', 'Advanced: write project rules') }),
      h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'template', text: accessText('从常用规则开始', 'Start from a template') }), templateSelect), fieldsBox,
        h('div', {}, h('button', { class: 'btn', type: 'button', onclick: addFromTemplate }, icon('plus'), accessText('加到规则内容里', 'Add to editor'))),
        h('div', { class: 'field' }, h('label', { for: 'rules-editor', class: 'mono', text: '.uxqa/rules.json' }), editor,
          h('span', { class: 'hint', id: 'rules-hint', text: data.path ? accessText(`项目规则文件：${data.path}。默认规则一直生效，这里写的叠加在上面。`, `Project rules: ${data.path}. These supplement the default rules.`) : accessText('这个项目还没有自己的规则文件。默认规则一直生效，这里写的叠加在上面。', 'This project has no rules file yet. Project rules supplement the defaults.') })),
        message,
        h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: preview }, accessText('检查写法', 'Validate')), h('button', { class: 'btn primary', type: 'button', onclick: save }, accessText('保存到项目', 'Save to project')))))));
}

// ---------- page settings ----------
// Looks for this project's running dev server; fills and saves it when sure, otherwise says exactly how to start it.
async function findPreviewInto(entry, box, { quiet = false } = {}) {
  fill(box, h('p', { class: 'muted', role: 'status', text: accessText('正在找这个项目在本机的预览地址…', 'Looking for a local preview…') }));
  let result;
  try { result = await api(`/projects/${entry.id}/find-preview`, { method: 'POST', body: {} }); }
  catch (error) { fill(box, h('div', { class: 'notice error', role: 'alert', text: error.message })); return null; }
  const use = async (url) => {
    const pages = entry.pages || { routes: ['/'], discover: true };
    await api(`/projects/${entry.id}/settings`, { method: 'POST', body: { baseUrl: url, routes: (pages.routes || ['/']).join('\n'), discover: pages.discover !== false, ...(pages.storageState ? { storageState: pages.storageState } : {}) } });
    await loadProjects();
    const input = document.getElementById('base-url');
    if (input) input.value = url;
    fill(box, h('div', { class: 'notice', role: 'status', text: accessText(`已用 ${url}，下一轮检测会打开页面截图。`, `Using ${url}; the next check can capture pages.`) }));
    if (!quiet) toast(accessText(`预览地址已设为 ${url}`, `Preview set to ${url}`));
  };
  if (result.found && result.found.sure) { await use(result.found.url); fill(box, h('div', { class: 'notice', role: 'status' }, h('strong', { text: accessText(`找到了：${result.found.url}`, `Found ${result.found.url}`) }), accessText(`（${result.found.why}），已经保存。`, ' — matched this project and saved.'))); return result.found.url; }
  const startCode = `cd "${result.start.folder}"\n${result.start.command}`;
  fill(box, h('div', { class: 'stack' },
    result.found ? h('div', { class: 'notice', role: 'status' }, accessText(`可能是 ${result.found.url}：${result.found.why}。`, `Possible preview: ${result.found.url}. Confirm it belongs to this project. `), h('button', { class: 'btn small', type: 'button', onclick: () => use(result.found.url) }, accessText('用这个', 'Use this'))) : null,
    !result.found ? h('div', { class: 'notice', role: 'status' }, h('strong', { text: accessText('这个项目还没在本机跑起来。', 'No running preview found.') }), accessText('打开"终端"，把下面两行粘贴进去回车，等出现 localhost 地址后回来点"再找一次"。', 'Run the commands below in a terminal, then return and search again when a localhost URL appears.')) : null,
    !result.found ? h('pre', { class: 'mono code-snippet', text: startCode }) : null,
    h('div', { class: 'row' },
      !result.found ? h('button', { class: 'btn small', type: 'button', onclick: () => copy(startCode, accessText('启动命令', 'start command')) }, icon('copy'), accessText('复制命令', 'Copy commands')) : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => findPreviewInto(entry, box) }, accessText('再找一次', 'Search again'))),
    result.others.length ? h('div', { class: 'stack-tight' }, h('span', { class: 'faint', text: accessText('本机还有这些地址在运行，如果其中一个是这个项目，点"用这个"：', 'Other local addresses are running. Select one if it belongs to this project:') }),
      result.others.map((other) => h('div', { class: 'row' }, h('span', { class: 'mono grow', text: other.url }), h('button', { class: 'btn small', type: 'button', onclick: () => use(other.url) }, accessText('用这个', 'Use this'))))) : null));
  return null;
}

function renderSettings(body) {
  const entry = project();
  const finder = h('div', {});
  if (state.autoFind) { state.autoFind = false; queueMicrotask(() => findPreviewInto(entry, finder)); }
  const pages = entry.pages || { baseUrl: '', routes: ['/'], discover: true };
  const message = h('div', { role: 'status' });
  const loginBox = h('div', { role: 'status' });
  const routes = h('textarea', { id: 'routes', class: 'input short mono' });
  routes.value = pages.routes.join('\n');
  const values = () => ({ baseUrl: document.getElementById('base-url').value, routes: routes.value, discover: document.getElementById('discover').checked, storageState: document.getElementById('storage').value });
  const form = h('form', { class: 'panel', onsubmit: async (event) => {
    event.preventDefault();
    try {
      const data = await api(`/projects/${entry.id}/settings`, { method: 'POST', body: values() });
      await loadProjects();
      if (data.pages) document.getElementById('base-url').value = data.pages.baseUrl;
      fill(message, h('div', { class: 'notice', text: data.pages ? accessText(`已保存：${data.pages.baseUrl}。下一轮检测会打开这些页面截图。`, `Saved: ${data.pages.baseUrl}. The next check will capture these pages.`) : accessText('已清除页面地址，之后的检测只配代码。', 'Page URL cleared. Subsequent checks will inspect source only.') }));
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  } },
    h('h2', { text: accessText('页面地址', 'Page URLs') }),
    h('p', { class: 'muted', text: accessText('填写后，每一轮检测会打开这些页面，把问题在截图上圈出来。需要先在本机把项目跑起来（例如 npm run dev）。', 'Checks open these pages and mark findings on screenshots. Start your project locally first (for example, npm run dev).') }),
    h('div', { class: 'field' }, h('label', { for: 'base-url', text: accessText('预览地址', 'Preview URL') }),
      h('div', { class: 'row' }, h('input', { id: 'base-url', class: 'input grow', type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'localhost:5173', value: pages.baseUrl }),
        h('button', { class: 'btn', type: 'button', onclick: () => findPreviewInto(entry, finder) }, icon('scan'), accessText('帮我找', 'Find preview'))),
      h('span', { class: 'hint', text: accessText('不知道填什么就点"帮我找"。也可以自己写，例如 localhost:5173，会自动补上 http://。', 'Find a running preview, or enter an address such as localhost:5173. UXQA adds http:// when needed.') }),
      finder),
    h('div', { class: 'field' }, h('label', { for: 'routes', text: accessText('要打开的页面（一行一个，以 / 开头）', 'Pages to open (one per line, beginning with /)') }), routes),
    h('label', { class: 'check' }, h('input', { id: 'discover', type: 'checkbox', checked: pages.discover }), accessText('自动找更多页面（读取项目里的路由，并顺着页面链接找）', 'Find more pages from project routes and page links')),
    h('div', { class: 'field' }, h('label', { for: 'storage', text: accessText('登录状态（要登录才能看到的页面需要它）', 'Login state (for pages requiring sign-in)') }),
      h('div', { class: 'row' }, h('input', { id: 'storage', class: 'input mono grow', type: 'text', placeholder: accessText('还没有登录状态', 'No login state saved'), value: pages.storageState || '' }),
        h('button', { class: 'btn', type: 'button', onclick: () => startLogin(entry, loginBox) }, accessText('打开浏览器登录', 'Open browser to sign in'))),
      loginBox,
      h('span', { class: 'hint', text: accessText('点"打开浏览器登录"，在弹出的窗口里像平时一样登录，回来点"我已登录"。登录状态只保存在这台电脑的 ~/.uxqa 里，不会写进项目。也可以填一个已有的 Playwright 登录状态文件路径。', 'Sign in in the browser, then return and confirm. Login state is stored locally in ~/.uxqa, not in your project. You can also enter an existing Playwright state file path.') })),
    message,
    h('div', { class: 'row' },
      entry.pages ? h('button', { class: 'btn quiet', type: 'button', onclick: async () => { await api(`/projects/${entry.id}/settings`, { method: 'POST', body: { baseUrl: '' } }); await loadProjects(); renderWorkspace(); } }, accessText('清除页面地址', 'Clear page URL')) : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        fill(message, h('span', { class: 'muted', text: accessText('正在试着打开…', 'Opening preview…') }));
        try { const result = await api(`/projects/${entry.id}/settings/test`, { method: 'POST', body: values() }); fill(message, h('div', { class: `notice${result.ok ? '' : ' error'}`, text: result.message })); }
        catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
      } }, accessText('试着打开', 'Test preview')),
      h('button', { class: 'btn primary', type: 'submit' }, accessText('保存', 'Save'))));
  queueMicrotask(() => {
    if (!state.focusField) return;
    const field = document.getElementById(state.focusField);
    state.focusField = null;
    if (field) { field.focus(); field.scrollIntoView({ block: 'center' }); }
  });
  const aiPanel = h('div', { class: 'notice row', role: 'note' }, h('span', { class: 'grow', text: accessText('AI 看图复核、连接 AI 助手这些所有项目通用的设置，放在左下角的"设置"里。', 'AI image review and assistant connections apply to all projects and are available in Settings.') }), h('button', { class: 'btn small', type: 'button', onclick: openGlobal }, icon('gear'), accessText('打开设置', 'Open settings')));
  fill(body, h('div', { class: 'page' }, form, aiPanel,
    h('div', { class: 'panel' }, h('h2', { text: accessText('项目', 'Project') }),
      h('div', { class: 'row' }, h('span', { class: 'grow muted mono ellipsis', title: entry.root, text: entry.root }),
        h('button', { class: 'btn', type: 'button', onclick: removeCurrent }, accessText('从列表移除', 'Remove from list'))),
      h('p', { class: 'faint', text: accessText('移除只是不在 uxqa 里显示，不会删除项目里的任何文件；检测记录保留在本机。', 'Removing a project does not delete its files. Check records remain on this computer.') }))));
}

/** Settings for the optional screenshot review: off, a vision model by API key, or the user's own AI agent over MCP. */
function nativeModelsPanel(saved, save) {
  const status = h('div', { role: 'status' });
  const providers = h('div', { class: 'stack' });
  const accounts = h('div', { class: 'stack' });
  const loginStatus = h('div', { role: 'status', class: 'stack' });
  const names = { codex: 'ChatGPT / Codex', claude: 'Claude', copilot: 'GitHub Copilot', gemini: 'Gemini Code Assist', antigravity: 'Antigravity' };
  const agent = h('select', { id: 'native-agent', class: 'input' }, Object.entries(names).map(([value, text]) => h('option', { value, text })));
  const model = h('input', { id: 'engine-model', class: 'input mono', value: ['native', 'magpie'].includes(saved.connection) ? saved.model : '', placeholder: accessText('获取模型后选择，或填写 服务商/模型名', 'Fetch models or enter provider/model') });
  const choices = h('select', { class: 'input', 'aria-label': accessText('可用模型', 'Available models') }, h('option', { value: '', text: accessText('登录或添加服务商后，点击获取模型', 'Sign in or add a provider, then fetch models') }));
  choices.addEventListener('change', () => { if (choices.value) model.value = choices.value; });
  const values = () => ({ mode: 'api', connection: 'native', model: model.value, clearKey: true });
  const section = h('div', { class: 'stack model-settings' });
  let flow, timer, capabilities = [], busy = false, flowView = '', hasConnections = false;
  const action = async (button, work) => {
    button.disabled = true;
    fill(status, h('p', { text: accessText('正在处理…', 'Working…') }));
    try { await work(); } catch (error) { fill(status, h('div', { class: 'notice error', text: error.message })); }
    finally { button.disabled = false; }
  };
  const refresh = async () => {
    const state = await api('/ai/native/state');
    capabilities = state.capabilities;
    hasConnections = state.providers.length > 0 || state.accounts.some((item) => item.on);
    fill(providers, state.providers.length ? state.providers.map((item) => h('div', { class: 'stack-tight' },
      h('div', { class: 'row' }, h('b', { class: 'grow', text: item.name }),
        h('button', { class: 'btn', type: 'button', onclick: () => editProvider(item) }, accessText('编辑', 'Edit')),
        h('button', { class: 'btn quiet', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
          if (!await confirmSheet({ title: accessText(`移除 ${item.name}？`, `Remove ${item.name}?`), body: h('p', { text: accessText('将删除 UXQA 保存的连接配置。使用这个服务商的复核会需要重新选择模型。', 'This deletes the connection saved in UXQA. Select another model for reviews using this provider.') }), confirmText: accessText('移除服务商', 'Remove provider') })) { fill(status); return; }
          await api('/ai/native/provider-delete', { method: 'POST', body: { id: item.id } }); await refresh();
          fill(status, h('p', { text: accessText('服务商已移除。', 'Provider removed.') }));
        }) }, accessText('移除', 'Remove'))),
      h('p', { class: 'faint mono', text: `${item.protocol} · ${item.baseUrl} · ${item.hasKey ? accessText('已保存密钥', 'Key saved') : accessText('未设置密钥', 'No key')}` }))) : h('p', { class: 'faint', text: accessText('还没有 API 服务商。可以添加多个服务商并在它们的模型之间切换。', 'No API providers yet. Add providers and switch between their models.') }));
    fill(accounts, state.accounts.length ? state.accounts.map((item) => h('div', { class: 'row' },
      h('span', { class: 'grow', text: `${names[item.agent] ?? item.agent} · ${item.user}${item.plan ? ` · ${item.plan}` : ''}${item.lapsed ? accessText(' · 登录已失效，请重新登录', ' · Sign-in expired; sign in again') : item.on ? accessText(' · 已启用', ' · Enabled') : accessText(' · 已停用', ' · Disabled')}` }),
      h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
        await api('/ai/native/account', { method: 'POST', body: { agent: item.agent, user: item.user, on: !item.on } }); await refresh(); fill(status, h('p', { text: item.on ? accessText('账号已停用。', 'Account disabled.') : accessText('账号已启用。', 'Account enabled.') }));
      }) }, item.on ? accessText('停用', 'Disable') : accessText('启用', 'Enable')),
      h('button', { class: 'btn quiet', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
        if (!await confirmSheet({ title: accessText('从 UXQA 移除账号？', 'Remove account from UXQA?'), body: h('p', { text: accessText(`移除 ${item.user} 在 UXQA 保存的登录凭据。`, `Remove credentials saved in UXQA for ${item.user}.`) }), confirmText: accessText('移除账号', 'Remove account') })) { fill(status); return; }
        await api('/ai/native/account', { method: 'POST', body: { agent: item.agent, user: item.user, remove: true } }); await refresh(); fill(status, h('p', { text: accessText('账号已从 UXQA 移除。', 'Account removed from UXQA.') }));
      }) }, accessText('移除', 'Remove')))) : h('p', { class: 'faint', text: accessText('还没有在 UXQA 登录的订阅账号。', 'No subscription accounts signed in to UXQA.') }));
  };
  const editProvider = (item = {}) => openOverlay((panel, close) => {
    const name = h('input', { id: 'provider-name', class: 'input', value: item.name ?? '', 'data-autofocus': true });
    const protocol = h('select', { id: 'provider-protocol', class: 'input' }, [['openai', accessText('OpenAI Chat / 兼容协议', 'OpenAI Chat / compatible')], ['responses', 'OpenAI Responses'], ['anthropic', 'Anthropic Messages'], ['gemini', 'Google Gemini']].map(([value, text]) => h('option', { value, text, selected: item.protocol === value })));
    const base = h('input', { id: 'provider-base', class: 'input mono', value: item.baseUrl ?? '', placeholder: 'https://api.example.com/v1' });
    const key = h('input', { id: 'provider-key', class: 'input mono', type: 'password', autocomplete: 'new-password', placeholder: item.hasKey ? accessText('留空保留已保存密钥；更换地址时会清除', 'Leave blank to keep the key; changing the URL clears it') : accessText('API Key（本地模型可留空）', 'API key (optional for local models)') });
    const models = h('input', { id: 'provider-models', class: 'input mono', value: (item.models ?? []).join(', '), placeholder: accessText('可选：模型名，以逗号分隔', 'Optional: model names separated by commas') });
    const clearKey = h('input', { type: 'checkbox' });
    const feedback = h('div', { role: 'status' });
    const field = (id, label, control) => h('div', { class: 'field' }, h('label', { for: id, text: label }), control);
    const submit = h('button', { class: 'btn primary', type: 'submit' }, accessText('保存服务商', 'Save provider'));
    const form = h('form', { class: 'stack', onsubmit: async (event) => {
      event.preventDefault(); submit.disabled = true; fill(feedback, h('p', { text: accessText('正在保存…', 'Saving…') }));
      try {
        await api('/ai/native/providers', { method: 'POST', body: { id: item.id, name: name.value, protocol: protocol.value, baseUrl: base.value, apiKey: key.value, clearKey: clearKey.checked, models: models.value.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean) } });
        close(true); await refresh(); fill(status, h('p', { text: accessText('服务商已保存。现在可以获取模型。', 'Provider saved. You can now fetch models.') }));
      } catch (error) { fill(feedback, h('div', { class: 'notice error', text: error.message })); }
      finally { submit.disabled = false; }
    } }, field('provider-name', accessText('服务商名称', 'Provider name'), name), field('provider-protocol', accessText('接口协议', 'Protocol'), protocol), field('provider-base', accessText('模型地址', 'Model URL'), base), field('provider-key', 'API Key', key), h('label', { class: 'row' }, clearKey, accessText('清除已保存的密钥', 'Clear saved key')), field('provider-models', accessText('自定义模型', 'Custom models'), models), feedback, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, accessText('取消', 'Cancel')), submit));
    append(panel, [h('h2', { text: item.id ? accessText('编辑服务商', 'Edit provider') : accessText('添加服务商', 'Add provider') }), form]);
  }, { label: item.id ? accessText('编辑服务商', 'Edit provider') : accessText('添加服务商', 'Add provider') });
  const showFlow = async (state) => {
    if (!flow || state.id !== flow.id) return;
    flow = state;
    clearTimeout(timer);
    const finished = ['done', 'failed', 'canceled'].includes(state.state);
    const text = state.state === 'done' ? accessText('登录成功，账号已保存到 UXQA。现在可以获取模型。', 'Signed in; the account is saved in UXQA. You can now fetch models.') : state.state === 'failed' ? accessText('登录失败，请重新开始。', 'Sign-in failed. Please try again.') : state.state === 'canceled' ? accessText('登录已取消。', 'Sign-in canceled.') : accessText('等待服务商授权，请在浏览器完成登录。', 'Waiting for provider authorization. Complete sign-in in the browser.');
    const children = [h('p', { text })];
    if (!finished) {
      if (state.url?.startsWith('https://')) children.push(h('a', { class: 'btn primary', href: state.url, target: '_blank', rel: 'noopener noreferrer', text: accessText('在浏览器继续授权', 'Continue authorization in browser') }));
      if (state.code) children.push(h('p', {}, accessText('授权码：', 'Authorization code: '), h('code', { text: state.code })));
      if (state.pasteCallback) {
        const callback = h('input', { class: 'input mono', 'aria-label': accessText('授权后的回调地址', 'Authorization callback URL'), placeholder: accessText('粘贴授权完成后浏览器地址栏中的完整地址', 'Paste the full browser URL after authorizing') });
        children.push(h('p', { class: 'faint', text: state.callbackBlocked ? accessText('本地回调端口被占用。授权后复制浏览器地址，粘贴到这里完成登录。', 'The local callback port is in use. After authorizing, paste the browser URL here to finish signing in.') : accessText('若授权后未自动完成，可以粘贴回调地址。', 'If authorization does not finish automatically, paste the callback URL.') }), callback,
          h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { const next = await api(`/ai/native/login/${state.id}`, { method: 'POST', body: { callback: callback.value } }); callback.value = ''; await showFlow(next); fill(status); }) }, accessText('提交授权回调', 'Submit callback')));
      }
      children.push(h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { await showFlow(await api(`/ai/native/login/${state.id}`, { method: 'POST', body: { cancel: true } })); fill(status); }) }, accessText('取消登录', 'Cancel sign-in')));
    }
    // Keep a person's partially pasted callback intact during status polling.
    const signature = JSON.stringify([state.id, state.state, state.url, state.code, state.pasteCallback, state.callbackBlocked]);
    if (signature !== flowView) {
      const previous = loginStatus.querySelector('input')?.value;
      fill(loginStatus, children);
      if (previous && loginStatus.querySelector('input')) loginStatus.querySelector('input').value = previous;
      flowView = signature;
    }
    if (finished) { flow = undefined; await refresh(); return; }
    timer = setTimeout(async () => {
      if (!section.isConnected) { await api(`/ai/native/login/${state.id}`, { method: 'POST', body: { cancel: true } }).catch(() => {}); flow = undefined; return; }
      try { await showFlow(await api(`/ai/native/login/${state.id}`)); }
      catch (error) {
        fill(status, h('p', { class: 'notice error', text: accessText(`暂时无法读取授权状态：${error.message}`, `Could not read authorization status: ${error.message}`) }),
          h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { if (flow) await showFlow(await api(`/ai/native/login/${flow.id}`)); fill(status); }) }, accessText('重新检查授权状态', 'Check authorization again')));
      }
    }, 1500);
  };
  append(section, [h('p', { text: accessText('在 UXQA 内管理模型连接和订阅账号。配置保存在本机，截图复核使用你选择的模型。', 'Manage model connections and subscription accounts in UXQA. Settings are stored locally; screenshot reviews use your chosen model.') }),
    h('div', { class: 'row' }, h('h3', { class: 'grow', text: accessText('API 服务商', 'API providers') }), h('button', { class: 'btn', type: 'button', onclick: () => editProvider() }, accessText('添加服务商', 'Add provider'))), providers,
    h('h3', { text: accessText('订阅账号', 'Subscription accounts') }), accounts,
    h('p', { class: 'faint', text: accessText('账号在服务商网页授权后保存到 UXQA。Claude 订阅需要本机已安装官方 Claude Code；Gemini 需要可用的 Code Assist 账号与项目。', 'Accounts are saved to UXQA after authorization with the provider. Claude subscriptions require the official Claude Code locally; Gemini requires an eligible Code Assist account and project.') }),
    h('div', { class: 'field' }, h('label', { for: 'native-agent', text: accessText('登录的订阅服务', 'Subscription service') }), agent),
    h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
      if (busy) return; busy = true;
      try {
        const capability = capabilities.find((item) => item.id === agent.value);
        if (capability && !capability.available) throw new Error(capability.reason || accessText(`请先安装官方 ${capability.requirement} 运行时，然后重试。`, `Install the official ${capability.requirement} runtime and try again.`));
        if (flow) await api(`/ai/native/login/${flow.id}`, { method: 'POST', body: { cancel: true } });
        flow = await api('/ai/native/login', { method: 'POST', body: { agent: agent.value } }); await showFlow(flow); fill(status);
      } finally { busy = false; }
    }) }, accessText('登录订阅账号', 'Sign in to subscription')), loginStatus,
    h('h3', { text: accessText('复核使用的模型', 'Model for review') }), h('div', { class: 'field' }, h('label', { for: 'engine-model', text: accessText('看图模型', 'Vision model') }), model, choices),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { const result = await api('/ai/models', { method: 'POST', body: values() }); fill(choices, h('option', { value: '', text: accessText('选择支持看图的模型', 'Select a vision model') }), result.models.map((id) => h('option', { value: id, text: id }))); fill(status, h('p', { text: result.models.length ? accessText(`已获取 ${result.models.length} 个模型，请选择并测试看图。`, `Found ${result.models.length} models. Select one and test image review.`) : hasConnections ? accessText('账号或服务商已添加，但暂未获取到模型。请检查连接后重试。', 'A connection exists but no models were returned. Check it and retry.') : accessText('还没有可用模型，请先添加服务商或登录订阅。', 'No models available. Add a provider or sign in first.') }), (result.warnings ?? []).map((text) => h('p', { class: 'notice error', text }))); }) }, accessText('获取模型', 'Fetch models')),
      h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { const result = await api('/ai/test', { method: 'POST', body: values() }); fill(status, h('div', { class: `notice${result.ok ? '' : ' error'}`, text: result.message })); }) }, accessText('测试看图连接', 'Test vision connection')),
      h('button', { class: 'btn primary', type: 'button', onclick: () => save(values()) }, accessText('保存并用于复核', 'Save for review'))), status]);
  refresh().catch((error) => fill(status, h('div', { class: 'notice error', text: error.message }), h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { await refresh(); fill(status); }) }, accessText('重试加载', 'Retry'))));
  return section;
}

async function renderAiPanel(panel) {
  let data;
  try { data = await api('/ai'); } catch (error) { fill(panel, h('h2', { text: accessText('AI 看图复核（可选）', 'AI image review (optional)') }), h('div', { class: 'notice error', text: error.message })); return; }
  const saved = data.settings;
  let mode = saved.mode === 'api' && ['native', 'magpie'].includes(saved.connection) ? 'subscription' : saved.mode;
  let saving = false;
  const message = h('div', { role: 'status' });
  const draw = () => {
    const modeButtons = h('div', { class: 'seg', role: 'group', 'aria-label': accessText('怎么用 AI 看图', 'AI image review mode') },
      [['off', '不用', 'Off'], ['api', '直接连接 API', 'Direct API'], ['subscription', '模型与账号', 'Models and accounts'], ['agent', '外部助手（MCP）', 'External assistant (MCP)']].map(([value, label, english]) => h('button', { type: 'button', 'aria-pressed': String(mode === value), onclick: () => { mode = value; draw(); } }, accessText(label, english))));
    const intro = h('p', { class: 'muted', text: accessText('程序检查之外，再让能看图的大模型看一遍截图：确认每个问题是不是真的（看几遍，结论一致才算），再按规则找程序没查到的问题。不配置也完全能用。', 'Optionally use a vision model to review screenshots, assess detected issues, and suggest additional findings. Ordinary checks work without AI.') });
    let body = null;
    if (mode === 'off') body = h('div', { class: 'row' }, h('span', { class: 'grow faint', text: accessText('现在不用 AI 看图。', 'AI image review is off.') }), saved.mode !== 'off' ? h('button', { class: 'btn primary', type: 'button', onclick: () => save({ mode: 'off' }) }, accessText('保存', 'Save')) : null);
    if (mode === 'agent') {
      body = h('div', { class: 'stack' },
        h('p', { text: accessText('可通过 UXQA 的 MCP 让已有 AI 助手复核截图；使用受该助手的账号、套餐与用量限制约束。', 'Use an existing AI assistant through UXQA MCP to review screenshots. Its account, subscription and usage limits apply.') }),
        h('ol', { class: 'howto' },
          h('li', { text: accessText('按下面"连接你的 AI 助手"里的说明接一次。', 'Connect once using the instructions below.') }),
          h('li', { text: accessText('在项目里点"开始检测"，然后对 AI 助手说"用 uxqa 复核截图"。它看完提交的结论会显示在问题旁边，标着"AI 助手（MCP）"。', 'Run a project check, then ask your assistant to review UXQA screenshots. Submitted findings are marked as AI assistant results.') })),
        h('div', { class: 'row' }, h('span', { class: 'grow' }), saved.mode !== 'agent' ? h('button', { class: 'btn primary', type: 'button', onclick: () => save({ mode: 'agent' }) }, accessText('保存', 'Save')) : h('span', { class: 'chip ok', text: accessText('已在使用', 'Active') })));
    }
    if (mode === 'subscription') body = nativeModelsPanel(saved, save);
    if (mode === 'api') {
      const preset = h('select', { id: 'ai-preset', class: 'input' }, h('option', { value: '', text: accessText('选一个服务商自动填地址（可选）', 'Choose a provider to fill the URL (optional)') }), data.presets.map((item) => h('option', { value: item.id, text: item.label })));
      const protocol = h('select', { id: 'ai-protocol', class: 'input' }, [['openai', accessText('OpenAI Chat Completions / 兼容服务', 'OpenAI Chat Completions / compatible')], ['responses', 'OpenAI Responses'], ['anthropic', 'Anthropic Messages'], ['gemini', accessText('Google Gemini 原生接口', 'Google Gemini native API')]].map(([value, text]) => h('option', { value, text, selected: saved.protocol === value })));
      const baseUrl = h('input', { id: 'ai-base', class: 'input mono', type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'https://api.openai.com/v1', value: saved.baseUrl });
      const model = h('input', { id: 'ai-model', class: 'input mono', type: 'text', autocomplete: 'off', placeholder: accessText('填你账号里能看图的模型名', 'Enter a vision-capable model name'), value: saved.model });
      const key = h('input', { id: 'ai-key', class: 'input mono', type: 'password', autocomplete: 'off', placeholder: saved.hasKey ? accessText(`已保存（${saved.keyHint}），不改就留空`, `Saved (${saved.keyHint}); leave blank to keep`) : accessText('粘贴 API Key（本机 Ollama 可以不填）', 'API key (optional for local Ollama)') });
      const passes = h('select', { id: 'ai-passes', class: 'input' }, [1, 2, 3].map((n) => h('option', { value: String(n), text: n === 1 ? accessText('看 1 遍（最省）', '1 pass (lowest cost)') : accessText(`看 ${n} 遍，结论一致才算${n === 2 ? '（推荐）' : '（最稳）'}`, `${n} passes; results must agree${n === 2 ? ' (recommended)' : ''}`), selected: saved.passes === n })));
      const maxCalls = h('input', { id: 'ai-max', class: 'input', type: 'number', min: '1', max: '500', value: String(saved.maxCalls) });
      const verify = h('input', { id: 'ai-verify', type: 'checkbox', checked: saved.verify });
      const discover = h('input', { id: 'ai-discover', type: 'checkbox', checked: saved.discover });
      preset.addEventListener('change', () => {
        const item = data.presets.find((entry) => entry.id === preset.value);
        if (!item) return;
        protocol.value = item.protocol;
        baseUrl.value = item.baseUrl;
        if (item.model) model.value = item.model; else if (!model.value) model.focus();
      });
      const values = () => ({ mode: 'api', connection: 'direct', protocol: protocol.value, baseUrl: baseUrl.value, model: model.value, apiKey: key.value, passes: Number(passes.value), maxCalls: Number(maxCalls.value), verify: verify.checked, discover: discover.checked });
      const models = h('select', { class: 'input', 'aria-label': accessText('可用模型', 'Available models') }, h('option', { value: '', text: accessText('可手动填写，也可获取模型列表', 'Enter a name or fetch models') }));
      models.addEventListener('change', () => { if (models.value) model.value = models.value; });
      body = h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); save(values()); } },
        h('div', { class: 'notice', role: 'note', text: accessText('开启后，每一轮的截图会发送给你配置的模型服务。API Key 保存在本机 UXQA 数据目录，不写进项目。按次计费的服务会产生费用，可设置每轮请求上限。', 'When enabled, screenshots are sent to the configured model service. The API key is stored in UXQA local data, outside the project. Usage may incur charges; set a per-round request limit below.') }),
        h('div', { class: 'field' }, h('label', { for: 'ai-preset', text: accessText('服务商', 'Provider') }), preset),
        h('div', { class: 'field' }, h('label', { for: 'ai-protocol', text: accessText('接口类型', 'Protocol') }), protocol),
        h('div', { class: 'field' }, h('label', { for: 'ai-base', text: accessText('模型地址', 'Model URL') }), baseUrl),
        h('div', { class: 'field' }, h('label', { for: 'ai-model', text: accessText('模型名（要支持看图）', 'Model name (vision required)') }), model, models,
          h('button', { class: 'btn small', type: 'button', onclick: async (event) => {
            const button = event.currentTarget; button.disabled = true;
            try { const result = await api('/ai/models', { method: 'POST', body: values() });
              fill(models, h('option', { value: '', text: accessText('选择支持看图的模型', 'Select a vision model') }), result.models.map((id) => h('option', { value: id, text: id })));
              fill(message, h('p', { text: result.models.length ? accessText(`已读取 ${result.models.length} 个模型，请选择后测试看图能力。`, `Found ${result.models.length} models. Select one and test vision.`) : accessText('服务没有返回可用模型，可以手动填写。', 'No models returned; you can enter one manually.') }));
            } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
            finally { button.disabled = false; }
          } }, accessText('获取模型列表', 'Fetch models'))),
        h('div', { class: 'field' }, h('label', { for: 'ai-key', text: 'API Key' }), key,
          saved.hasKey ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => save({ ...values(), apiKey: '', clearKey: true }) }, accessText('删除已保存的 Key', 'Delete saved key')) : null),
        h('div', { class: 'field' }, h('label', { for: 'ai-passes', text: accessText('每个结论看几遍', 'Review passes per finding') }), passes),
        h('label', { class: 'check' }, verify, accessText('复核程序找到的问题（判断是不是误报）', 'Review automatic findings for false positives')),
        h('label', { class: 'check' }, discover, accessText('按规则找程序没查到的问题（会再看一遍确认）', 'Find issues missed by automatic checks (with a second review)')),
        h('div', { class: 'field' }, h('label', { for: 'ai-max', text: accessText('每轮最多请求几次', 'Maximum requests per round') }), maxCalls),
        h('div', { class: 'row' }, h('span', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            fill(message, h('p', { class: 'muted', text: accessText('正在发一张小图试试…', 'Sending a small test image…') }));
            try { const result = await api('/ai/test', { method: 'POST', body: values() }); fill(message, h('div', { class: `notice${result.ok ? '' : ' error'}`, text: result.message })); }
            catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
          } }, accessText('测试连接', 'Test connection')),
          h('button', { class: 'btn primary', type: 'submit' }, accessText('保存', 'Save'))));
    }
    fill(panel, h('h2', { text: accessText('AI 看图复核（可选）', 'AI image review (optional)') }), intro, modeButtons, body, message);
  };
  const save = async (values) => {
    if (saving) return;
    saving = true;
    const controls = [...panel.querySelectorAll('button, input, select')];
    controls.forEach((control) => { control.disabled = true; });
    panel.setAttribute('aria-busy', 'true');
    try {
      const result = await api('/ai', { method: 'POST', body: values });
      Object.assign(saved, result.settings);
      mode = saved.mode === 'api' && ['native', 'magpie'].includes(saved.connection) ? 'subscription' : saved.mode;
      draw();
      fill(message, h('div', { class: 'notice', text: saved.mode === 'off' ? accessText('已关闭 AI 看图。', 'AI image review is off.') : saved.mode === 'api' ? accessText('已保存。下一轮检测完会自动让 AI 看截图；已有的检测也可以在问题列表上方点"AI 看图复核"。', 'Saved. AI will review screenshots after the next check; existing rounds can also be reviewed from the findings list.') : accessText('已保存。检测后对你的 AI 助手说"用 uxqa 复核截图"。', 'Saved. After checking, ask your AI assistant to review the screenshots with UXQA.') }));
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
    finally { saving = false; panel.removeAttribute('aria-busy'); controls.forEach((control) => { control.disabled = false; }); }
  };
  draw();
}

async function startLogin(entry, box) {
  if (!entry.pages || !entry.pages.baseUrl) { fill(box, h('div', { class: 'notice error', text: accessText('请先填写并保存预览地址。', 'Save a preview URL first.') })); return; }
  try { await api(`/projects/${entry.id}/login/start`, { method: 'POST' }); }
  catch (error) {
    if (error.status === 409 && error.data.browser) {
      if (await browserSheet(error.data.browser, { purpose: 'login' }) === 'installed') return startLogin(entry, box);
      return;
    }
    fill(box, h('div', { class: 'notice error', text: error.message })); return;
  }
  fill(box, h('div', { class: 'notice stack' },
    h('span', { text: accessText('已经打开了一个浏览器窗口。请在里面登录你的产品，登录好后回到这里点"我已登录"。', 'A browser window is open. Sign in to your product there, then return and select “I have signed in”.') }),
    h('div', { class: 'row' },
      h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
        try {
          const data = await api(`/projects/${entry.id}/login/finish`, { method: 'POST' });
          await loadProjects();
          document.getElementById('storage').value = data.saved;
          fill(box, h('div', { class: 'notice', text: accessText('已保存登录状态。下一轮检测会带着登录去打开页面。', 'Login state saved. The next check will use it to open pages.') }));
        } catch (error) { fill(box, h('div', { class: 'notice error', text: error.message })); }
      } }, accessText('我已登录', 'I have signed in')),
      h('button', { class: 'btn small', type: 'button', onclick: async () => { await api(`/projects/${entry.id}/login/cancel`, { method: 'POST' }).catch(() => undefined); fill(box); } }, accessText('取消', 'Cancel')))));
}

async function removeCurrent() {
  const entry = project();
  const ok = await confirmSheet({ title: accessText(`从列表移除 ${entry.name}？`, `Remove ${entry.name} from the list?`), body: h('p', { text: accessText('只是从 uxqa 的项目列表里移除，不会删除项目里的任何文件。这个项目的检测记录会保留在本机。', 'This removes the project from the list, not its files. Check records remain on this computer.') }), confirmText: accessText('移除', 'Remove') });
  if (!ok) return;
  await api(`/projects/${entry.id}`, { method: 'DELETE' });
  state.current = null;
  await loadProjects();
  if (state.projects[0]) await selectProject(state.projects[0].id); else renderWorkspace();
}

// ---------- start ----------
(async () => {
  if (!token) {
    renderRail();
    fill(document.getElementById('workspace'), h('div'), emptyState('info', '请用启动时给出的链接打开 / Open the launch link', '在终端运行 uxqa ui，它会打印一个带访问令牌的链接。 / Run uxqa ui in a terminal and open the link it prints.'));
    return;
  }
  try { await initializeAccess(); await loadProjects(); }
  catch (error) { fill(document.getElementById('workspace'), h('div'), emptyState('info', accessText('打不开控制台', 'Could not open console'), error.message)); return; }
  const wanted = new URLSearchParams(location.search);
  const start = state.projects.find((entry) => entry.id === wanted.get('project')) || state.projects[0];
  if (wanted.get('settings')) {
    if (start) await selectProject(start.id);
    openGlobal();
    return;
  }
  if (start) {
    await selectProject(start.id);
    if (TABS.some(([id]) => id === wanted.get('tab'))) { state.tab = wanted.get('tab'); renderWorkspace(); }
  } else renderWorkspace();
  // ?open=add|prompt|notes|changes opens that panel directly, so a link can point at it.
  const panel = wanted.get('open');
  if (panel === 'add') openAddProject();
  else if (panel === 'prompt' && state.round) openPrompt();
  else if (panel === 'notes' && state.round) openRoundNotes();
  else if (panel === 'reuse' && state.round && state.round.capture && state.round.capture.reuse && state.round.capture.reuse.length) openReuse();
  else if (panel === 'changes' && state.round && state.round.capture && state.round.capture.changes && state.round.capture.changes.length) openChanges();
})();
