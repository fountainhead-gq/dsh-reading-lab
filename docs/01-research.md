# 01 调研：参考产品、DSH 扩展面与解析可行性

> 状态：**完成**，作为 v0.1 需求与设计的依据
> 调研与实测日期：2026-11-19
> 实测环境：DSH **0.2.2-rc.5**（Electron 44.7.0 / Node 24.21.0 / Chrome 152.0.7977.130，Windows）
> 关联文档：[02 需求](02-requirements.md) · [03 设计](03-design.md) · [04 接口](04-api.md) · [06 测试](06-test.md)

## 结论先行

1. **产品形态成立**：Ponder、NotebookLM、ima、LuminRead、令狐兄都把「导入长文档 → 结构化导图 → 基于原文追问」做成主路径；差异在载体（Web / 云知识库 / 移动 App / 本地阅读器）与引用可核查程度。DSH 插件的机会是**本地工作区 + 会话 agent + 可导出**，不重复做云知识库。
2. **DSH 扩展面足够**：`main` 主面板 + `sidebar.panellist` 图标可按 id 联动；`sidebar.right.pane.tab`、`shell.overlay`、`conversation.chat.node`、`tool.call.toolview` 可承载线程、浮层与过程；Host 侧 `commands.execute`、`tools`、`systemPrompt`、`workspaceFiles`、`storageDomain` 覆盖「注入提问、注册工具、读写工作区」三件事。
3. **解析可行且便宜**：EPUB 3 用 JSZip + fast-xml-parser，2.7 KB 夹具 5 ms 出目录与正文；PDF 用 pdfjs-dist 5.4.296 的 legacy build，纯文本抽取不需要 canvas，中文 PDF 与英文论文的抽样段落均与原文一致，2 页中文 126–167 ms、10 页英文采样 5 页 183 ms。扫描版 PDF 可稳定识别为「无文本层」并拒绝。
4. **主要约束**：依赖安装走默认镜像 `registry.npmmirror.com` 会 403（`anynum`、`string_decoder`），必须固定 `registry.npmjs.org` 或随包分发；解析组合约 80 MB（实测 79.6 MB）；扫描版 OCR、云同步、移动端明确不做（见 [02 需求](02-requirements.md) §8）。

## 0. 方法与证据口径

### 0.1 证据分级

| 级别 | 含义 | 本文用法 |
|---|---|---|
| **实测** | 本机执行命令、解析夹具或读取运行中 DSH 的 inspect 结果 | 版本号、槽位/服务清单、解析耗时与字符数、npm 安装结果 |
| **源码** | 本机安装包内的源码与 README，标到文件与行号 | Client 槽位作用域、图标与面板联动方式、布局宽度 |
| **官方** | 产品官网、官方博客、应用商店页 | 竞品能力与形态 |
| **三方** | 评测站、聚合站、第三方教程 | 仅作旁证，与官方口径交叉后再用 |

竞品部分不引用无法访问的截图或二手转述；每条能力尽量落到官方页面。产品会迭代，本文以 2026-11-19 可访问的页面为准。

### 0.2 本次实测清单与限制

| 项目 | 做法 | 结果 |
|---|---|---|
| Host 服务目录 | `cordis_inspect_query`（platform=host，provider=Service，method=listService） | 成功，得到 §2.3 的方法签名 |
| Client 槽位树 | `cordis_inspect_query`（platform=client，Slots.listSubTree） | **两次 10 s 超时**（`Client inspect query … timed out`），改用安装包源码 + 先例插件核对 |
| 解析冒烟 | Node 24.19 下执行 `smoke.mjs`、`cjk-smoke.mjs`、`unpdf-smoke.mjs` | 见 §3.1–§3.3 |
| 依赖体积/许可 | `npm view`、`npm install`、统计 `node_modules` 字节数 | 见 §3.4 |
| 镜像可用性 | 默认 registry 与 `registry.npmjs.org` 各安装一次 | 默认镜像 403，npmjs 成功 |

Client inspect 超时不等于槽位不可用：DSH 页面未连接或未打开时该查询会等待首个页面响应。为避免把「查询失败」误写成「能力不存在」，§2.2 的每条槽位结论都给出了安装包内的文件与行号，并在 §2.5 用已发布插件的真实注册代码交叉验证。

## 1. 竞品调研

### 1.1 总览

| 维度 | Ponder | NotebookLM | 腾讯 ima | LuminRead | 令狐兄 AI 阅读器 |
|---|---|---|---|---|---|
| 载体 | Web（云端工作区） | Web / 移动端（Google 账号） | Windows / macOS / iOS / Android / 小程序 | iPhone / iPad / Android | Chrome/Edge 扩展 + Windows / macOS / Linux / Android / iOS |
| 导入 | PDF、视频、网页；书籍转导图 | PDF、网页、Google Docs/Slides、YouTube 等来源 | 本地文件、微信文件、公众号、网页、图片、音频 | PDF、EPUB | ePub、PDF、网盘文件 |
| 导图 | 无限画布知识图谱，按章节/人物/情节展开 | Studio 生成交互式 Mind Map，可缩放、点节点看摘要 | AI 解读一键生成可编辑脑图 | 阅读界面内一键生成脑图，可缩放/拖拽/查看节点 | 批注与笔记生成可视化节点，节点可跳回原文 |
| 引用/溯源 | 抽取关键论点与引用关系 | 回答与节点可回到来源 | 基于知识库文档问答 | 基于文档问答 | 强调「零幻觉」，回答角标一键跳原文 |
| AI 问答 | 有，围绕研究与跨文档分析 | 有，来源锚定 RAG | 有，知识库 + 文档解读 | 有，总结/解释/翻译/提问 | 有，可选 DeepSeek / 自填 API Key / 本地 Ollama |
| 存储与隐私 | 云端账号，按 credits 计费 | 云端账号 | 云端知识库（有空间容量概念） | 账号 + 跨设备同步 | 本地优先，云同步按需开启 |
| 导出 | 导图、文档、幻灯片 | 以 Google 生态分享为主 | 脑图可导出（PNG/XMind/PDF，三方教程口径） | 脑图可导出（官方工具页口径） | 对话可导出 Word / Markdown |
| 对本项目的意义 | 画布与卡片树的视觉范式 | 导图 + 引用 + 追问的闭环 | 知识库与「AI 解读」入口命名 | 移动端阅读器的功能密度 | 本地优先与引用跳转的产品说服力 |

### 1.2 逐家要点

**Ponder（原 ResearchFlow）** 把「一本书变成思维导图」作为独立落地页：抽取章节、人物、情节，生成可交互的知识图谱，强调用图来记忆与分享（[Book to Mindmap](https://ponder.ing/features/book-to-mindmap)）。第三方目录补充了它的形态：无限画布、上传 PDF/视频/网页、抽取关键论点与引用关系、跨文档分析（[toolin.ai](https://toolin.ai/en/tools/ponder#1)）。定价页显示免费档每日 40 credits、可创建并导出 mindmap/docs/slides，付费档 ¥105–308/月（[Pricing](https://ponder.ing/pricing)）。它的强项是**画布表现力**，弱项是**数据在云、额度制**；本项目的参考截图 1/2/3 即来自这一类界面。

**NotebookLM** 的 Mind Map 是 Studio 的输出物：生成交互式视觉图，可缩放，点击概念得到该主题的摘要（[Google 官方博客，2025-04-02](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-studying-help/)）。Google Workspace 的更新说明把它描述为在笔记本内导航复杂主题、发现新连接（[Workspace Updates，2025-03-18](https://workspaceupdates.googleblog.com/2025/03/new-features-available-in-notebooklm.html)）。它的结构是「来源层 → 导图结构层 → RAG/音频/测验消费层」，导图不是终点，而是追问与复习的入口（[工作流拆解](https://notebooklm.hk/zh-cn/blog/notebooklm-mind-map-guide/)）。可借鉴的是**节点即入口**；不可照搬的是**来源与账号绑定在云端**。

**腾讯 ima** 定位「以知识库为基础的 AI 知识管家」，个人知识库支持本地文件、微信文件、公众号、网页、图片、音频，AI 解读可对文档一键生成思维导图、有声播客与知识小测验，另有笔记、录音纪要、PDF 双语对照翻译（[产品页](https://platform.foxdata.cn/cn/app-profile/6737188438/CN/as)；[腾讯云开发者社区](https://developer.cloud.tencent.cn/techpedia/2613)）。官网 FAQ 给出「存储空间」的查看路径（电脑端头像 → 存储空间），说明其知识库是云端配额模型（[ima.qq.com](https://ima.qq.com/)）。ima 证明了「导入即解读、解读即脑图」的入口效率，但它的组织单位是**知识库**，不是**单本书的深读**。

**LuminRead** 是移动端 AI 阅读副驾驶：导入 PDF/EPUB，提供 AI 问答、一键总结、智能解释、跨语言翻译、生成脑图、知识库、高亮与笔记；商店描述称可在 iPhone/iPad/Mac 间同步，但当前页面同时标注「专为 iPad 设计、未针对 macOS 验证」（[App Store](https://apps.apple.com/cn/app/luminread/id6751025549)）。其官方工具页描述脑图生成后可缩放、拖拽、查看节点内容并做简单编辑或导出（[AI Mind Map Maker](https://luminread.com/en/tools/ai-mind-map-maker)）。它的功能密度接近本项目目标，但载体是移动 App，**没有桌面工作区与可编程 agent**。

**令狐兄 AI 阅读器** 是本地优先的跨平台阅读器：ePub/PDF/思维导图/TTS/网盘，AI 问答强调严格基于原文、回答角标「一键溯源」跳原文段落，支持自填 API Key 或本地 Ollama，对话可导出 Word/Markdown（[Chrome 应用商店](https://chromewebstore.google.com/detail/foxycape-ai-reader/okgffdhpnikhbmpieeefjbkjmfbffehp)）。小米应用页补充了平台覆盖与「节点跳回原文」的细节（[应用页](https://app.xiaomi.com/details?id=com.linghuxiong.aireader)）。它最接近「本地 + 引用 + 自定义模型」的价值主张，但 AI 仍是**阅读器内置功能**，过程不可被 agent 复用或编排。

### 1.3 三张参考截图的界面拆解

三张截图在需求讨论中提供，逐图记录见仓库外需求草稿 `DESIGN.md` §2；截图原件未纳入本仓库，本文以该记录作为验收基线。拆解如下：

| 图 | 观察到的结构 | 可复用机制 | 本期取舍 |
|---|---|---|---|
| **1. 导图总览** | 左栏「我的研究」书库；顶部标题栏 + 缩放/搜索/适应窗口/上传工具；中央无限画布，书卡向左右展开章节卡，卡片带引用计数角标；右侧竖排浮动工具；底部「变更审阅 171 变更」 | 三层信息架构（库 / 图 / 浮层）；书卡作为根节点；引用计数直接长在卡片上；画布工具常驻顶部 | v0.1 做左栏书库 + 中央只读画布 + 顶部缩放/适应；搜索放 v0.3；「变更审阅」放 v0.3 |
| **2. 单卡笔记** | 卡片详情：标题、正文、引用链接；卡片下方浮动工具栏 | 详情不离开画布；引用是可点击的定位符；工具栏跟随选中对象 | v0.1 做基础详情与引用跳转；富文本编辑与悬浮工具栏放 v0.2 |
| **3. 询问 AI** | 右侧浮层：快捷指令（深入探索 / 解释 / 简化 / 示例）+ 自由提问 + 追问建议；被选中的卡片紫色描边 | 浮层贴着画布但不遮挡选中卡；快捷指令降低提问成本；选中态贯穿画布与浮层 | v0.1 不实现；v0.2 按此形态做右浮层与紫色选中态 |

三张图共同说明一件事：**导图不是一张静态图，而是「卡片 + 引用 + 追问」的可操作界面**。因此需求把「每个节点至少一条可定位引用」写成硬性验收，而不是装饰性角标（见 [02 需求](02-requirements.md) FR-07、FR-09）。

### 1.4 借鉴与差异化

**借鉴**

- 从 Ponder 借「书卡 → 章节卡 → 叶卡」的分栏卡片树与画布缩放，而不是传统放射状脑图。
- 从 NotebookLM 借「节点即提问入口」，以及回答必须能回到来源的约束。
- 从 ima 借「导入即解读」的单一入口：导入完成后自动进入解析与导图生成，不要求用户先配置。
- 从令狐兄借「本地优先 + 引用跳转 + 可选自定义模型」的信任叙事；在 DSH 里，模型由会话配置决定，插件不保存密钥。

**差异化**

| 差异点 | 本项目 | 竞品常见做法 |
|---|---|---|
| 运行位置 | DSH 本地插件，产物在工作区 `reading/`，可 git、可拷贝 | 云端账号或 App 沙盒 |
| AI 过程 | 会话 agent 调 `reading.*` 工具，进度与结果在会话流可见、可中断 | 黑盒「一键生成」 |
| 引用 | 引用绑定 `chunkId`，点击回到原文段落；未知引用直接判失败 | 角标可能只到页/文档级 |
| 导出 | Markdown / OPML / JSON，格式开放 | 多为图片、PDF 或自家格式 |
| 成本 | 复用 DSH 已配置模型，无额外订阅与 credits | 订阅或算力包 |

## 2. DSH 扩展面实测

### 2.1 版本与运行时

| 项 | 值 | 证据 |
|---|---|---|
| DSH 包版本 | `@deepseek-ai/dsh` **0.2.2-rc.5** | `DSH_INSTALL_DIR` 下 `package.json` |
| Electron | 44.7.0 | 以 `ELECTRON_RUN_AS_NODE` 读取 `process.versions` |
| Node | 24.21.0 | 同上 |
| Chromium | 152.0.7977.130 | 同上 |
| 插件引擎约束 | `dsh.engines.dsh >= 0.2.2-rc.1` | 仓库 `package.json`；低于此版本不保证槽位签名 |

### 2.2 Client 槽位（源码核对）

安装包根：`D:\Program\dsh\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh`。下表路径相对于该根下的 `dsh-client-ui-*` 包。

| 槽位 id | 作用域/类型 | 用途 | 证据 |
|---|---|---|---|
| `main` | root，keyed | 全局主面板；`conversation` 是保留 key | `dsh-client-ui-layout/README.md:36`；`AppFrame.tsx:35` 的 `PropsRenderSlots<'sidebar'\|'main'\|'rightbar'\|…>` |
| `sidebar.panellist` | root，list | 侧栏面板图标；list id 与 main 面板一一对应 | `dsh-client-ui-sidebar/src/client/contract/slots.ts:44-47`；`SidebarRoot.tsx:444` 调 `selectPanel(panel.id)` |
| `sidebar.right.pane.tab` | session，keyed | DSH 右栏页签 | `dsh-client-ui-sidebar-right/index.ts:246` |
| `sidebar.right.pane.tab.title` | session | 右栏页签标题 | 同上 `:247` |
| `shell.overlay` | root，list | 覆盖整个窗口的浮层 | `dsh-client-ui-layout/index.ts:107`；`dsh-client-ui-chat/apply.ts:325` |
| `shell.bottom` | root，单例 | 底部状态条 | `dsh-client-ui-layout/README.md:38` |
| `conversation.chat.node` | session，keyed | 会话流中的自定义节点（进度/结果卡） | `dsh-client-ui-chat/apply.ts:228` |
| `conversation.composer.dock` | session，list | 输入框下方工具条 | `dsh-client-ui-chat/apply.ts:343`；`dsh-client-ui-conversation/slots.ts:315` |
| `tool.call.toolview` | session，keyed | 工具调用的自定义视图 | `dsh-client-ui-tool/slots.ts:23`、`apply.ts:42` |

**关键结论：图标与面板如何联动。** `sidebar.panellist` 的注释明确写着「每个 list id 指向对应的 main 面板；侧栏只负责按钮，标签从 list 元数据解析」，点击时执行 `selectPanel(panel.id)`。因此只要 `sidebar.panellist` 的 `id` 与 `main` 注册的 `key` 相同，点击图标就会切到本插件主面板，无需额外桥接。`DESIGN.md` §5.1 里「联动需实现期验证、有兜底」的风险由此降为**低**；兜底方案（`shell.overlay`）保留但不必先做。

### 2.3 Host 服务（inspect 实测）

| 服务 | 已确认的方法/能力 | 本项目用途 |
|---|---|---|
| `commands` | `register`；`@Remote list(agent)`；`find`；`@Remote async execute(agent, line, submittedAttachments, signal): Promise<CommandExecution \| undefined>` | 把「快捷指令 + 卡片上下文」作为一条用户消息注入当前会话，触发 agent 回答 |
| `tools` | `register(definition, options)`；`schemas`；`execute` | 注册 `reading.import` / `.map` / `.notes` / `.ask` / `.export` |
| `systemPrompt` | `section` / `context` / `tools` / `variable` / `assemble` | 注入阅读任务指令、当前书籍与引用规范 |
| `workspaceFiles` | `@Remote read` / `readBytes` / `stat` / `list` / `search` / `changes` | 读写工作区 `reading/`，向面板提供文件与变更 |
| `storageDomain` | `async open<S extends DomainSpec>(spec: S): Promise<Domain<S>>` | 轻量索引（书库排序、最近打开），产物仍以文件为准 |
| `fileUploads` | `@Remote upload(agent, request, signal)`；`uploadStream` | 接收面板拖入的文件（若走上传通道） |
| `attachments` | `saveFile` / `fileHostPath` / `saveImages` | 保存原书文件、封面缩略图 |
| `llm` | 适配器注册 + 流式模型调用，可被 `llm/stream` waterfall 拦截 | **不直接用**；LLM 工作交给会话 agent（DR-02） |
| `subagents` | `startActivation` / `sendMessage` | v0.3 多章并行生成（可选） |
| `sessions` | `registerMessageProjection` | 把问答结果投影到会话流 |
| `actionCards` | `register(kind)` / `record` / `view` / `@Remote act` | 会话流中的「导图已生成」操作卡（v0.2 可选） |
| `agentPresets` / `workingDirectory` / `workflowEngine` | 目录、当前工作区、工作流 | 确定 `reading/` 根目录；v0.3 并行 |

签名以 inspect 返回为准；表中只列本项目会用到的部分。`llm` 服务的存在说明插件「可以」自行调模型，但本项目选择不这么做，理由见 [02 需求](02-requirements.md) DR-02。

### 2.4 布局约束

`dsh-client-ui-layout/README.md:30` 给出：侧栏 264–420 px（默认 280，折叠为 56 px 图标轨）；右栏打开时占视口 45%，上限 70%，并为中心区保留 400 px。以 1440 px 窗口计算，右栏约 648 px、中心区约 528 px（还要容纳会话）；1280 px 下中心区约 440 px。扣掉面板内边距与卡片最小宽度后，无法横向排布「书卡 + 多列章节卡」——这正是 `DESIGN.md` 5.1 方案 C 被否掉的量化原因。主面板则占用中心区全部宽度（侧栏折叠后接近整窗），是唯一能容纳「书卡 + 多列章节卡」的承载面。

### 2.5 先例插件交叉验证

本机已安装的 `dsh-weread-gather` v1.1.5（MIT）是同类「侧栏图标 + 主面板」插件，其 `client.js:6963-6977` 同时注册：

```js
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
  name: 'sidebar.panellist', id: PANEL_ID, order: 26, label: () => t('entry.label'),
}, PanelIcon))
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, StudyPanel))
```

`PANEL_ID = 'weread'`，两处使用同一 id。其 `package.json` 与本仓库骨架同构：`type: module`、`exports` 暴露 `"."`/`"./client"`/locale/icon、`dsh.bundle.patch`、`dsh.client.platform = 'web'`、`engines.dsh >= 0.2.2-rc.1`；Host 侧直接用 `node:fs` 读写数据，说明**主面板 + 文件存储**的路线在 rc 系列上已跑通。

### 2.6 对本项目的直接结论

1. 主面板用 `main`（key = `reading-lab`），侧栏图标用 `sidebar.panellist`（id 相同），这是 DR-01 的依据。
2. 询问 AI 的「右浮层」做成**主面板内部的绝对定位浮层**，不占 DSH 右栏：截图 3 要求浮层贴着画布且不遮挡选中卡；DSH 右栏是 session 级全局页签，宽度与层级都不符合。线程本身持久化到 `reading/books/<id>/threads.json`，问答同时经 `commands.execute` 进入会话流（DR-07）。
3. 过程呈现用 `conversation.chat.node`（进度/结果卡）与 `tool.call.toolview`（工具调用明细），不必自造通知系统。
4. 工作区文件读写走 `workspaceFiles` / `node:fs`，索引走 `storageDomain`；不建数据库。
5. `shell.overlay` 只留给「全窗预览/导出预览」这类必须盖住整个 Harness 的场景，不作为主入口。

## 3. 解析可行性

### 3.1 夹具与实测结果

测试目录：`D:\Qunar\personal\dsh\_tmp-reading-deps`（一次性验证目录，不进入仓库）。Node 24.19.0，依赖从 `registry.npmjs.org` 安装。

| 夹具 | 大小 | 解析方式 | 结果 | 耗时 |
|---|---|---|---|---|
| 自造 EPUB 3（2 章 + nav） | 2,692 B | JSZip + fast-xml-parser | 标题「Reading Lab 解析冒烟测试」、作者 Fountainhead、2 章正文 54/31 字 | 5 ms |
| 自造 2 页文本 PDF | 966 B | pdfjs-dist 5.4.296 legacy | 2 页，文本逐字一致 | 242 ms（含首次加载） |
| 中文文章 PDF `03_冰原上的小船.pdf` | 2 页 | pdfjs-dist 5.4.296 legacy | 847 字符，其中汉字 735；正文连续可读，抽样段落与原文一致 | 126 ms |
| 中文文章 PDF `12_2025 年度，与自己的深度对话.pdf` | 2 页 | 同上 | 1,144 字符，汉字 997；正文连续可读，抽样段落与原文一致 | 167 ms |
| 英文学术 PDF `hyland2.pdf` | 10 页 | 同上 | 采样 5 页 17,537 字符，标题与正文正确 | 183 ms |
| 扫描版 PDF `gopenswan.pdf` | 9 页 | 同上 | 采样 5 页仅 5 个空白字符，无文本层 | 87 ms |
| 同一 2 页 PDF | 966 B | unpdf 2.2.1 | 2 页，文本一致 | 未单独计时 |

### 3.2 EPUB

EPUB 3 的最小闭环是：`mimetype` → `META-INF/container.xml` 找 OPF → 解析 `package/metadata` 与 `spine` → 按 spine 顺序读 XHTML → 抽标题与正文。JSZip 解 ZIP，fast-xml-parser 解 XML，XHTML 只需按标题/段落做轻量抽取，不需要完整 DOM 与 CSS 布局。实测 5 ms 说明**目录树与正文抽取可以放在导入的同步路径里**，用户无感。

注意点：

- `spine` 的顺序才是阅读顺序，`manifest` 的 id 顺序不可靠；`nav`/`toc.ncx` 只作标题补充。
- XHTML 必须先净化（去 `<script>`、事件属性、远程 `src`/`href`），再进渲染层；否则等于把电子书当 HTML 执行。
- EPUB 2 的 NCX 与 EPUB 3 的 nav 都要兼容，取不到标题时回退「第 N 章」。

### 3.3 PDF

pdfjs-dist 的 legacy build 在 Node 下可直接 `getDocument({ data })`，`getTextContent()` 返回文本项，**不需要 canvas**。这意味着 v0.1 可以在 Host 侧完成全文抽取，客户端只渲染文本段落，不必在浏览器里跑 PDF 渲染器。

实测补充：

- **中文**：两份中文 PDF 在**不配置 cmaps** 的情况下仍文本连续可读（抽样段落与原文一致），因为字体已嵌入；但依赖预定义 CMap 的 PDF 需要把 `cMapUrl` 指向包内 `pdfjs-dist/cmaps/`，且必须本地路径，不能走 CDN。v0.1 的实现约束是「始终传本地 cMapUrl 与 standardFontDataUrl」，避免换一本书就乱码。
- **字体告警**：pdfjs 5.4.296 在缺 `standardFontDataUrl` 时会告警；即使提供路径，`standard_fonts` 目录只有 `.pfb`，仍会告警找不到 `LiberationSans-Regular.ttf`。文本抽取不受影响，但日志需要降噪，不能把告警当失败。
- **学术 PDF**：10 页英文论文采样 5 页 183 ms，说明按页流式抽取的固定开销很小；总耗时随页数线性增长，数百页文档需在性能基准中验证（NFR-01）。实现上按页 `getPage` + 逐页释放，避免一次性持有全部文本项。
- **扫描版识别**：`gopenswan.pdf` 采样 5 页只有空白字符，用「每页有效字符数 < 20」即可判定无文本层。v0.1 明确不接 OCR，导入时给可读错误并保留原文件，不生成半成品导图。
- **加密/DRM**：加密 PDF 会抛 `PasswordException`，DRM EPUB 的加密条目无法解密；两者都要在导入阶段转成「不支持」状态，不能静默失败。

### 3.4 依赖、许可证与体积

| 用途 | 包 | 版本 | 许可证 | 解包体积（npm 报告） | 结论 |
|---|---|---|---|---|---|
| EPUB 解压 | `jszip` | 3.10.2 | `(MIT OR GPL-3.0-or-later)`，**选 MIT** | 693 KB | 采用 |
| XML 解析 | `fast-xml-parser` | 4.5.0 | MIT | 1.34 MB | 采用；5.12.1 会拉 `anynum`，镜像上被 403 |
| PDF 文本 | `pdfjs-dist` | 5.4.296 | Apache-2.0 | 36.6 MB（实测，含 fonts/cmaps/wasm） | 采用；legacy build 无需 canvas |
| PDF 备选 | `unpdf` | 2.2.1 | MIT | 3.0 MB | 备选；`engines.node >= 24`，Node 22 环境不适用 |
| EPUB 渲染 | `epubjs` | 0.3.93 | BSD-2-Clause | — | 不采用：面向浏览器 DOM，Host 侧解析用不上 |
| PDF 一体化 | `pdf-parse` | 2.4.5 | Apache-2.0 | 21 MB | 不采用：依赖 `@napi-rs/canvas`，无必要 |

实测组合（jszip + fast-xml-parser + pdfjs-dist + unpdf 及传递依赖）的 `node_modules` 合计 **79,580,281 字节（约 79.6 MB）**，大头是 pdfjs 的字体、cmaps 与 wasm（pdfjs-dist 单独 36.6 MB）。最终发布可移除 unpdf，视 pdfjs 为唯一 PDF 依赖。插件发布时只保留实际使用的依赖，`pdfjs-dist` 的 `legacy/build` 与 `cmaps/` 是必需项；`standard_fonts/` 缺失只会让部分字体回退并产生告警，文本抽取不受影响，可按体积预算决定是否保留。

许可证兼容性：本项目 MIT，可以分发 Apache-2.0（pdfjs）、MIT（jszip/fast-xml-parser/unpdf）与 BSD-2（未采用）代码；发布时在 `THIRD_PARTY_NOTICES` 附 pdfjs 的 NOTICE 与 Apache-2.0 文本即可。jszip 的双许可必须显式选择 MIT，避免把 GPL 条款带进来。

### 3.5 安装、离线与安全

**安装。** 本机默认 registry 是 `https://registry.npmmirror.com`，安装时在 `anynum-1.0.1.tgz`、`string_decoder-1.1.1.tgz` 上返回 403（`cdn.npmmirror.com` 拒绝）。改用 `--registry=https://registry.npmjs.org` 后 18 个包 28 s 装完。因此：

- 仓库提交 `package-lock.json`，锁文件里的 `resolved` 指向 npmjs；
- [05 开发](05-dev.md) 写明安装命令与镜像覆盖方式；
- 若目标机器无法访问 npmjs，提供离线 tgz 或随包 `vendor/` 的兜底，不依赖运行时联网安装。

**离线。** 依赖装好后，EPUB/PDF 解析、分块、导图布局、导出全部在本机完成，不访问网络；AI 步骤依赖 DSH 已配置的模型，离线时降级为「只读导图 + 本地导出」。插件不做遥测、不上传原文。

**安全。** 三条硬约束：

1. EPUB 的 XHTML 一律净化后再渲染，禁脚本、禁事件属性、禁远程资源。
2. 引用定位符只能是 `chunkId`，渲染前校验其存在于 `chunks.json`；未知引用判为生成失败，不静默丢弃。
3. 文件读写限制在工作区 `reading/` 内，路径做规范化与越界检查，禁止 `..` 逃逸。

### 3.6 风险与对策

| 编号 | 风险 | 影响 | 对策 | 状态 |
|---|---|---|---|---|
| R-01 | 扫描版 PDF 无文本层 | 导入后空白 | 每页字符数阈值检测，明确报错「暂不支持扫描版 OCR」，保留原文件 | 已实测识别 |
| R-02 | 加密 PDF / DRM EPUB | 解析抛错 | 捕获 `PasswordException` / 解密失败，标记「受保护文档」并跳过 | 设计约束 |
| R-03 | 超大 PDF（数百 MB / 数千页） | 内存与耗时 | 体积 ≤100 MB、页数 ≤2000 的硬阈值；按页流式抽取，逐页释放 | 需求阈值 |
| R-04 | 中文 CMap 依赖外部资源 | 部分中文 PDF 乱码 | `cMapUrl` 固定指向包内 `cmaps/`，`standardFontDataUrl` 指向包内字体；测试夹具补一类使用预定义 CMap 的 PDF | 实现约束 |
| R-05 | 默认 npm 镜像 403 | 安装失败 | 锁 npmjs、提交 lockfile、提供离线包 | 已实测 |
| R-06 | `sidebar.panellist` 与 `main` 联动在真实页面未跑 | 入口点不开面板 | 源码与先例已证同 id 联动；骨架期以真实加载做一次点按验收 | 低 |
| R-07 | 生成引用幻觉 | 用户点到不存在的段落 | 工具返回前校验 `chunkId`；未知引用整条拒绝并重试一次 | 设计约束 |
| R-08 | EPUB XHTML 注入 | XSS / 远程请求 | 白名单净化，CSP 式禁远程资源 | 设计约束 |

## 4. 结论与决策映射

| 决策 | 结论 | 主要依据 | 详见 |
|---|---|---|---|
| DR-01 UI 承载 | 完整主面板（`main` key=`reading-lab`）+ 侧栏图标 | `main`/`panellist` 同 id 联动；右栏 45% 上限、中心区保 400 px | [02 需求](02-requirements.md) DR-01 |
| DR-02 AI 引擎 | Agent 原生，插件只注册工具与提示词 | `commands.execute` + `tools` + `systemPrompt`；`llm` 直调会黑盒化 | DR-02 |
| DR-03 导图渲染 | 自绘 SVG 卡片树 | 参考图为分栏卡片而非放射脑图；无库可低成本还原；零新依赖 | DR-03 |
| DR-04 格式范围 | EPUB 3 + 文本型 PDF；扫描版不做 OCR | EPUB 5 ms、PDF 126–242 ms 实测；扫描版可识别 | DR-04 |
| DR-05 存储 | 工作区 `reading/books/<bookId>/`，JSON + Markdown | `workspaceFiles` 可读写；可 git、可拷贝、可导出 | DR-05 |
| DR-06 命名 | 包 `dsh-reading-lab`，展示「阅读实验室 / Reading Lab」 | bundle patch、locale meta、面板 id 统一 | DR-06 |
| DR-07 提问交互 | 面板内右浮层 + 线程落盘 + 会话留痕 | 截图 3 的浮层形态；`commands.execute` 注入会话；DSH 右栏是全局页签 | DR-07 |

## 5. 来源

访问日期均为 2026-11-19。标注「三方」的仅作旁证。

**官方**

1. Ponder — Book to Mindmap：<https://ponder.ing/features/book-to-mindmap>
2. Ponder — Pricing：<https://ponder.ing/pricing>
3. Google — NotebookLM studying help（Mind Map，2025-04-02）：<https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-studying-help/>
4. Google Workspace Updates — NotebookLM Mind Map（2025-03-18）：<https://workspaceupdates.googleblog.com/2025/03/new-features-available-in-notebooklm.html>
5. 腾讯 ima 官网：<https://ima.qq.com/>
6. 腾讯云开发者社区 — ima 产品概览：<https://developer.cloud.tencent.cn/techpedia/2613>
7. LuminRead — AI Mind Map Maker：<https://luminread.com/en/tools/ai-mind-map-maker>
8. LuminRead — App Store：<https://apps.apple.com/cn/app/luminread/id6751025549>
9. 令狐兄 AI 阅读器 — Chrome 应用商店：<https://chromewebstore.google.com/detail/foxycape-ai-reader/okgffdhpnikhbmpieeefjbkjmfbffehp>
10. 令狐兄 — 小米应用商店：<https://app.xiaomi.com/details?id=com.linghuxiong.aireader>

**三方（旁证）**

11. ima 功能清单（FoxData）：<https://platform.foxdata.cn/cn/app-profile/6737188438/CN/as>
12. ima 评测（36Kr）：<https://ai.36kr.com/product-detail/14606>
13. Ponder 形态说明（toolin.ai）：<https://toolin.ai/en/tools/ponder#1>
14. NotebookLM Mind Map 工作流（notebooklm.hk）：<https://notebooklm.hk/zh-cn/blog/notebooklm-mind-map-guide/>
15. 令狐兄版本与功能（crxdl）：<https://crxdl.com/detail/o/okgffdhpnikhbmpieeefjbkjmfbffehp>

**本机源码与实测**

16. `dsh-client-ui-layout/README.md:30,36,38`；`AppFrame.tsx:35`；`index.ts:107`
17. `dsh-client-ui-sidebar/src/client/contract/slots.ts:44-47`；`SidebarRoot.tsx:444`
18. `dsh-client-ui-sidebar-right/index.ts:246-247`；`dsh-client-ui-tool/slots.ts:23`、`apply.ts:42`；`dsh-client-ui-chat/apply.ts:228,325,343`；`dsh-client-ui-conversation/slots.ts:315`
19. `dsh-weread-gather/client.js:6963-6977`（v1.1.5）
20. 解析冒烟：`_tmp-reading-deps/smoke.mjs`、`cjk-smoke.mjs`、`unpdf-smoke.mjs` 及本文 §3.1 输出