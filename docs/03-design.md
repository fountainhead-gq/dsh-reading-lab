# 03 设计：阅读实验室 v0.1–v0.3

> 状态：**v1 定稿**（2026-11-19；同日文档门禁修订 §12.3/§12.4 与夹具路径）。上游：[01-research.md](./01-research.md)、[02-requirements.md](./02-requirements.md)；下游：[04-api.md](./04-api.md)、[05 开发](05-dev.md)、[06 测试](06-test.md)。
>
> 维护：docs（qa/docs）；评审：架构 + 工程
>
> 读者：实现者（按 §2 认领文件后即可开工）、评审、测试。本文只写**决定**与**约束**，不复述需求理由；需求编号（FR/US/NFR/AC/DR）沿用 02。

## 0. 裁决摘要

下表是本文档相对 01/02 新增或细化的决定。编号 `D-03-nn` 供 04/05/06 引用；与 02 冲突的条目在 §14 单独登记。

| 编号 | 决定 | 影响 |
|---|---|---|
| D-03-01 | Client↔Host 用 **webServer HTTP JSON 路由**（`/dsh-reading-lab/api/v1/*`），不用 Typert `ctx.remote` | `src/host/routes.js`、`src/client/api.js`；理由见 §1.4 |
| D-03-02 | Agent 工具注册名用下划线：`reading_import` / `reading_map` / `reading_notes` / `reading_ask` / `reading_export` / `reading_tutor` | 工具名只允许 `[A-Za-z0-9_-]`（`dsh-mcp-client/lib/index.js:68-69`）；产品文案仍写 `reading.*`，映射见 04 §2 |
| D-03-03 | 线程文件定名 **`threads.json`**；`qa-threads.json` 只是早期别名，禁止双写或改名 | 02 DR-05/FR-12 优先；测试断言目录内无 `qa-threads.json` |
| D-03-04 | 面板 key / panellist id / bundle 行 id 统一 `reading-lab`；`main` 的 `conversation` key 是保留位，绝不占用 | 02 DR-06；`src/client/index.js` 注释里的 `key="reading"` 是过期文字，由 client-shell owner 修正（§14-1） |
| D-03-05 | 书 `bookId = "b" + sha256(source)[0:12]`；重复导入按内容寻址天然幂等 | §5.2；FR-03 |
| D-03-06 | 块 `chunkId = "c-" + 6 位全局序号`（`c-000001`）；重解析会重排，引用失效按 FR-09 处理 | §5.3、§6.5 |
| D-03-07 | 节点 `nodeId = "n-" + sha1(章节路径 + "\|" + 标题)[0:8]`，冲突加 `-2`；重生成时标题/路径不变的节点 id 稳定，线程可续 | §5.4、§7.4 |
| D-03-08 | 「询问 AI」用 `agent.followup(UserMessage)` 注入会话；`commands.execute` 只执行斜杠命令、不送模型，不能产生回答 | §8.2；02 FR-11 已于 2026-11-19 门禁修订为同一机制 |
| D-03-09 | 进度到面板走 **SSE**（`GET /events`）+ 轮询兜底；到会话流靠工具调用本身与 `conversation.chat.node`（v0.2） | §1.3、§8.4、04 §6 |
| D-03-10 | PNG 导出在 **Client** 侧完成（SVG→canvas→blob），Host 不引入无头浏览器 | §9.6；v0.3 |
| D-03-11 | 工作区索引用可重建的 `reading/index.json`，不依赖 `storageDomain` 的隐藏状态；启动时以 `meta.json` 为准重扫 | §5.7；DR-05 允许但不要求 storageDomain |
| D-03-12 | 原文渲染只用**纯文本**（`chunks[].text`），绝不把 EPUB 的 XHTML 注入 DOM | §10.4；XSS 面收敛为零 |

## 1. 架构

### 1.1 运行时拓扑

```
┌──────────────────────────── DSH Client（浏览器 / Web 视图）────────────────────────────┐
│  sidebar.panellist(id=reading-lab)      main(key=reading-lab)          shell.overlay    │
│         │ 点击 selectPanel(id)                │                              │          │
│         └──────────────►  views/header.js  views/library.js  views/canvas.js           │
│                           views/detail.js  views/ask.js      views/overlay.js          │
│                                    │                                                   │
│                             client/api.js（fetch + EventSource）                        │
└────────────────────────────────────┼───────────────────────────────────────────────────┘
                                     │ HTTP JSON / SSE（同源，loopback）
┌────────────────────────────────────┼───────────────────────────────────────────────────┐
│ DSH Host（Node 进程）               ▼                                                   │
│  routes.js ──► books.js ──► import.js ──► parse/{epub,pdf}.js ──► chunk.js               │
│      │             │              │                                                     │
│      │             ├──► map.js ◄──┴── layout.js                                         │
│      │             ├──► notes.js                                                        │
│      │             ├──► threads.js ◄── ask.js ──► agent.followup()                       │
│      │             └──► export/*.js                                                     │
│      │                                                                                  │
│  tools.js（reading_* 六个工具）──► 与 routes 共用同一套 service（无第二份逻辑）           │
│  prompt.js（systemPrompt.section：工作区约定 + 工具用法）                                  │
│  sse.js（进程内事件总线 → 面板）                                                          │
└────────────────────────────────────┬───────────────────────────────────────────────────┘
                                     │ 文件系统（唯一真相）
                          <workspace>/reading/
                          ├── books/<bookId>/{source.*,meta.json,chunks.json,map.json,
                          │                    notes.md,threads.json,import.log}
                          ├── exports/
                          └── index.json
```

### 1.2 三层职责

| 层 | 负责 | 不负责 | 判定方法 |
|---|---|---|---|
| 确定性插件代码（Host） | 解析、分块、校验、布局、原子写、导出、路由、工具 schema | 任何语义总结、问答、模型调用 | 同一输入必须同一输出；单测可覆盖 |
| Agent（会话内的模型） | 读书、生成导图节点、写笔记、回答问题 | 直接写文件、直接改状态 | 一切落盘经工具校验 |
| Client | 展示、交互、乐观 UI、本地视口状态 | 计算布局坐标、拼接引用、解析文件 | 关闭面板不丢数据 |

**硬边界**：插件代码不 import `llm`、不读 API Key、不发模型请求（DR-02）。`ask.js` 只做「组装上下文 + `agent.followup` + 回写答案」，不生成答案。

### 1.3 四条主链路

**导入（FR-03/04/05/06）**

```
面板选择文件 → POST /books/import（裸字节流）
  → 校验魔数/体积 → 写 reading/inbox/<uuid>.part，边写边算 SHA-256
  → 命中已有 bookId？ 是→删临时文件，返回 { duplicate:true, book }
  → 否→ 建 books/<bookId>/，source.<ext> 原子改名，meta.status=parsing
  → 解析（EPUB 或 PDF）→ 统一 Document{chapters[{title,path,blocks[]}]}
  → 分块 → 写 chunks.json → meta.status=ready（失败按 §10）
  → SSE 推 progress/book 事件；会话流无感（导入不经过 agent）
```

**生成导图（FR-07）**

```
面板「生成导图」→ POST /books/:id/actions/generate-map
  → Host 解析目标 agent（§8.2）→ agent.followup(提示词)
  → agent 调 reading_map{action:"outline"} 拿章节树
  → agent 调 reading_map{action:"chunks"} 分批读原文
  → agent 调 reading_map{action:"commit", root} → 校验 → layout → 原子写 map.json
  → SSE map 事件 → 画布重绘；工具结果同时出现在会话流（含节点数/被拒原因）
```

**询问 AI（FR-11/12）**

```
选中节点 → 浮层输入 → POST /ask {bookId,nodeId,question,agentId}
  → threads.js 建线程 + 追加 user 消息(status=pending)
  → ask.js 组装上下文（≤6000 字）→ agent.followup(带 thread 标记的提示词)
  → 立即返回 {threadId,messageId}；浮层显示「思考中」
  → agent 回答（流式在会话流）→ session/event 监听器捕获 assistant/message
  → 抽取 [c-xxxx] 引用 → threads.json 追加 assistant 消息 → SSE thread 事件
```

**导出（FR-13）**

```
面板选格式 → POST /books/:id/export {format}
  → 读 meta/map/notes/threads（只读）
  → 渲染字符串 → 写 exports/<书名>-<yyyyMMdd-HHmmss>.<ext>.part → 原子改名
  → 返回 {path,bytes}；png 例外：Client 本地生成并下载（§9.6）
```

### 1.4 为什么不用 Typert `ctx.remote`

01 已核实：`dsh-api-remotes` 只挂载构建期生成的 `/remote` 贡献，第三方手写插件无法在运行时声明 capability；`ctx.remote.$on()` 只能订阅 `API_REMOTE_FORWARDED_EVENTS` 白名单，**无法转发自定义插件事件**。因此：

- 采用 `webServer.register({kind:'prefix', path:'/dsh-reading-lab/api/v1'})`，与先例 `dsh-weread-gather` 同路（`index.js:3121`）。
- 路由 handler 拥有完整响应生命周期，SSE 可行（`dsh-host-webserver/lib/types/index.d.ts`）。
- 不用 `registerFallback`、不占用 `upgrade`；路由冲突会抛错，因此路径前缀带插件名。
- **未来迁移 Typert 的条件**（满足任一再评估）：DSH 提供第三方运行期 capability 声明；或 `API_REMOTE_FORWARDED_EVENTS` 开放插件事件。迁移只替换 `client/api.js` 与 `routes.js` 的传输层，service 层不动。

### 1.5 版本与能力探测

- Host 暴露 `GET /health` → `{pluginVersion, apiVersion:1, dshVersion, capabilities:{sse:true, formats:['epub','pdf'], exports:[...]}}`。
- `capabilities.exports` 只列**导出生成**真正支持的格式，必须与该版本 `POST /books/:id/export` 的行为一致：v0.1/v0.2 未实现生成 → `[]` 且路由 501 `E_UNSUPPORTED{availableIn:'0.2.0'}`；实现后填 `limits.exportFormats`。「列出/下载已有导出」（`GET /exports`、`GET /exports/:name`）与本能力无关，始终可用。
- Client 首次加载先 `GET /health`；`apiVersion !== 1` 时面板显示「插件与界面版本不匹配，请升级 dsh-reading-lab」，不进入半可用状态。
- `dsh.engines.dsh` 已声明 `>=0.2.2-rc.1`；03 依据的槽位事实来自 0.2.2-rc.5（01 §2.2）。

## 2. 模块与文件所有权

### 2.1 目标目录树

`*` 为本次设计新增文件；未标注的已存在（入口 stub）。

```
dsh-reading-lab/
├─ src/host/
│  ├─ index.js              * 装配（保持最小）
│  ├─ config.js             * Config schema（limits、导出开关）
│  ├─ limits.js             * 全部阈值常量（唯一来源）
│  ├─ errors.js             * ReadingError + 错误码
│  ├─ paths.js              * 工作区路径解析、逃逸防护、文件名清洗
│  ├─ json-file.js          * 原子读写 JSON / NDJSON 追加
│  ├─ queue.js              * 每书串行队列 + 全局导入闸门
│  ├─ ids.js                * bookId/chunkId/nodeId 生成与校验
│  ├─ books.js              * BookService（CRUD、状态机、index.json）
│  ├─ import.js             * 导入编排（落临时文件→解析→分块→落盘）
│  ├─ parse/epub.js         * EPUB → Document
│  ├─ parse/pdf.js          * PDF → Document（pdfjs-dist legacy）
│  ├─ parse/text.js         * 文本规范化、CJK 拼接、页眉页脚剔除
│  ├─ chunk.js              * 分块（纯函数）
│  ├─ layout.js             * tidy-tree 布局（纯函数）
│  ├─ map.js                * map 读取/校验/原子写
│  ├─ notes.js              * notes 五节解析/渲染/校验
│  ├─ threads.js            * 线程读写、引用抽取、去重
│  ├─ ask.js                * 上下文组装 + agent.followup + 答案回写订阅
│  ├─ agents.js             * 可用 agent 列表与解析
│  ├─ prompt.js             * systemPrompt.section 文本
│  ├─ tools.js              * 六个工具注册（薄层）
│  ├─ routes.js             * 路由分发 + 错误映射
│  ├─ routes/books.js       * 书库/导入/删除/重命名/动作
│  ├─ routes/content.js     * chunks/map/notes/threads/export
│  ├─ routes/events.js      * SSE
│  ├─ sse.js                * 进程内事件总线 + 节流
│  └─ export/
│     ├─ index.js           * 调度、命名、原子写
│     ├─ markdown.js        * md（v0.2）
│     ├─ opml.js            * opml（v0.2）
│     ├─ json.js            * json（v0.2）
│     └─ html.js            * html（v0.3）
├─ src/client/
│  ├─ index.js              * ModuleLoader 入口：注册槽位、样式、locale
│  ├─ api.js                * fetch/SSE 封装、错误归一
│  ├─ store.js              * 面板状态机（书库/当前书/选中/浮层/进度）
│  ├─ i18n.js               * t() 读取 locale（en/zh）
│  ├─ styles.js             * <style> 注入（只含 token 变量）
│  ├─ svg.js                * 贝塞尔路径、卡片、缩放数学（纯函数）
│  └─ views/
│     ├─ header.js          * 顶栏：书名、面包屑、导入、生成、导出、设置
│     ├─ library.js         * 左栏书库：列表、状态、删除、重命名
│     ├─ canvas.js          * 画布：渲染、pan/zoom、选中、键盘、适应窗口
│     ├─ detail.js          * 详情抽屉：摘要、引用、原文定位
│     ├─ ask.js             * 右浮层：快捷指令、线程、发送/停止
│     └─ overlay.js         * shell.overlay：全窗原文/大图预览、toast
├─ schema/
│  ├─ meta-v1.schema.json          * 供测试校验
│  ├─ map-v1.schema.json
│  ├─ threads-v1.schema.json
│  └─ export-v1.schema.json        * FR-13 要求
├─ locale/{en,zh}.json      * 只加面板文案（含错误码 key）
├─ scripts/
│  ├─ build-client.mjs       * 把 src/client/**/*.js 确定性拼接成单入口 client.js（D-05-02）
│  ├─ gen-fixtures.mjs       * 生成并校验 9 个确定性夹具（`--check` 逐字节比对）
│  └─ verify-schemas.mjs     * 用 schema/ 校验样例（M3 起）
├─ test/                     * 分层测试、夹具与手工验收（§12；夹具在 test/fixtures/）
└─ assets/                   * 截图与发布素材（不放夹具）
```

### 2.2 所有权表

角色是**职责**，不是人头；一个人可兼多个角色，但一个文件只能有一个 owner。跨文件修改必须由 owner 提交或书面同意（PR 描述里 @）。

| Owner 角色 | 文件 | 对外接口（只导出这些） | 不碰 |
|---|---|---|---|
| **host-shell** | `src/host/index.js`、`config.js`、`prompt.js` | `apply(ctx, config)`；`promptText(limits)` | 解析/布局细节 |
| **host-core** | `limits.js`、`errors.js`、`paths.js`、`json-file.js`、`queue.js`、`ids.js` | `LIMITS`、`ReadingError`、`resolveInReading()`、`readJson/writeJsonAtomic/appendNdjson`、`withBookLock()`、`bookIdFromSha()` | 业务语义 |
| **store** | `books.js`、`routes/books.js` | `BookService` 方法（04 §3.1） | 解析实现 |
| **parse** | `import.js`、`parse/*.js`、`chunk.js`、`routes/content.js`（chunks 只读） | `parseBook()`、`chunkDocument()`、`importBook()` | 导图/笔记/导出 |
| **map** | `layout.js`、`map.js` | `layoutTree()`、`validateMap()`、`readMap/writeMap` | 画布渲染 |
| **notes** | `notes.js` | `parseNotes()`、`renderNotes()`、`validateNotes()` | 导出排版 |
| **ask** | `ask.js`、`threads.js`、`agents.js` | `buildAskContext()`、`askAgent()`、`appendMessage()` | 路由/工具 schema |
| **export** | `export/*.js` | `exportBook(bookId, format, opts)` | 其他写盘 |
| **api** | `routes.js`、`routes/events.js`、`sse.js` | `makeRoutes(services)`、`publish(event)` | 业务逻辑（只编排） |
| **tools** | `tools.js` | `registerTools(ctx, services)` | 解析/导出实现 |
| **client-shell** | `src/client/index.js`、`api.js`、`store.js`、`i18n.js`、`styles.js` | `apply(ctx)`；`api.*`；`store.*` | 各 view 内部 |
| **canvas** | `views/canvas.js`、`svg.js` | `renderCanvas(props)`、`fitView()`、`screenToWorld()` | 数据读取（走 store） |
| **library** | `views/library.js`、`views/header.js` | `renderLibrary()`、`renderHeader()` | 画布内部 |
| **detail** | `views/detail.js` | `renderDetail()`、`openSourceAt(chunkId)` | 线程 |
| **ask-ui** | `views/ask.js`、`views/overlay.js` | `renderAsk()`、`showToast()` | 答案生成 |
| **qa/docs** | `docs/*`、`schema/*`、`scripts/*`、`test/*` | — | `src/**` 除评审意见 |

### 2.3 依赖规则

```
views/* ──► store.js ──► api.js
   │            │
   └──► svg.js  └──► i18n.js / styles.js
（views 之间禁止互相 import；共享逻辑上提 store/svg）

routes/* ──► services ──► core
tools.js  ──► services ──► core
export/*  ──► core（只读 books/map/notes/threads）
core      ──► node:fs / node:path / node:crypto（无环）
```

- 禁止 host 反向 import `src/client/**`，禁止 client import `node:*`。
- 禁止 `views/*` 直接 `fetch`；唯一出口是 `api.js`（便于错误归一与测试打桩）。
- 禁止在 `index.js` 写业务；入口只做 `inject`、`effect`、`register`。
- 纯函数（`chunk.js`、`layout.js`、`svg.js`、`parse/text.js`）不得读写文件系统。

### 2.4 stub 约定

实现顺序靠「先立接口、后填实现」：

1. 每个新模块先提交导出签名 + `throw new ReadingError('E_NOT_IMPLEMENTED', …)`。
2. `src/host/index.js` 与 `src/client/index.js` 在 M1 只装配路由与空面板；功能模块逐个替换 stub。
3. 替换 stub 的 PR 必须同时补该模块的单测；未补测试不得合并（§12）。
4. stub 期间 `npm run check` 必须通过；`npm test` 允许 skip，但 skip 列表写在 `test/skip.txt` 并在 M2 清零。

## 3. Client 承载

### 3.1 槽位注册

`src/client/index.js` 的 `apply(ctx)` 内完成，全部注册返回 disposer，交给 `ctx.effect`：

| 槽位 | 注册形态 | key/id | 内容 |
|---|---|---|---|
| `main` | keyed | `reading-lab` | 主面板组件（`views/header+library+canvas+detail`） |
| `sidebar.panellist` | list | `reading-lab` | 图标 + 标题（locale key `panel.title`），与 main key 相同即可联动 |
| `sidebar.footer.action` | list | `reading-lab.footer` | **兜底入口**：图标按钮，点击 `ctx.layout` 无面板 API 时打开 `shell.overlay` 全屏面板 |
| `shell.overlay` | list | `reading-lab.overlay` | 全窗浮层宿主；默认不渲染，仅兜底/大图预览时挂载 |
| `conversation.chat.node` | keyed（v0.2） | `reading-lab.result` | 会话流中的导图/问答结果卡 |
| `tool.call.toolview` | keyed（v0.2） | `reading_map` 等 | 工具调用结果的可视化（可选，缺省用 DSH 原生） |

注册时显式声明 `locale: 'reading-lab'` 命名空间，文案走 `locale/{en,zh}.json`；缺失字典会 fail loud，正好在开发期暴露漏翻。

### 3.2 主面板方案（DR-01）

- `main` 注册 `key='reading-lab'`，`sidebar.panellist` 注册同 `id`。依据 01 §2.2，点击 panellist 会 `selectPanel(id)`，`main` 切到同 key 的面板，**不需要额外桥接**。
- 面板必须自己处理「无会话」状态：不假设有活动 session；书库与画布在无会话时可用，只有「询问 AI」入口因无 agent 而禁用。
- 面板不得占用 `conversation` key，也不得注册 `sidebar`/`conversation`/`details` 整列（会替换宿主 UI）。

**联动验证点（M1 手工验收，不写成自动化）**：

1. 启动 DSH → 侧栏出现「阅读实验室」图标。
2. 点击图标 → 主区切到书库空态，侧栏该图标高亮。
3. 点回会话图标 → 主区回会话；再点阅读图标 → 面板状态（当前书、视口）保留。
4. 刷新页面 → 面板仍可进入；上一步的书与视口从 `localStorage` 恢复。
5. **不可调用** `ctx.layout.selectPanel`：`ctx.layout` 只有 `toggleSidebar/openDetails/closeDetails`（01 核查），面板切换在 sidebar 内部 store 完成。若实现里出现该调用，评审直接打回。

### 3.3 兜底方案

仅当 §3.2 第 2 步在目标 DSH 版本失败时启用，且**不删除**主方案代码：

- `sidebar.footer.action` 放一个图标按钮，点击后通过 `store.js` 的 `uiMode='overlay'` 在 `shell.overlay` 渲染完整面板（同一套 views，只换容器）。
- `shell.overlay` 是 root list、点击穿透；容器自己设 `pointer-events:auto`、全屏 fixed、`z-index` 由宿主层管理。
- 兜底形态下，「询问 AI」仍可用；但面板不随主区切换而隐藏，需提供关闭按钮与 `Esc`。
- 判定与切换记录进 [05 开发](05-dev.md) 的「兼容性」一节；两套容器共用 `views/*`，禁止 fork 一份 UI。

## 4. UI 规格

### 4.1 布局与区域

面板基准视口 1200×800（DSH 中心区最小 400 px 由宿主保证，见 01 §2.4）：

```
┌──────────────────────────────────────────────────────────────┐
│ header 48px：返回书库 · 书名/作者 · 进度 · 生成导图 · 导出 · ⋯ │
├──────────────┬───────────────────────────────────────────────┤
│ library      │ canvas（flex:1，min-width:0）                  │
│ 280px        │  工具栏浮层（左上）：适应窗口 / 缩放 % / 图例   │
│ 可折叠→48px  │                                               │
│              │  detail 抽屉 360px（覆盖在画布右侧，不挤压画布）│
│              │  ask 浮层 420px（从面板右缘滑出，盖住抽屉）     │
└──────────────┴───────────────────────────────────────────────┘
```

| 区域 | 尺寸 | 规则 |
|---|---|---|
| header | 高 48；左右 padding 12；gap 8 | 书名为 14/600，作者 12/400 secondary；窄于 720 px 时隐藏作者与按钮文字（保留图标 + tooltip） |
| library | 宽 280，可拖到 240–360；折叠后 48 | 折叠状态持久化；列表项高 52；导入按钮固定在底部 |
| canvas | 自适应，最小 320 | 背景点阵 24 px；内容四周留白 80 |
| detail | 宽 360；距右 16；上下 64 | 覆盖层，`box-shadow` 用边框替代；打开时画布不重排 |
| ask | 宽 `min(420px, 40%)`；全高 | 从右滑入 180 ms `ease-out`；打开时把选中节点平移到剩余可视区中央 |
| overlay | 全窗 | 仅兜底/大图；背景 `--dsw-alias-bg-mask-drop` |

### 4.2 视图状态

面板顶层状态机：

```
booting ──/health ok──► idle ──选书──► loading ──► ready
   │                      │                        │
   └──health fail──► incompatible          ┌──────┴───────┐
                                           ▼              ▼
                                        parsing        failed
                                           │              │
                                           └──► ready ◄───┘（重试）
```

| 状态 | 画布 | 书库 | 可操作 |
|---|---|---|---|
| `booting` | 骨架屏 | 骨架屏 | 无 |
| `idle`（无书） | 空态插画 + 「导入第一本书」 | 空态 | 导入 |
| `loading` | 骨架卡片 ×6 | 保持 | 切书 |
| `parsing` | 进度条 + 阶段文案 + 已解析页/章 | 该书行内进度 | 切书、取消（v0.2） |
| `ready` | 画布 | 列表 | 全部 |
| `unsupported` | 说明卡（E_SCANNED/E_ENCRYPTED） | 该书标灰 + 原因 | 删除、重试 |
| `failed` | 错误卡 + 重试 | 该书标红 | 重试、删除 |

局部状态：`map=null` → 画布空态「还没有导图，点生成导图」；`map` 生成中旧图保留，header 显示细进度条，画布右上角显示「更新中 32%」（不阻塞）。引用失效：该条引用不渲染，详情底部一行 `--dsw-alias-state-error-primary` 文案「引用失效」。

### 4.3 组件与尺寸

| 组件 | 规格 |
|---|---|
| 书卡（根节点） | 宽 240；padding 16；标题 16/600；作者 12；引用角标 11 |
| 章节卡 | 宽 220；padding 12；标题 14/600；摘要 12/1.5，最多 3 行省略 |
| 论点卡 | 同章节卡；左侧 3 px 竖条表示层级色 |
| 引用角标 | 高 18；padding 0 6；圆角 9；`--dsw-alias-markdown-citation` 底；文字 11 |
| 详情抽屉 | 标题 16/600；摘要 14/1.6；引用列表行高 32；原文块 14/1.7，等宽？否（正文用系统字体） |
| 原文高亮 | 背景 `--dsw-alias-state-warn-secondary`，3 s 后淡出（`prefers-reduced-motion` 时立即移除） |
| 浮层消息 | user 气泡右对齐 `--dsw-alias-bg-layer-2`；assistant 左对齐透明；正文 13/1.65；引用 chip 12 |
| 输入框 | 高 36→自动增高至 120；发送按钮 28×28 |
| 进度条 | 高 2；`--dsw-alias-brand-primary`；不确定态用 1.2 s 循环 |
| toast | 底部居中；宽 ≤ 480；4 s 自动消失；错误常驻到手动关闭 |

间距只用 4 的倍数：4 / 8 / 12 / 16 / 24 / 32。字号档位：11 / 12 / 13 / 14 / 16 / 20 / 24。圆角：6（控件）/ 8（卡片）/ 12（浮层）。行高：正文 1.6–1.7，标题 1.3。

### 4.4 设计 token（强制）

**规则：CSS 里只允许 `var(--dsw-alias-*)` 与 `currentColor`；禁止 hex/rgb/hsl/命名色，禁止 `prefers-color-scheme` 分支（主题由 DSH 切换 token 完成）。** 例外仅限 `transparent` 与 `none`。

已核实存在的 token（2026-11-20 从安装包 asar 内 223 个 CSS 提取，共 138 个 `--dsw-alias-*`；下表按用途摘录，完整白名单见 `test/unit/theme-tokens.test.js` 的 `ALLOWED`）：

| 用途 | token |
|---|---|
| 面板底 / 卡片底 / 浮层底 | `--dsw-alias-bg-base`、`--dsw-alias-bg-layer-1`、`--dsw-alias-bg-layer-2`、`--dsw-alias-bg-overlay` |
| 主/次/三级文字 | `--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-alias-label-tertiary`、`--dsw-alias-label-caption` |
| 反色文字（主按钮上） | `--dsw-alias-label-primary-inverted`（浅色主题 #FFF 压在 rgb(15,17,21) ≈ 17.9:1，深色主题 rgb(53,54,56) 压在 rgb(249,250,251) ≈ 11.2:1） |
| 边框/分隔线 | `--dsw-alias-border-l1`（分隔线、面板描边）、`--dsw-alias-border-l2`（控件边框、需要更明显的容器边框） |
| 品牌/选中/悬停 | `--dsw-alias-brand-primary`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-interactive-bg-active` |
| 状态 | `--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-warn-secondary`、`--dsw-alias-state-error-primary` |
| 引用/代码 | `--dsw-alias-markdown-citation`、`--dsw-alias-markdown-inline-code` |
| 主按钮 | `--dsw-alias-button-primary-fill`、`--dsw-alias-button-primary-hover` |
| 骨架/遮罩 | `--dsw-alias-bg-skeleton`、`--dsw-alias-bg-mask-drop` |
| 滚动条 | `--dsw-alias-scrollbar-bg-l`、`--dsw-alias-scrollbar-hover-l` |

**以下名字在主题里不存在，禁止使用**（写错时浏览器静默回落成透明/继承，深色主题下尤难读；历史 bug 见 t27）：`--dsw-alias-bg-primary`、`--dsw-alias-separator-primary`、`--dsw-alias-border-l`、`--dsw-alias-border-secondary`、`--dsw-alias-label-inverse`、`--dsw-alias-label-error`。把状态红写成 `--dsw-alias-state-error-primary` 才对。

层级配色（章节色条）不使用新增色值：用 `--dsw-alias-brand-primary`、`--dsw-alias-state-business-primary`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary` 四色按 depth 0–3 循环。SVG 内所有 `fill`/`stroke` 用 `var(...)` 或 `currentColor`。

对比度：正文与 `--dsw-alias-bg-base` ≥ 4.5:1（NFR）；实现期用 DevTools 抽查明暗两套。有底色的控件必须成对取 token（`button-primary-fill` ↔ `label-primary-inverted`），不要用「反色」语义之外的名字猜。token 缺失时**回退到 `currentColor`**，不得写死颜色。`src/client/**/*.js` 里出现的每个 `--dsw-alias-*` 都必须落在 `test/unit/theme-tokens.test.js` 的 `ALLOWED` 内，该测试同时禁止 `styles.js` 出现 hex/rgb/hsl。

### 4.5 交互规格

| 操作 | 行为 |
|---|---|
| 书库单击 | 选中并加载；双击重命名（v0.2） |
| 导入 | `<input type=file accept=".epub,.pdf">` → `POST /books/import` 流式上传；进度条按 `upload.onprogress`；完成后自动打开 |
| 拖文件到面板 | 同导入；仅接受单文件；超过 100 MB 立即拒绝（不发请求） |
| 画布拖拽空白 | 平移；光标 `grab/grabbing`；移动端单指平移 |
| 滚轮 | 缩放（以指针为锚点）；`ctrl+滚轮` 同；范围 25%–200% |
| `+`/`-`/`0`/`f` | 放大 / 缩小 / 100% / 适应窗口 |
| 适应窗口下限（t9 实现裁决） | 大图（如 500 节点、30000 px 高）在 25% 下限时仍装不下，`f`/`fitView` 允许缩到 2% 以便总览；滚轮、按钮与键盘缩放仍限制在 25%–200%，不会因适应窗口把小图放大到 25% 以上 |
| 单击卡片 | 选中（描边），打开详情抽屉；同一节点再点关闭 |
| 双击卡片 | 展开/收起子树（v0.1 允许，仅视图状态，不改 map） |
| 点引用 | 打开原文视图，滚动到块并高亮 3 s；PDF 顶部显示页码，EPUB 显示章节路径 |
| `Esc` | 依次关闭：浮层 → 详情 → 清除选中 |
| 生成导图 | header 按钮；无 agent 时禁用并 tooltip 说明；生成中可继续浏览旧图 |
| 导出 | 下拉菜单；执行中按钮 loading；完成 toast 显示相对路径（可点击复制） |
| 删除书 | 二次确认（输入书名或勾选）；进行中的解析先取消 |
| 视口恢复 | 每本书记录 `{x,y,zoom,selectedNodeId}` 到 `localStorage['reading-lab:view:<bookId>']`，切书/刷新恢复 |

防抖与节流：画布重绘用 `requestAnimationFrame` 合并；SSE 进度事件 ≥200 ms 节流一次；搜索（v0.3）输入 150 ms 防抖。

### 4.6 键盘与无障碍

- 画布 `role="tree"`，卡片 `role="treeitem"` + `aria-level`/`aria-expanded`/`aria-selected`；`tabindex` 采用 roving（只有当前节点 0，其余 -1）。
- 键位：`↑↓←→` 在可见节点间移动（左右=展开/收起或跨层，上下=同级）；`Enter` 打开详情；`Space` 展开/收起；`Home/End` 首/末节点；`PageUp/PageDown` 平移。
- 焦点环：2 px `--dsw-alias-brand-primary`，`outline-offset:2px`；不得用 `outline:none` 而不给替代。
- 浮层用 `role="dialog" aria-modal="false"`（非模态，画布仍可操作）；打开时焦点进输入框，`Esc` 关闭并还焦到触发按钮。
- 所有图标按钮有 `aria-label`；进度条 `role="progressbar"` + `aria-valuenow`；toast `role="status"`，错误 `role="alert"`。
- `prefers-reduced-motion: reduce` 时禁用滑入/高亮淡出动画。

### 4.7 文案与 i18n

- 命名空间 `reading-lab`；key 规范：`panel.*`、`library.*`、`canvas.*`、`detail.*`、`ask.*`、`error.<CODE>`、`action.*`。
- 错误文案一律 `error.<CODE>` + `error.<CODE>.hint`；FR-15 表格是唯一文案来源，中英同步。
- 不在代码里拼接中英文；数量词以 `{count}` 参数化。
- 动态内容（书名、引用原文）不进 locale。

### 4.8 性能

- 画布首屏：≤300 节点直接全量渲染 SVG；>300 节点按需渲染（只渲染视口 + 1 屏缓冲），v0.3 再上虚拟化。
- 拖动/缩放：只改 `<g transform>`，不重建节点 DOM；p95 帧 ≤33 ms（NFR）。
- 详情抽屉打开不触发画布重排（绝对定位）。
- 大原文（>200 KB）按块分页，每页 50 块；引用定位跨页时先加载目标页。

## 5. 数据契约

### 5.1 目录布局（DR-05）

```
<workspace>/reading/
├─ inbox/                     上传临时文件（启动时清空 *.part）
├─ books/
│  └─ b3f9a1c07d2e/
│     ├─ source.epub | source.pdf     原始文件（只读，不改写）
│     ├─ meta.json
│     ├─ chunks.json
│     ├─ map.json             （可能不存在）
│     ├─ map.bak.json         （重解析/重生成前备份，保留 1 份）
│     ├─ notes.md             （v0.2）
│     ├─ threads.json         （v0.2；不存在时视为空）
│     └─ import.log           NDJSON
├─ exports/
│  └─ 书名-20261119-173000.md
└─ index.json                 可重建索引（缓存）
```

- 所有路径由 `paths.js` 统一构造；`bookId` 必须先过 `^b[0-9a-f]{12}$`。
- 文件名不使用用户输入；显示名只在 `meta.title`/`meta.displayName`。
- 同一本书的写操作经 `queue.withBookLock(bookId)` 串行；全局导入并发 1（PDF 解析吃内存）。

### 5.2 `meta.json`

```json
{
  "schemaVersion": 1,
  "id": "b3f9a1c07d2e",
  "title": "示例书名",
  "displayName": null,
  "author": "示例作者",
  "language": "zh",
  "format": "epub",
  "source": {
    "file": "source.epub",
    "bytes": 5242880,
    "sha256": "3f9a1c07d2e0b8…（64 hex）",
    "importedAt": "2026-11-19T09:30:00.000Z"
  },
  "status": "ready",
  "statusDetail": null,
  "progress": { "phase": "done", "done": 12, "total": 12, "updatedAt": "2026-11-19T09:30:02.000Z" },
  "stats": { "chapters": 12, "chunks": 843, "chars": 412000, "pages": null },
  "toc": [
    { "id": "ch-001", "title": "第一章", "level": 1, "chunkStart": "c-000001", "chunkEnd": "c-000064" }
  ],
  "createdAt": "2026-11-19T09:30:00.000Z",
  "updatedAt": "2026-11-19T09:30:02.000Z",
  "mapUpdatedAt": null,
  "notesUpdatedAt": null,
  "threadsUpdatedAt": null
}
```

| 字段 | 类型 | 约束 |
|---|---|---|
| `schemaVersion` | int | 当前 1；读取时 `!==1` → `E_SCHEMA` |
| `id` | string | `^b[0-9a-f]{12}$`，与目录名一致 |
| `title` | string | 1–200 字；解析失败时回退文件名（去扩展名） |
| `displayName` | string\|null | 重命名只改它，≤200 字 |
| `author` | string\|null | EPUB `dc:creator`；PDF `info.Author`；缺失 null |
| `language` | string\|null | BCP-47 粗判；未知 null |
| `format` | `"epub"\|"pdf"` | 由魔数决定，不由扩展名 |
| `source.sha256` | string | 64 小写 hex；`bookId` 前 12 位来源 |
| `status` | enum | `queued\|parsing\|ready\|unsupported\|failed` |
| `statusDetail` | object\|null | `{code,message,at}`；`message` 已脱敏（无绝对路径） |
| `progress` | object | `phase` ∈ `queued\|reading\|extracting\|chunking\|mapping\|done`；`done/total` 为页或章 |
| `stats.pages` | int\|null | PDF 页数；EPUB 为 null |
| `toc[].chunkStart/End` | string | 章节首/末块 id；空章节两端相同且 `stats.chunks` 不计 |
| `mapUpdatedAt/notesUpdatedAt/threadsUpdatedAt` | ISO\|null | 产物时间；用于缓存与 SSE delta |

`displayName ?? title` 是展示名；导出文件名用它。

### 5.3 `chunks.json`

```json
{
  "schemaVersion": 1,
  "bookId": "b3f9a1c07d2e",
  "generatedAt": "2026-11-19T09:30:02.000Z",
  "chunker": { "version": 1, "target": 1000, "max": 2000, "min": 100 },
  "chunks": [
    {
      "id": "c-000001",
      "seq": 1,
      "chapterId": "ch-001",
      "chapterTitle": "第一章",
      "chapterPath": ["第一章"],
      "page": null,
      "text": "正文……",
      "chars": 968,
      "startOffset": 0,
      "endOffset": 968
    }
  ]
}
```

| 字段 | 约束 |
|---|---|
| `id` | `^c-\d{6}$`，全局递增，全书唯一 |
| `seq` | 1 起，等于 id 数字部分 |
| `chapterId` | 对应 `meta.toc[].id` |
| `chapterPath` | 根→叶标题数组，用于面包屑与引用展示 |
| `page` | PDF 页码（1 起）；EPUB null |
| `text` | 已规范化纯文本；不含 HTML；≤2000 字（硬上限） |
| `chars` | `[...text].length`（按码点计，中文=1） |
| `startOffset/endOffset` | 在**章节文本**中的码点偏移，用于高亮定位 |

体量控制：`stats.chars ≤ 50 MB`；`chunks.length ≤ 20000`。超限在分块阶段报 `E_TOO_LARGE`（不静默截断）。

### 5.4 `map.json`

```json
{
  "schemaVersion": 1,
  "bookId": "b3f9a1c07d2e",
  "generatedAt": "2026-11-19T10:02:11.000Z",
  "generator": { "kind": "agent", "agentId": "…", "sessionId": "…", "pluginVersion": "0.1.0" },
  "root": {
    "id": "n-0a1b2c3d",
    "kind": "book",
    "title": "示例书名",
    "summary": "全书 40–120 字摘要……",
    "citations": [],
    "questions": ["作者为什么……？"],
    "children": [
      {
        "id": "n-4e5f6a7b",
        "kind": "chapter",
        "title": "第一章",
        "summary": "本章 40–120 字摘要……",
        "citations": [{ "chunkId": "c-000003", "quote": "可选短引文 ≤80 字" }],
        "questions": ["……？"],
        "children": []
      }
    ]
  },
  "layout": {
    "version": 1,
    "width": 2400,
    "height": 1600,
    "nodes": { "n-0a1b2c3d": { "x": 0, "y": 0, "w": 240, "h": 120, "depth": 0, "side": "root" } },
    "edges": [{ "from": "n-0a1b2c3d", "to": "n-4e5f6a7b" }]
  },
  "stats": { "nodes": 42, "depth": 3, "citations": 61 }
}
```

| 字段 | 约束 |
|---|---|
| `root.kind` | 固定 `book`；其余 `chapter\|section\|point` |
| `root.citations` | 允许空（根节点例外）；其余节点 1–3 条 |
| `title` | 1–60 字；同级不重复 |
| `summary` | 40–120 字（`[...s].length`）；根节点同 |
| `citations[].chunkId` | 必须存在于 `chunks.json`；否则整次 commit 拒绝 |
| `citations[].quote` | 可选，≤80 字；必须是块内子串（服务端校验） |
| `questions` | 1–3 条，每条 ≤80 字；v0.1 采集，v0.2 展示 |
| 深度 | 根 depth 0，总深度 2–4（即 depth 1..3） |
| `stats.nodes` | ≤300（v0.1）；超限拒绝 |
| `layout.nodes[].side` | `root\|left\|right`；根居中，一级章节左右分配 |

`layout` 由 Host 计算并持久化，Client **不得重算**；这样同一 map 在多端/多次打开坐标一致。

### 5.5 `notes.md`

```markdown
<!-- reading-lab:notes {"schemaVersion":1,"bookId":"b3f9a1c07d2e","generatedAt":"2026-11-19T10:20:00.000Z"} -->

# 示例书名 · 研究笔记

## 主题脉络
正文……[[c:000003]] [[c:000011]]

## 核心论点
……

## 术语表
| 术语 | 释义 | 出处 |
|---|---|---|
| 示例 | …… | [[c:000021]] |

## 阅读建议
……

## 开放问题
……
```

- 第一行必须是 HTML 注释形式的元数据（单行 JSON），解析失败视为手改文件，按「未知版本」处理：可读、不可重生成覆盖（提示先备份）。
- 五个二级标题名称固定且齐全；缺节 → 校验失败 `E_CITATION`（生成期）或只读展示（运行期）。
- 引用语法 `[[c:NNNNNN]]`（6 位序号）；渲染为 chip；未知块显示「引用失效」。
- 无内容的节写 `本书未形成该部分`（固定文案，不翻译，作为数据标记）。
- 面板只读展示（v0.2），复制为 Markdown 原文；编辑留到 v0.3。

### 5.6 `threads.json`

```json
{
  "schemaVersion": 1,
  "bookId": "b3f9a1c07d2e",
  "updatedAt": "2026-11-19T10:31:00.000Z",
  "threads": [
    {
      "id": "t-01",
      "scope": { "kind": "node", "nodeId": "n-4e5f6a7b", "nodeTitle": "第一章" },
      "createdAt": "2026-11-19T10:30:00.000Z",
      "updatedAt": "2026-11-19T10:31:00.000Z",
      "state": "idle",
      "messages": [
        {
          "id": "m-01",
          "role": "user",
          "text": "这个论点成立吗？",
          "citations": [],
          "createdAt": "2026-11-19T10:30:00.000Z",
          "status": "done",
          "messageId": null
        },
        {
          "id": "m-02",
          "role": "assistant",
          "text": "……回答，含引用 [c-000003]。",
          "citations": [{ "chunkId": "c-000003" }],
          "createdAt": "2026-11-19T10:31:00.000Z",
          "status": "done",
          "messageId": "msg_…"
        }
      ]
    }
  ]
}
```

| 字段 | 约束 |
|---|---|
| `threads[].scope` | `{kind:"node",nodeId,nodeTitle}` 或 `{kind:"book"}`；node 不存在时保留线程并标 `orphaned:true`（读取时计算，不落盘） |
| `id` | `t-<两位>` 递增；删除线程不回收 |
| `state` | `idle\|running`；进程重启后 `running` 一律降为 `idle` 并把未完成消息标 `stopped` |
| `messages[].role` | `user\|assistant` |
| `status` | `pending\|streaming\|done\|stopped\|failed` |
| `messageId` | 能关联 DSH 会话消息时写；否则 null |
| `citations` | 只存合法 chunkId；非法条目在写入时丢弃并记日志 |

`qa-threads.json`：**禁止**。历史文档/任务里的该名称为早期别名，任何代码、测试、文档不得再引用为真实文件名（D-03-03）。

### 5.7 `index.json` 与 `import.log`

`index.json`（可删、可重建）：

```json
{ "schemaVersion": 1, "rebuiltAt": "…", "books": [{ "id": "b3f9a1c07d2e", "title": "…", "status": "ready", "format": "epub", "updatedAt": "…", "stats": { "chunks": 843 }, "mapUpdatedAt": "…" }] }
```

启动流程：读 `index.json` → 与各 `meta.json` 的 `updatedAt` 对账 → 不一致或缺失则重扫 `books/*/meta.json` 重建。索引只加速列表，**永远不作为真相**。

`import.log`：NDJSON，每行 `{ "ts": ISO, "level": "info|warn|error", "code": "E_*|null", "msg": "…", "ms": 123 }`；禁止写正文、禁止写绝对路径；单文件轮转 1 MB，保留 `import.log.1`。

### 5.8 写入、并发与恢复

- **原子写**：所有 JSON/Markdown 产物写 `<name>.tmp` → `fsync`（可选）→ `rename`；同目录 rename 在 Windows 上目标存在时先 `rm` 旧文件再 rename（`json-file.js` 封装，测试覆盖）。
- **锁**：`queue.withBookLock(bookId, fn)` 是进程内 Promise 链；跨进程不保证（DSH 单实例假设）。导入前先占全局导入闸门。
- **崩溃恢复**：启动扫描 `books/*`：
  - `meta.status==='parsing'` 且无 `import.log` 结束标记 → 置 `failed`，`statusDetail.code='E_PARSE'`，保留 source 供重试；
  - 存在 `*.tmp` → 删除；
  - `meta.status==='ready'` 但 `chunks.json` 缺失/损坏 → 置 `failed`（不自动重解析）。
- **删除**：先取消该书的队列任务 → 目录改名为 `books/.trash-<id>-<ts>` → 异步 `rm -rf`；失败留下 trash 并记日志，下次启动重试。
- **重解析**（FR-14）：`map.json` → `map.bak.json`（覆盖旧备份）→ 重新解析并生成新 `chunks.json` → 成功后再删备份；失败回滚 meta，旧 chunks 保留。
- **磁盘配额**：不主动清理；删除书与导出由用户触发。`reading/` 超过 2 GB 时面板顶部提示（只提示，不阻止）。

### 5.9 版本迁移

- `schemaVersion` 独立于插件版本；读取时只接受 `1`，其它 → `E_SCHEMA` 并在 UI 显示「数据版本过新/过旧」。
- 新增可选字段不升版本；重命名/删除字段升版本，并提供 `migrations/1→2.js`（v0.3 需要时再加）。
- 未知字段一律保留（读-改-写时不能丢），避免降级插件破坏数据。

## 6. 解析管道

### 6.1 总流程

```
输入字节流
  → 魔数/体积/加密校验（6.2）
  → 容器解析（EPUB 6.3 / PDF 6.4）
  → Document { title, author, language, chapters:[{ title, path, blocks[] , page? }] }
  → 规范化（NFKC、空白折叠、控制字符剔除、CJK 拼接）
  → 分块（6.5）
  → 扫描版判定（EPUB 不适用；PDF 6.6）
  → 写 chunks.json + meta（stats/toc）
```

`Document` 是内部契约（04 §3.2），不落盘。

### 6.2 输入校验

| 检查 | 规则 | 错误 |
|---|---|---|
| 魔数 | EPUB：`PK\x03\x04` 且含 `mimetype`=`application/epub+zip`；PDF：`%PDF-` 前 1024 字节内 | `E_FORMAT` |
| 扩展名 | 仅作提示，不参与判定 | — |
| 体积 | ≤100 MB（`Content-Length` 与实际字节双校验） | `E_TOO_LARGE` |
| 加密 | EPUB：`META-INF/encryption.xml` 存在且含 `EncryptedData`；PDF：`pdfjs` 抛 `PasswordException` | `E_ENCRYPTED` |
| 页数 | PDF ≤2000 页（读取 `numPages` 后判定） | `E_TOO_LARGE` |
| 空文件 | 0 字节 | `E_FORMAT` |

### 6.3 EPUB

依赖：`jszip@3.10.2`（MIT）、`fast-xml-parser@4.5.0`（MIT）。

步骤：

1. `JSZip.loadAsync(buffer, { checkCRC32:false })`；拒绝条目数 >5000、解压总量 >300 MB、单条 >50 MB、压缩比 >200:1、路径含 `..`/绝对路径/反斜杠（`E_FORMAT`）。
2. 读 `META-INF/container.xml` → 第一个 `rootfile@full-path` → OPF。
3. OPF：`metadata`（`dc:title`、`dc:creator`、`dc:language`、`dc:identifier`）；`manifest`（id→href/media-type/properties）；`spine`（`itemref` 顺序，跳过 `linear="no"`）。
4. 目录：
   - EPUB3：manifest 中 `properties` 含 `nav` 的 XHTML → 解析 `<nav epub:type="toc">` 的 `<ol><li><a>` 层级；
   - EPUB2：`spine@toc` → NCX `navMap/navPoint` 递归；
   - 都缺失：用 spine 顺序 + 每篇首个 `h1–h3` 作标题，回退「第 N 章」。
5. 章节切分：TOC 条目 href（去 fragment、URL 解码）映射到 spine index；同一 spine 文档被多个 TOC 条目引用时，以最浅层级为准，其余作为节内标题；TOC 覆盖不到的 spine 文档单独成章。
6. 文本抽取（`parse/text.js`）：
   - 用 XML 解析（非正则），遍历文本节点；
   - 块级元素（`p/div/section/li/blockquote/td/th/h1–h6/pre`）前后加 `\n`；`br` → `\n`；`img` → `[图：alt]`（alt 为空则 `[图]`）；跳过 `script/style/head`；
   - 实体由解析器解码；`&nbsp;` → 空格；连续空白折叠为单空格；保留段落边界（最多两个 `\n`）；
   - 脚注链接（`epub:type="noteref"`）保留锚文本，不展开注释；
   - 结果做 NFKC；剔除控制字符（保留 `\n\t`）。
7. 资源缺失：单个 XHTML 读取失败 → 记 warn 跳过；缺失比例 >20% 或正文总字符 <100 → `E_PARSE`。
8. **不渲染 EPUB 内嵌 HTML/CSS/图片到面板**（D-03-12）；只输出纯文本，图片以 `[图]` 标记。

**M2 实现记录（as built，2026-11-19）**：`jszip` / `fast-xml-parser` 未引入——本仓库 M1 起 `dependencies` 为空（CT-PKG-08 断言），且 profile 安装环境的镜像不可用（05 §6.7）。改为零依赖实现：

- `src/host/zip.js`：自解析 EOCD / 中央目录 / 本地头，`method 0` 直取、`method 8` 用 `node:zlib` 的 `inflateRawSync`；条目数/单条/总量/压缩比阈值来自 `limits.js`（`maxZipEntries`、`maxZipEntryBytes`、`maxZipTotalBytes`、`maxZipRatio`）。不支持 zip64（`E_FORMAT zip64-unsupported`）。
- `src/host/xml.js`：宽容 XML 解析（元素/属性/CDATA/注释/PI/DOCTYPE），够 OPF/container/NCX/XHTML 用；不追求完整 XML 规范。
- `validateEpubContainer(buffer, {limits})`（`parse/epub.js`）：只做容器级校验（ZIP 结构、mimetype、DRM、container.xml），由 `import.js` 在**落盘前**调用——坏包/炸弹/加密包在请求上直接得 415/413/422，不落成 `failed` 书。
- `src/host/chunk.js` 的 `chunker` 取 `{version:1, target:1000, max:2000, min:100}`，其中 `target` 是 03 §6.4 区间 800–1500 内的实现取值。
- PDF 分支（§6.4）尚未实现：`import.js` 对 `%PDF-` 魔数返回 `E_UNSUPPORTED`（`details.reason: 'pdf-pending'`），由 t9/t13 接手。

### 6.4 PDF

依赖：`pdfjs-dist@5.4.296`（Apache-2.0），使用 `legacy/build/pdf.mjs`（Node 无 DOM）。

```js
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const doc = await getDocument({
  data: new Uint8Array(buffer),
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  standardFontDataUrl: undefined,
}).promise
```

- 加密：捕获 `PasswordException` → `E_ENCRYPTED`；其它 `InvalidPDFException` → `E_PARSE`。
- 逐页 `page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })`：
  - 按 `item.transform[5]`（y）聚类成行，容差 2 pt；行内按 `transform[4]`（x）排序；
  - 相邻 item 拼接：若两侧都是 CJK（`\p{Script=Han}` 等）直接拼；否则补一个空格；行尾连字符（`-`）且下一行小写开头 → 去连字符拼接；
  - 行高差 >1.8 倍中位行高 → 段落边界；
- 页眉页脚：统计每页首/末行文本；同一文本在 >60% 页面出现且长度 <80 → 从所有页移除（只删该位置的完全匹配）。
- 章节：
  - `doc.getOutline()` 可用 → 解析 `dest` 为页号（数组 dest 取第一项页码；字符串 dest 用 `getDestination`/`getPageIndex` 解析）；
  - 无 outline → 每 20 页一节，标题「第 X–Y 页」；
  - 每节记录 `pageStart/pageEnd`，块内 `page` 取所在页。
- 页码：chunk 的 `page` 为该块起始页。
- 空文本页：仍占页号；连续空页计入扫描判定。

### 6.5 分块（`chunk.js`）

输入 `Document.chapters[].blocks[]`（段落字符串，已规范化）。算法（纯函数、确定性）：

1. 丢弃 trim 后为空的块；单块 >2000 字先按句末标点切（`。！？!?；;` 后跟空白/结尾；英文 `. ` 需后接大写或结尾），仍超长则硬切 2000。
2. 以目标 1000 字累积：`acc + block`；加入后若 ≥1000 且 ≤2000 → 收束为一块；若 >2000 → 先收束当前（若当前 ≥100 字），否则与下一块合并后再切。
3. 尾部余量 <100 字时并入前一块（前一块可能到 2000 上限，则单独成块并允许 <100，记 warn）。
4. 段落间以 `\n` 连接；不跨章节合并。
5. `startOffset/endOffset` 按章节文本码点计；`chars` 用 `[...text].length`。
6. 全书块数 >20000 → `E_TOO_LARGE`。

阈值集中在 `limits.js`：`{ target:1000, max:2000, min:100, maxChunks:20000, maxChars:50_000_000 }`。

### 6.6 扫描版检测（FR-05/FR-15）

- 采样页：第 1 页、`floor(numPages/2)`、最后一页；不足 3 页全取。
- 每页取 `getTextContent` 拼接后，统计「有效字符」：去除空白与仅标点的 item 后的字符数。
- 三页平均 <20 → `status='unsupported'`，`statusDetail.code='E_SCANNED'`；仍写 `meta.json`（供重试/删除），**不写** `map.json`/`chunks.json`。
- 阈值与采样数写入 `limits.js`，测试用 5 页扫描夹具断言。

### 6.7 失败与日志

- 每个阶段包一层 try/catch，捕获为 `ReadingError`；未知异常转 `E_PARSE` 并记录 `err.stack` 到 `import.log`（仅堆栈首行 + 类名，不含正文）。
- 失败清理：删除半成品 `chunks.json.tmp`；保留 `source.*` 与 `meta.json`（status=failed）以便重试。
- 取消：`AbortSignal` 贯穿解析；PDF 每页检查一次；EPUB 每章检查一次；取消后状态回 `queued`（或删除，取决于调用方）。

### 6.8 性能预算

| 场景 | 预算 | 依据 |
|---|---|---|
| 5 MB EPUB 解析+分块 | ≤2 s | 01 实测 2 章 5 ms，线性外推留余量 |
| 50 MB / 500 页 PDF | ≤30 s | 01 实测 2 页 242 ms；逐页开销约 40–50 ms |
| 冷启动 50 本书 | ≤800 ms | 只读 `index.json` + 校验 mtime；不读 chunks |
| 内存峰值（PDF） | ≤1 GB | 逐页 `page.cleanup()`，不保留页面对象 |

## 7. 导图生成与布局

### 7.1 责任划分

| 步骤 | 谁做 | 产物 |
|---|---|---|
| 决定读哪些块 | Agent（`reading_map outline` 给章节树与块预览） | 工具入参 |
| 生成节点标题/摘要/引用/追问 | Agent | `reading_map commit` 的 `root` |
| 校验（引用、字数、深度、重复） | Host | 通过/拒绝清单 |
| 计算坐标 | Host（`layout.js`） | `map.layout` |
| 渲染 | Client | SVG |

插件自身**不**生成任何节点内容；没有 agent 时按钮禁用。

### 7.2 上下文裁剪

`reading_map action=outline` 返回：

```json
{
  "bookId": "b3f9a1c07d2e",
  "title": "示例书名",
  "author": "示例作者",
  "totalChunks": 843,
  "chapters": [
    { "chapterId": "ch-001", "title": "第一章", "chunkCount": 64,
      "chunks": [{ "id": "c-000001", "chars": 968, "preview": "正文前 120 字…" }] }
  ]
}
```

- `preview` = 块文本前 120 字 + `…`；`chapters[].chunks` 最多 200 条，超出截断并给 `truncated:true`。
- 单次响应 ≤200 KB；客户端/模型需要全文时用 `action=chunks`（每次 ≤20 块、≤20000 字）。
- 这是**刻意**的两段式：先给结构，模型再按需取原文，避免一次把 50 MB 塞进上下文。

### 7.3 校验（commit）

按顺序，任一失败即整体拒绝（返回 `rejected` 列表，最多 20 条）：

1. 结构：单根、无环、`children` 数组、节点数 ≤300、深度 2–4。
2. 字段：`title` 1–60、`summary` 40–120、`questions` 1–3 且每条 ≤80。
3. 引用：非根节点 1–3 条；`chunkId` 必须存在；`quote` 若给出必须是该块子串。
4. 同级标题不重复（大小写与空白归一后比较）。
5. 书根 `kind='book'`，`title` 默认展示名（模型可覆盖，但 ≤60）。

通过后：`nodeId` 由 `ids.nodeId(chapterPath,title)` 计算 → `layoutTree()` → 写 `map.bak.json`（若有旧图）→ 原子写 `map.json` → 更新 `meta.mapUpdatedAt/stats` → 发 `reading/map-changed`。

失败重试策略：工具返回 `{ok:false, code:'E_CITATION', rejected:[...]}`；提示词要求模型**只修复被拒节点**后重提一次；仍失败则保留旧图并结束（FR-07）。

### 7.4 布局算法（`layout.js`）

确定性 tidy-tree（Reingold–Tilford 简化版）：

- 根居中；一级子节点按左右交替分配（`index % 2`），每侧子树独立布局。
- 水平层距：`gapX = 80 + depth*8`；垂直兄弟间距：`gapY = 24`；卡片尺寸由 `kind` 决定（书 240×120，章节/论点 220×96，按摘要行数自适应到 160）。
- 同一父节点的子树包围盒不重叠；父节点 y = 子节点 y 的中位数。
- 输出绝对坐标（左上角），`width/height` 为整体包围盒 + 80 padding。
- 纯函数、无随机、无时间依赖；同输入同输出（单测用快照）。
- 若节点数 >300（v0.3），布局不变，仅渲染层虚拟化。

节点 id 稳定性：`sha1(chapterPath.join('/') + '|' + title)` 前 8 位；同标题同路径重复出现时追加 `-2`、`-3`。重生成后标题未变的节点 id 不变，`threads.scope.nodeId` 继续有效；标题改变的线程保留并标 orphaned（§5.6）。

### 7.5 重生成与旧图

- 进行中：`meta.progress.phase='mapping'`，旧 `map.json` 不动，SSE 只发进度；面板可继续浏览。
- 成功：新图替换，旧图进 `map.bak.json`。
- 失败：旧图与 `meta.mapUpdatedAt` 都不变；`statusDetail` 记 `E_CITATION`/`E_AGENT`，面板 toast 可重试。
- 重生成不触碰 `notes.md` 与 `threads.json`（FR-10 验收）。

## 8. 询问 AI 与线程

### 8.1 上下文（FR-11）

`buildAskContext({bookId, nodeId?, question})`：

```
书名《…》 作者 … 
章节路径：第一章 > 1.2 …
选中节点摘要：……（≤120 字）
相关原文：
[c-000003] ……
[c-000004] ……
```

- 选中节点：节点摘要 + 其 citations 指向的块（去重），不足 3 条时按章节邻近块补足到 3 条，最多 5 条。
- 无选中：全书概览 = 根摘要 + 每章标题与首块前 80 字（最多 12 章）。
- 总长 ≤6000 字（按码点）；超长从末尾块截断并标 `…（已截断）`。
- 末尾追加固定指令：回答用中文、引用格式 `[c-000123]`、只引用给定块、不确定就说明。

### 8.2 注入（D-03-08）

```js
const agent = ctx.agents.get(agentId)            // 目标由面板选择，Host 校验存活
const message = createMessage({
  role: 'user',
  content: [{ type: 'text', text: prompt }],
  source: { kind: 'plugin', plugin: 'dsh-reading-lab' },
})
agent.followup(message)                           // 排队一轮并唤醒
```

- **不用** `commands.execute`：其文档明确「without sending the command to the model」，只能执行斜杠命令，无法得到回答。
- `agentId` 来源：面板 `GET /agents` 列表（`ctx.agents.list()`），默认取最近活跃的 root agent；用户可在设置里固定。无 agent → `E_AGENT`，输入禁用（FR-11）。
- 注入的 prompt 顶部带一行不可见标记：`<!-- reading-lab thread=<threadId> message=<messageId> -->`，用于回写关联；模型可忽略。
- 同线程串行：`threads[].state==='running'` 时拒绝新提问（HTTP 409 `E_BUSY`）；面板发送按钮禁用。
- 停止：`POST /threads/:tid/stop` → `agent.cancel('user', {keepInbox:true})`（仅当该线程是该 agent 当前注入的来源；否则只把消息标 stopped，不打断 agent）。v0.2 先实现「标 stopped + 忽略后续回答」。

### 8.3 答案回写

Host 在 `apply` 里订阅：

```js
ctx.on('session/event', (session, event) => {
  if (event.type !== 'assistant/message') return
  // 1) 找到该 session 最近的 pending 线程消息（内存 Map，key=sessionId）
  // 2) 文本 = 所有 text block 拼接；引用 = /\[c-(\d{6})\]/g 命中且块存在
  // 3) 追加 assistant 消息（status=done, messageId=event.data.message.id）
  // 4) 更新 thread.state='idle'，发 reading/thread-changed
})
```

- 关联窗口：从 `followup` 起 10 分钟内、同一 session 的 `assistant/message`；按时间取第一条未消费的。
- 去重：先按 `messageId`，再按 `(threadId, text前80字, 60s)`；重复则忽略。
- 引用净化：只保留 `chunks.json` 里存在的 id；不存在的丢弃并在消息里保留原文（UI 显示「引用失效」）。
- 模型若主动调 `reading_ask{action:"record"}`，以工具写入为准（带 `source:'tool'`），监听器见到已消费则跳过。
- 会话事件 API 已核实存在（`dsh-session/lib/types/index.d.ts:66` 的 `'session/event'`）。

### 8.4 并发、失败与重启

- 每本书最多 1 个 running 线程；不同书可并行。
- `agent.followup` 抛错 / agent 不存在 / 5 分钟无 `assistant/message` → 消息 `status='failed'`，`code='E_AGENT'`，SSE 通知。
- 重启：加载 `threads.json` 时把 `running` 降为 `idle`，`pending|streaming` 降为 `stopped`；不自动重发。
- 不重复注入：`POST /ask` 幂等键 `Idempotency-Key`（面板生成 `threadId+messageId`）；同 key 10 分钟内返回首次结果（FR-12 验收）。

## 9. 导出（FR-13）

### 9.1 通用

- 产物目录 `<workspace>/reading/exports/`；文件名 `sanitize(displayName)-yyyyMMdd-HHmmss.<ext>`，同名追加 `-2`、`-3`（最多 99）。
- 写 `.part` → fsync → rename；失败删 `.part` 并返回 `E_IO`。
- 只读 `map.json`/`notes.md`/`threads.json`，不修改；导出后源文件哈希不变（AC）。
- 版本：md/opml/json 属 v0.2；html/png 属 v0.3；未实现的格式返回 `E_UNSUPPORTED`（HTTP 501），UI 不展示入口。

### 9.2 Markdown

```markdown
# 示例书名

> 作者：示例作者 ｜ 格式：EPUB ｜ 导出：2026-11-19 17:30

## 导图大纲

- 示例书名
  - 第一章
    - 论点一
      > 摘要……
      - 引用：[c-000003](reading://b3f9a1c07d2e/c-000003)

## 研究笔记

（notes.md 去掉首行元数据注释后的正文）

## 问答精选

### 第一章 · 这个论点成立吗？
**问**：……
**答**：…… [c-000003]
```

- 标题层级与 map 深度一致；`>` 引用块放摘要；引用用 `reading://<bookId>/<chunkId>` 伪链接（本地可读，不联网）。
- 所有文本转义 Markdown 特殊字符（`\` `*` `_` `[` `]` `` ` `` `#` `>`）；不输出原始 HTML。
- `includeThreads=false` 时省略问答节。

### 9.3 OPML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>示例书名</title><dateCreated>Thu, 19 Nov 2026 09:30:00 GMT</dateCreated></head>
  <body>
    <outline text="示例书名" _note="全书摘要" _citation="">
      <outline text="第一章" _note="本章摘要" _citation="c-000003,c-000011">
        <outline text="论点一" _note="……" _citation="c-000021"/>
      </outline>
    </outline>
  </body>
</opml>
```

- `text` 必填；摘要进 `_note`；引用逗号分隔进 `_citation`（XMind 忽略未知属性但不丢层级）。
- XML 转义 `& < > " '`；不输出 DTD/外部实体。
- 深度不截断（OPML 无深度限制），但节点数上限同 map（300）。

### 9.4 JSON

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-11-19T09:30:00.000Z",
  "generator": { "plugin": "dsh-reading-lab", "version": "0.1.0" },
  "book": { "meta": {}, "chunksIndex": [{ "id": "c-000001", "chapterId": "ch-001", "chars": 968 }] },
  "map": {},
  "notes": { "sections": [{ "heading": "主题脉络", "markdown": "…" }] },
  "threads": []
}
```

- `book.meta` 去掉 `source.file` 的绝对路径痕迹（本来就只有相对名）；`chunksIndex` 不含正文（控制体积）。
- `map` 与 `map.json` 的 `root/layout/stats` 逐字段一致（FR-13 验收）。
- `threads` 仅在 `includeThreads=true` 时出现。
- 必须通过 `schema/export-v1.schema.json`（测试里用 ajv 或手写校验器；不新增运行时依赖，校验器放 `scripts/`）。

### 9.5 HTML（v0.3）

- 单文件、内联 `<style>`、无 `<script>`、无外部 URL/字体/图片。
- 结构：`<header>` 书名/作者/导出时间 → `<nav>` 目录（锚点）→ 嵌套 `<details>` 节点（默认展开 2 层）→ 每节点摘要、引用列表、块原文（`<blockquote id="c-000003">`）。
- 文本全部 HTML 转义；引用链接 `#c-000003`；不嵌入地图 SVG（体积），保留大纲。
- 主题用 `prefers-color-scheme` + 一组 `--rl-*` 变量（导出文件脱离 DSH，不能依赖 `--dsw-alias-*`；这是唯一允许自定颜色的场景，且只用于导出产物）。

### 9.6 PNG（v0.3，Client 侧）

- 触发：画布工具栏「导出图片」→ Client 从当前 SVG 克隆、内联计算样式（把 `var(--dsw-alias-*)` 解析为计算值）、移除交互层。
- `XMLSerializer` → `Blob` → `Image` → `<canvas>`（2× 缩放，上限单边 16384 px；超限按比例降采样）→ `toBlob('image/png')` → 下载。
- 背景使用当前主题 `--dsw-alias-bg-base` 的计算值；不导出选中描边/浮层。
- 文件名同 §9.1；不经 Host（D-03-10），因此不写 `exports/`，由浏览器下载目录接管。若用户要求落工作区，v0.3 再加 `POST /exports/upload`（不在本次范围）。
- 失败（画布过大/浏览器限制）→ toast `E_IO`，提示先缩小范围或改导出 SVG（v0.3 可选）。

### 9.7 失败清理

- 任何格式失败：删 `.part`，不触碰已有同名成功文件；日志 `E_IO` 带 `format` 与阶段。
- 导出进行中禁止删除该书（`withBookLock` 读锁）；删除请求返回 409 `E_BUSY`。

## 10. 错误、恢复与安全

### 10.1 错误码（行为层）

| 码 | 触发 | 用户文案 key | 恢复动作 | 终态 |
|---|---|---|---|---|
| `E_FORMAT` | 魔数/结构不符 | `error.E_FORMAT` | 换文件 | failed |
| `E_TOO_LARGE` | 体积/页数/块数/字符超限 | `error.E_TOO_LARGE` | 拆分 | failed |
| `E_ENCRYPTED` | DRM/密码 | `error.E_ENCRYPTED` | — | unsupported |
| `E_SCANNED` | 无文本层 | `error.E_SCANNED` | 换文本版 | unsupported |
| `E_PARSE` | 结构损坏/缺资源 | `error.E_PARSE` | 重试/删除 | failed |
| `E_AGENT` | 无 agent/中断/超时 | `error.E_AGENT` | 重试 | 保持旧态 |
| `E_CITATION` | 引用/字数/深度校验失败 | `error.E_CITATION` | 重新生成 | 保持旧图 |
| `E_IO` | 读写/权限/磁盘满 | `error.E_IO` | 检查目录 | failed/保持 |
| `E_SCHEMA` | schemaVersion 不匹配 | `error.E_SCHEMA` | 升级插件 | 只读 |
| `E_NOT_FOUND` | book/chunk/thread 不存在 | `error.E_NOT_FOUND` | 刷新 | — |
| `E_BUSY` | 同书/同线程并发 | `error.E_BUSY` | 稍后 | — |
| `E_BAD_REQUEST` | 参数非法 | `error.E_BAD_REQUEST` | 修正 | — |
| `E_UNSUPPORTED` | 版本未实现（html/png/tutor） | `error.E_UNSUPPORTED` | 升级 | — |
| `E_PATH` | 路径越界/非法文件名 | `error.E_PATH` | 选择工作区内文件 | — |
| `E_NOT_IMPLEMENTED` | stub 未替换（仅开发期） | `error.E_NOT_IMPLEMENTED` | — | — |

HTTP 状态映射与工具返回格式见 04 §7；**同一码在路由与工具里的语义必须一致**。

### 10.2 状态机与清理

```
queued ──► parsing ──► ready
   │           ├──► unsupported（E_SCANNED/E_ENCRYPTED）
   │           └──► failed（E_*）
   └──► failed（入队前校验失败）
```

- 进入 `ready` 的最低条件：`chunks.json` 可读、`stats.chunks>0`、`toc` 非空。
- `unsupported` 可删除、可重试（换文件需重新导入）。
- `failed` 保留 `source.*`，重试 = 重新解析同一文件（不重复上传）。
- 删除进行中的书：取消 → 状态置 `deleting`（内存）→ 目录移入 `.trash` → 列表移除。

### 10.3 路径安全（强制）

1. 根：`READING_ROOT = path.resolve(workspaceRoot, 'reading')`；`workspaceRoot` 取自 DSH 的 `workingDirectory`/会话 cwd，不信任请求参数。
2. 任何用户输入路径先 `path.resolve(base, input)`，再 `path.relative(READING_ROOT, resolved)`；结果为空或以 `..` 开头、或是绝对路径 → `E_PATH`。
3. `bookId` 白名单正则；`chunkId` 白名单 `^c-\d{6}$`；线程/消息 id 同理。
4. 不用用户文件名落盘；`source.<ext>` 固定名。展示名只进 JSON，不进路径。
5. 现有路径的符号链接：`fs.lstat` 检查；若是 symlink → 拒绝（防越界）。Windows junction 同样按 lstat 判定。
6. ZIP 条目路径：拒绝以 `/`、`\`、`X:` 开头，拒绝任何 `..` 段，拒绝 NUL；解压目标始终 `path.join(tmpDir, safeName)` 并再次校验。
7. 工具 `reading_import` 的 `path` 只允许工作区内**已存在普通文件**；`stat.isFile()` 且 `realpath` 仍在 workspace 内。
8. 错误消息不回显绝对路径；`import.log` 只写工作区相对路径。

### 10.4 内容安全

- **不渲染书内 HTML**：面板与导出都只用 `chunks[].text`（纯文本）。因此不存在 EPUB XSS 面；仍对文本做控制字符剔除。
- 导出 HTML 全量转义（`& < > " '`）；Markdown 转义特殊字符；OPML 用 XML 转义。
- 引用 `quote` 必须是块内子串，防止模型编造引文。
- 链接：面板内不渲染任何书内超链接；`reading://` 伪链接只在导出 Markdown 中出现，点击由用户自行处理。
- 图片：EPUB 图片不解析、不展示；PDF 不渲染页面位图（避免大内存与追踪像素）。

### 10.5 隐私

- 书稿与产物只落本地工作区；插件不发任何网络请求（除 DSH 自身的模型调用，由 agent 发起）。
- 注入 agent 的上下文只含选中的 3–5 块 + 摘要（§8.1），不整书上传；提示词里不包含绝对路径与用户名。
- `import.log`、`meta.json` 不含正文；`threads.json` 含问答原文（用户可见、可删）。
- 删除书 = 删除目录；`exports/` 需用户自行清理（导出面板提供「打开目录」提示）。

## 11. 性能与可观测

| 指标 | 目标 | 采集 |
|---|---|---|
| 导入耗时（分阶段） | 见 §6.8 | `import.log` 的 `ms` + `phase` |
| 首屏书库 | ≤300 ms（50 本，热） | Client `performance.mark` |
| 画布 200 节点拖动 | p95 ≤33 ms | 手工采样（06 测试） |
| 导图布局 | ≤500 ms（300 节点） | 单测基准 |
| 导出 1 MB md | ≤500 ms | `export` 日志 |
| SSE 断线率 | 记录重连次数 | Client 计数，console.debug |

降级：画布 >300 节点关阴影/关动画；原文 >1 MB 分页；PDF 解析超过 25 s 时进度文案改为「仍在解析，可先去读书库」。

## 12. 测试与夹具

### 12.1 单测（`node:test`，零依赖）

| 模块 | 用例 |
|---|---|
| `parse/epub.js` | EPUB3 nav / EPUB2 NCX / 无 TOC 回退 / 缺章 / 恶意 zip（`../`、绝对路径、超大条目） |
| `parse/pdf.js` | 2 页文本 / 中文 / 扫描 5 页 / 加密 / 损坏 PDF / outline 章节 |
| `parse/text.js` | CJK 拼接、连字符、页眉页脚剔除、实体、控制字符 |
| `chunk.js` | 目标/上限/下限、长段切分、章节不跨、码点计数、20000 上限 |
| `layout.js` | 快照（10/50/300 节点）、左右分配、无重叠、确定性 |
| `map.js` | 引用未知/空引用/摘要超长/深度超限/重复标题 → 拒绝清单 |
| `notes.js` | 五节缺失、引用未知、固定文案、元数据行解析 |
| `threads.js` | 引用抽取、去重、running→idle 降级、幂等键 |
| `paths.js` | `..`、绝对路径、symlink、Windows 保留名、UNC |
| `export/*.js` | 转义、OPML 层级、JSON schema、文件名去重、原子写 |
| `svg.js` | 坐标变换、fitView、贝塞尔控制点 |

### 12.2 集成（HTTP）

- 用 `node:http` 起临时 server，挂 `makeRoutes()`；`fetch` 直打。
- 覆盖：导入→列表→chunks→map→notes→threads→export 全链路；404/405/413/415/409；SSE 首帧与断线重连。
- 上传流：构造 1 MB 随机字节 + 100 MB 假 `Content-Length`（不真传）断言 413。

### 12.3 夹具（`test/fixtures/`，9 个文件 + `manifest.json`）

| 夹具 | 用途 | 实测体积 |
|---|---|---|
| `epub3-mini.epub` | 2 章 + nav | 2.9 KB |
| `epub2-ncx.epub` | NCX + 无 nav | 3.0 KB |
| `pdf-text-2p.pdf` | 2 页英文文本 | 2.0 KB |
| `pdf-text-10p.pdf` | 10 页英文，采样与性能 | 8.4 KB |
| `pdf-zh-2p.pdf` | 中文 CID/ToUnicode | 4.3 KB |
| `pdf-scanned-5p.pdf` | 扫描判定 | 1.9 KB |
| `evil-zip.epub` | zip-slip 路径逃逸 | 1.1 KB |
| `bomb.epub` | 压缩比炸弹 | 9.1 KB |
| `corrupt.pdf` | 损坏/截断 | 82 B |

`manifest.json` 记录每个夹具的 `bytes`、`sha256` 与生成参数；`scripts/gen-fixtures.mjs` 零依赖、确定性生成，`npm run fixtures:check` 逐字节校验。全部夹具 <10 KB，可入库；50 MB 大文件由脚本临时生成，不提交（05 §3、06 §5）。

### 12.4 AC 映射（编号与语义以 02 §9.1 为准）

| AC | 自动化 | 手工 |
|---|---|---|
| AC-01 首次导入 EPUB → 出图 → 叶卡引用 | IT-IMP-01、UT-MAP-*、CT-FIX-02 | MAN-03 面板走查 |
| AC-02 中文 PDF 文本/页码/跳转 | CT-FIX-10、UT-PDF-02、IT-IMP-02 | MAN-04 抽检 5 段 |
| AC-03 扫描版 10 s 内 `unsupported` | CT-FIX-07、UT-PDF-03 | MAN-05 导入后可删除 |
| AC-04 引用往返 5/5 一致 | IT-C04、UT-CHUNK-01 | MAN-08 点引用高亮 |
| AC-05 重启恢复 + 运行内切换恢复 | IT-BOOK-04、IT-C10 | MAN-11 重启 DSH |
| AC-06 卡片追问 → 会话流 → 引用 → 线程 | UT-ASK/THREAD、IT-C06 | MAN-10 真会话问答 |
| AC-07 三格式导出，OPML 可导入 | UT-EXP、IT-C12 | MAN-12 XMind 打开 |
| AC-08 中英切换无硬编码；亮暗对比达标 | UT-ERR-01（错误文案双语覆盖） | MAN-13 切语言/主题 |
| AC-09 100 MB/2000 页/加密/损坏 → 错误码 | IT-C02、UT-ERR-01、CT-FIX-08 | MAN-05 逐条构造 |
| AC-10 断网后导入/浏览/引用/导出可用 | 无（离线不可自动断言） | MAN-13 断网走查 |

完整步骤写进 `docs/06-test.md`，本文只定边界。

## 13. 里程碑与出口标准

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| **M1 骨架** | 入口装配、路由 `/health`、书库空态、panellist/main 联动、store/api/样式 | 手工 §3.2 五点全过；`npm run check`；`GET /health` 200 |
| **M2 导入** | EPUB/PDF 解析、分块、`meta/chunks`、书库列表、进度 SSE、错误码 | 夹具全过；5 MB EPUB ≤2 s；扫描版判 unsupported；单测覆盖 §12.1 解析/分块 |
| **M3 导图** | `reading_map`、校验、布局、画布渲染、详情/引用跳转 | 真 agent 生成一张图；注入坏 chunkId 被拒；200 节点 p95 ≤33 ms |
| **M4 研究** | `reading_notes`、`reading_ask`、线程、浮层、会话留痕、md/opml/json 导出 | 问答往返一次；重启线程恢复；三格式导出通过 schema/目测 |
| **M5 收口** | html/png（v0.3）、性能、安全、文档、发布门禁 | 02 §9.2 全绿；`npm pack --dry-run` 清单正确；AC-01..10 |

依赖：M1 → M2 → M3（可并行做 M4 的 threads 读写）→ M4 → M5。M3 的画布可在假 map 上先行，不阻塞 agent 联调。

## 14. 与 02 的偏差登记

1. **`src/client/index.js` 过期注释**：注释写 `main 面板 key="reading"`。以 DR-06/D-03-04 为准（`reading-lab`）。本任务不改产品代码，由 client-shell owner 在 M1 修正；在此之前评审以本文档为准。
2. **FR-11 的 `commands.execute`（已关闭）**：实测该 API 只执行斜杠命令、不送模型（`dsh-commands` 文档原文 "without sending the command to the model"），无法产生回答。实现在 2026-11-19 文档门禁中统一为 `agent.followup`（D-03-08），02 FR-11/DR-07 已同步修订；04 按同一机制写。
3. **`qa-threads.json`**：任务描述使用该名，02 DR-05/FR-12 使用 `threads.json`。以 02 为准（D-03-03）。
4. **FR-07「进度通过 `conversation.chat.node`」**：`chat.node` 是 Client 槽位，需要可渲染的会话事件。v0.1 先由工具调用卡（原生）承载进度，面板用 SSE；`conversation.chat.node` 的 `reading-lab.result` 结果卡排到 v0.2（M4）。这不改变「进度可见」的验收，只改变呈现层实现顺序。
5. **`reading.tutor` 属 v0.3**：v0.1/v0.2 注册 schema 但 execute 返回 `E_NOT_IMPLEMENTED`，工具描述标注「预览，未实现」；v0.3 再补实现。这样模型不会误以为可用，也避免版本切换时 schema 变化。
6. **html/png 属 v0.3**：v0.2 的 `GET /capabilities` 不宣告它们；UI 不展示入口。

## 15. 未决问题

| 编号 | 问题 | 影响 | 计划 |
|---|---|---|---|
| Q-01 | `main` 槽位在 0.2.2-rc.5 的 owner props 是否含 `sessionId` | 「询问 AI」目标 agent 的默认值 | 已用 `GET /agents` 规避；M1 验证后可在 04 增补 |
| Q-02 | `session/event` 的 `assistant/message` 是否在流式结束后只发一次 | 回写去重 | M4 用真实会话验证；已有 messageId 去重兜底 |
| Q-03 | Windows 上 `rename` 覆盖已存在文件的原子性 | 原子写 | `json-file.js` 用「先 unlink 再 rename」+ 失败重试；测试覆盖 |
| Q-04 | PDF `getOutline()` 的 dest 解析兼容性（命名目标/远程） | 章节质量 | 无 outline 回退 20 页一节；不阻塞 |
| Q-05 | 主题 token 在极旧 DSH 版本缺失 | 视觉 | `currentColor` 回退；engines 已限制最低版本 |
| Q-06 | 100 MB 上传在 Electron IPC 载体下的内存 | 导入 | 流式写临时文件（§5.1）；M2 实测 100 MB 峰值 <300 MB |
