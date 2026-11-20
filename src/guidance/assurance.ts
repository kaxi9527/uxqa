// Project documents supply expectations. These procedures specify how to collect evidence.
export function assuranceCatalog(locale: 'zh' | 'en' | null) {
  const t = (zh: string, en: string) => locale === 'en' ? en : zh;
  const wcag = 'https://www.w3.org/TR/WCAG22/';
  const istqb = 'https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf';
  const playwright = 'https://playwright.dev/docs/test-snapshots';
  const decisions: Record<string,string[]> = {
    fidelity:[
      t('用标注的边界或容差判断具体区域；没有标注时记录差异位置并送审。','Judge the region against its annotated bounds or tolerance. With no annotation, record the difference for review.'),
      t('以批准的字样、色值、素材或字体配置为预期。仅有抗锯齿差异时保留样本供人工核对。','Use the approved text, color, asset or font setting. Isolate antialiasing differences for review.'),
      t('每个帧只对应一个视口与状态。缺少该状态设计或未触发时，该格待验证。','Pair each frame with one viewport and state. A missing state design or untriggered state stays unverified.')],
    logic:[
      t('逐行判定预期与实测，注明单位和包含端点的约定。没有原文支撑的阈值不得作为失败依据。','Evaluate each decision row with units and endpoint inclusivity. An unsupported threshold cannot establish failure.'),
      t('触发条件成立后目标读值应随配置变化，对照对象应保留原值。记录发布版本、时间和读取入口。','After activation, target consumers must follow the setting and the control must retain its value. Record version, time and read sites.'),
      t('按作用域和对象键比较缺失、多余、错误归属与重复项；无法枚举完整清单时只报告已覆盖范围。','Compare missing, extra, misassigned and duplicate keys within scope. An incomplete list supports only a partial observation.')],
    interaction:[
      t('以交互文档规定的触发次数和控件状态核对。只有按键事件而无状态观测时记录待验证。','Compare observed activation count and resulting state with the interaction contract. Input events alone leave the outcome unverified.'),
      t('记录去程锚点与回程实际选中项、位置和焦点；若设计要求重置，使用该约定作为预期。','Record the outbound anchor and actual return selection, position and focus. Apply an intentional reset if specified.'),
      t('分别比对首次、重复和恢复后的最终实体及副作用次数。缺少可观察副作用时保留缺口。','Compare final entity and side-effect count after first action, repetition and recovery. Note any unobservable side effect.')],
    accessibility:[
      t('核对 WCAG 2.2 AA 适用条件：普通文字 4.5:1、大字 3:1；需要辨识的控件视觉信息按 1.4.11 核对 3:1 和例外。渐变、遮盖或未知背景需复核。','For applicable WCAG 2.2 AA cases, evaluate normal text at 4.5:1 and large text at 3:1. Check applicable non-text information at 3:1 under 1.4.11 and its exceptions. Review uncertain backgrounds.'),
      t('按实际可操作顺序逐项留证。2.5.8 的 24×24 CSS 像素有间距、等效控件等例外；焦点遮挡按 2.4.11 的适用条件核对。','Capture the actual actionable order. Apply spacing, equivalent-control and other exceptions to the 24×24 CSS px target rule; evaluate obscuration under 2.4.11.'),
      t('比对实际朗读的标签、状态和错误告知；缺少指定辅助技术的运行记录时，读屏任务保持待验证。','Compare actual announcements for labels, state and errors. Without the specified assistive technology, leave the reader journey unverified.')],
    usability:[
      t('记录第一步和实际求助内容；区分参与者的原话与评审者对原因的解释。建议改动后重复观察。','Record the first action and assistance requested. Distinguish participant words from the reviewer’s explanation, then retest.'),
      t('独立完成、协助完成和未完成分开计数。仅比较同一任务与条件，并同时展示分母。','Count independent, assisted and incomplete attempts separately. Compare equivalent tasks and conditions and display the denominator.'),
      t('以能否恢复并继续原任务为观察结果。错误率改进需要同条件前后样本，单次观察只形成建议。','Observe whether the person recovers and resumes the task. An error-rate claim requires comparable samples; a single observation supports a recommendation.')],
    components:[
      t('只有已绑定目录、解析后的包及实际消费点同时对应才确认映射。来源无法解析时记未知。','Confirm a mapping only when bound catalog, resolved package and consumer agree. Record unresolved origins as unknown.'),
      t('按契约逐项比对输入、可见 UI 和事件；相同截图不能证明事件或受控回调正确。','Compare input, rendered state and emitted event against the contract. Identical images do not establish callback behavior.'),
      t('以当前绑定版本及允许覆盖项为准。记录 token 链和计算值，变更版本后重新采集。','Use the bound version and permitted overrides. Record token chain and computed value; recollect after a version change.')],
    compatibility:[
      t('只对矩阵中实际运行的组合下结论。记录裁切、可达性和受影响操作；超宽图表等允许双向滚动的区域单独核对。','Judge only executed matrix cells. Record clipping, reachability and affected action, accounting for regions permitted to scroll in two directions.'),
      t('同时核对长内容可读性、语义、数字日期口径和操作可达。无本地化原文时将翻译质量留给人工。','Check content visibility, meaning, date and number formats, and controls. Route translation quality to review if the approved copy is missing.'),
      t('故障实际触发、重试成功及实体唯一性均需留证。未注入故障时不能判定恢复合格。','Capture actual failure injection, successful retry and entity uniqueness. Without the fault, recovery remains unverified.')],
    performance:[
      t('对照项目明确的指标、设备与预算。记录冷暖缓存和采样次数，缺失现场数据时保留现场指标空缺。','Use the project metric, device and budget. Record cache state and sample count, leaving absent field metrics unmeasured.'),
      t('报告实际触发、采样时长及分布；把浏览器帧回调间隔与真实设备掉帧分别记录。','Report observed trigger, sample duration and distribution. Distinguish browser frame intervals from device-level dropped frames.'),
      t('记录偏好生效、动画结束与最终可操作状态。比较滚动时必须观测滚动位移；未发生位移时不能判定滑动性能。','Record applied preference, animation end and final actionable state. Scroll comparisons require observed displacement; no movement leaves the measurement open.')],
  };
  return [
    { id: 'fidelity', title: t('视觉还原','Design fidelity'), domain: 'ui', topics: ['hierarchy','spacing','typography','color','assets'],
      inputs: t('设计帧、标注、断点、主题或品牌规范；相同状态的实测截图。','A design frame, annotations, breakpoint, theme or brand spec and an observed capture of the same state.'),
      boundary: t('先确认路由、角色、内容、主题、字体、比例和裁切范围。不同条件列为待对齐。像素差异须核对具体设计要求。','Match route, role, content, theme, fonts, scale and crop. Hold unmatched pairs for alignment. Interpret pixel differences against an explicit design requirement.'),
      sources: [playwright], checks: [
        [t('框架与布局','Structure and layout'),t('按帧与同尺寸页面叠图，检查容器边界、栅格、对齐、间距和滚动区域。记录帧版本、区域与差异坐标。','Overlay a frame with an equally sized capture. Inspect containers, grid, spacing, alignment and scroll regions. Record the frame revision, region and coordinates.')],
        [t('文字、颜色与资源','Type, color and assets'),t('逐项核对字重、换行、语义色、图标和裁切。用标注或计算样式复核；字体渲染与动态内容单列。','Check weight, wrapping, semantic colors, icon and crop against annotations or computed styles. Isolate font rendering and dynamic content.')],
        [t('变体与跨屏还原','States and breakpoints'),t('为默认、选中、禁用、错误和每个已设计断点分别配对。修复后用同一帧和条件重跑。','Pair default, selected, disabled, error and designed breakpoints separately. Recheck against the same frame and capture conditions.')]] },
    { id: 'logic', title: t('逻辑判断','Product logic'), domain: 'ux', topics: ['context','forms','states','review'],
      inputs: t('PRD、决策记录、开发说明、API 契约、验收示例或工单中的可检验条款。','Testable clauses in requirements, decisions, implementation notes, API contracts, acceptance examples or tickets.'),
      boundary: t('记录原文、版本、角色、对象和生效条件。条款冲突或条件未触发时留待确认。一次观察到相同文案不足以证明规则已生效。','Record the quote, revision, actor, entity and activation condition. Hold conflicts or untriggered conditions. Matching copy at one instant cannot establish propagation.'),
      sources: [istqb,'https://docs.pact.io/getting_started/how_pact_works'], checks: [
        [t('条件组合与边界','Decision tables and boundaries'),t('从条款提取前置条件、结果与单位。按等价类、临界值两侧、无效输入和例外建立可达用例；逐个对照实际观测。','Extract preconditions, outcomes and units. Exercise reachable equivalence classes, both sides of boundaries, invalid inputs and exceptions, recording each observed result.')],
        [t('单变量配置生效','Configuration propagation'),t('固定角色、实体和版本，先记录对照值，再改变一项并触发生效条件。读取每个消费入口并保留未改对象作对照。','Hold entity, revision and role constant. Capture a control, vary one setting, trigger activation and observe every consumer plus an unchanged control.')],
        [t('状态迁移与多角色结果','Transitions and cross-role outcomes'),t('分别跑确认、取消、重试。保存前后各角色所见的作用域、对象键、字段和值；按键比对清单并核对撤销后的状态。','Run confirm, cancel and retry separately. Capture scoped keys, fields and values for each role before and after. Compare keyed lists and the restored state.')]] },
    { id: 'interaction', title: t('交互行为','Interaction behavior'), domain: 'ux', topics: ['navigation','forms','gestures','motion-interruption'],
      inputs: t('交互文档、原型连线、控件规范、错误状态表或复现步骤。','Interaction specs, prototype links, control contracts, error-state tables or reproduction steps.'),
      boundary: t('记录触发方式、操作前后状态与可见反馈。静态画面无法验证手势或动作完成。','Record the input modality, prior and resulting state and visible feedback. A still frame cannot establish gesture behavior.'),
      sources: ['https://www.w3.org/WAI/ARIA/apg/patterns/','https://www.w3.org/WAI/tutorials/forms/notifications/'], checks: [
        [t('输入与操作反馈','Input and feedback'),t('分别用键盘、指针和适用的触屏操作。核对焦点、激活次数、忙碌与完成态以及操作是否可取消。','Exercise keyboard, pointer and applicable touch input. Record focus, activation count, busy and completion states and cancellation.')],
        [t('导航、滚动与返回','Navigation, scroll and return'),t('执行深链接、前进后退、长列表加载、弹层开合。比对返回后的选中项、滚动锚点、输入草稿和焦点。','Exercise deep links, history, long lists and overlays. Compare selection, scroll anchor, draft and focus on return.')],
        [t('中断、重复与恢复','Interruption and recovery'),t('在等待完成前重复或取消操作，再进行恢复。核对触发次数、最终状态和恢复反馈；用原条件复检。','Repeat or cancel while an action is pending, then recover. Capture activation count, final state and recovery feedback, and replay under the original conditions.')]] },
    { id: 'accessibility', title: t('无障碍','Accessibility'), domain: 'ux', topics: ['accessibility','motion-accessibility','forms','color'],
      inputs: t('无障碍目标、页面及完整任务、支持的辅助技术、主题和交互状态。','Accessibility target, complete journeys, supported assistive technology, themes and interaction states.'),
      boundary: t('逐项注明 WCAG 版本、成功准则、适用内容和例外。自动扫描只覆盖可判定项目；键盘与读屏任务分别留证。','Record the WCAG version, criterion, applicability and exceptions. Limit automated findings to decidable cases. Record keyboard and assistive-technology journeys separately.'),
      sources: [wcag,'https://www.w3.org/TR/WCAG-EM/','https://www.w3.org/WAI/ARIA/apg/patterns/'], checks: [
        [t('感知与重排','Perception and reflow'),t('采集实际前景和背景，按文字大小和非文本用途核对 1.4.3、1.4.11；缩放、重排测试 1.4.10 并记录例外。','Sample actual foreground and background. Check 1.4.3 and 1.4.11 by text size and control purpose. Test reflow under 1.4.10 and document exceptions.')],
        [t('键盘、焦点与触达','Keyboard, focus and targets'),t('以键盘完成关键任务，检查陷阱、顺序、焦点可见与遮挡；按 2.5.8 检查目标尺寸、间隔及等效操作。','Complete the journey by keyboard. Test traps, order, focus visibility and occlusion. Evaluate target size, spacing and equivalent controls under 2.5.8.')],
        [t('语义与状态通告','Semantics and announcements'),t('检查名称、角色、值、错误关联及状态通告。用指定读屏组合验证真实朗读和恢复路径，记录工具与版本。','Inspect names, roles, values, associated errors and status messages. Use the specified screen reader to verify announcements and recovery; record its version.')]] },
    { id: 'usability', title: t('用户体验与便利性','Usability and ease of use'), domain: 'experience', topics: ['onboarding','copy','navigation','forms','patterns'],
      inputs: t('目标用户与任务、客服反馈、研究记录、操作手册或验收目标。','Target users and tasks, support reports, research notes, help content or acceptance goals.'),
      boundary: t('启发式审查产生建议。只有实测任务才记录完成、时间、误操作、求助次数；说明样本和限制。','Heuristic review produces suggestions. Record completion, time, errors and assistance only for observed sessions, alongside sample and limitations.'),
      sources: ['https://www.nngroup.com/articles/ten-usability-heuristics/','https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing'], checks: [
        [t('可发现与易理解','Discoverability and comprehension'),t('给出用户目标，不透露控件名称。观察第一步、术语理解和误入路径；将观察、原因假设与修复建议分开。','Give a task goal without naming the control. Observe the first action, misunderstood words and wrong turns. Separate observations, hypotheses and recommendations.')],
        [t('成本与效率','Effort and efficiency'),t('分别走首次与熟练路径，记录输入、往返、重复填写、求助及任务完成。比较方案时保持任务、设备与样本口径一致。','Observe novice and repeat paths, entries, backtracking, duplicated work, assistance and completion. Compare alternatives under matched tasks, devices and sampling.')],
        [t('预防错误与自主恢复','Error prevention and recovery'),t('在易出错步骤观察提示时机、撤销、草稿和下一步。提出降低负担的方案，复测同一任务能否独立完成。','Observe warning timing, undo, saved input and next steps at likely mistakes. Propose an improvement and repeat the task to observe unaided recovery.')]] },
    { id: 'components', title: t('组件库映射','Component library mapping'), domain: 'ui', topics: ['components','color','spacing','patterns'],
      inputs: t('原生组件目录、Story、导入与消费点、Props 契约、Token 或版本迁移说明。','Native catalog, stories, imports and consumers, props contracts, tokens or migration notes.'),
      boundary: t('按真实导入来源、业务语义、版本和运行变体建立映射。同名、相似截图或重复结构只提供候选。','Map by resolved import, meaning, version and rendered variant. Similar appearance, names or structure identify candidates only.'),
      sources: ['https://storybook.js.org/docs/writing-tests/interaction-testing','https://design-system.service.gov.uk/community/contribution-criteria/'], checks: [
        [t('来源与复用','Provenance and reuse'),t('以项目绑定目录为基准追踪导出、导入、封装和消费点。区分库组件、原生元素、局部业务组件与未知来源。','Trace exports, imports, wrappers and consumers against the bound catalog. Distinguish library, native, local business and unresolved components.')],
        [t('变体与行为契约','Variants and behavior contracts'),t('将实际 Props、插槽、键盘与受控状态映射到目录或 Story。逐个执行默认、禁用、加载和错误变体。','Map props, slots, keyboard and controlled state to the catalog or stories. Exercise default, disabled, loading and error variants.')],
        [t('Token 与版本漂移','Tokens and version drift'),t('核对 Token 语义、主题继承和版本迁移。记录期望 Token、实际导入或计算值及消费位置，再用绑定版本复检。','Check semantic tokens, theme inheritance and migration. Record expected token, observed import or computed value and usage site; recheck on the bound version.')]] },
    { id: 'compatibility', title: t('适配与异常恢复','Compatibility and recovery'), domain: 'experience', topics: ['responsive','localization','platforms','states'],
      inputs: t('支持矩阵、国际化规范、异常设计、网络与离线约定。','Support matrix, localization rules, recovery designs and network/offline contracts.'),
      boundary: t('明确浏览器、设备、语言、网络与数据规模。模拟环境和真机结果分开。','Identify browser, device, language, network and data scale. Distinguish emulation from actual hardware.'),
      sources: ['https://playwright.dev/docs/emulation','https://www.w3.org/International/questions/qa-i18n'], checks: [
        [t('浏览器与断点','Browser and breakpoint matrix'),t('按支持矩阵选浏览器、极窄与宽屏、触屏和方向切换，检查关键内容、任务完成及溢出坐标。','Sample supported engines, narrow and wide layouts, touch and rotation. Record content loss, task completion and overflow coordinates.')],
        [t('语言与内容边界','Locale and content extremes'),t('覆盖译文膨胀、长名字、空值、日期单位与方向。核对信息是否完整、可读和可操作。','Exercise expanded translations, long names, empty values, date units and direction. Verify completeness, readability and actionability.')],
        [t('慢网、失败与重试','Slow network, failure and retry'),t('在受控测试环境重现超时、请求失败或离线。比较重试前后的草稿、实体与重复提交，记录实际故障注入。','In a controlled fixture exercise delay, request failure or offline. Compare draft, entity and duplicate submissions before and after retry; record the injected condition.')]] },
    { id: 'performance', title: t('响应性能与动效','Responsiveness and motion'), domain: 'experience', topics: ['performance','motion-timing','motion-interruption','motion-accessibility'],
      inputs: t('性能预算、支持设备、加载策略、动效规范及观测窗口。','Performance budgets, target devices, loading policy, motion specs and observation window.'),
      boundary: t('同条件采样并记录次数与波动。实验室数据、真实用户分位数和单次动画采样分别报告；没有项目预算时给出测量值与建议。','Repeat matched samples and report variation. Separate lab measures, field percentiles and individual motion traces. Without a project budget, report observations and advice.'),
      sources: ['https://web.dev/articles/vitals',wcag], checks: [
        [t('加载与视觉稳定','Loading and layout stability'),t('分冷缓存与热缓存记录加载、内容出现与布局移位，保留视口和网络条件。现场分位数需实有样本。','Record loading, content appearance and layout shifts for cold and warm caches with network and viewport evidence. Field percentiles require field samples.')],
        [t('输入响应与长任务','Input response and long tasks'),t('重放实际点击、输入或滚动，采样交互延迟、帧间隔和长任务。记录设备、重复次数及测试噪声。','Replay actual clicks, typing or scrolls. Sample interaction latency, frame intervals and long tasks; record device, repetitions and measurement noise.')],
        [t('动效偏好与中断','Motion preferences and interruption'),t('分别用标准和减少动效偏好，验证可打断、最终状态和恢复路径。对比相同触发与实际滚动距离。','Run normal and reduced-motion modes, interrupt transitions and verify final state and recovery. Compare identical triggers and observed scroll distances.')]] },
  ].map(suite => ({...suite, checks: suite.checks.map(([name,procedure],i) => [name,procedure,decisions[suite.id][i]])}));
}
