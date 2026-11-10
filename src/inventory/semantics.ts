/**
 * Built-in knowledge used to connect hand-written markup and plain-language queries to library components.
 * Only components that actually exist in the product library are ever suggested.
 */

export interface NativeMapping {
  /** Intrinsic JSX tag, e.g. `button`. */
  element: string;
  /** Optional ARIA role or input type that changes the meaning, e.g. `tab`. */
  role?: string;
  inputType?: string;
  /** Library export names to try, most specific first. */
  components: string[];
  /** Plain-language name shown to people. */
  label: string;
}

/** Most specific first: a `<button role="tab">` is a tab, not a button. */
export const NATIVE_MAPPINGS: NativeMapping[] = [
  { element: 'button', role: 'tab', components: ['TabsTrigger', 'Tabs'], label: '标签页' },
  { element: 'button', role: 'switch', components: ['Switch'], label: '开关' },
  { element: 'button', role: 'checkbox', components: ['Checkbox'], label: '复选框' },
  { element: 'button', role: 'radio', components: ['RadioGroupItem', 'RadioGroup'], label: '单选项' },
  { element: 'button', role: 'menuitem', components: ['DropdownMenuItem'], label: '菜单项' },
  { element: 'button', role: 'combobox', components: ['SelectTrigger', 'Select'], label: '下拉选择' },
  { element: 'div', role: 'tab', components: ['TabsTrigger', 'Tabs'], label: '标签页' },
  { element: 'div', role: 'tablist', components: ['TabsList', 'Tabs'], label: '标签页' },
  { element: 'div', role: 'dialog', components: ['Dialog', 'Sheet'], label: '弹窗' },
  { element: 'div', role: 'alertdialog', components: ['AlertDialog'], label: '确认弹窗' },
  { element: 'div', role: 'button', components: ['Button'], label: '按钮' },
  { element: 'span', role: 'button', components: ['Button'], label: '按钮' },
  { element: 'div', role: 'switch', components: ['Switch'], label: '开关' },
  { element: 'div', role: 'checkbox', components: ['Checkbox'], label: '复选框' },
  { element: 'div', role: 'progressbar', components: ['Progress'], label: '进度条' },
  { element: 'div', role: 'tooltip', components: ['Tooltip'], label: '提示气泡' },
  { element: 'input', inputType: 'checkbox', components: ['Checkbox'], label: '复选框' },
  { element: 'input', inputType: 'radio', components: ['RadioGroupItem', 'RadioGroup'], label: '单选项' },
  { element: 'input', inputType: 'range', components: ['Slider'], label: '滑块' },
  { element: 'button', components: ['Button'], label: '按钮' },
  { element: 'input', components: ['Input'], label: '输入框' },
  { element: 'textarea', components: ['Textarea'], label: '多行输入框' },
  { element: 'select', components: ['Select'], label: '下拉选择' },
  { element: 'label', components: ['Label'], label: '表单标签' },
  { element: 'table', components: ['Table'], label: '表格' },
  { element: 'progress', components: ['Progress'], label: '进度条' },
  { element: 'hr', components: ['Separator'], label: '分隔线' },
  { element: 'dialog', components: ['Dialog'], label: '弹窗' },
];

/** Plain-language names and search words for common component names (lower-case keys). */
export const COMPONENT_WORDS: Record<string, { label: string; words: string[] }> = {
  button: { label: '按钮', words: ['按钮', '按键', 'btn', 'cta', '提交', '确认按钮'] },
  tabs: { label: '标签页', words: ['标签页', '选项卡', 'tab', '切换'] },
  dialog: { label: '弹窗', words: ['弹窗', '对话框', '模态', 'modal', 'popup'] },
  'alert-dialog': { label: '确认弹窗', words: ['确认弹窗', '二次确认', 'confirm'] },
  sheet: { label: '侧边抽屉', words: ['抽屉', '侧滑', 'drawer', 'sheet'] },
  input: { label: '输入框', words: ['输入框', '文本框', 'textfield', 'field'] },
  textarea: { label: '多行输入框', words: ['多行输入', '文本域', 'textarea'] },
  select: { label: '下拉选择', words: ['下拉', '选择器', 'dropdown', 'picker', 'combobox'] },
  checkbox: { label: '复选框', words: ['复选框', '勾选', '多选'] },
  'radio-group': { label: '单选项', words: ['单选', 'radio'] },
  switch: { label: '开关', words: ['开关', 'toggle', '切换开关'] },
  slider: { label: '滑块', words: ['滑块', '滑动条', 'range'] },
  card: { label: '卡片', words: ['卡片', 'card', '面板'] },
  badge: { label: '小标签', words: ['徽标', '标签', 'tag', 'chip', 'pill'] },
  avatar: { label: '头像', words: ['头像', 'avatar'] },
  tooltip: { label: '提示气泡', words: ['提示', '气泡', 'tooltip', 'hint'] },
  popover: { label: '弹出层', words: ['弹出层', '浮层', 'popover'] },
  'dropdown-menu': { label: '下拉菜单', words: ['下拉菜单', '更多菜单', 'menu', '菜单'] },
  table: { label: '表格', words: ['表格', '列表', 'table', 'grid'] },
  pagination: { label: '分页', words: ['分页', '翻页', 'pager'] },
  progress: { label: '进度条', words: ['进度', 'progress', 'loading bar'] },
  skeleton: { label: '加载占位', words: ['骨架屏', '加载占位', 'skeleton', 'placeholder'] },
  separator: { label: '分隔线', words: ['分隔线', '分割线', 'divider'] },
  label: { label: '表单标签', words: ['表单标签', 'label'] },
  alert: { label: '提示条', words: ['提示条', '警告', 'banner', 'notice'] },
  accordion: { label: '折叠面板', words: ['折叠', '手风琴', 'accordion', 'collapse'] },
  sidebar: { label: '侧边栏', words: ['侧边栏', '导航栏', 'sidebar', 'nav'] },
  command: { label: '命令面板', words: ['命令面板', '搜索面板', 'command', 'palette'] },
  chart: { label: '图表', words: ['图表', 'chart', 'graph'] },
  toggle: { label: '切换按钮', words: ['切换按钮', 'toggle'] },
};

export function componentLabel(name: string): string | undefined {
  const key = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return COMPONENT_WORDS[key]?.label ?? COMPONENT_WORDS[key.split('-')[0]]?.label;
}
