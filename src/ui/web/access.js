'use strict';

let accessSettings = { locale: null, onboardingDone: false, checks: [] };
let accessDataLocation = '';
const accessText = (zh, en) => accessSettings.locale === 'en' ? en : zh;
function applyAccessLocale() {
  document.documentElement.lang = accessSettings.locale === 'en' ? 'en' : 'zh-CN';
  window.webkit?.messageHandlers?.uxqaLanguage?.postMessage(accessSettings.locale);
}
const accessStatus = (status) => ({
  accessible: accessText('最近可访问', 'Accessible at last check'),
  denied: accessText('访问被拒绝', 'Access denied'),
  missing: accessText('位置不存在或已移动', 'Location missing or moved'),
  unavailable: accessText('位置暂不可用', 'Location unavailable'),
  'timed-out': accessText('检查超时，请确认系统提示后重试', 'Check timed out; respond to any system prompt and retry'),
  error: accessText('无法确定访问状态', 'Could not determine access'),
})[status] || accessText('未检查', 'Not checked');

async function checkAccessPath(path) {
  accessSettings = await api('/access/check', { method: 'POST', body: { path } });
  renderRail();
  return accessSettings.checks.find((item) => item.path === path) || accessSettings.checks.at(-1);
}

function accessPathForm(onChecked) {
  const input = h('input', { class: 'input', type: 'text', 'aria-label': accessText('文件夹路径', 'Folder path'), placeholder: accessText('输入要检查的项目文件夹绝对路径', 'Enter an absolute path to the project folder') });
  const message = h('p', { class: 'notice', role: 'status', hidden: true });
  return h('form', { class: 'stack-tight', onsubmit: async (event) => {
    event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; message.hidden = false;
    message.textContent = accessText('正在检查…', 'Checking…');
    try {
      const result = await checkAccessPath(input.value);
      message.textContent = `${accessStatus(result.result)} · ${result.path} · ${timeText(result.checkedAt)}`;
      onChecked?.();
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  } }, h('label', { class: 'workflow-field' }, accessText('项目文件夹', 'Project folder'), input),
  h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, accessText('检查并按需授权', 'Check and authorize if needed'))), message);
}

function accessExplanation() {
  return h('div', { class: 'stack' },
    h('p', { text: accessText('UXQA 读取你选择的项目目录以检查源码。项目默认只读；保存规则、基线或组件同步时会单独说明。', 'UXQA reads the project folder you choose to inspect source files. Projects are read-only by default; saving rules, baselines, or component sync is explained separately.') }),
    h('p', { text: accessText(`项目列表、检查记录和账号配置保存在本机 ${accessDataLocation}。应用截图和已登记的命令行截图在 48 小时后自动清理；检查记录保留。可选的网页预览、浏览器下载和 AI 复核可能联网；AI 复核会发送选定截图及上下文。`, `Project lists, check records, and account settings are stored locally at ${accessDataLocation}. App screenshots and registered CLI screenshots are deleted after 48 hours; check records remain. Optional page previews, browser downloads, and AI review may use the network; AI review sends selected screenshots and context.`) }),
    h('p', { class: 'muted', text: accessText('系统可能在访问桌面、文稿、下载或其他受保护位置时询问。macOS 通常记住选择，但授权可能被更改。UXQA 不需要摄像头、麦克风、辅助功能、全盘访问或系统录屏权限。', 'The system may ask before accessing Desktop, Documents, Downloads, or other protected locations. macOS usually remembers your choice, but permissions can change. UXQA does not need camera, microphone, accessibility, full-disk access, or screen-recording permissions.') }));
}

function openAccessOnboarding({ required = false } = {}) {
  let step = accessSettings.locale ? 1 : 0;
  return openOverlay((panel, close) => {
    panel.classList.add('access-panel');
    const render = () => {
      if (step === 0) {
        fill(panel, h('h2', { text: '选择语言 / Choose your language' }), h('p', { class: 'muted', text: '稍后可在设置中更改。 / You can change this later in Settings.' }),
          h('div', { class: 'row' }, ...[['zh', '中文'], ['en', 'English']].map(([locale, label]) => h('button', { class: 'btn', type: 'button', onclick: async (event) => {
            event.currentTarget.disabled = true;
            try { accessSettings = await api('/access', { method: 'POST', body: { locale } }); applyAccessLocale(); step = 1; render(); }
            catch (error) { toast(error.message); event.currentTarget.disabled = false; }
          } }, label))));
      } else if (step === 1) {
        fill(panel, h('h2', { text: accessText('了解访问范围', 'Understand access') }), accessExplanation(),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { step = 0; render(); } }, accessText('上一步', 'Back')),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { step = 2; render(); } }, accessText('下一步', 'Next'))));
      } else if (step === 2) {
        const list = h('div', { class: 'stack-tight' });
        const refresh = () => fill(list, ...accessSettings.checks.map((item) => h('p', { class: 'muted', text: `${accessStatus(item.result)} · ${item.path}` })));
        refresh();
        fill(panel, h('h2', { text: accessText('检查项目位置', 'Check project locations') }),
          h('p', { class: 'muted', text: accessText('逐个输入你要使用的项目文件夹。访问受保护位置时，系统可能显示授权提示；也可以稍后在设置中检查。', 'Enter each project folder you plan to use. The system may request access to protected locations. You can also check later in Settings.') }),
          accessPathForm(refresh), list,
          h('p', { class: 'faint', text: accessText('结果只反映检查时此位置的可访问性，并非永久授权保证。', 'A result only reflects accessibility at the time of the check; it is not a permanent authorization guarantee.') }),
          h('p', { class: 'faint', text: accessText('今后启动时会重新检查此前可访问的位置；也可以在设置中随时重新检查或移除记录。', 'Previously accessible locations are checked again at startup. You can recheck or remove a record in Settings.') }),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { step = 1; render(); } }, accessText('上一步', 'Back')),
            h('button', { class: 'btn primary', type: 'button', onclick: () => { step = 3; render(); } }, accessText('下一步', 'Next'))));
      } else {
        fill(panel, h('h2', { text: accessText('局域网与可选联网', 'Local network and optional connections') }),
          h('p', { text: accessText('只有检查局域网中的预览地址时，系统才可能请求本地网络访问。请在项目的预览设置中填写地址；系统出现提示时，由你决定是否允许。', 'The system may request local-network access only when you check a preview on your LAN. Enter the URL in project preview settings and decide whether to allow any system prompt.') }),
          h('p', { class: 'muted', text: accessText('这一步不会发起联网请求，也无法读取系统的本地网络授权状态。浏览器组件下载和 AI 看图均为可选操作，会分别告知用途。', 'This step makes no network request and cannot read the system’s local-network grant. Browser downloads and AI image review are optional and explain their purpose separately.') }),
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: () => { step = 2; render(); } }, accessText('上一步', 'Back')),
            h('button', { class: 'btn primary', type: 'button', onclick: async (event) => {
              event.currentTarget.disabled = true;
              try { accessSettings = await api('/access', { method: 'POST', body: { onboardingDone: true } }); close(true); }
              catch (error) { toast(error.message); event.currentTarget.disabled = false; }
            } }, accessText('完成', 'Finish'))));
      }
      if (panel.isConnected) panel.querySelector('button, input, select')?.focus();
    };
    render();
  }, { label: 'UXQA setup', dismissible: !required });
}

function renderAccessPanel(panel) {
  panel.classList.add('access-panel');
  api('/access').then((settings) => { if (panel.isConnected) { const restoreFocus = panel.contains(document.activeElement); accessSettings = settings; renderRail(); draw(); if (restoreFocus) panel.querySelector('select')?.focus(); } }).catch((error) => { if (panel.isConnected) toast(error.message); });
  const draw = () => fill(panel, h('h2', { text: accessText('访问与语言', 'Access and language') }),
    h('p', { class: 'muted', text: accessText('下方为最近一次实际目录读取的结果，并非 macOS 系统授权清单；系统决定可能随时变化。', 'These are results of actual folder checks, not a list of macOS system grants. System decisions can change.') }),
    h('label', { class: 'workflow-field' }, accessText('界面语言', 'Interface language'), h('select', { class: 'input', 'aria-label': accessText('界面语言', 'Interface language'), onchange: async (event) => {
      try { accessSettings = await api('/access', { method: 'POST', body: { locale: event.target.value } }); applyAccessLocale(); renderRail(); renderGlobal(document.getElementById('workspace')); document.querySelector('.access-panel select')?.focus(); }
      catch (error) { toast(error.message); }
    } }, h('option', { value: 'zh', selected: accessSettings.locale !== 'en', text: '中文' }), h('option', { value: 'en', selected: accessSettings.locale === 'en', text: 'English' }))),
    accessSettings.checks.length ? h('div', { class: 'stack-tight' }, accessSettings.checks.map((item) => h('div', { class: 'access-check-row' },
      h('p', { text: `${accessStatus(item.result)} · ${item.path} · ${timeText(item.checkedAt)}` }),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', 'aria-label': accessText(`重新检查 ${item.path}`, `Recheck ${item.path}`), onclick: async (event) => {
        event.currentTarget.disabled = true; try { await checkAccessPath(item.path); draw(); } catch (error) { toast(error.message); event.currentTarget.disabled = false; }
      } }, accessText('重新检查', 'Recheck')),
      h('button', { class: 'btn small', type: 'button', 'aria-label': accessText(`移除 ${item.path} 的记录`, `Forget record for ${item.path}`), onclick: async (event) => {
        event.currentTarget.disabled = true; try { accessSettings = await api('/access/forget', { method: 'POST', body: { path: item.path } }); renderRail(); draw(); } catch (error) { toast(error.message); event.currentTarget.disabled = false; }
      } }, accessText('移除记录', 'Forget record'))))))
      : h('p', { class: 'muted', text: accessText('尚未检查任何项目位置。', 'No project locations have been checked.') }),
    accessPathForm(draw), h('p', { class: 'faint', text: accessText('若访问被拒绝，请在系统隐私与安全设置中检查 UXQA 的文件与文件夹权限，再点击检查。目录移动或网络卷断开也会导致无法访问。', 'If access is denied, review UXQA under your system privacy and security settings, then check again. Moved folders or disconnected network volumes can also become unavailable.') }),
    h('button', { class: 'btn', type: 'button', onclick: () => openAccessOnboarding() }, accessText('重新查看首次引导', 'Review setup')));
  draw();
}

async function initializeAccess() {
  accessSettings = await api('/access');
  accessDataLocation = accessSettings.dataLocation;
  applyAccessLocale();
  if (!accessSettings.onboardingDone || !accessSettings.locale) await openAccessOnboarding({ required: true });
  if (accessSettings.onboardingDone && accessSettings.checks.some((item) => item.result === 'accessible')) {
    fill(document.getElementById('workspace'), h('div'), h('p', { class: 'boot', role: 'status', text: accessText('正在检查此前访问过的位置…', 'Checking previously accessed locations…') }));
    const result = await api('/access/recheck', { method: 'POST', body: {} }); accessSettings = result.settings;
    if (result.changed.length) toast(accessText('此前可访问的项目位置已发生变化，请在设置中检查。', 'A previously accessible project location has changed. Review it in Settings.'));
  }
}
