'use strict';

// ---------- basics ----------
const params = new URLSearchParams(location.hash.slice(1));
const token = params.get('t') || sessionStorage.getItem('uxqa-token') || '';
if (params.get('t')) { sessionStorage.setItem('uxqa-token', token); history.replaceState(null, '', `${location.pathname}${location.search}`); }
// Opening the start link in a tab already on this page only changes the hash: reload to pick up the new token.
window.addEventListener('hashchange', () => { if (new URLSearchParams(location.hash.slice(1)).get('t')) location.reload(); });

const LEVEL = { must: '需要改', default: '建议改', reference: '可以看看' };
const PAGE_SIZE = 80;

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method || 'GET',
    headers: { 'x-uxqa-token': token, ...(options.body ? { 'content-type': 'application/json' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) {
    const error = new Error(data.error || `请求失败（${response.status}）`);
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
    toast(`已复制${what}`);
  } catch {
    const area = h('textarea', { class: 'sr-only' });
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    toast(ok ? `已复制${what}` : '复制失败，请手动选中文字复制');
  }
}

function timeText(iso) {
  const date = new Date(iso);
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
function openOverlay(build, { kind = 'sheet', label } = {}) {
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
    const wrap = h('div', { class: kind === 'drawer' ? 'drawer-wrap' : 'backdrop', onclick: (event) => { if (event.target === wrap) close(false); } }, panel);
    function onKey(event) {
      if (event.key === 'Escape') { event.preventDefault(); close(false); }
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

function confirmSheet({ title, body, confirmText, cancelText = '取消' }) {
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
const mib = (bytes) => (bytes ? `${(bytes / 1048576).toFixed(1)} MiB` : '大小未知');

function browserFacts(info) {
  const official = info.files.every((file) => OFFICIAL_HOSTS.includes(new URL(file.url).host));
  return h('ul', { class: 'facts' },
    h('li', {}, h('b', { text: '用途：' }), info.purpose),
    h('li', {}, h('b', { text: '文件：' }), info.files.map((file, index) => [index ? '、' : '', h('span', { class: 'mono', text: file.name }), `（${mib(file.bytes)}）`])),
    h('li', {}, h('b', { text: '来源：' }), h('span', { class: 'mono', text: info.source }), official ? '（Playwright 官方下载地址）' : '（你设置的下载镜像）', info.servedBy ? ['，实际从 ', h('span', { class: 'mono', text: info.servedBy }), ' 下载'] : ''),
    h('li', {}, h('b', { text: '保存到：' }), h('span', { class: 'mono', text: info.location })),
    h('li', {}, h('b', { text: '合计：' }), info.totalBytes ? mib(info.totalBytes) : '大小未知（连不上下载地址时读不到大小）', '。下载一次，以后不用再下。'));
}

/** Shows what would be downloaded and waits for a clear yes. Resolves 'installed', 'skip' (go on without screenshots) or false. */
function browserSheet(info, { purpose = 'check' } = {}) {
  const title = purpose === 'login' ? '打开登录窗口需要先下载浏览器组件' : '给页面截图需要先下载浏览器组件';
  return openOverlay((panel, close) => {
    const skipText = purpose === 'login' ? '先不下' : '先不下，只检查源码';
    const ask = () => fill(panel,
      h('h2', { text: title }),
      h('p', { text: 'uxqa 要用一个浏览器打开你的页面。它比较大，所以没有放进安装包，第一次用到时才下载，下载前先问你。' }),
      browserFacts(info),
      h('div', { class: 'notice', role: 'note', text: purpose === 'login' ? '不下载的话，也可以在"页面地址"里填一个已有的登录状态文件。' : '不下载也可以：源码检查照常进行，只是这一轮没有截图和页面检查。' }),
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', 'data-autofocus': true, onclick: () => close('skip') }, skipText),
        h('button', { class: 'btn primary', type: 'button', onclick: download }, '同意下载')));
    const download = async () => {
      const bar = h('span', {});
      const meter = h('span', { class: 'dl-bar', role: 'progressbar', 'aria-label': '下载进度', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar);
      const message = h('p', { class: 'muted', role: 'status', text: '正在开始下载…' });
      fill(panel, h('h2', { text: '正在下载浏览器组件' }), browserFacts(info), meter, message,
        h('div', { class: 'row' }, h('span', { class: 'grow faint', text: '可以先关掉这个窗口，下载会在后台继续。' }), h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, '关闭')));
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
      if (install && install.state === 'done') { toast('浏览器组件已下载好'); close('installed'); return; }
      fill(panel, h('h2', { text: '浏览器组件没有下载成功' }),
        h('div', { class: 'notice error', role: 'alert', text: (install && install.error) || '原因不明' }),
        h('p', { class: 'muted', text: '网络不通时可以稍后再试；也可以设置 PLAYWRIGHT_DOWNLOAD_HOST 用镜像下载（见安装说明）。' }),
        h('div', { class: 'row' }, h('span', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', 'data-autofocus': true, onclick: () => close('skip') }, skipText),
          h('button', { class: 'btn primary', type: 'button', onclick: download }, '再试一次')));
    };
    ask();
  }, { label: title });
}

/** Global settings panel: is the browser here, and a way to download it ahead of time. */
async function renderBrowserPanel(panel) {
  let data;
  try { data = await api('/browser'); } catch (error) { fill(panel, h('h2', { text: '浏览器组件' }), h('div', { class: 'notice error', text: error.message })); return; }
  const info = data.browser;
  if (info.ready) {
    fill(panel, h('h2', { text: '浏览器组件' }),
      h('div', { class: 'row' }, h('span', { class: 'chip ok', text: '已就绪' }), h('span', { class: 'grow muted', text: '截图和页面检查可以直接用。' })),
      h('p', { class: 'faint' }, '位置：', h('span', { class: 'mono', text: info.location })));
    return;
  }
  fill(panel, h('h2', { text: '浏览器组件' }),
    h('p', { class: 'muted', text: '还没有下载。只检查源码不需要它；要截图和检查页面时才需要，下载前会先问你。' }),
    browserFacts(info),
    h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: async () => { await browserSheet(info, { purpose: 'settings' }); renderBrowserPanel(panel); } }, '查看并下载')));
}

// ---------- state ----------
const state = {
  projects: [],
  current: null,
  tab: 'issues',
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
    h('div', { class: 'rail-head' }, h('img', { class: 'logo', src: '/icon.png', alt: '' }), h('span', { class: 'brand' }, 'UXQA', h('small', { text: '组件守门员' }))),
    h('div', { class: 'rail-label', text: '项目' }),
    h('div', { class: 'rail-list' }, state.projects.length ? state.projects.map((entry) => {
      const last = entry.lastRound;
      return h('button', { class: 'project', type: 'button', 'data-button-wrap': 'allow', 'aria-current': entry.id === state.current && !state.global ? 'true' : 'false', title: entry.root, onclick: () => selectProject(entry.id) },
        avatar(entry.name),
        h('span', { class: 'project-text' }, h('span', { class: 'project-name ellipsis', text: entry.name }), h('span', { class: 'project-sub ellipsis', text: last ? `上次检测 ${timeText(last.at)}` : '还没检测过' })),
        last ? h('span', { class: `count${last.newMust ? '' : ' zero'}`, 'aria-label': `${last.newMust} 个需要改`, text: last.newMust ? String(last.newMust) : '✓' }) : null);
    }) : h('p', { class: 'faint', text: '还没有项目' })),
    h('div', { class: 'rail-foot' },
      h('button', { class: 'btn block', type: 'button', onclick: openAddProject, title: '添加项目' }, icon('plus'), h('span', { class: 'label', text: '添加项目' })),
      h('button', { class: `rail-settings${state.global ? ' active' : ''}`, type: 'button', 'aria-current': state.global ? 'page' : undefined, title: '设置（所有项目通用）', onclick: openGlobal }, icon('gear'), h('span', { class: 'label', text: '设置' }))));
}

function openAddProject() {
  let candidates = null;
  let scanning = true;
  let folder = '~/Projects';
  let error = '';
  let value = '';
  let preview = '';
  return openOverlay((panel, close) => {
    const submit = async (path) => {
      let data;
      try { data = await api('/projects', { method: 'POST', body: { path } }); }
      catch (failure) { error = failure.message; value = path; render(); panel.querySelector('#add-path').focus(); return; }
      close(true);
      await afterAdd(data, preview);
    };
    const render = () => {
      const input = h('input', { id: 'add-path', class: 'input mono', type: 'text', placeholder: '/Users/you/Projects/my-app', autocomplete: 'off', value, 'aria-invalid': error ? 'true' : undefined, 'aria-describedby': 'add-note', oninput: (event) => { value = event.target.value; } });
      const found = candidates || [];
      fill(panel,
        h('div', { class: 'row' }, h('h2', { class: 'grow', text: '添加项目' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', onclick: () => close(false) }, icon('close'))),
        // Found projects come first: one click is easier than typing a folder path.
        h('div', { class: 'stack-tight' },
          h('div', { class: 'row' }, h('span', { class: 'section-title grow' }, icon('scan'), scanning ? '正在你电脑上找前端项目…' : `在 ${folder} 里找到 ${found.length} 个前端项目`),
            h('button', { class: 'btn small quiet', type: 'button', 'aria-disabled': scanning ? 'true' : undefined, onclick: () => { if (!scanning) scan(); } }, '重新扫描')),
          scanning ? null
            : found.length ? h('div', { class: 'candidates' }, found.map((candidate) => h('div', { class: 'candidate' },
              avatar(candidate.name),
              h('div', { class: 'grow' }, h('div', { class: 'ellipsis', text: candidate.name }), h('div', { class: 'faint ellipsis', title: candidate.root, text: `${candidate.why} · ${candidate.root}` })),
              candidate.added
                ? h('button', { class: 'btn small', type: 'button', onclick: () => { close(false); selectProject(candidate.id); } }, '已添加，打开')
                : h('button', { class: 'btn small primary', type: 'button', 'data-autofocus': !found.some((other) => !other.added && found.indexOf(other) < found.indexOf(candidate)) ? true : undefined, onclick: () => submit(candidate.root) }, '添加'))))
            : h('p', { class: 'muted', text: '没找到前端项目。可以在下面写项目文件夹。' })),
        h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); submit(value); } },
          h('div', { class: 'field' },
            h('label', { for: 'add-path', text: '或者写项目文件夹' }), input,
            error ? h('span', { class: 'error-text', id: 'add-note', role: 'alert', text: error }) : h('span', { class: 'hint', id: 'add-note', text: '有 package.json 的那一层或它下面任意一层都可以。在访达里选中文件夹按 ⌥⌘C 可以复制它的路径。' })),
          h('div', { class: 'field' },
            h('label', { for: 'add-preview', text: '本地预览地址（可不填）' }),
            h('input', { id: 'add-preview', class: 'input', type: 'text', inputmode: 'url', placeholder: 'localhost:5173', autocomplete: 'off', value: preview, oninput: (event) => { preview = event.target.value; } }),
            h('span', { class: 'hint', text: '不填也行：添加后会自动去找这个项目在本机的预览地址。' })),
          h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn primary', type: 'submit' }, '添加'))));
    };
    const scan = () => {
      scanning = true;
      render();
      api('/discover', { method: 'POST', body: {} })
        .then((result) => { candidates = result.candidates; folder = result.folder || folder; })
        .catch(() => { candidates = []; })
        .finally(() => { scanning = false; if (panel.isConnected) { const focused = document.activeElement && document.activeElement.id; render(); const again = focused && document.getElementById(focused); if (again) again.focus(); else (panel.querySelector('[data-autofocus]') || panel.querySelector('input'))?.focus(); } });
    };
    scan();
  }, { label: '添加项目' });
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
  toast(`已添加 ${data.project.name}${data.library.library ? '' : '（没有找到组件库）'}${found ? `，自动找到预览地址 ${found}` : ''}`);
  await selectProject(data.project.id);
  if (previewProblem) { state.tab = 'settings'; renderWorkspace(); toast(`预览地址没保存：${previewProblem}`); }
}

async function loadProjects() {
  state.projects = (await api('/projects')).projects;
  renderRail();
}

async function selectProject(id) {
  Object.assign(state, { global: false, current: id, tab: 'issues', round: null, rounds: [], library: null, level: 'all', title: 'all', query: '', withShot: false, selected: null, shown: PAGE_SIZE, error: '' });
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
const TABS = [['issues', '问题'], ['components', '组件库'], ['rules', '规则'], ['settings', '页面']];

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
  const ai = h('div', { class: 'panel' }, h('h2', { text: 'AI 看图复核（可选）' }), h('p', { class: 'muted', text: '正在读取…' }));
  const agent = h('div', { class: 'panel' }, h('h2', { text: '连接你的 AI 助手' }), h('p', { class: 'muted', text: '正在读取…' }));
  const data = h('div', { class: 'panel' }, h('h2', { text: '数据存放' }), h('p', { class: 'muted', text: '正在读取…' }));
  const browser = h('div', { class: 'panel' }, h('h2', { text: '浏览器组件' }), h('p', { class: 'muted', text: '正在读取…' }));
  fill(workspace,
    h('header', { class: 'topbar' }, h('div', { class: 'topbar-row' }, h('div', { class: 'title grow' }, h('h1', { text: '设置' }), h('span', { text: '这里的设置所有项目通用' })))),
    h('section', { class: 'content' }, h('div', { class: 'page' }, ai, agent, browser, data)));
  renderAiPanel(ai);
  renderBrowserPanel(browser);
  api('/ai').then((info) => {
    const quote = (value) => (/[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
    const argv = [...info.mcp.args, 'mcp'];
    const claude = `claude mcp add uxqa -- ${[info.mcp.command, ...argv].map(quote).join(' ')}`;
    const codex = `[mcp_servers.uxqa]\ncommand = ${JSON.stringify(info.mcp.command)}\nargs = ${JSON.stringify(argv)}`;
    const cursor = JSON.stringify({ mcpServers: { uxqa: { command: info.mcp.command, args: argv } } }, null, 2);
    const block = (title, text, what) => h('li', {}, title, h('pre', { class: 'mono code-snippet', text }), h('button', { class: 'btn small', type: 'button', onclick: () => copy(text, what) }, icon('copy'), '复制'));
    fill(agent, h('h2', { text: '连接你的 AI 助手' }),
      h('p', { class: 'muted', text: '接上以后，AI 写界面前会先查组件库、写完会自己检查；用订阅会员的 AI 助手也能帮你"看图复核"。只需要接一次：AI 助手在哪个项目里打开，就检查哪个项目。' }),
      h('ol', { class: 'howto' },
        block('Claude Code：在终端运行', claude, '命令'),
        block('Codex：加到 ~/.codex/config.toml', codex, '配置'),
        block('Cursor 等：加到 MCP 配置（mcp.json）', cursor, '配置')),
      h('p', { class: 'faint', text: '接好后可以对 AI 说："用 uxqa 检测一下页面"、"用 uxqa 复核截图"、"写按钮前先用 uxqa 找组件"。' }));
    fill(data, h('h2', { text: '数据存放' }),
      h('p', {}, '项目列表、检测记录和 AI 设置保存在这台电脑的 ', h('code', { class: 'mono', text: info.home }), ' 里，不会写进你的项目。启用 AI 看图后，截图会发送给你选择的模型服务。'),
      h('p', { class: 'faint', text: '只有两种情况会写进项目：你在"规则"或"组件库来源"里点了保存（写 .uxqa/rules.json），或者把现有问题记为老问题（写 .uxqa/baseline.json），每次都会先让你确认。' }));
  }, (error) => fill(agent, h('h2', { text: '连接你的 AI 助手' }), h('div', { class: 'notice error', text: error.message })));
}

function renderWorkspace() {
  rememberPlace();
  const workspace = document.getElementById('workspace');
  if (state.global) { renderGlobal(workspace); return; }
  const entry = project();
  if (!entry) {
    const welcomeFound = state.welcomeFound || (state.welcomeFound = h('div', {}));
    fill(workspace, h('div'), h('div', { class: 'content' }, h('div', { class: 'welcome' },
      h('h1', { text: '三步看清前端哪里不对' }),
      h('p', { class: 'muted', text: 'uxqa 帮你检查 AI 写的界面：有没有用组件库、有没有重复造轮子、窄屏时文字有没有乱，并在截图上圈出来，再生成一段可以直接发给 AI 的修改说明。它只读你的代码，不会改。' }),
      h('ol', { class: 'steps' },
        step(1, '添加项目', '点下面找到的项目，或者自己选文件夹。', h('button', { class: 'btn', type: 'button', onclick: openAddProject }, icon('plus'), '自己选文件夹')),
        step(2, '预览地址（自动找）', '添加时会自动找项目在本机跑着的地址；没跑起来会告诉你用哪条命令启动。有了地址，问题就能配上截图。'),
        step(3, '开始检测，让 AI 修', '看完问题，点"让 AI 修"复制给写代码的 AI，改完再检测一次。')),
      welcomeFound)));
    if (!state.welcomeScanned) {
      state.welcomeScanned = true;
      fill(welcomeFound, h('p', { class: 'muted', role: 'status', text: '正在你的电脑上找前端项目…' }));
      api('/discover', { method: 'POST', body: {} }).then(({ candidates }) => {
        const fresh = candidates.filter((candidate) => !candidate.added).slice(0, 12);
        fill(welcomeFound, fresh.length ? h('div', { class: 'panel' }, h('h2', { text: `在你电脑上找到 ${fresh.length} 个前端项目，点一下就能添加` }),
          fresh.map((candidate) => h('div', { class: 'candidate' }, avatar(candidate.name),
            h('div', { class: 'grow' }, h('div', { class: 'ellipsis', text: candidate.name }), h('div', { class: 'faint ellipsis', title: candidate.root, text: `${candidate.why} · ${candidate.root}` })),
            h('button', { class: 'btn small primary', type: 'button', onclick: () => addProjectPath(candidate.root) }, '添加'))))
          : h('p', { class: 'muted', text: '没有在 ~/Projects 里找到前端项目，点"自己选文件夹"添加。' }));
      }).catch(() => fill(welcomeFound));
    }
    return;
  }
  const library = state.library;
  const chip = !library ? h('span', { class: 'chip', text: '正在读取组件库…' })
    : library.library ? h('span', { class: 'chip ok', title: `组件库目录：${library.library}`, text: `组件库 · ${library.components} 个组件` })
      : h('span', { class: 'chip warn', text: '没有找到组件库' });
  const nav = h('div', { class: 'nav', role: 'tablist', 'aria-label': '项目功能' }, TABS.map(([id, label]) => h('button', {
    type: 'button', role: 'tab', id: `tab-${id}`, 'aria-selected': state.tab === id ? 'true' : 'false', tabindex: state.tab === id ? '0' : '-1',
    onclick: () => { state.tab = id; renderWorkspace(); },
    onkeydown: (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      const index = TABS.findIndex(([key]) => key === id);
      const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0];
      state.tab = next; renderWorkspace(); document.getElementById(`tab-${next}`).focus();
    },
  }, label)));
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'topbar-row' },
      h('div', { class: 'title grow' }, h('h1', { class: 'ellipsis', text: entry.name }), h('span', { class: 'ellipsis', title: entry.root, text: entry.root })),
      chip,
      state.round ? h('button', { class: 'btn quiet', type: 'button', onclick: openPrompt }, icon('wand'), '让 AI 修') : null,
      runner()),
    nav);
  const body = h('section', { class: state.tab === 'issues' ? '' : 'content', role: 'tabpanel', 'aria-labelledby': `tab-${state.tab}` });
  body.style.minHeight = '0';
  fill(workspace, topbar, body);
  if (state.tab === 'issues') renderIssues(body);
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
  if (!job || job.state !== 'running') return h('button', { id: 'runner', class: 'btn primary', type: 'button', onclick: startCheck }, icon('play'), '开始检测');
  const percent = job.phase === 'source' ? 6 : job.phase === 'saving' ? 100 : job.total ? Math.max(8, Math.round((job.done / job.total) * 100)) : 8;
  const fillBar = h('span');
  fillBar.style.width = `${percent}%`;
  return h('div', { id: 'runner', class: 'runner', role: 'status', 'aria-live': 'polite' },
    h('span', { class: 'ellipsis', text: job.phase === 'source' ? '检查源码…' : job.phase === 'pages' ? job.message : '保存结果…' }),
    h('span', { class: 'bar', role: 'progressbar', 'aria-label': '检测进度', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(percent) }, fillBar),
    h('button', { type: 'button', onclick: cancelCheck }, '取消'));
}

function updateRunner() {
  const current = document.getElementById('runner');
  if (current) current.replaceWith(runner());
}

async function startCheck(options = {}) {
  if (state.job && state.job.state === 'running') return;
  // The first start may check whether the screenshot browser is here, which can take a few seconds.
  const slow = setTimeout(() => toast('正在准备检测…'), 700);
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
    else { toast(error.message); return; }
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
  if (job.state === 'failed') { toast(`检测失败：${job.error}`); updateRunner(); return; }
  state.rounds = (await api(`/projects/${projectId}/rounds`)).rounds;
  if (job.roundId) await openRound(job.roundId, false);
  await loadProjects();
  state.tab = 'issues';
  renderWorkspace();
  toast(job.state === 'cancelled' ? '已取消，保留了已完成的部分' : job.phase === 'ai' && job.message ? job.message : '检测完成');
}

/** Ask the configured vision model to look at this round's screenshots (runs in the background like a check). */
async function startReview() {
  if (state.job && state.job.state === 'running') return;
  try { state.job = (await api(`/projects/${state.current}/rounds/${state.round.id}/ai-review`, { method: 'POST' })).job; }
  catch (error) { toast(error.message); return; }
  updateRunner();
  pollJob(state.current);
}

const AI_WORD = { real: 'AI 看图：确实有', 'not-real': 'AI 看图：可能是误报', unsure: 'AI 看图：看不准' };

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
  state.shown = PAGE_SIZE;
  const fresh = freshViolations();
  if (!fresh.some((violation) => violation.fingerprint === state.selected)) state.selected = fresh[0] ? fresh[0].fingerprint : null;
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
    hint.textContent = all ? '一次发太多，AI 容易漏改或改乱；问题多时建议分批。' : `先把最要紧的 ${FIRST} 个发给 AI，改完检测一次，再复制下一批。`;
    for (const button of document.querySelectorAll('.drawer .seg button')) button.setAttribute('aria-pressed', String(button.textContent.startsWith('全部') === all));
  };
  queueMicrotask(show);
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: '给 AI 的修复提示' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' },
        h('ol', { class: 'howto' },
          h('li', { text: '点下面的"复制"。' }),
          h('li', { text: '粘贴给帮你写代码的 AI（Claude Code、Cursor、Codex 等），发送。' }),
          h('li', { text: 'AI 改完后回到这里，点右上角"开始检测"，看问题有没有变少。' })),
        total > FIRST ? h('div', { class: 'seg', role: 'group', 'aria-label': '复制多少个问题' },
          h('button', { type: 'button', 'aria-pressed': String(!all), onclick: () => { all = false; show(); } }, `先修最重要的 ${FIRST} 个（推荐）`),
          h('button', { type: 'button', 'aria-pressed': String(all), onclick: () => { all = true; show(); } }, `全部 ${total} 个`)) : null,
        hint, text),
      h('div', { class: 'drawer-foot' }, h('span', { class: 'grow faint', text: `第 ${state.round.number} 轮` }), h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => copy(all ? state.prompt : state.promptFirst, '修复提示') }, icon('copy'), '复制')),
    ]);
  }, { kind: 'drawer', label: '给 AI 的修复提示' });
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
      h('h1', { text: '准备好了就开始检测' }),
      h('ol', { class: 'steps' },
        h('li', { class: 'step done' }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, icon('check')), h('div', { class: 'grow' }, h('strong', { text: '已添加项目' }),
          h('p', { class: 'muted', text: library ? (library.library ? `找到了组件库 ${library.library}，共 ${library.components} 个组件。` : '没有找到组件库，只能检查写死的颜色和尺寸。可以在"规则"里指定组件库目录。') : '正在读取组件库…' }))),
        h('li', { class: `step${entry.pages ? ' done' : ''}` }, h('span', { class: 'step-num', 'aria-hidden': 'true' }, entry.pages ? icon('check') : '2'), h('div', { class: 'grow' }, h('strong', { text: entry.pages ? `预览地址：${entry.pages.baseUrl}` : '填预览地址（可选）' }),
          h('p', { class: 'muted', text: entry.pages ? '检测时会打开这些页面截图，并把页面从宽到窄检查一遍。' : '不填也能检测源码；填了以后，问题会配上截图，还能检查窄屏时文字换行、没对齐这些问题。' })),
          entry.pages ? null : h('button', { class: 'btn', type: 'button', onclick: () => { state.tab = 'settings'; state.focusField = 'base-url'; renderWorkspace(); } }, '去填写')),
        h('li', { class: 'step' }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: '3' }), h('div', { class: 'grow' }, h('strong', { text: '开始检测' }), h('p', { class: 'muted', text: '源码检查几秒钟；打开页面截图会多花一些时间，可以随时取消。' })),
          h('button', { class: 'btn primary', type: 'button', onclick: startCheck }, icon('play'), '开始检测'))))));
    return;
  }
  const fresh = freshViolations();
  const numbered = new Map(fresh.map((violation, index) => [violation.fingerprint, index + 1]));
  const query = state.query.trim().toLowerCase();
  const hasShot = (violation) => { const capture = state.round.capture && state.round.capture.captures[violation.fingerprint]; return !!(capture && capture.shots && capture.shots.length); };
  const filtered = fresh.filter((violation) => (state.level === 'all' || violation.level === state.level)
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
  const roundSelect = h('select', { class: 'round-select', 'aria-label': '选择检测轮次', onchange: (event) => openRound(event.target.value) },
    state.rounds.map((entry) => h('option', { value: entry.id, text: `第 ${entry.number} 轮 · ${timeText(entry.at)}`, selected: entry.id === round.id })));
  const doubted = fresh.filter((violation) => violation.ai && violation.ai.verdict === 'not-real').length;
  const review = state.review || { mode: 'off', pending: 0 };
  const reviewBar = !review.pending ? null
    : review.mode === 'api' ? h('div', { class: 'tip' }, h('span', { class: 'grow', text: `有 ${review.pending} 项截图还没让 AI 看过。AI 会再看一遍，确认问题是不是真的，并找程序漏掉的问题。` }), h('button', { class: 'btn small primary', type: 'button', onclick: startReview }, 'AI 看图复核'))
    : review.mode === 'agent' ? h('div', { class: 'tip' }, h('span', { class: 'grow' }, `有 ${review.pending} 项截图等你的 AI 助手复核：在 Claude Code、Codex 等里说`, h('strong', { text: '「用 uxqa 复核截图」' }), '。'))
    : null;
  const levelFilters = [['all', `全部 ${fresh.length}`, null], ...['must', 'default', 'reference'].map((level) => [level, `${LEVEL[level]} ${fresh.filter((violation) => violation.level === level).length}`, level])];
  const list = h('div', { class: 'issues', role: 'listbox', 'aria-label': '问题列表', onkeydown: (event) => {
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
      h('span', { class: 'grow' }, h('div', { class: 'row-title ellipsis', title: violation.name, text: violation.name }), h('div', { class: 'row-sub ellipsis', text: `${violation.title} · ${violation.line ? `${violation.file.split('/').pop()}:${violation.line}` : violation.file}${violation.ai ? ` · ${AI_WORD[violation.ai.verdict]}` : ''}` })),
      h('span', { class: 'row-end' }, capture && capture.shots && capture.shots.length ? h('span', { title: '有截图' }, icon('image')) : null, h('span', { class: `dot ${violation.level}`, title: LEVEL[violation.level] }))));
  }
  const emptyNote = filtered.length ? null : h('p', { class: 'muted list-empty', text: fresh.length ? '没有符合筛选的问题。' : '这一轮没有新问题。' });
  const foot = (h('div', { class: 'list-foot row' },
    filtered.length > state.shown ? h('button', { class: 'btn small', type: 'button', onclick: () => { state.shown += PAGE_SIZE; renderWorkspace(); } }, `再显示 ${Math.min(PAGE_SIZE, filtered.length - state.shown)} 个`) : null,
    h('span', { class: 'grow' }),
    h('button', { class: 'btn small quiet', type: 'button', onclick: openRoundNotes }, icon('info'), '本轮说明')));
  const scroller = h('div', { class: 'list-scroll' }, emptyNote, list, foot);
  return h('div', { class: 'list-pane' },
    h('div', { class: 'list-head' },
      h('div', { class: 'row' }, roundSelect),
      h('div', { class: 'delta' }, round.number > 1
        ? ['比上一轮：', h('span', { class: round.appeared ? 'up' : '', text: `新出现 ${round.appeared}` }), ' · ', h('span', { class: round.resolved ? 'down' : '', text: `修好 ${round.resolved}` })]
        : `检查了 ${round.filesScanned} 个文件${round.screenshots ? `，${round.screenshots} 个问题配了截图` : ''}`),
      round.partial ? h('div', { class: 'notice warn', role: 'status', text: round.partial }) : null,
      changedBar(round),
      reuseBar(round),
      reviewBar,
      fresh.length && localStorage.getItem('uxqa-tip-next') !== 'hidden' ? h('div', { class: 'tip' },
        h('span', { class: 'grow' }, '下一步：点右上角', h('strong', { text: '「让 AI 修」' }), '复制给写代码的 AI；它改完后，再点「开始检测」看问题有没有变少。'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '不再提示', onclick: () => { localStorage.setItem('uxqa-tip-next', 'hidden'); renderWorkspace(); } }, icon('close'))) : null,
      h('div', { class: 'filters', role: 'group', 'aria-label': '按严重程度筛选' }, levelFilters.map(([value, label, dot]) => h('button', {
        class: 'filter', type: 'button', 'aria-pressed': state.level === value ? 'true' : 'false',
        onclick: () => { state.level = value; state.shown = PAGE_SIZE; renderWorkspace(); },
      }, dot ? h('span', { class: `dot ${dot}` }) : null, label)),
        round.screenshots ? h('button', { class: 'filter', type: 'button', 'aria-pressed': state.withShot ? 'true' : 'false', onclick: () => { state.withShot = !state.withShot; state.shown = PAGE_SIZE; renderWorkspace(); } }, icon('image'), `有截图 ${round.screenshots}`) : null,
        doubted ? h('button', { class: 'filter', type: 'button', 'aria-pressed': state.aiDoubt ? 'true' : 'false', onclick: () => { state.aiDoubt = !state.aiDoubt; state.shown = PAGE_SIZE; renderWorkspace(); } }, `AI 认为可能误报 ${doubted}`) : null),
      h('div', { class: 'row' },
        h('div', { class: 'search grow' }, icon('search'), h('input', { class: 'input', type: 'search', placeholder: '搜问题、文字或文件名', 'aria-label': '搜索问题', value: state.query, oninput: (event) => { state.query = event.target.value; state.shown = PAGE_SIZE; renderKeepingFocus('.search input'); } })),
        h('select', { class: 'input', 'aria-label': '按问题种类筛选', onchange: (event) => { state.title = event.target.value; state.shown = PAGE_SIZE; renderWorkspace(); } },
          h('option', { value: 'all', text: '所有种类', selected: state.title === 'all' }),
          titles.map((title) => h('option', { value: title, text: title, selected: state.title === title }))))),
    scroller);
}

/** "Pages that look different from the previous round", for checking that a refactor did not change the look. */
function changedBar(round) {
  const changes = (round.capture && round.capture.changes) || [];
  if (!changes.length) return null;
  const changed = changes.filter((change) => change.percent >= 0.05);
  return h('div', { class: 'delta row' },
    h('span', { class: 'grow', text: changed.length ? `和上一轮比，${changed.length} 个页面画面有变化` : `和上一轮比，${changes.length} 个页面画面都没变` }),
    h('button', { class: 'btn small quiet', type: 'button', onclick: openChanges }, '看对比'));
}

/** How many of the page's controls (those the library covers) really come from the library. */
function reuseBar(round) {
  const pages = (round.capture && round.capture.reuse) || [];
  const known = pages.reduce((sum, page) => sum + page.library + page.handwritten, 0);
  if (!pages.length) return null;
  if (!known) return h('div', { class: 'delta', text: '组件复用率：看不出来源（页面需要用开发模式运行，例如 npm run dev）' });
  const used = pages.reduce((sum, page) => sum + page.library, 0);
  return h('div', { class: 'delta row' },
    h('span', { class: 'grow', text: `组件复用率 ${Math.round((used / known) * 100)}%：页面上 ${known} 个控件里 ${used} 个来自组件库` }),
    h('button', { class: 'btn small quiet', type: 'button', onclick: openReuse }, '按页看'));
}

function openReuse() {
  const pages = [...state.round.capture.reuse].sort((a, b) => (a.library / Math.max(1, a.library + a.handwritten)) - (b.library / Math.max(1, b.library + b.handwritten)));
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: '每页的组件复用率' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', 'data-autofocus': true, onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' },
        h('p', { class: 'muted', text: '只数组件库里有对应组件的控件（例如组件库有按钮，就数按钮）。来源从开发模式下 React 记录的"是谁创建了这个元素"读出来；看不出来源的单独列出，不算进去。' }),
        pages.map((page) => {
          const known = page.library + page.handwritten;
          return h('div', { class: 'stack-tight' },
            h('strong', { text: `${page.route}：${known ? `${Math.round((page.library / known) * 100)}%` : '看不出来源'}` }),
            h('span', { class: 'muted', text: `${page.total} 个控件：来自组件库 ${page.library}，手写 ${page.handwritten}${page.unknown ? `，看不出来源 ${page.unknown}` : ''}` }),
            page.examples.length ? h('span', { class: 'faint', text: `手写的例如：${page.examples.map((text) => `「${text}」`).join('、')}` }) : null);
        })),
    ]);
  }, { kind: 'drawer', label: '每页的组件复用率' });
}

function openChanges() {
  const changes = [...state.round.capture.changes].sort((a, b) => b.percent - a.percent);
  const url = (round, name) => `/api/projects/${state.current}/shot?round=${encodeURIComponent(round)}&name=${encodeURIComponent(name)}&t=${encodeURIComponent(token)}`;
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: '页面和上一轮对比' }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', 'data-autofocus': true, onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' },
        h('p', { class: 'muted', text: '同一个页面、同一个宽度，上一轮和这一轮的截图逐像素比较。重构（比如把重复的写法合成组件）后，页面应该一点都没变；红色是变了的地方。' }),
        changes.map((change) => h('div', { class: 'stack-tight' },
          h('strong', { text: `${change.route} · ${change.width} 宽：${change.percent >= 0.05 ? `变了 ${change.percent}%` : '没有变化'}` }),
          change.diff ? h('div', { class: 'compare' },
            h('figure', {}, h('img', { src: url(change.previousRound, change.previousImage), alt: `${change.route} 上一轮的截图`, loading: 'lazy' }), h('figcaption', { text: '上一轮' })),
            h('figure', {}, h('img', { src: url(state.round.id, change.image), alt: `${change.route} 这一轮的截图`, loading: 'lazy' }), h('figcaption', { text: '这一轮' })),
            h('figure', {}, h('img', { src: url(state.round.id, change.diff), alt: `${change.route} 变化的地方（红色）`, loading: 'lazy' }), h('figcaption', { text: '变化（红色）' }))) : null))),
    ]);
  }, { kind: 'drawer', label: '页面和上一轮对比' });
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
    append(pane, emptyState('check', any ? '选一个问题看看' : '这一轮没有新问题', any ? '左边是这一轮的问题，点一个就能看到截图、原因和改法。' : (state.round.baseline ? `还有 ${state.round.baseline} 个老问题记录在案。` : '组件都用对了。')));
    return pane;
  }
  const number = numbered.get(violation.fingerprint);
  const capture = state.round.capture && state.round.capture.captures ? state.round.capture.captures[violation.fingerprint] : null;
  const index = filtered.findIndex((entry) => entry.fingerprint === violation.fingerprint);
  const codeBox = h('div', {}, h('p', { class: 'faint', text: violation.line ? '正在读取代码…' : '' }));
  if (!violation.line) fill(codeBox, h('div', { class: 'notice' }, `这是在页面上看到的问题，没能确定是哪一行代码。可以在代码里搜索「${violation.snippet || violation.name}」找到它。`));
  else api(`/projects/${state.current}/excerpt?file=${encodeURIComponent(violation.file)}&line=${violation.line}`).then((data) => {
    fill(codeBox, h('div', { class: 'code mono', role: 'region', tabindex: '0', 'aria-label': `${violation.file} 第 ${violation.line} 行附近的代码` },
      data.lines.map((line, offset) => h('div', { class: `line${data.start + offset === violation.line ? ' hit' : ''}` }, h('span', { class: 'ln', text: String(data.start + offset) }), line || ' '))));
  }, (error) => fill(codeBox, h('div', { class: 'notice error', text: error.message })));

  const single = (state.prompts && state.prompts[violation.fingerprint]) || `${violation.name}\n位置：${violation.file}${violation.line ? ` 第 ${violation.line} 行` : ''}\n要改成：${violation.fix}`;
  append(pane, h('div', { class: 'detail' },
    h('div', { class: 'detail-head' },
      h('button', { class: 'icon-btn back', type: 'button', 'aria-label': '回到问题列表', onclick: () => { state.selected = null; renderWorkspace(); } }, icon('back')),
      h('span', { class: 'big-num', 'aria-hidden': 'true', text: String(number) }),
      h('div', { class: 'grow' },
        h('h2', { text: violation.name }),
        h('div', { class: 'row' }, h('span', { class: `pill ${violation.level}`, text: LEVEL[violation.level] }), h('span', { class: 'chip', text: violation.title }),
          h('span', { class: 'where mono ellipsis', title: violation.file }, icon('file'), violation.line ? `${violation.file}:${violation.line}` : violation.file))),
      h('button', { class: 'btn small', type: 'button', onclick: () => copy(single, '这一条的修复提示') }, icon('copy'), '复制给 AI')),
    stage(number, capture),
    violation.ai ? h('div', { class: `notice${violation.ai.verdict === 'not-real' ? ' warn' : ''}`, role: 'note' }, h('strong', { text: `${AI_WORD[violation.ai.verdict]}：` }), violation.ai.reason || '没有给出理由', h('span', { class: 'faint', text: `（${violation.ai.by}，看了 ${violation.ai.looks} 遍${violation.ai.verdict === 'unsure' && violation.ai.looks > 1 ? '，结论不一致' : ''}）` })) : null,
    violation.origin === 'ai' ? h('div', { class: 'notice', role: 'note', text: '这个问题是看截图时发现的（程序规则没覆盖到），已经复核过一遍；改之前请在页面上确认。' }) : null,
    h('dl', { class: 'explain' },
      h('div', {}, h('dt', { text: '怎么了' }), h('dd', { text: violation.what })),
      h('div', {}, h('dt', { text: '会怎样' }), h('dd', { text: violation.consequence })),
      h('div', {}, h('dt', { text: '怎么改' }), h('dd', { text: violation.fix }))),
    violation.plan && violation.plan.length ? h('div', { class: 'stack-tight' }, h('div', { class: 'section-title' }, icon('wand'), '合并方案'),
      h('div', { class: 'plan mono', role: 'region', 'aria-label': '合并方案' }, violation.plan.map((step) => h('p', { text: step })))) : null,
    h('div', { class: 'section-title' }, icon('code'), '代码'),
    codeBox,
    h('details', { class: 'more-info' }, h('summary', { text: '详细信息' }), h('p', { class: 'mono faint', text: `规则 ${violation.rule}（${violation.origin === 'basic' ? '默认规则' : violation.origin === 'ai' ? 'AI 看图' : '项目规则'}）` }), h('p', { class: 'mono faint', text: violation.detail })),
    h('div', { class: 'detail-foot' },
      h('button', { class: 'btn small', type: 'button', 'aria-disabled': index <= 0 ? 'true' : undefined, onclick: () => { if (index > 0) selectIssue(filtered[index - 1].fingerprint, false); } }, '上一个'),
      h('button', { class: 'btn small', type: 'button', 'aria-disabled': index >= filtered.length - 1 ? 'true' : undefined, onclick: () => { if (index < filtered.length - 1) selectIssue(filtered[index + 1].fingerprint, false); } }, '下一个'),
      h('span', { class: 'faint', text: '在左边列表里按 ↑ ↓ 也能切换' }))));
  return pane;
}

/** A screenshot, with a box drawn over it when the problem came with pixel coordinates (screenshot review). */
function markedImage(src, alt, mark) {
  const img = h('img', { src, alt });
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
  if (capture && capture.shots && capture.shots.length) {
    const shot = capture.shots[0];
    const full = state.view === 'full';
    return h('figure', { class: 'stage', role: 'group', 'aria-label': '页面截图' },
      h('div', { class: 'stage-bar' },
        icon('image'), h('span', { class: 'grow ellipsis', text: `页面 ${shot.route} · ${shot.viewport}` }),
        h('div', { class: 'seg', role: 'group', 'aria-label': '截图范围' },
          h('button', { type: 'button', 'aria-pressed': full ? 'false' : 'true', onclick: () => { state.view = 'crop'; renderWorkspace(); } }, '附近'),
          h('button', { type: 'button', 'aria-pressed': full ? 'true' : 'false', onclick: () => { state.view = 'full'; renderWorkspace(); } }, '整页'))),
      h('div', { class: 'stage-img' }, markedImage(shotUrl(full ? shot.full : shot.crop), `问题 ${number} 在页面 ${shot.route} 上的位置，已用红框圈出`, capture.mark)),
      h('figcaption', { class: 'stage-bar', text: capture.note }));
  }
  // No screenshot: keep the picture's place and say exactly why, with the next step.
  const goSettings = (field) => { state.tab = 'settings'; state.focusField = field; renderWorkspace(); };
  const PLACEHOLDERS = {
    'no-browser': ['这一轮没有截图', '这台电脑还没有浏览器组件，所以这一轮只检查了源码。下载后再检测，这里会显示这个问题在页面上的位置。', [['下载浏览器组件并重新检测', () => startCheck(), true]]],
    'no-preview': ['还没有页面截图', '设置好本地预览地址后，这里会显示这个问题在页面上的位置。', [['帮我找预览地址', () => { state.autoFind = true; goSettings('base-url'); }, true]]],
    'preview-down': ['预览打不开', null, [['帮我找预览地址', () => { state.autoFind = true; goSettings('base-url'); }, false], ['重新检测', startCheck, true]]],
    'login-required': ['要登录才能看到', null, [['提供登录状态文件', () => goSettings('storage'), true]]],
    'file-not-opened': ['这一轮没打开用到它的页面', null, [['添加要打开的页面', () => goSettings('routes'), true]]],
    hidden: ['页面上没找到这个元素', null, []],
    'code-only': ['这个问题只在代码里', null, []],
    'over-limit': ['这个问题没有参与截图', '这一轮问题太多，超过了截图上限。修掉一些后再检测，或者用筛选先看有截图的问题。', []],
  };
  const reason = capture ? (capture.reason || (capture.status === 'not-locatable' ? 'code-only' : 'hidden')) : state.round.capture ? 'over-limit' : state.round.partial && state.round.partial.includes('还没有浏览器组件') ? 'no-browser' : 'no-preview';
  const [title, fallback, actions] = PLACEHOLDERS[reason];
  // Problems that live only in code get a one-line note; the code below is their picture.
  if (reason === 'code-only') return h('div', { class: 'notice', role: 'note' }, h('strong', { text: `${title}：` }), (capture && capture.note) || fallback);
  return h('figure', { class: 'stage', role: 'group', 'aria-label': '页面截图' },
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
  section('这一轮', [`检查了 ${result.filesScanned} 个文件，用时 ${(round.durationMs / 1000).toFixed(1)} 秒`, `${round.newMust} 个需要改，${round.newDefault} 个建议改，${round.newReference} 个可以看看`, `老问题（已记录）${round.baseline} 个`]);
  const ignored = result.violations.filter((violation) => violation.status === 'ignored');
  if (ignored.length) section('已按注释忽略', ignored.map((violation) => `${violation.file}:${violation.line} ${violation.name} —— 理由：${violation.ignoreReason}`));
  if (result.ignoreWithoutReason.length) section('忽略注释没写理由，所以没有生效', result.ignoreWithoutReason.map((entry) => `${entry.file}:${entry.line}（写法：// uxqa-ignore 规则名 -- 理由）`));
  if (result.rules.guidance.length) section('一句话规则（没法自动检查，请自己和 AI 留意）', result.rules.guidance.map((entry) => entry.text));
  if (result.rules.disabled.length) section('已关闭的默认规则', result.rules.disabled.map((entry) => `${entry.id}：${entry.reason}`));
  if (round.capture) section(`打开的页面（${round.capture.viewport}）`, round.capture.pages.map((page) => page.status === 'ok' ? `${page.route}：打开成功，在这里找到 ${page.problems} 个问题` : `${page.route}：没打开（${page.error}）`));
  if (result.skipped.length) section('没检查的文件', result.skipped.map((entry) => `${entry.file}：${entry.reason}`));
  openOverlay((panel, close) => {
    append(panel, [
      h('div', { class: 'drawer-head' }, h('h2', { class: 'grow', text: `第 ${round.number} 轮说明` }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': '关闭', 'data-autofocus': true, onclick: () => close(false) }, icon('close'))),
      h('div', { class: 'drawer-body stack' }, sections, h('p', { class: 'faint', text: '截图按特征对应，不读取页面内部信息。' })),
      h('div', { class: 'drawer-foot' }, h('button', { class: 'btn', type: 'button', onclick: async () => { close(false); await recordBaseline(); } }, '把现有问题记为老问题')),
    ]);
  }, { kind: 'drawer', label: '本轮说明' });
}

async function recordBaseline() {
  const ok = await confirmSheet({
    title: '把现在的问题记为老问题？',
    body: h('div', { class: 'stack' },
      h('p', { text: '会在项目里写入一个文件：.uxqa/baseline.json。以后检测只把新出现的问题算进来，老问题单独计数，修好了会提示。' }),
      h('p', { class: 'muted', text: '适合老项目刚接入时使用。这个文件可以和代码一起提交，也可以随时删除。' })),
    confirmText: '写入并记录',
  });
  if (!ok) return;
  try {
    const data = await api(`/projects/${state.current}/baseline`, { method: 'POST', body: { confirm: true } });
    toast(`已记录 ${data.entries} 个老问题，再检测一轮就能看到效果`);
  } catch (error) { toast(error.message); }
}

// ---------- components ----------
let componentTimer;
function renderComponents(body) {
  const results = h('div', { class: 'comp-grid', 'aria-live': 'polite' });
  const search = h('input', { id: 'component-search', class: 'input', type: 'search', placeholder: '按钮、标签页、下拉菜单、Dialog…', autocomplete: 'off' });
  const load = async () => {
    const query = search.value.trim();
    try {
      const data = await api(`/projects/${state.current}/components${query ? `?q=${encodeURIComponent(query)}` : ''}`);
      if (!data.library) { fill(results, h('div', { class: 'notice warn', text: '没有找到组件库。可以在"规则"里写 "library": { "root": "组件库目录" } 指定。' })); return; }
      if (!data.components.length) { fill(results, h('div', { class: 'notice', text: `组件库里没有和"${query}"相关的组件。需要的话，请在组件库（${data.library}）里新建，不要写在页面里。` })); return; }
      fill(results, data.components.map((component) => h('div', { class: 'comp' },
        h('div', { class: 'row' }, h('span', { class: 'comp-name grow', text: component.label ? `${component.name}（${component.label}）` : component.name }),
          component.duplicateOf ? null : h('button', { class: 'icon-btn', type: 'button', 'aria-label': `复制 ${component.name} 的引入写法`, title: '复制引入写法', onclick: () => copy(component.importHint, '引入写法') }, icon('copy'))),
        h('code', { class: 'mono', text: component.importHint }),
        component.duplicateOf ? h('span', { class: 'error-text', text: `重复的一份，不建议使用；请用 ${component.duplicateOf} 里的 ${component.name}。` }) : null,
        component.variantText ? h('span', { class: 'muted', text: component.variantText }) : null,
        component.parts.length ? h('span', { class: 'faint', text: `还包括 ${component.parts.slice(0, 6).join('、')}${component.parts.length > 6 ? ` 等 ${component.parts.length} 个` : ''}` }) : null,
        h('span', { class: 'faint mono ellipsis', title: component.file, text: component.source ? `${component.source} · ${component.file}` : component.file }))));
    } catch (error) { fill(results, h('div', { class: 'notice error', text: error.message })); }
  };
  search.addEventListener('input', () => { clearTimeout(componentTimer); componentTimer = setTimeout(load, 220); });
  const sources = h('div', { class: 'panel' }, h('h2', { text: '组件库来源' }), h('p', { class: 'muted', text: '正在读取…' }));
  fill(body, h('div', { class: 'page' },
    h('div', { class: 'field' }, h('label', { for: 'component-search', text: '找组件' }), h('div', { class: 'search' }, icon('search'), search), h('span', { class: 'hint', text: '写界面之前先查一下，有就用现成的。中文、英文都可以。' })),
    results, sources));
  load();
  renderSources(sources, load);
}

const SOURCE_KINDS = { auto: '本项目里', local: '本机文件夹', package: '已安装的 npm 包', git: 'Git 仓库' };

/** Where components come from: the project's own library first, then shared ("parent") libraries in the listed order. */
async function renderSources(panel, reloadComponents) {
  let summary, rules;
  try { [summary, rules] = await Promise.all([api(`/projects/${state.current}/library`), api(`/projects/${state.current}/rules`)]); }
  catch (error) { fill(panel, h('h2', { text: '组件库来源' }), h('div', { class: 'notice error', text: error.message })); return; }
  let current;
  try { current = JSON.parse(rules.raw || '{}'); } catch { current = null; }
  const configured = current && Array.isArray(current.libraries) ? current.libraries : [];
  const message = h('div', { role: 'status' });
  const save = async (next, done) => {
    if (!current) { fill(message, h('div', { class: 'notice error', text: '项目里的规则文件格式不对，请先在"规则"里改好。' })); return; }
    const raw = JSON.stringify({ ...current, extends: current.extends === undefined ? 'uxqa:basic' : current.extends, libraries: next }, null, 2);
    let checked;
    try { checked = await api(`/projects/${state.current}/rules/preview`, { method: 'POST', body: { raw } }); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); return; }
    const ok = await confirmSheet({ title: '保存组件库来源到项目？', body: h('div', { class: 'stack' }, h('p', { text: `会写入 ${project().root}/${checked.path}（只改这一个文件，可以提交到仓库让团队和 AI 共用）：` }), h('pre', { class: 'mono', text: checked.text })), confirmText: '保存' });
    if (!ok) return;
    try { await api(`/projects/${state.current}/rules/save`, { method: 'POST', body: { raw, confirm: true } }); toast('组件库来源已保存，下一轮检测生效'); if (done) done(); renderSources(panel, reloadComponents); reloadComponents(); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  };
  const pull = async (source, button) => {
    button.setAttribute('aria-disabled', 'true'); button.textContent = '正在拉取…';
    try { const result = await api(`/projects/${state.current}/libraries/pull`, { method: 'POST', body: { source } }); toast(`已拉取到 ${result.commit}`); renderSources(panel, reloadComponents); reloadComponents(); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); button.removeAttribute('aria-disabled'); button.textContent = '拉取 / 更新'; }
  };
  const rows = summary.libraries.map((library, index) => {
    const source = configured.find((entry) => entry.name === library.name);
    const position = configured.indexOf(source);
    return h('div', { class: 'rule-row' },
      h('div', { class: 'grow stack-tight' },
        h('div', {}, h('strong', { text: library.name }), h('span', { class: 'faint', text: `　${index === 0 ? '最优先' : '母库'} · ${SOURCE_KINDS[library.kind]}` })),
        h('div', { class: 'mono faint ellipsis', title: library.display, text: library.display }),
        h('div', { class: library.ready ? 'muted' : 'error-text', text: library.ready ? `${library.components} 个组件${library.importBase ? `，从 ${library.importBase} 引入` : ''}` : library.issue || '还不能用' })),
      h('div', { class: 'row' },
        source && source.git ? h('button', { class: 'btn small', type: 'button', onclick: (event) => pull(source, event.currentTarget) }, '拉取 / 更新') : null,
        source && position > 0 ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => { const next = [...configured]; next.splice(position - 1, 0, next.splice(position, 1)[0]); save(next); } }, '上移') : null,
        source ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => save(configured.filter((entry) => entry !== source)) }, '移除') : null));
  });
  // Add a source: one kind at a time, in plain words.
  let kind = 'package';
  const form = h('form', { class: 'stack' });
  const drawForm = () => {
    const fields = {
      local: [['value', '文件夹路径', '../shared-ui/src 或 /Users/you/ui/src']],
      package: [['value', 'npm 包名', '@your-company/ui']],
      git: [['value', '仓库链接', 'https://github.com/your-company/ui.git'], ['ref', '分支或标签（可不填）', 'main'], ['path', '组件所在的子目录（可不填）', 'packages/ui/src'], ['import', '项目里怎么引入（可不填）', '@your-company/ui']],
    }[kind];
    fill(form,
      h('div', { class: 'seg', role: 'group', 'aria-label': '来源类型' }, Object.entries({ package: '已安装的 npm 包', git: 'Git 仓库链接', local: '本机文件夹' }).map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(kind === value), onclick: () => { kind = value; drawForm(); } }, label))),
      h('p', { class: 'faint', text: kind === 'package' ? '公司的组件库通常发成 npm 包。先在项目里装好它，这里填包名。' : kind === 'git' ? '填仓库链接后点"添加"，再点"拉取 / 更新"下载到本机（只存在 ~/.uxqa 里）。私有仓库要先在终端里用 git 登录过一次。' : '另一个文件夹里的组件库，例如同一个仓库里的共享组件目录。' }),
      h('div', { class: 'field' }, h('label', { for: 'src-name', text: '叫什么（显示用）' }), h('input', { id: 'src-name', class: 'input', type: 'text', placeholder: '公司组件库', autocomplete: 'off' })),
      fields.map(([name, label, example]) => h('div', { class: 'field' }, h('label', { for: `src-${name}`, text: label }), h('input', { id: `src-${name}`, class: 'input mono', type: 'text', placeholder: `例如：${example}`, autocomplete: 'off' }))),
      h('div', { class: 'row' }, h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', onclick: () => tryOut() }, '试一下'),
        h('button', { class: 'btn primary', type: 'submit' }, '添加')));
  };
  const draft = () => {
    const value = (id) => { const field = document.getElementById(id); return field ? field.value.trim() : ''; };
    const entry = { name: value('src-name') || '公司组件库', [kind === 'local' ? 'root' : kind]: value('src-value') };
    for (const key of ['ref', 'path', 'import']) if (value(`src-${key}`)) entry[key] = value(`src-${key}`);
    return entry;
  };
  const tryOut = async () => {
    try {
      const result = await api(`/projects/${state.current}/libraries/preview`, { method: 'POST', body: { libraries: [...configured, draft()] } });
      const added = result.libraries[result.libraries.length - 1];
      fill(message, h('div', { class: `notice${added.ready ? '' : ' warn'}`, text: added.ready ? `能读到：${added.components} 个组件。点"添加"保存。` : added.issue || '还读不到组件' }));
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  };
  form.addEventListener('submit', (event) => { event.preventDefault(); save([...configured, draft()]); });
  drawForm();
  fill(panel,
    h('h2', { text: '组件库来源' }),
    h('p', { class: 'muted', text: '可以同时用好几个组件库：排在最上面的最优先（通常是项目自己的"子库"），下面的是公司共用的"母库"。两边都有同名组件时，用上面那个。' }),
    rows,
    summary.overrides.length ? h('div', { class: 'notice', text: `两个库都有的组件：${summary.overrides.map((entry) => `${entry.name}（用的是「${entry.used}」的）`).join('、')}。如果子库只是改了样式，可以考虑直接用母库的并加一个样式选项。` }) : null,
    h('details', { class: 'more-info' }, h('summary', { text: '添加组件库来源' }), form),
    message);
}

// ---------- rules ----------
const TEMPLATES = {
  element: { label: '某个元素必须用组件库里的组件', fields: [['element', '原生元素', 'a'], ['role', '角色（可不填）', 'button'], ['component', '应该用的组件', 'Button']], build: (v) => ({ id: `use-${v.component || 'component'}`.toLowerCase(), type: 'require-library-component', element: v.element, ...(v.role ? { role: v.role } : {}), component: v.component, level: 'must' }) },
  scale: { label: '间距或字号只能取某些值', fields: [['property', '哪一类（spacing 或 font-size）', 'spacing'], ['allowed', '允许的值（multiple-of-4 或用逗号分隔的数字）', 'multiple-of-4']], build: (v) => ({ id: `${v.property || 'spacing'}-scale`, type: 'value-scale', property: v.property || 'spacing', allowed: v.allowed === 'multiple-of-4' || !v.allowed ? 'multiple-of-4' : v.allowed.split(',').map((x) => Number(x.trim())).filter((x) => !Number.isNaN(x)), level: 'must' }) },
  text: { label: '按钮文字不能太长', fields: [['max', '最多几个字', '8']], build: (v) => ({ id: 'short-buttons', type: 'text-length', max: Number(v.max) || 8, level: 'default' }) },
  import: { label: '禁止引入某个库', fields: [['module', '库名', 'antd'], ['fix', '应该怎么做（可不填）', '改用组件库里的组件']], build: (v) => ({ id: `no-${(v.module || 'library').replace(/[^a-z0-9]+/gi, '-')}`, type: 'forbid-import', module: v.module, level: 'must', ...(v.fix ? { fix: v.fix } : {}) }) },
  prop: { label: '组件必须带某个属性', fields: [['component', '组件', 'Avatar'], ['prop', '属性', 'alt']], build: (v) => ({ id: `${(v.component || 'x').toLowerCase()}-${v.prop || 'prop'}`, type: 'require-prop', component: v.component, prop: v.prop, level: 'default' }) },
  sentence: { label: '一句话规则（不自动检查，交给 AI 参考）', fields: [['text', '规则', '一屏不超过一个主按钮']], build: (v) => ({ id: `note-${Date.now().toString(36)}`, text: v.text }) },
  off: { label: '关闭或局部关闭某条默认规则', fields: [['id', '默认规则', '', 'basic'], ['scope', '只在这些目录关闭（可不填，逗号分隔）', 'src/pages/admin/**'], ['reason', '理由（必填，会显示在报告里）', '']], build: (v) => ({ id: v.id, level: 'off', ...(v.scope ? { scope: v.scope.split(',').map((x) => x.trim()).filter(Boolean) } : {}), reason: v.reason }) },
};

async function renderRules(body) {
  fill(body, h('div', { class: 'page' }, h('p', { class: 'muted', text: '正在读取规则…' })));
  let data;
  try { data = await api(`/projects/${state.current}/rules`); }
  catch (error) { fill(body, h('div', { class: 'page' }, h('div', { class: 'notice error', role: 'alert', text: error.message }))); return; }
  const levelWord = { must: '必须', default: '建议', reference: '参考', off: '关闭' };
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
        : h('input', { id: `tpl-${name}`, class: 'input', type: 'text', placeholder: example ? `例如：${example}` : '' }))));
  };
  templateSelect.addEventListener('change', renderFields);
  renderFields();
  const addFromTemplate = () => {
    const template = TEMPLATES[templateSelect.value];
    const values = Object.fromEntries(template.fields.map(([name]) => [name, document.getElementById(`tpl-${name}`).value.trim()]));
    let current;
    try { current = JSON.parse(editor.value || '{}'); } catch { fill(message, h('div', { class: 'notice error', text: '下面的规则内容现在格式不对，先改好再添加。' })); return; }
    current.rules = Array.isArray(current.rules) ? current.rules : [];
    current.rules.push(template.build(values));
    editor.value = JSON.stringify(current, null, 2);
    fill(message, h('div', { class: 'notice', text: '已加到规则内容里，还没保存。' }));
  };
  const preview = async () => {
    try {
      const result = await api(`/projects/${state.current}/rules/preview`, { method: 'POST', body: { raw: editor.value } });
      fill(message, h('div', { class: 'notice', text: result.unchanged ? '写得没问题，和项目里现有的一样。' : '写得没问题，可以保存。' }));
      return result;
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); return null; }
  };
  // ---- switches: every built-in rule as a plain sentence with a level picker ----
  const LEVELS = [['must', '必须改'], ['default', '建议改'], ['reference', '可以看看'], ['off', '不检查']];
  const rank = { must: 3, default: 2, reference: 1, off: 0 };
  const changes = new Map();
  const changeBar = h('div', { class: 'row', hidden: true });
  const switchMessage = h('div', { role: 'alert' });
  const refreshBar = () => {
    changeBar.hidden = changes.size === 0;
    fill(changeBar, h('span', { class: 'grow muted', text: `改了 ${changes.size} 条，还没保存` }),
      h('button', { class: 'btn', type: 'button', onclick: () => renderRules(body) }, '撤销'),
      h('button', { class: 'btn primary', type: 'button', onclick: saveSwitches }, '保存修改'));
  };
  const ruleRow = (entry) => {
    const select = h('select', { class: 'input level-select', 'aria-label': `${entry.rule}：要不要检查` }, LEVELS.map(([value, label]) => h('option', { value, text: value === entry.defaultLevel ? `${label}（默认）` : label, selected: entry.level === value })));
    const reason = h('input', { class: 'input', type: 'text', placeholder: '为什么放宽这一条？（必填，会写进报告）', 'aria-label': `放宽「${entry.rule}」的理由` });
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
    if (missing) { fill(switchMessage, h('div', { class: 'notice error', text: `「${missing.entry.rule}」放宽了，请写一句理由。` })); return; }
    let current;
    try { current = JSON.parse(data.raw || '{}'); } catch { fill(switchMessage, h('div', { class: 'notice error', text: '项目里现有的规则文件格式不对，请在下面"自己写规则"里先改好。' })); return; }
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
  const groups = [['code', '写代码时检查'], ['page', '打开页面时检查（需要填预览地址）']];

  const save = async () => {
    const checked = await preview();
    if (!checked || checked.unchanged) return;
    const ok = await confirmSheet({ title: '保存到项目？', body: h('div', { class: 'stack' }, h('p', { text: `会写入 ${project().root}/${checked.path}（只改这一个文件）：` }), h('pre', { class: 'mono', text: checked.text })), confirmText: '保存' });
    if (!ok) return;
    try { await api(`/projects/${state.current}/rules/save`, { method: 'POST', body: { raw: editor.value, confirm: true } }); toast('规则已保存，下一轮检测生效'); renderWorkspace(); }
    catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  };
  const custom = data.active.filter((rule) => rule.origin === 'project');
  refreshBar();
  fill(body, h('div', { class: 'page' },
    h('div', { class: 'panel' },
      h('h2', { text: '检查哪些东西' }),
      h('p', { class: 'muted', text: `一共 ${data.catalog.length} 条，默认已经按常见做法设好，一般不用改。"必须改"的问题在 AI 写代码时会被当场拦下；"建议改""可以看看"只提醒。` }),
      groups.map(([kind, title]) => h('div', { class: 'stack-tight' }, h('h3', { text: title }), data.catalog.filter((entry) => entry.kind === kind).map(ruleRow))),
      switchMessage, changeBar),
    custom.length || data.guidance.length ? h('div', { class: 'panel' }, h('h2', { text: '这个项目自己加的规则' }),
      custom.length ? h('div', {}, custom.map((rule) => h('div', { class: 'rule-row' },
        h('span', { class: `pill ${rule.level}`, text: levelWord[rule.level] }),
        h('div', { class: 'grow' }, h('div', { text: rule.fix || rule.id }), h('div', { class: 'faint mono', text: rule.id }))))) : null,
      data.guidance.length ? h('div', {}, h('h3', { text: '一句话规则（不自动检查，会写进给 AI 的提示）' }), h('ul', { class: 'list-plain' }, data.guidance.map((entry) => h('li', { text: entry.text })))) : null) : null,
    h('details', { class: 'panel' }, h('summary', { text: '高级：自己写规则' }),
      h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'template', text: '从常用规则开始' }), templateSelect), fieldsBox,
        h('div', {}, h('button', { class: 'btn', type: 'button', onclick: addFromTemplate }, icon('plus'), '加到规则内容里')),
        h('div', { class: 'field' }, h('label', { for: 'rules-editor', class: 'mono', text: '.uxqa/rules.json' }), editor,
          h('span', { class: 'hint', id: 'rules-hint', text: data.path ? `项目规则文件：${data.path}。默认规则一直生效，这里写的叠加在上面。` : '这个项目还没有自己的规则文件。默认规则一直生效，这里写的叠加在上面。' })),
        message,
        h('div', { class: 'row' }, h('span', { class: 'grow' }), h('button', { class: 'btn', type: 'button', onclick: preview }, '检查写法'), h('button', { class: 'btn primary', type: 'button', onclick: save }, '保存到项目'))))));
}

// ---------- page settings ----------
// Looks for this project's running dev server; fills and saves it when sure, otherwise says exactly how to start it.
async function findPreviewInto(entry, box, { quiet = false } = {}) {
  fill(box, h('p', { class: 'muted', role: 'status', text: '正在找这个项目在本机的预览地址…' }));
  let result;
  try { result = await api(`/projects/${entry.id}/find-preview`, { method: 'POST', body: {} }); }
  catch (error) { fill(box, h('div', { class: 'notice error', role: 'alert', text: error.message })); return null; }
  const use = async (url) => {
    const pages = entry.pages || { routes: ['/'], discover: true };
    await api(`/projects/${entry.id}/settings`, { method: 'POST', body: { baseUrl: url, routes: (pages.routes || ['/']).join('\n'), discover: pages.discover !== false, ...(pages.storageState ? { storageState: pages.storageState } : {}) } });
    await loadProjects();
    const input = document.getElementById('base-url');
    if (input) input.value = url;
    fill(box, h('div', { class: 'notice', role: 'status', text: `已用 ${url}，下一轮检测会打开页面截图。` }));
    if (!quiet) toast(`预览地址已设为 ${url}`);
  };
  if (result.found && result.found.sure) { await use(result.found.url); fill(box, h('div', { class: 'notice', role: 'status' }, h('strong', { text: `找到了：${result.found.url}` }), `（${result.found.why}），已经保存。`)); return result.found.url; }
  const startCode = `cd "${result.start.folder}"\n${result.start.command}`;
  fill(box, h('div', { class: 'stack' },
    result.found ? h('div', { class: 'notice', role: 'status' }, `可能是 ${result.found.url}：${result.found.why}。`, h('button', { class: 'btn small', type: 'button', onclick: () => use(result.found.url) }, '用这个')) : null,
    !result.found ? h('div', { class: 'notice', role: 'status' }, h('strong', { text: '这个项目还没在本机跑起来。' }), '打开"终端"，把下面两行粘贴进去回车，等出现 localhost 地址后回来点"再找一次"。') : null,
    !result.found ? h('pre', { class: 'mono code-snippet', text: startCode }) : null,
    h('div', { class: 'row' },
      !result.found ? h('button', { class: 'btn small', type: 'button', onclick: () => copy(startCode, '启动命令') }, icon('copy'), '复制命令') : null,
      h('button', { class: 'btn small', type: 'button', onclick: () => findPreviewInto(entry, box) }, '再找一次')),
    result.others.length ? h('div', { class: 'stack-tight' }, h('span', { class: 'faint', text: '本机还有这些地址在运行，如果其中一个是这个项目，点"用这个"：' }),
      result.others.map((other) => h('div', { class: 'row' }, h('span', { class: 'mono grow', text: other.url }), h('button', { class: 'btn small', type: 'button', onclick: () => use(other.url) }, '用这个')))) : null));
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
      fill(message, h('div', { class: 'notice', text: data.pages ? `已保存：${data.pages.baseUrl}。下一轮检测会打开这些页面截图。` : '已清除页面地址，之后的检测只配代码。' }));
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
  } },
    h('h2', { text: '页面地址' }),
    h('p', { class: 'muted', text: '填写后，每一轮检测会打开这些页面，把问题在截图上圈出来。需要先在本机把项目跑起来（例如 npm run dev）。' }),
    h('div', { class: 'field' }, h('label', { for: 'base-url', text: '预览地址' }),
      h('div', { class: 'row' }, h('input', { id: 'base-url', class: 'input grow', type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'localhost:5173', value: pages.baseUrl }),
        h('button', { class: 'btn', type: 'button', onclick: () => findPreviewInto(entry, finder) }, icon('scan'), '帮我找')),
      h('span', { class: 'hint', text: '不知道填什么就点"帮我找"。也可以自己写，例如 localhost:5173，会自动补上 http://。' }),
      finder),
    h('div', { class: 'field' }, h('label', { for: 'routes', text: '要打开的页面（一行一个，以 / 开头）' }), routes),
    h('label', { class: 'check' }, h('input', { id: 'discover', type: 'checkbox', checked: pages.discover }), '自动找更多页面（读取项目里的路由，并顺着页面链接找）'),
    h('div', { class: 'field' }, h('label', { for: 'storage', text: '登录状态（要登录才能看到的页面需要它）' }),
      h('div', { class: 'row' }, h('input', { id: 'storage', class: 'input mono grow', type: 'text', placeholder: '还没有登录状态', value: pages.storageState || '' }),
        h('button', { class: 'btn', type: 'button', onclick: () => startLogin(entry, loginBox) }, '打开浏览器登录')),
      loginBox,
      h('span', { class: 'hint', text: '点"打开浏览器登录"，在弹出的窗口里像平时一样登录，回来点"我已登录"。登录状态只保存在这台电脑的 ~/.uxqa 里，不会写进项目。也可以填一个已有的 Playwright 登录状态文件路径。' })),
    message,
    h('div', { class: 'row' },
      entry.pages ? h('button', { class: 'btn quiet', type: 'button', onclick: async () => { await api(`/projects/${entry.id}/settings`, { method: 'POST', body: { baseUrl: '' } }); await loadProjects(); renderWorkspace(); } }, '清除页面地址') : null,
      h('span', { class: 'grow' }),
      h('button', { class: 'btn', type: 'button', onclick: async () => {
        fill(message, h('span', { class: 'muted', text: '正在试着打开…' }));
        try { const result = await api(`/projects/${entry.id}/settings/test`, { method: 'POST', body: values() }); fill(message, h('div', { class: `notice${result.ok ? '' : ' error'}`, text: result.message })); }
        catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
      } }, '试着打开'),
      h('button', { class: 'btn primary', type: 'submit' }, '保存')));
  queueMicrotask(() => {
    if (!state.focusField) return;
    const field = document.getElementById(state.focusField);
    state.focusField = null;
    if (field) { field.focus(); field.scrollIntoView({ block: 'center' }); }
  });
  const aiPanel = h('div', { class: 'notice row', role: 'note' }, h('span', { class: 'grow', text: 'AI 看图复核、连接 AI 助手这些所有项目通用的设置，放在左下角的"设置"里。' }), h('button', { class: 'btn small', type: 'button', onclick: openGlobal }, icon('gear'), '打开设置'));
  fill(body, h('div', { class: 'page' }, form, aiPanel,
    h('div', { class: 'panel' }, h('h2', { text: '项目' }),
      h('div', { class: 'row' }, h('span', { class: 'grow muted mono ellipsis', title: entry.root, text: entry.root }),
        h('button', { class: 'btn', type: 'button', onclick: removeCurrent }, '从列表移除')),
      h('p', { class: 'faint', text: '移除只是不在 uxqa 里显示，不会删除项目里的任何文件；检测记录保留在本机。' }))));
}

/** Settings for the optional screenshot review: off, a vision model by API key, or the user's own AI agent over MCP. */
function nativeModelsPanel(saved, save) {
  const status = h('div', { role: 'status' });
  const providers = h('div', { class: 'stack' });
  const accounts = h('div', { class: 'stack' });
  const loginStatus = h('div', { role: 'status', class: 'stack' });
  const names = { codex: 'ChatGPT / Codex', claude: 'Claude', copilot: 'GitHub Copilot', gemini: 'Gemini Code Assist', antigravity: 'Antigravity' };
  const agent = h('select', { id: 'native-agent', class: 'input' }, Object.entries(names).map(([value, text]) => h('option', { value, text })));
  const model = h('input', { id: 'engine-model', class: 'input mono', value: ['native', 'magpie'].includes(saved.connection) ? saved.model : '', placeholder: '获取模型后选择，或填写 服务商/模型名' });
  const choices = h('select', { class: 'input', 'aria-label': '可用模型' }, h('option', { value: '', text: '登录或添加服务商后，点击获取模型' }));
  choices.addEventListener('change', () => { if (choices.value) model.value = choices.value; });
  const values = () => ({ mode: 'api', connection: 'native', model: model.value, clearKey: true });
  const section = h('div', { class: 'stack' });
  let flow, timer, capabilities = [], busy = false, flowView = '', hasConnections = false;
  const action = async (button, work) => {
    button.disabled = true;
    fill(status, h('p', { text: '正在处理…' }));
    try { await work(); } catch (error) { fill(status, h('div', { class: 'notice error', text: error.message })); }
    finally { button.disabled = false; }
  };
  const refresh = async () => {
    const state = await api('/ai/native/state');
    capabilities = state.capabilities;
    hasConnections = state.providers.length > 0 || state.accounts.some((item) => item.on);
    fill(providers, state.providers.length ? state.providers.map((item) => h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('b', { class: 'grow', text: item.name }),
        h('button', { class: 'btn', type: 'button', onclick: () => editProvider(item) }, '编辑'),
        h('button', { class: 'btn quiet', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
          if (!await confirmSheet({ title: `移除 ${item.name}？`, body: h('p', { text: '将删除 UXQA 保存的连接配置。使用这个服务商的复核会需要重新选择模型。' }), confirmText: '移除服务商' })) { fill(status); return; }
          await api('/ai/native/provider-delete', { method: 'POST', body: { id: item.id } }); await refresh();
          fill(status, h('p', { text: '服务商已移除。' }));
        }) }, '移除')),
      h('p', { class: 'faint mono', text: `${item.protocol} · ${item.baseUrl} · ${item.hasKey ? '已保存密钥' : '未设置密钥'}` }))) : h('p', { class: 'faint', text: '还没有 API 服务商。可以添加多个服务商并在它们的模型之间切换。' }));
    fill(accounts, state.accounts.length ? state.accounts.map((item) => h('div', { class: 'row' },
      h('span', { class: 'grow', text: `${names[item.agent] ?? item.agent} · ${item.user}${item.plan ? ` · ${item.plan}` : ''}${item.lapsed ? ' · 登录已失效，请重新登录' : item.on ? ' · 已启用' : ' · 已停用'}` }),
      h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
        await api('/ai/native/account', { method: 'POST', body: { agent: item.agent, user: item.user, on: !item.on } }); await refresh(); fill(status, h('p', { text: item.on ? '账号已停用。' : '账号已启用。' }));
      }) }, item.on ? '停用' : '启用'),
      h('button', { class: 'btn quiet', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
        if (!await confirmSheet({ title: '从 UXQA 移除账号？', body: h('p', { text: `移除 ${item.user} 在 UXQA 保存的登录凭据。` }), confirmText: '移除账号' })) { fill(status); return; }
        await api('/ai/native/account', { method: 'POST', body: { agent: item.agent, user: item.user, remove: true } }); await refresh(); fill(status, h('p', { text: '账号已从 UXQA 移除。' }));
      }) }, '移除'))) : h('p', { class: 'faint', text: '还没有在 UXQA 登录的订阅账号。' }));
  };
  const editProvider = (item = {}) => openOverlay((panel, close) => {
    const name = h('input', { id: 'provider-name', class: 'input', value: item.name ?? '', 'data-autofocus': true });
    const protocol = h('select', { id: 'provider-protocol', class: 'input' }, [['openai', 'OpenAI Chat / 兼容协议'], ['responses', 'OpenAI Responses'], ['anthropic', 'Anthropic Messages'], ['gemini', 'Google Gemini']].map(([value, text]) => h('option', { value, text, selected: item.protocol === value })));
    const base = h('input', { id: 'provider-base', class: 'input mono', value: item.baseUrl ?? '', placeholder: 'https://api.example.com/v1' });
    const key = h('input', { id: 'provider-key', class: 'input mono', type: 'password', autocomplete: 'new-password', placeholder: item.hasKey ? '留空保留已保存密钥；更换地址时会清除' : 'API Key（本地模型可留空）' });
    const models = h('input', { id: 'provider-models', class: 'input mono', value: (item.models ?? []).join(', '), placeholder: '可选：模型名，以逗号分隔' });
    const clearKey = h('input', { type: 'checkbox' });
    const feedback = h('div', { role: 'status' });
    const field = (id, label, control) => h('div', { class: 'field' }, h('label', { for: id, text: label }), control);
    const submit = h('button', { class: 'btn primary', type: 'submit' }, '保存服务商');
    const form = h('form', { class: 'stack', onsubmit: async (event) => {
      event.preventDefault(); submit.disabled = true; fill(feedback, h('p', { text: '正在保存…' }));
      try {
        await api('/ai/native/providers', { method: 'POST', body: { id: item.id, name: name.value, protocol: protocol.value, baseUrl: base.value, apiKey: key.value, clearKey: clearKey.checked, models: models.value.split(/[,，\n]/).map((v) => v.trim()).filter(Boolean) } });
        close(true); await refresh(); fill(status, h('p', { text: '服务商已保存。现在可以获取模型。' }));
      } catch (error) { fill(feedback, h('div', { class: 'notice error', text: error.message })); }
      finally { submit.disabled = false; }
    } }, field('provider-name', '服务商名称', name), field('provider-protocol', '接口协议', protocol), field('provider-base', '模型地址', base), field('provider-key', 'API Key', key), h('label', { class: 'row' }, clearKey, '清除已保存的密钥'), field('provider-models', '自定义模型', models), feedback, h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, '取消'), submit));
    append(panel, [h('h2', { text: item.id ? '编辑服务商' : '添加服务商' }), form]);
  }, { label: item.id ? '编辑服务商' : '添加服务商' });
  const showFlow = async (state) => {
    if (!flow || state.id !== flow.id) return;
    flow = state;
    clearTimeout(timer);
    const finished = ['done', 'failed', 'canceled'].includes(state.state);
    const text = state.state === 'done' ? '登录成功，账号已保存到 UXQA。现在可以获取模型。' : state.state === 'failed' ? '登录失败，请重新开始。' : state.state === 'canceled' ? '登录已取消。' : '等待服务商授权，请在浏览器完成登录。';
    const children = [h('p', { text })];
    if (!finished) {
      if (state.url?.startsWith('https://')) children.push(h('a', { class: 'btn primary', href: state.url, target: '_blank', rel: 'noopener noreferrer', text: '在浏览器继续授权' }));
      if (state.code) children.push(h('p', {}, '授权码：', h('code', { text: state.code })));
      if (state.pasteCallback) {
        const callback = h('input', { class: 'input mono', 'aria-label': '授权后的回调地址', placeholder: '粘贴授权完成后浏览器地址栏中的完整地址' });
        children.push(h('p', { class: 'faint', text: state.callbackBlocked ? '本地回调端口被占用。授权后复制浏览器地址，粘贴到这里完成登录。' : '若授权后未自动完成，可以粘贴回调地址。' }), callback,
          h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { const next = await api(`/ai/native/login/${state.id}`, { method: 'POST', body: { callback: callback.value } }); callback.value = ''; await showFlow(next); fill(status); }) }, '提交授权回调'));
      }
      children.push(h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { await showFlow(await api(`/ai/native/login/${state.id}`, { method: 'POST', body: { cancel: true } })); fill(status); }) }, '取消登录'));
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
        fill(status, h('p', { class: 'notice error', text: `暂时无法读取授权状态：${error.message}` }),
          h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { if (flow) await showFlow(await api(`/ai/native/login/${flow.id}`)); fill(status); }) }, '重新检查授权状态'));
      }
    }, 1500);
  };
  append(section, [h('p', { text: '在 UXQA 内管理模型连接和订阅账号。配置保存在本机，截图复核使用你选择的模型。' }),
    h('div', { class: 'row' }, h('h3', { class: 'grow', text: 'API 服务商' }), h('button', { class: 'btn', type: 'button', onclick: () => editProvider() }, '添加服务商')), providers,
    h('h3', { text: '订阅账号' }), accounts,
    h('p', { class: 'faint', text: '账号在服务商网页授权后保存到 UXQA。Claude 订阅需要本机已安装官方 Claude Code；Gemini 需要可用的 Code Assist 账号与项目。' }),
    h('div', { class: 'field' }, h('label', { for: 'native-agent', text: '登录的订阅服务' }), agent),
    h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => {
      if (busy) return; busy = true;
      try {
        const capability = capabilities.find((item) => item.id === agent.value);
        if (capability && !capability.available) throw new Error(capability.reason || `请先安装官方 ${capability.requirement} 运行时，然后重试。`);
        if (flow) await api(`/ai/native/login/${flow.id}`, { method: 'POST', body: { cancel: true } });
        flow = await api('/ai/native/login', { method: 'POST', body: { agent: agent.value } }); await showFlow(flow); fill(status);
      } finally { busy = false; }
    }) }, '登录订阅账号'), loginStatus,
    h('h3', { text: '复核使用的模型' }), h('div', { class: 'field' }, h('label', { for: 'engine-model', text: '看图模型' }), model, choices),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { const result = await api('/ai/models', { method: 'POST', body: values() }); fill(choices, h('option', { value: '', text: '选择支持看图的模型' }), result.models.map((id) => h('option', { value: id, text: id }))); fill(status, h('p', { text: result.models.length ? `已获取 ${result.models.length} 个模型，请选择并测试看图。` : hasConnections ? '账号或服务商已添加，但暂未获取到模型。请检查连接后重试。' : '还没有可用模型，请先添加服务商或登录订阅。' }), (result.warnings ?? []).map((text) => h('p', { class: 'notice error', text }))); }) }, '获取模型'),
      h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { const result = await api('/ai/test', { method: 'POST', body: values() }); fill(status, h('div', { class: `notice${result.ok ? '' : ' error'}`, text: result.message })); }) }, '测试看图连接'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => save(values()) }, '保存并用于复核')), status]);
  refresh().catch((error) => fill(status, h('div', { class: 'notice error', text: error.message }), h('button', { class: 'btn', type: 'button', onclick: (event) => action(event.currentTarget, async () => { await refresh(); fill(status); }) }, '重试加载')));
  return section;
}

async function renderAiPanel(panel) {
  let data;
  try { data = await api('/ai'); } catch (error) { fill(panel, h('h2', { text: 'AI 看图复核（可选）' }), h('div', { class: 'notice error', text: error.message })); return; }
  const saved = data.settings;
  let mode = saved.mode === 'api' && ['native', 'magpie'].includes(saved.connection) ? 'subscription' : saved.mode;
  let saving = false;
  const message = h('div', { role: 'status' });
  const draw = () => {
    const modeButtons = h('div', { class: 'seg', role: 'group', 'aria-label': '怎么用 AI 看图' },
      [['off', '不用'], ['api', '直接连接 API'], ['subscription', '模型与账号'], ['agent', '外部助手（MCP）']].map(([value, label]) => h('button', { type: 'button', 'aria-pressed': String(mode === value), onclick: () => { mode = value; draw(); } }, label)));
    const intro = h('p', { class: 'muted', text: '程序检查之外，再让能看图的大模型看一遍截图：确认每个问题是不是真的（看几遍，结论一致才算），再按规则找程序没查到的问题。不配置也完全能用。' });
    let body = null;
    if (mode === 'off') body = h('div', { class: 'row' }, h('span', { class: 'grow faint', text: '现在不用 AI 看图。' }), saved.mode !== 'off' ? h('button', { class: 'btn primary', type: 'button', onclick: () => save({ mode: 'off' }) }, '保存') : null);
    if (mode === 'agent') {
      body = h('div', { class: 'stack' },
        h('p', { text: '适合有 Claude、ChatGPT 等订阅、没有 API Key 的情况：你平时用的 AI 助手通过 uxqa 的 MCP 看截图，用的是它自己的看图能力，不另外花钱。' }),
        h('ol', { class: 'howto' },
          h('li', { text: '按下面"连接你的 AI 助手"里的说明接一次。' }),
          h('li', { text: '在项目里点"开始检测"，然后对 AI 助手说"用 uxqa 复核截图"。它看完提交的结论会显示在问题旁边，标着"AI 助手（MCP）"。' })),
        h('div', { class: 'row' }, h('span', { class: 'grow' }), saved.mode !== 'agent' ? h('button', { class: 'btn primary', type: 'button', onclick: () => save({ mode: 'agent' }) }, '保存') : h('span', { class: 'chip ok', text: '已在使用' })));
    }
    if (mode === 'subscription') body = nativeModelsPanel(saved, save);
    if (mode === 'api') {
      const preset = h('select', { id: 'ai-preset', class: 'input' }, h('option', { value: '', text: '选一个服务商自动填地址（可选）' }), data.presets.map((item) => h('option', { value: item.id, text: item.label })));
      const protocol = h('select', { id: 'ai-protocol', class: 'input' }, [['openai', 'OpenAI Chat Completions / 兼容服务'], ['responses', 'OpenAI Responses'], ['anthropic', 'Anthropic Messages'], ['gemini', 'Google Gemini 原生接口']].map(([value, text]) => h('option', { value, text, selected: saved.protocol === value })));
      const baseUrl = h('input', { id: 'ai-base', class: 'input mono', type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: 'https://api.openai.com/v1', value: saved.baseUrl });
      const model = h('input', { id: 'ai-model', class: 'input mono', type: 'text', autocomplete: 'off', placeholder: '填你账号里能看图的模型名', value: saved.model });
      const key = h('input', { id: 'ai-key', class: 'input mono', type: 'password', autocomplete: 'off', placeholder: saved.hasKey ? `已保存（${saved.keyHint}），不改就留空` : '粘贴 API Key（本机 Ollama 可以不填）' });
      const passes = h('select', { id: 'ai-passes', class: 'input' }, [1, 2, 3].map((n) => h('option', { value: String(n), text: n === 1 ? '看 1 遍（最省）' : `看 ${n} 遍，结论一致才算${n === 2 ? '（推荐）' : '（最稳）'}`, selected: saved.passes === n })));
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
      const models = h('select', { class: 'input', 'aria-label': '可用模型' }, h('option', { value: '', text: '可手动填写，也可获取模型列表' }));
      models.addEventListener('change', () => { if (models.value) model.value = models.value; });
      body = h('form', { class: 'stack', onsubmit: (event) => { event.preventDefault(); save(values()); } },
        h('div', { class: 'notice', role: 'note', text: '开启后，每一轮的截图会发给你填的这个模型服务（不会发给别人）。API Key 只保存在这台电脑的 ~/.uxqa 里，不会写进项目。按次计费的服务会产生费用，可以用下面的"每轮最多请求"控制。' }),
        h('div', { class: 'field' }, h('label', { for: 'ai-preset', text: '服务商' }), preset),
        h('div', { class: 'field' }, h('label', { for: 'ai-protocol', text: '接口类型' }), protocol),
        h('div', { class: 'field' }, h('label', { for: 'ai-base', text: '模型地址' }), baseUrl),
        h('div', { class: 'field' }, h('label', { for: 'ai-model', text: '模型名（要支持看图）' }), model, models,
          h('button', { class: 'btn small', type: 'button', onclick: async (event) => {
            const button = event.currentTarget; button.disabled = true;
            try { const result = await api('/ai/models', { method: 'POST', body: values() });
              fill(models, h('option', { value: '', text: '选择支持看图的模型' }), result.models.map((id) => h('option', { value: id, text: id })));
              fill(message, h('p', { text: result.models.length ? `已读取 ${result.models.length} 个模型，请选择后测试看图能力。` : '服务没有返回可用模型，可以手动填写。' }));
            } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
            finally { button.disabled = false; }
          } }, '获取模型列表')),
        h('div', { class: 'field' }, h('label', { for: 'ai-key', text: 'API Key' }), key,
          saved.hasKey ? h('button', { class: 'btn small quiet', type: 'button', onclick: () => save({ ...values(), apiKey: '', clearKey: true }) }, '删除已保存的 Key') : null),
        h('div', { class: 'field' }, h('label', { for: 'ai-passes', text: '每个结论看几遍' }), passes),
        h('label', { class: 'check' }, verify, '复核程序找到的问题（判断是不是误报）'),
        h('label', { class: 'check' }, discover, '按规则找程序没查到的问题（会再看一遍确认）'),
        h('div', { class: 'field' }, h('label', { for: 'ai-max', text: '每轮最多请求几次' }), maxCalls),
        h('div', { class: 'row' }, h('span', { class: 'grow' }),
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            fill(message, h('p', { class: 'muted', text: '正在发一张小图试试…' }));
            try { const result = await api('/ai/test', { method: 'POST', body: values() }); fill(message, h('div', { class: `notice${result.ok ? '' : ' error'}`, text: result.message })); }
            catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
          } }, '测试连接'),
          h('button', { class: 'btn primary', type: 'submit' }, '保存')));
    }
    fill(panel, h('h2', { text: 'AI 看图复核（可选）' }), intro, modeButtons, body, message);
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
      fill(message, h('div', { class: 'notice', text: saved.mode === 'off' ? '已关闭 AI 看图。' : saved.mode === 'api' ? '已保存。下一轮检测完会自动让 AI 看截图；已有的检测也可以在问题列表上方点"AI 看图复核"。' : '已保存。检测后对你的 AI 助手说"用 uxqa 复核截图"。' }));
    } catch (error) { fill(message, h('div', { class: 'notice error', text: error.message })); }
    finally { saving = false; panel.removeAttribute('aria-busy'); controls.forEach((control) => { control.disabled = false; }); }
  };
  draw();
}

async function startLogin(entry, box) {
  if (!entry.pages || !entry.pages.baseUrl) { fill(box, h('div', { class: 'notice error', text: '请先填写并保存预览地址。' })); return; }
  try { await api(`/projects/${entry.id}/login/start`, { method: 'POST' }); }
  catch (error) {
    if (error.status === 409 && error.data.browser) {
      if (await browserSheet(error.data.browser, { purpose: 'login' }) === 'installed') return startLogin(entry, box);
      return;
    }
    fill(box, h('div', { class: 'notice error', text: error.message })); return;
  }
  fill(box, h('div', { class: 'notice stack' },
    h('span', { text: '已经打开了一个浏览器窗口。请在里面登录你的产品，登录好后回到这里点"我已登录"。' }),
    h('div', { class: 'row' },
      h('button', { class: 'btn small primary', type: 'button', onclick: async () => {
        try {
          const data = await api(`/projects/${entry.id}/login/finish`, { method: 'POST' });
          await loadProjects();
          document.getElementById('storage').value = data.saved;
          fill(box, h('div', { class: 'notice', text: '已保存登录状态。下一轮检测会带着登录去打开页面。' }));
        } catch (error) { fill(box, h('div', { class: 'notice error', text: error.message })); }
      } }, '我已登录'),
      h('button', { class: 'btn small', type: 'button', onclick: async () => { await api(`/projects/${entry.id}/login/cancel`, { method: 'POST' }).catch(() => undefined); fill(box); } }, '取消'))));
}

async function removeCurrent() {
  const entry = project();
  const ok = await confirmSheet({ title: `从列表移除 ${entry.name}？`, body: h('p', { text: '只是从 uxqa 的项目列表里移除，不会删除项目里的任何文件。这个项目的检测记录会保留在本机。' }), confirmText: '移除' });
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
    fill(document.getElementById('workspace'), h('div'), emptyState('info', '请用启动时给出的链接打开', '在终端运行 uxqa ui，它会打印一个带访问令牌的链接。'));
    return;
  }
  try { await loadProjects(); }
  catch (error) { fill(document.getElementById('workspace'), h('div'), emptyState('info', '打不开控制台', error.message)); return; }
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
