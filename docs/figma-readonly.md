# Figma 只读检查

有设计稿时，可以先核对组件和原型连线。运行中的前端则能提供真实键盘、鼠标和数据状态的证据。按手上的材料选择入口。

| 材料 | 入口 | 可以核对 |
| --- | --- | --- |
| Figma 组件主件和变量 | `uxqa figma check` | 每个主题的文字对比度、变体反馈、命名热区、字体和颜色合同 |
| Figma 页面、交互原型 | `uxqa figma graph` | 显式起点、可能路径、断链、无出口、热区重叠及已声明的跨画板事实 |
| 导出图和实际页面截图 | 项目内「视觉还原」 | 相同视口与状态的视觉差异 |
| 运行中的前端、PRD 或交互预期 | `uxqa run --config <scenario.json>` | 在可访问的预览上操作并核对实际反馈、焦点和状态变化 |
| 源码与组件目录 | `uxqa components`、`uxqa library` | 代码复用、组件目录、样式与设计 Token 的使用 |

## 采集与检查

先建立只包含当前授权页面的配置：

```json
{
  "fileKey": "yourFileKey",
  "pageId": "1:2",
  "themes": [
    { "name": "Light", "background": [1, 1, 1, 1] },
    { "name": "Dark", "background": [0.08, 0.08, 0.08, 1] }
  ]
}
```

主题支持 Light / 浅色、Dark / 深色。首次连接设计文件、生成索引时会检查主件实际引用的变量集合和别名。多模式集合不能唯一匹配时，会列出可用模式并停在首批采集之前。品牌命名可以指定主题的 `"mode": "Day"`，或用 `"modes": {"VariableCollectionId:1:2": "Night"}` 为特定集合指定模式。单模式集合共享该模式。可以用 `backgroundVariableId` 声明背景变量，或提供取自项目的 RGBA 背景。

### 推荐：从 Figma 桌面端直接下载

```sh
uxqa figma prepare --config ./figma.json --out ./capture-plugin
```

1. 在 Figma 桌面端打开目标设计文件，通过 Plugins → Development → Import plugin from manifest 选择 `capture-plugin/manifest.json`。若团队要求使用 Figma 分配的开发插件 ID，在新目录重新运行 prepare 并传入 `--plugin-id <数字ID>`。
2. 运行 **QA Master · Read-only capture**。选择「采集主件与原型」会自动分批（每批最多 128 个主件），选择「仅原型」可以跳过主件和变量。完成后点击下载，把 JSON 保存到自己选定的位置。
3. 导入下载的文件并生成报告。仅原型采集可直接执行 graph。示例中的输出目录应为空，两个报告目录均在 evidence 之外。

```sh
uxqa figma ingest --from ./downloaded-capture.json --out ./evidence
uxqa figma check --input ./evidence --out ./component-report
uxqa figma graph --input ./evidence --out ./prototype-report
```

插件通过已有 Figma 会话读取指定页，生成的 manifest 禁止插件自行联网。QA大师无需另行保存账号或 API Token。Figma 自身打开和同步云端文件仍使用其连接。报告会注明文件键由 Figma 连接读到，或取自采集配置。索引、批次和原型必须来自同一轮采集。

### 已有 MCP 连接

在当前授权的连接内运行 `index.js`，将返回保存到文件后用 `uxqa figma ingest --from-mcp-result result.json --out ./evidence` 导入。也可以使用 `--from -` 读取标准输入，或显式选择 `--from-clipboard`。随后在生成的 `collect.js` 中填入该索引的组件 ID，逐批执行并导入。原型使用同目录的 `graph.js`。本地插件可以一次下载整页，适合大文件或 MCP 配额紧张的场景。

MCP 单次返回预算为 43,000 字节，超限会尝试无损编码。仍超限时会给出明确错误。单个批次最多 128 个主件，能装多少由节点复杂度决定。CLI 导入的单份下载文件上限为 64 MiB；check 读取的组件 JSON 上限为每文件 8 MiB、每轮 64 MiB 和 500 批。重复导入相同证据可安全重试，冲突会报告错误。

### 怎样理解覆盖和退出码

报告分别显示实采数量、索引数量及页面主件总数。新采集会在索引和各批次重新读取本页主件集合并比较指纹；ingest 另存原索引的 SHA-256 回执。旧采集缺少独立对账证据时显示 `partial`、页面总数 `unknown`。索引被缩小、收集期间主件集合变化、缺批次或回执不符都会影响覆盖结论。完整性校验用于发现内容变动，不提供 Figma 身份签名。

| 状态 | 含义 |
| --- | --- |
| complete / partial | 本页主件清单已对账 / 覆盖不完整或无法对账 |
| limited-pass / needs-review / issues-found | 已执行设计规则通过 / 需要复核或补证 / 有确定规则失败 |
| excluded / not-verified | 规则按适用条件豁免 / 证据不足以判断 |

默认 `--fail-on review` 会因规则失败、待复核、无法验证或组件覆盖不完整返回 1。CI 只拦确定失败时，可用 `--fail-on fail`，相同证据和缺口仍写入报告。命令完成且未触发所选条件返回 0；参数或输入错误返回 2。

## 规则与覆盖

- 文字：按显式主题解析别名、合成透明前景，依据字号/字重计算 4.5 或 3 的阈值。
- 输入边界：按组件名称识别候选，检查描边与内外背景；可能有填充替代边界，因此低值列为 review。
- 交互状态：相同组件集和其余 variant 属性下，比较 hover/pressed/focus 与唯一默认变体。外观指纹包含尺寸、位置、文字、画笔和字形信息；完全相同列为 review，复杂效果无法解析列为未验证。
- 小控件：命名识别的组件边界与命名热区至少 24×24；小尺寸及相交热区需人工判断例外和真实点击绑定。
- 提示：检查图标主组件断链、缺图标及不同 Tone 使用同组图标的候选。向量绘制图标可能需要人工确认。
- 文案：主件可保留「按钮」「标签」等默认文字。在原型画板或实例中出现这些词时，graph 才列为待复核。
- 裁切：文字矩形超出裁切祖先只标为 review，需结合原生截图核对。

按属性名和值识别禁用态，包括 `禁用=是` 和 `启用=否`；开关本身的 `开=是` 保留正常检查。禁用态的对比度、点击尺寸和交互反馈标明豁免。启用态遇到渐变、图片背景、分组透明度或复杂效果导致计算不可靠时，需用对应主题的最终渲染复核。

组件报告为 `figma.json`、`figma.md`、`figma.html`，包含节点链接、主题、采集时间、输入 SHA-256 和逐项结果。HTML 禁用脚本。

## 原型与跨画板事实

`graph.md` 可按问题回到原节点，`graph.json` 保留画板、动作、起点及可达画板，便于按源节点和目标排查。遍历会展开条件动作的可能分支。确定目标已丢失记为 fail，目标读取失败记为 not-verified。无出口可能是合法终点，跨页、孤立画板、封闭循环、弹层再开弹层、同级热区相交都列为 review。没有可靠起点时不判不可达。条件实际是否成立、鼠标实际命中和后端更新仍需运行中的前端取证。

如需核对两块画板展示同一条记录，可在配置顶层添加 `sameFacts`。每侧指定四个实际文字节点的 ID，分别提供对象标识、字段名、版本和值：

```json
{"sameFacts":[{"name":"同一版本的任务数",
  "left": {"object":"1:10","field":"1:11","version":"1:12","value":"1:13"},
  "right":{"object":"2:10","field":"2:11","version":"2:12","value":"2:13"}
}]}
```

两侧必须位于不同画板。对象、字段和版本文字全部对齐时，值不一致才记 fail。身份、版本或读数缺失会明确标记为未验证；本项比较文字值，不推断业务数值的等价格式。

## 通用化、变体与产品设计合同

快照同时记录可见层级骨架、嵌套组件依赖、字体和颜色绑定。报告按组件集汇总，并列出跨组件集的同骨架候选；业务目的、数据模型、交互和属性合同仍须人工比较，不能仅因外观相似自动合并。快照不会猜测哪些组件是新增，必须提供可信的创建记录或完整历史索引。

配置可声明 `forbiddenFonts`（字体名前缀数组）、`allowedColorPrefixes`（颜色变量名前缀数组）及 `tokenExpectations`（`{id, theme, expected:[r,g,b,a]}` 数组）。这些是项目合同，不作为所有产品的默认规则。禁用字体/明确色值违约为 fail；未绑定画笔和不匹配前缀为 review，需考虑保留的图标笔触和合法继承。

合并候选要求至少两个组件集有相同骨架，且参与比较的骨架至少有四个节点。报告会说明空结果的覆盖范围：采集不完整时，只能说明已采部分尚未发现候选。

## English quick start

With a Figma design file, run `uxqa figma prepare --config ./figma.json --out ./capture-plugin`. In Figma Desktop, import its manifest under Plugins → Development. Open the intended file, run **QA Master · Read-only capture**, choose **Capture page** or **Prototype only**, then download the JSON. Run the three ingest/check/graph commands above. For a prototype-only capture, use ingest and graph. No separate model, token or hosted QA service is required.

The component report distinguishes captured masters, indexed masters and the reconciled page total. Legacy evidence without an independent inventory is partial even when every indexed record is present. The graph follows possible paths from declared entries and preserves node-level evidence. Broken destinations can fail; intended terminal screens, overlay nesting and intersecting hotspots need human review. Runtime behavior needs an accessible product preview. Use `--fail-on fail` for confirmed failures only, or the default `--fail-on review` for review and evidence gaps as well. Invalid input returns 2.

Figma API references: [Plugin manifest](https://developers.figma.com/docs/plugins/manifest/), [prototype actions](https://developers.figma.com/docs/plugins/api/Action/), [page flow starts](https://developers.figma.com/docs/plugins/api/PageNode/), [variable modes](https://developers.figma.com/docs/plugins/api/VariableCollection/).
