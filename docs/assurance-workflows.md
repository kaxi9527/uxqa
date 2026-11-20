# UXQA 专项检测 / Specialist checks

从项目「检查」开始。先选要回答的问题，再确定哪份资料能定义预期、哪个运行状态能验证它。内置规程离线可用。资料链接用于核查方法出处。

## 降低误报与过拟合 / Reducing false findings and overfitting

文档定义预期，运行记录给出实际结果。编排和运行前都会核对显式期望值。操作步骤里的文本、数量和目标地址也要有条款依据；同一个观测值与自己比较会被拒绝。字面引用仍可能误解否定、单位或作用域，执行前请核对原文语义。视觉差异和可用性建议要分别保留复核状态。

评估新规则时，为每条规则准备应触发、应保持不变和证据不足三种样例。保留整个未参与调规则的项目作盲测，同一项目的相似页面归入同一组。让评审者先独立标注预期，记录真实缺陷、误报、漏报及未验证比例，按专项和影响等级查看。基准数据需来自经许可并已标注的项目。此处描述评估方法，尚无跨项目盲测准确率。

Source-based scenarios validate explicit expectations at preparation and execution time, including step-level values and self-comparisons. Check scope, units and negation during review. To measure generalization, reserve whole unseen projects, test positive, invariant and insufficient-evidence cases, and report false positives, missed defects and the unverified share separately for each category.

[CheckList behavioral evaluation](https://aclanthology.org/2020.acl-main.442/) · [Cross-validation and grouped splits](https://scikit-learn.org/stable/modules/cross_validation.html)

## 检测依据

### 给每道规程建立可复查的案例

进入「项目 → 检查 → 专项检测」，选择类别，展开「任务验收 → 按三项规程验收」。八类共 24 道规程都能建立案例。在案例中写明谁、在哪一页、什么条件下要做什么，选择有效条款或填写有出处的项目约定，再选本轮实测。来源中的代码默认描述现状。预期与实际结果分开保存。没有证据也可以登记；「已有明确人工结论」只计算已完成双评且结果明确的规程，包含已确认的问题。

1. 每个项目首次保存案例时选择「调规则项目」或「独立盲测项目」。已经看过并用来改规则的项目应归入前者。样本类型可记为目标行为、对照或反例、证据不足。以项目分组，同一产品的复制品、改名项目或相邻版本也要由评测者避免跨组。复检在后续轮次重新取证，保留旧结论，排除重复计数。
2. 需要比较模型时，先封存模型判断，再请两位评审各自观察并评分。两人都提交后可见彼此的理由；分歧由第三位裁定，模型判断在人工定案后揭示。代号用于单机区分评审，组织评测时应安排不同的人。注明使用同一案例证据，或填写补充现场证据的位置。
3. 用四档记录实际影响。「符合预期」需要观测支持；「有困难」表示仍能完成；「受阻」表示无法完成或发生严重误操作；其余标为「证据不足」。视觉偏好可绑定已批准稿、标注区域、状态和可接受示例。缺少共识时保留评审意见。不要把颜色喜好直接计为任务阻断。
4. 用户体验专项先记录目标人群、设备、任务和实际表现。操作结束后可请参与者自评容易程度，从 1（非常困难）到 7（非常容易）；未作答留空。参与者可能独立完成却打低分。此字段不会进入模型提示，在验收案例中于定案后揭示。观察笔记中避免抄入评分或评审答案。
5. 配置传播规程分别记录变更前、激活后的目标对象、相同条件下未改对象的结果和位置。三个位置可为同一页面的不同事件。核对所有声明的消费入口。缺一项即暂缓模型判断。读屏、触屏、现场性能以及未被当前环境重放的状态都应补独立证据。

### 怎样读人机校准指标

在「任务验收 → 查看校准指标」中选项目分组与专项。先看独立项目数、样本数、待双评和待裁定数。每种模型配置与规程版本分别列出，空分母显示暂无数据。建议优先抽查模型可能放过的严重问题，并保留随机抽取的普通案例。

| 指标 | 分子 / 分母 | 解释 |
| --- | --- | --- |
| 双人一致 | 首两位评审同档 / 完成双评的案例 | 双人经常分歧时，先核对任务定义、用户群与评分示例 |
| 人机一致 | 两方同档 / 两方均有明确结论 | 表示当前取样下的一致程度 |
| 严重漏放 | 人工判受阻 / 有明确人工结论的模型通过案例 | 直接回答「模型放行后，有多少其实使任务受阻」 |
| 漏报与误报 | 模型放过的问题 / 人工确认的问题；模型误报 / 人工确认通过 | 分别计算，两方均须有明确结论 |
| 感受差距 | 至少一位参与者自评 1–3 分的案例 / 有参与者自评且模型判通过的案例 | 只统计已经人工定案的案例，每案例计一次；1–3 是界面提示区间 |
| 模型待验证 | 模型答证据不足 / 人工已定案且有模型判断的案例 | 防止通过大量弃答抬高表面一致率 |

真实参与者的任务观察补充了规则检查无法代表的体验。选择目标群体，可纳入辅助技术使用者，保留实际操作条件和参与者原话。 [GOV.UK 可用性测试](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing) · [W3C 用户参与评估](https://www.w3.org/WAI/test-evaluate/involving-users/)

| 资料示例 | 拆成可验证的要求 | 常见关联 |
| --- | --- | --- |
| PRD、决策记录、验收用例 | 哪个角色，在什么条件下，操作后看到什么；不满足条件时保持什么状态 | 逻辑、交互、体验 |
| 接口定义、开发文档、数据字典 | 作用域、字段单位、默认值、错误码、缓存生效时点 | 逻辑、异常恢复、性能 |
| 设计标注、帧、品牌和内容规范 | 确定帧、主题、断点、状态、文字或图形的具体约束 | 视觉还原、组件、无障碍 |
| 组件目录、Story、Token 表和迁移说明 | 来源包、版本、变体、受控状态、语义 Token 和兼容范围 | 组件、交互、无障碍 |
| 工单、客服反馈、研究记录、操作手册 | 受影响任务、观察到的困难、用户群与可重现条件 | 体验、交互、异常恢复 |
| 多语言规范、支持设备矩阵、性能预算 | 适用设备和环境、指标定义、样本与具体阈值 | 适配、性能、无障碍 |

资料类型是开放的。一个条款可以进入多个专项，一个专项也可以有多个来源。项目文本可按原文定位，并保存文件摘要、行号与摘录；外部材料用标题、版本、页码或节点和人工摘录。关键词仅用于推荐类别，保存前可修改。规范、实现说明和观察记录的权威性取决于项目约定。遇到互相矛盾的预期，将冲突原文与版本一并记录在验证任务里，等待负责人裁定。工单中的现象可用于复现，产品目标需要独立依据。

## 运行与判定

| 专项 | 运行路径 | 能得出的结论 | 保留的人工判断 |
| --- | --- | --- | --- |
| 视觉还原 | 锁定帧版本和状态，选择当轮同尺寸 PNG，逐像素对比，核对差异区域，再按原条件复检 | 记录两侧摘要、尺寸、变化像素数及差异图；结果应用于选定图对 | 检查字体加载、动态内容、透明背景与图层差异；结合标注确认具体违约 |
| 逻辑判断 | 引用条款，列角色、实体键、条件组合与边界，准备浏览器场景，看过操作后执行，按作用域比较前后结果 | 在已运行角色和状态下，报告相符、偏差、条件未触发或阻塞 | 未知优先级、服务端不可见状态和文档矛盾继续待核对 |
| 交互行为 | 从键盘遍历开始，再按文档编排提交、撤销、模态、连续输入和滚动返回 | 可定位焦点停靠点、具名状态与重现步骤 | 焦点顺序是否符合任务、触屏手感和特殊设备需专项验证 |
| 无障碍 | 对选择的路由运行自动扫描、键盘、重排与减少动效，沿完整任务使用辅助技术复核 | 准则相关发现、待人工判断的规则、可定位节点和测试环境 | 读屏通告、替代文字质量、例外条款和完整流程符合性 |
| 用户体验 | 定义人群和任务，先记录启发式风险，再观察首次使用与熟练路径，并比较改进方案 | 可追溯的观察、便利性建议、参加者实际任务表现 | 任务成功率或满意度需要真实样本；自动化耗时只用于技术测量 |
| 组件库映射 | 绑定本项目目录，追溯实际导入、封装、变体和消费点，对照 Story、Token 与版本；已检出的库问题可直接打开 | 来源、调用与可复现的契约差异 | 语义等价、合法特例和库升级责任由项目确认 |
| 适配与异常恢复 | 按支持矩阵检查窄屏重排和模拟缩放，再用有故障条件的场景检查重试与状态保留 | 实测浏览器尺寸下的溢出和可定位状态 | 跨引擎、真机、读写方向、真实离线与特定故障条件分别留证 |
| 响应性能与动效 | 页面实测采集静止状态的桌面浏览器样本；项目对话可按目标元素测滚动、焦点或悬停。比较同条件样本 | 采样窗口、帧回调间隔、长任务和可用计数 | 真实用户 Core Web Vitals 分位数、真机流畅度和项目预算需相应数据 |

**证据规则。** 开始前写明范围、预期、前提、操作和取证位置。多角色检查要求同一实体和版本，按键逐项比对。条件未发生、设计稿尺寸不符、原文过期、实测截图缺失或页面请求失败时，保留具体缺口。像素容差为 RGB 任一通道差值大于 24 时计入差异，透明 PNG 以白底合成。视觉差异和自动建议可进入人工复核；确定违约时记录对应原文、观测与原因。复检使用同一条款和条件，需求改版则生成新验证任务。

**数据与权限。** 项目文档和设计 PNG 的本地读取、条款定位、像素比较与人工验证均可离线进行；页面实测需要可访问的项目预览。点「用所选模型编排场景」会向已配置模型发送所选条款及当前项目上下文。当次只允许读取与编排，场景在另行运行时可能修改测试数据。原始设计稿仍属于项目；UXQA 生成的差异图按应用截图的 48 小时规则清理。条款快照和结果记录保存在 UXQA 本地数据目录。

文档场景在编排时需要可观察断言。只打开页面、只读取字段的方案无法进入执行队列。关系断言中的固定预期值须出现在所选条款中，运行时才知道的值通过具名观测引用。程序校验出处和执行结果；操作是否完整表达产品意图，仍要在执行前核对场景。

## English

### Task acceptance and calibration

Open **Project → Check → Specialist checks → Task acceptance**. Each of the eight categories has three procedures. Create a case for one task, role, route and set of conditions. Choose a current requirement or a sourced project criterion and attach observations from this round. Code imports describe observed behavior by default. A procedure with a definite human result may contain a confirmed defect.

Keep entire projects in either rule development or held-out evaluation. Keep related copies and revisions on the same side. Include target, invariant/control and missing-evidence cases. For a holdout, seal the model judgement before two different people independently rate the packet. A third reviewer adjudicates disagreements. Distinguish shared evidence from additional field evidence. An alias facilitates local review; arranging independent people remains the evaluator’s responsibility. Retest in a later round with fresh observations. Retests are excluded from calibration.

Record a pass, friction with the task still achievable, a blocker/serious unintended outcome, or insufficient evidence. For visual taste, specify the approved reference, state and acceptable variations. For usability, record the actual participant group, device, behavior and outcome. Ask the participant how easy the task was on a 1–7 scale (very difficult to very easy); leave unanswered ratings empty. The dedicated rating stays out of model inputs and is revealed in the case after human review. Keep the answer out of free-text observations too.

Configuration propagation requires separate records for baseline, activated target and untouched control. Check each declared consumer. A definitive model verdict requires a criterion excerpt and exact citations from selected observations. Missing evidence and incompatible repeated readings yield an unknown result. A matching quote alone cannot guarantee sound interpretation.

**View calibration metrics** separates evaluation sets, category, model configuration and rubric. Report sample and project counts alongside the ratios. Human agreement uses the first two ratings. Exact human–model agreement uses definite paired verdicts. Serious escapes are human-confirmed blockers among adjudicated model passes. Misses and false alarms use human issues and human passes as their respective denominators. The ease gap counts settled model-pass cases with any participant rating 1–3 among those with a participant response. Abstentions use all settled predictions. Empty denominators stay empty. A synthetic test of these calculations provides no estimate of real-world accuracy.

Use **Check → Check category**. Link a quoted requirement to one or more categories. Select a passage from a local UTF-8 file, or provide an excerpt with a revision, page or design node. File-linked excerpts carry a hash and line number. If source rules conflict, record both and resolve their authority before running a verdict. A support report can identify a reproduction path; its author's expectation needs its own basis.

Each category supplies three procedures with inputs, observations and a retest method. Frame comparison checks aligned design and runtime PNGs. Confirm identical content, crop and scale. Each changed pixel exceeds 24 in at least one RGB channel after compositing over white. A difference calls for interpretation. Logic scenarios bind to the selected quote, can compare observations across roles and states, and run after review. Accessibility, interaction, compatibility and performance have route-level samples. Check the route, viewport, engine, individual assertion and coverage gaps. Usability recommendations need task observation, and component findings need the bound catalog or implementation contract. Manual checks retain their own evidence and history.

Local text and PNG handling require no model. **Prepare scenario with selected model** sends the clause and project check context to the configured provider. This preparation allows project reads and scenario planning. Running the scenario later can change test data. Generated difference images follow the app's 48-hour screenshot retention. Project design assets remain in their original location.

A document-grounded scenario requires an observable assertion. A visit or snapshot alone cannot enter the execution queue. Constants in relational assertions must occur in the selected clause. Use named observations for runtime values and review the proposed scenario for semantic fit before executing it.

## 方法来源 / Method references

- 条件组合、边界、状态迁移与可追溯用例采用 ISTQB 的测试设计方法；跨服务约定参考消费方与提供方验证。[ISTQB CTFL 4.0.1](https://istqb.org/wp-content/uploads/2024/11/ISTQB_CTFL_Syllabus_v4.0.1.pdf) · [Pact](https://docs.pact.io/getting_started/how_pact_works)
- 截图比较与设备模拟采用 Playwright 的条件控制方法。[Visual comparisons](https://playwright.dev/docs/test-snapshots) · [Emulation](https://playwright.dev/docs/emulation)
- 无障碍要求来自 WCAG。WCAG-EM 提供范围、抽样和报告方法；ARIA APG 提供特定控件的键盘模式。[WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WCAG-EM](https://www.w3.org/TR/WCAG-EM/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/)
- 体验建议采用启发式评估和以任务为中心的用户观察。[Nielsen Norman Group](https://www.nngroup.com/articles/ten-usability-heuristics/) · [GOV.UK Service Manual](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing)
- 组件契约参考可交互 Story 和公共设计系统的验收经验。性能规程区分实验室与真实用户数据。[Storybook](https://storybook.js.org/docs/writing-tests/interaction-testing) · [GOV.UK Design System](https://design-system.service.gov.uk/community/contribution-criteria/) · [Web Vitals](https://web.dev/articles/vitals)
