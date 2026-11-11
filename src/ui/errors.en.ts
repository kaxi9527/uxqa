const MESSAGES: Record<string, string> = {
  '问题分类只能是 UI、UX 或体验': 'Choose UI, UX, or Experience as the issue category.',
  '请求内容太大': 'The request is too large.',
  '请求内容不是有效的 JSON': 'The request is not valid JSON.',
  '请求内容必须是对象': 'The request must be an object.',
  '找不到这个项目，可能已被移除': 'Project not found; it may have been removed.',
  '请填写项目目录的路径': 'Enter a project folder path.',
  '缺少文件': 'A file is required.',
  '文件已不存在': 'The file no longer exists.',
  '只能查看项目里的文件': 'Only files inside the project can be viewed.',
  '这个文件不能预览': 'This file cannot be previewed.',
  '缺少规则内容': 'Rules content is required.',
  '规则内容的格式写错了，可能少了逗号、引号或括号。': 'The rules JSON is invalid; check commas, quotes and brackets.',
  '规则文件的最外层必须是一个对象': 'The top level of the rules file must be an object.',
  '模型地址看不懂，例如 https://api.openai.com/v1': 'Enter a valid model URL, for example https://api.openai.com/v1.',
  '请填写模型名；直接连接还需要模型地址': 'Enter a model name. A direct connection also needs a model URL.',
  '这个预览地址看不懂，例如可以写 localhost:5173 或 http://localhost:5173': 'Enter a valid preview URL, such as localhost:5173 or http://localhost:5173.',
  '页面地址只能是 http 或 https 开头': 'Preview URLs must use HTTP or HTTPS.',
  '页面地址里不要写账号密码；需要登录时请提供登录状态文件': 'Do not put credentials in the URL. Provide a login state file when needed.',
  '请填写要检查的文件夹绝对路径': 'Enter an absolute path to the folder to check.',
  '请选择要移除的访问记录': 'Choose an access record to remove.',
  '请选择中文或 English': 'Choose 中文 or English.',
  '无效的引导状态': 'Invalid onboarding state.',
  '下载浏览器组件需要你先确认': 'Confirm before downloading the browser component.',
  '模型操作不存在': 'Model operation not found.',
  '无法读取所选文件夹。请检查系统文件与文件夹权限，然后重试。': 'Cannot read the selected folder. Check system file and folder permissions, then retry.',
  '所选文件夹已不存在或已移动。': 'The selected folder is missing or has moved.',
  '暂时无法读取所选文件夹，请检查磁盘或网络卷。': 'The selected folder is unavailable. Check the disk or network volume.',
  '没有这个接口': 'Endpoint not found.',
  '请选择有效的专项诊断目标': 'Choose a valid focused review target.',
  '请先完成一轮检查，再根据证据生成方案': 'Complete a check before creating a plan from its evidence.',
  '找不到要处理的问题': 'The finding to handle was not found.',
  '请选择有效的处理状态': 'Choose a valid handling status.',
  '接受偏差或人工确认时，请填写理由或验证证据': 'Provide a reason or evidence when accepting a deviation or confirming manually.',
  '请填写问题名称、位置，以及可重现的操作与观察证据': 'Enter a name, location, reproduction steps, and observation evidence.',
  '找不到这一轮检测': 'Check round not found.',
  '还没有配置用 API 看图；在"页面"里的"AI 看图复核"设置': 'Configure API image review in Settings first.',
  '找不到这次检测': 'Check job not found.',
  '截图名称不对': 'Invalid screenshot name.',
  '截图已不存在': 'The screenshot no longer exists.',
  '请先填写并保存预览地址': 'Save a preview URL first.',
  '登录窗口已经关掉了，请重新点"打开浏览器登录"': 'The login window is closed. Open it again to sign in.',
  '请先填写页面地址': 'Enter a page URL first.',
  '只有 git 来源需要拉取': 'Only Git sources can be pulled.',
  '保存前需要确认': 'Confirm before saving.',
  '记录老问题前需要确认': 'Confirm before recording the baseline.',
  '请填写有效的模型地址': 'Enter a valid model URL.',
  '模型地址必须是 HTTP(S) 地址，不能包含账号、查询参数或片段': 'The model URL must use HTTP(S) and cannot contain credentials, a query or a fragment.',
  '模型列表分页过多，请在连接中心缩小可见模型范围': 'Too many model-list pages. Narrow the visible model range in the connection settings.',
  '还没有填模型地址或模型名': 'Enter a model URL and model name.',
  '模型输出被截断，请减少单次内容后重试': 'The model output was truncated. Reduce the amount sent and retry.',
  '模型没有返回文字，可能拒绝了请求或不支持看图': 'The model returned no text; it may have refused the request or may not support images.',
  '模型拒绝回答这次请求': 'The model refused this request.',
  '模型没有返回文字，请确认模型支持看图': 'The model returned no text. Check that it supports images.',
  '找不到此项目中的修复方案': 'Repair plan not found in this project.',
  '此方案生成于旧版本，请重新生成后逐项验证': 'This plan was created by an older version. Generate a new plan to verify tasks individually.',
  '请选择此方案中的验证任务': 'Choose a verification task in this plan.',
  '请选择有效的验证结果': 'Choose a valid verification result.',
  '请填写 1–4000 字的验证过程、观察证据或适用性理由': 'Enter 1–4000 characters describing verification steps, evidence or the reason the task is not applicable.',
};

export function englishUiError(message: string): string {
  if (MESSAGES[message]) return MESSAGES[message];
  let match = /^无法访问此位置：(.+)。请在系统隐私设置中检查文件与文件夹权限，然后重试。$/.exec(message);
  if (match) return `Cannot access ${match[1]}. Check system file and folder permissions, then retry.`;
  match = /^暂时无法读取此位置：(.+)。请确认磁盘或网络卷可用后重试。$/.exec(message);
  if (match) return `Cannot read ${match[1]}. Check that the disk or network volume is available, then retry.`;
  match = /^这个路径不是一个存在的文件夹：(.+)$/.exec(message);
  if (match) return `This path is not an existing folder: ${match[1]}`;
  match = /^页面路径要以 \/ 开头：(.+)$/.exec(message);
  if (match) return `Page paths must begin with /: ${match[1]}`;
  match = /^找不到登录状态文件：(.+)$/.exec(message);
  if (match) return `Login state file not found: ${match[1]}`;
  match = /^规则内容的格式写错了：第 (\d+) 行第 (\d+) 个字附近，可能少了逗号、引号或括号。$/.exec(message);
  if (match) return `Invalid rules JSON near line ${match[1]}, column ${match[2]}; check commas, quotes and brackets.`;
  match = /^模型服务返回 (\d+)：(.+)$/.exec(message);
  if (match) return `The model service returned ${match[1]}: ${match[2]}`;
  match = /^连不上模型服务：(.+)$/.exec(message);
  if (match) return `Cannot connect to the model service: ${match[1]}`;
  return /[\u4e00-\u9fff]/.test(message) ? `Details (original language): ${message}` : message;
}
