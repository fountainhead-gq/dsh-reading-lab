# 13 UI 重构与交互改造（下一轮规划）

> 状态：规划，未开工。v0.2.1 已发布，本文件记录 2026-11-22 用户评审提出的全部问题与改造要求，以及此前遗留的未验证项。
> 约定：**本文件之后，每个独立改动必须新开分支**（`feat/*`、`fix/*`），不再直接在 `dev` 上堆叠无关改动。

## 0 背景

v0.2.1 功能已可用，但界面是「工程可用」而非「产品可用」：控件散落、层级混乱、左右分栏职责不清、生成过程无可视化反馈。用户提出以参考应用（Ponder / 腾讯 ima）为标准的整体重构，明确「样式美观、交互简便」为验收前提。

当前界面截图：`assets/ui-before-v0.2.1.png`（三栏：顶栏 + 左侧书架与存储设置 + 点阵画布；顶栏混杂导出/询问 AI/引导学习/刷新/导入；存储位置与迁移勾选直接摊在左栏底部；主区工具条与顶栏重复）。

## 1 问题清单（用户原始反馈逐条落位）

| 编号 | 问题 | 现状证据 |
| --- | --- | --- |
| UI-01 | 设置类控件散落在左栏与顶栏，无统一入口 | 存储位置、迁移勾选、应用/恢复默认占据左栏底部；导入/导出/刷新在顶栏 |
| UI-02 | 存储位置与导出路径均不可选 | 存储位置是文本框 + 应用；导出只能落到默认目录 |
| UI-03 | 操作结果无统一反馈，成功/失败只靠文字变化 | 导出后顶栏出现一行灰色状态文字，不自动消失 |
| UI-04 | 书架不可拖动排序 | 列表顺序由导入时间决定 |
| UI-05 | 只能按章节生成，无法整书一次成型 | 生成入口按当前书；导图与笔记是两个独立按钮，无「先选类型再生成」 |
| UI-06 | 生成过程没有内嵌分析栏，靠外部会话完成 | 生成走 `agent.followup` 注入当前会话，用户看不到进度细节 |
| UI-07 | 缩放/适应窗口等控件在画布浮动条，且非纯图标 | 顶栏 `导出/询问 AI/引导学习/刷新/导入` 文字按钮 + 画布浮动搜索框 |
| UI-08 | 右侧工具条的展开/收起图标点了无效 | 图标存在，未接行为 |
| UI-09 | 卡片宽度固定 | 固定列宽，长摘要被截断 |
| UI-10 | 询问 AI 入口层级不足 | 点卡片只选中，需再找按钮；无「快捷框 → 详细对话」两级 |
| UI-11 | 视觉规范缺失 | 字号字重不统一、线条与留白不成体系、缺少参考应用的克制感 |

## 2 改造项与验收

### R1 布局重构：设置统一入口 · 已落地（feat/ui-foundation + feat/ui-polish）
- 顶栏只保留：书名/当前视图标题、视图切换（导图/笔记）、分析按钮、设置图标、导入；`feat/ui-polish` 起顶栏再无可见文字按钮（全部图标 + `aria-label`），并删掉书架底部与顶栏的两处冗余（存储路径块、「N 本书」计数）。
- 存储位置、导出路径、刷新、书库统计、迁移等全部收进**设置面板**（右侧抽屉或浮层，非独立页面）。
- 验收：顶栏可点控件 ≤6 个；左栏只剩书架与搜索；设置面板内分组为「存储」「导出」「诊断」。

### R2 路径可选：存储位置 + 导出目录 · 已落地（feat/ui-foundation + feat/ui-polish）
- 存储位置沿用 `PUT /settings/library-root`（已实现），在设置内以「当前路径 + 选择目录 + 迁移复选 + 应用」呈现，并提供系统目录选择能力（无原生对话框时用路径输入 + 校验 + 常用位置建议，禁止 `alert/confirm`）。
- 导出目录新增设置项 `exportRoot`（已落地）：`PUT /settings/export-root`，优先级「设置里的 `exportRoot` → 默认 `<书库>/exports`」；验收用例覆盖「自定义目录生效 / 传 null 恢复 / 非绝对路径与等于书库根被拒 / 改书库根时保留」。
- 验收：两处路径均可自定义、校验失败有明确文案、导出文件出现在所选目录。

### R3 统一反馈：toast · 已落地（feat/ui-foundation）
- 所有操作（导入、导出、生成、设置保存、迁移）通过统一 toast 反馈：成功/失败/进行中三态，2.5–4 秒自动消失，可手动关闭，失败态停留更久并附「查看详情」。
- 禁止使用 `alert/confirm/prompt`。
- 验收：任意操作均有反馈；连续操作不堆叠超过 3 条；失败文案含原因码。

### R4 书架拖动排序与隐藏 · 已落地（feat/ui-polish 第二批；宽度拖动待做）
- 书架支持拖拽重排，顺序持久化到书库索引（索引数组本身就是展示顺序，未新增 `order` 字段）：`PUT /books/order {ids}` → `BooksService.reorder()`，未知/重复 id 跳过，未列出的按原序接后，`revision` 自增。
- 验收：拖动有落点高亮（`data-dragging`）；顺序写入后 `GET /books` 与重启后一致；键盘可用（Alt+↑/↓）；顶栏最左按钮隐藏/显示书架（`libraryOpen` 持久化）。
- 未做：书架宽度拖拽（store 已备 `setLibraryWidth`（220–480 夹取）与 `libraryWidth` 持久化，UI 未接）。

### R5 整书生成 + 类型选择
- 导入完成后按**整本书**生成，而非按章节。
- 「分析」按钮先出类型选择（思维导图 / 研究笔记），选定后生成；两者可分别生成、也可连续生成。
- 验收：一本 10 章以上的书一次触发即产出整书结构；类型选择有默认记忆。

### R6 内嵌分析栏（关键）
- 生成导图/笔记时，在**插件面板内**启动分析栏（左侧或底部抽屉），显示：当前阶段、已处理章节/块数、增量出现的节点。
- 使用**当前 DSH 配置的模型**，走插件自身的 Host 调用链，**不再注入创作模式会话来分析文本**（现有 `agent.followup` 路径降级为「无模型时的兜底」）。
- 长文本耗时长时，**边分析边增量展示**（流式追加节点/笔记段落），失败可续跑。
- 验收：面板内可见进度与增量内容；断开会话不影响生成；模型来自 `ctx.llm`/`agentDefaultModel` 配置。

### R7 视图自由切换 · 已落地地基（feat/ui-foundation）
- 导图与文档笔记在同一主区内切换（顶栏或视图切换器），保留滚动位置与选中节点。
- 验收：切换 ≤100ms 无闪烁；同一书两视图数据一致（`map.json` 与 `notes`）。

### R8 画布交互（图标化 + 折叠 + 宽度 + HUD 自动隐藏）· 部分落地（图标化/HUD/书架折叠已做，节点折叠与卡宽待做）
- 缩放、适应窗口、搜索、展开全部改为**顶部工具栏图标**（带 tooltip 与快捷键）。
- 右侧工具条的展开/收起**真正生效**：展开全树 / 收起至一级 / 按节点折叠，动画 ≤200ms。
- 卡片宽度可调（拖拽或设置项，记入 `layout` 偏好），最小/最大宽度有界。
- 验收：所有图标有 tooltip；折叠状态持久化；宽度调整不破坏连线。
- 已落地：顶栏全部动作改 24px 线性图标（1.7 描边，Lucide/Feather 几何，`aria-label` + `title` 承担语义）；画布顶部 HUD（搜索/统计/缩放）**鼠标离开后自动收起**，移到画布顶部 64px 内再出现，有搜索词或焦点在内时保持可见。
- 未做：节点级折叠/展开动画与卡片宽度拖拽。

### R9 询问 AI 两级入口
- 点击卡片（或光标锁定卡片）先弹**快捷框**：快捷指令（深入探索/解释/简化/示例）+ 输入框。
- 点「询问 AI」再展开**详细对话**（右侧浮层，线程化，支持追问、引用、停止）。
- 验收：快捷框 ≤1 次点击可达；详细对话保留线程历史；键盘可达（Esc 逐级关闭）。

### R10 视觉规范 · 已落地（feat/ui-foundation）
- 建立 token 级规范：字号阶梯（12/13/15/20）、字重（400/500/600）、线条（1px 边框、分隔线弱化）、留白（8/12/16/24 栅格）、圆角（8/10/14）、阴影两级。
- 配色参考 Ponder / ima：低饱和背景 + 单一强调色（当前紫）+ 语义色仅用于状态。
- 严禁自定义颜色硬编码，全部走 `--dsw-alias-*` 与新增的插件局部 token。
- 验收：`test/unit/theme-tokens.test.js` 白名单覆盖新增 token；深浅两主题对比度 ≥4.5:1。

## 3 技术方案要点

- **面板内分析栏与模型调用**：`ctx.llm` 已在 Host 可用；新增 `src/host/analysis.js` 负责「分块 → 调用模型 → 解析为节点/笔记段落 → 增量落盘 → SSE 推送」，与现有 `generation.js` 状态机解耦，保留 watchdog 三段预算。
- **增量落盘**：`map.partial.json`（节点逐条追加）与 `notes.partial.md`，完成后原子替换正式文件；失败保留 partial 供续跑。
- **导出目录**：`settings.json` 增 `exportRoot`；导出服务读取优先级链，写盘失败回退默认并 toast 提示。
- **书架顺序**：`index.json` 增 `order` 数组；`GET /books` 按 order 排序，缺失时按导入时间兜底。
- **折叠状态与卡宽**：写入 `layout` 偏好（`$DSH_HOME/reading-lab/layout.json`），按书区分。

## 4 未验证项与测试欠账（承接 v0.2.1）

- 真实模型下的 `reading_ask` 端到端回答未验证（QA 环境 transport 5/5 失败，仅验了状态机与 HTTP/UI 路径）。
- `link:` 安装、XMind/Mubu 导入、AC-10 断网、加密 PDF、100MB 大文件、性能与 a11y 未执行。
- `generate-map-observe`、`ask-route` 类等待窗口已改为环境变量可控（`RL_WAIT_STATE_MS`/`RL_SSE_DRAIN_MS`/`RL_GEN_IDLE_MS`），满载 40/40 通过，但仍视为欠账，后续新增集成测试必须复用 `test/helpers/net.js` 的 `listenSafe`。
- `dev` 上 `ee4381f`（t45 收尾）未合并、未推送，随下一版发布。

## 5 分支与提交约定

- 每个改造项独立分支；实际已用：`feat/ui-foundation`（R10 + R1 + R3 + R7 地基）、`feat/ui-polish`（R2 导出目录 + R1/R8 图标化与降噪 + **第二批：R4 排序/隐藏、图标重做、HUD 自动隐藏、笔记头部元信息**）；待开：`feat/whole-book-generate`（R5）、`feat/inline-analysis`（R6）、`feat/ask-two-level`（R9）、`feat/canvas-controls`（R8 剩余：节点折叠 + 卡宽 + 书架宽度）。
- 单个分支只做一件事，合入 `dev` 前必须有对应测试与文档行；`dev` → `main` 仍走发布流程。
- 文档先行：每项的接口/交互变化先改 `03-design`、`04-api`，再写代码。
## 6 本轮进度：`feat/ui-foundation`

分支从 `dev`=`5732949` 拉出，只做四件事：**R10 视觉 token、R1 设置统一入口、R3 统一 toast、R7 视图切换地基**。导出目录（R2 的导出半边）需要动 export 契约与 `UT-EXP-06`，另开分支。

### 6.1 落地内容

| 改造项 | 落点 | 证据 |
| --- | --- | --- |
| R10 token | `src/client/styles.js` 在 `.rl-root` 建立 `--rl-space-*`、`--rl-font-*`、`--rl-weight-*`、`--rl-radius-*`、`--rl-header-h`、`--rl-side-w`、`--rl-rail-w`、`--rl-shadow-*`；颜色仍只引用 `--dsw-alias-*` | `test/unit/theme-tokens.test.js` 通过；未新增字面色值 |
| R10 卡片 | `canvas.js` 节点卡：白卡 + `border-l1` 描边 + `drop-shadow` 两级，标题 15/600、摘要 12.5、引用胶囊 | 截图待补（重启宿主后取） |
| R1 设置抽屉 | 新增 `src/client/views/settings.js`：存储 / 导出 / 诊断三节，非模态 `role=dialog`、Esc 关闭 | `settings-render.test.js` 4 例改为「先开抽屉再断言」 |
| R1 入口收敛 | 顶栏 = 导入 / 视图切换 / 询问 / 引导 / 导出 / 设置 / 计数；存储位置从书架底部移除，改由设置抽屉与书架底部「设置」按钮进入 | `ask-focus`、`export-render`、`tutor-render` 按图标化契约更新 |
| R3 toast | 新增 `src/client/views/toast.js`：成功 3.2 s、失败 5 s、`sticky` 不自动消失、最多 3 条、`data-toast` 便于断言；导入/导出/设置应用/刷新全部改走 toast | 无 `alert/confirm/prompt`（全库 grep 为空） |
| R7 视图切换 | `store.viewMode`（`map`/`notes`）+ 顶栏分段控件；主区渲染 `Notes variant="main"` 或画布 | `ask-focus` 笔记用例改为 `viewMode='notes'` |
| R8 部分 | 缩放 / 适应 / 1:1 挪进顶部 HUD 并图标化 | `canvas-render.test.js` 断言缩放条在 HUD 内、按钮无可见文字 |

### 6.2 验证

- `npm run verify` exit 0：432 tests / 395 pass / 0 fail / 37 todo（2026-11-22）。
- `client.js` 15 parts、263360 B（`node scripts/build-client.mjs --check` 一致）。
- 五处测试按新契约改写，不是放宽断言：图标入口改查 `aria-label`/`data-action`；设置区块改为「抽屉关闭时不渲染、打开后按节断言」。

### 6.3 本轮未做（明确留给后续分支）

- R2 导出目录自定义（要改 `ExportService` 与 `UT-EXP-06`）。
- R4 书架拖动排序、R5 整书生成 + 类型选择、R6 面板内分析栏（`ctx.llm` 直连 + 增量落盘）、R9 询问 AI 两级入口。
- R8 的「右侧工具条真正展开/收起」与「卡片宽度可调」：本轮只做了图标化。

### 6.4 手动验收待办

`link:` 安装下客户端改动要重启 DSH 才生效。重启后看：①顶栏是否只剩图标与导入；②点设置图标是否出右侧抽屉且存储/导出/诊断三节齐全；③任意操作是否出 toast 且几秒后消失；④切「笔记」是否在主区打开而非右侧覆盖。

## 7 本轮进度：`feat/ui-polish`（m01365 六项反馈）

分支从 `feat/ui-foundation`=`a2096ed` 拉出，做掉六项里的五项；书架栏隐藏/拖动（R4）留给下一分支。

### 7.1 落地内容

| 用户要求 | 落点 | 证据 |
| --- | --- | --- |
| 删书架底部「存储位置」 | `src/client/views/library.js` 删除 `.rl-library__foot`；`styles.js` 同步删规则 | `settings-render` 仍断言抽屉内存储节；书架渲染不再含路径块 |
| 设置里导出目录可编辑 | Host：`resolveExportRoot`/`validateExportRoot`、`PUT /settings/export-root`、`ExportService` 注入 `resolveExportDir`；Client：`api.setExportRoot`、设置抽屉导出节（输入 + 应用 + 恢复默认 + 自定义 badge） | `settings-route.test.js` 新增 4 例（默认/自定义生效/恢复与拒绝/改根保留）；`npm run verify` 437 tests / 400 pass |
| 删顶栏「N 本书」 | `header.js` 删除 `.rl-header__count` 与 `count` 变量 | `export-render`/`ask-focus` 不再依赖该节点 |
| 右上角功能全图标化 | `header.js`：导入改 `rl-icon-btn--accent`，视图切换改纯图标（`aria-label` + `title`），导出/询问/引导/设置均为图标按钮 | `canvas-render`、`tutor-render`、`ask-focus` 按 `aria-label`/`data-action` 断言 |
| 点击开合、导出菜单清晰化 | `ExportMenu` 改状态组件：点击 toggle、`Esc` 关闭、`onMouseEnter` 展开、`onMouseLeave` 100 ms 后收起；菜单有 `rl-export__head`（「导出为」标题）+ 三项「中文名 + 扩展名」两段式 | 新增 `export-render` 用例「点击展开、再点收起、hover 展开」；`aria-expanded`/`aria-haspopup` 断言 |

### 7.2 关键实现细节（后续分支会踩）

- 导出目录默认值必须取 `books.exportsDir`：`books.root = dirname(readingDir)`，而 `readingDir` 随设置变化，`path.join(books.root, 'exports')` 只在默认布局下偶然相等。
- `ExportService.create()` 返回的 `path`：文件在 `books.root` 内给相对路径（保持 `reading/exports/x.md` 契约），自定义目录在根外则给绝对路径，`UT-EXP-05/06/07` 不受影响。
- 设置读写都保留另一项：写 `libraryRoot` 时合并 `exportRoot`，写 `exportRoot` 时合并 `libraryRoot`。

### 7.3 验证

- `npm run verify` exit 0：437 tests / 400 pass / 0 fail / 37 todo（2026-11-22）。
- `client.js` 15 parts、270510 B（`scripts/build-client.mjs --check` 一致）。

### 7.4 待办

- R4 书架栏隐藏 / 拖动排序（用户原话「下一步继续」）。
- R8 剩余：右侧工具条真展开/收起、卡片宽度可调；R5/R6/R9 未动。
- 重启 DSH 后的手动验收：设置抽屉里导出目录可改并能落地；顶栏纯图标；导出菜单标题与点击/悬停开合。


## 8 本轮进度：`feat/ui-polish` 第二批（m01703 用户反馈）

| 反馈 | 落点 |
| --- | --- |
| 右上角图标不好看，要经典样式 | `views/header.js` 的 `ICONS` 全部换成 24×24、描边 1.7 的 Lucide/Feather 几何；`icon()` 支持 `{d}` 与 `{tag:'rect'|'circle'}`；新增书架显隐按钮与 `rl-header__divider` |
| 画布上方搜索等光标移开应隐藏 | `views/canvas.js` HUD 用 `useState` 控制，`onMouseMove` 按 `clientY - rect.top <= 64` 显隐，HUD 自身 hover/focus 保持可见；CSS `transition:opacity 160ms` + `.rl-canvas__hud--hidden` |
| 笔记上方研究笔记信息不显示 | `views/notes.js` 新增 `notesMetaParts()`：书名 + 章节数 + 块数 + 更新时间，全空回落 `notes.meta.empty`；头部 `position:sticky` 常驻 |
| 下一步：书架栏隐藏/拖动 | R4 落地：`PUT /books/order` + `BooksService.reorder()` + 卡片 `draggable`/`data-index`/Alt+↑↓ + 顶栏显隐按钮 + `libraryOpen` 持久化 |
| 提交后合并 main；仓库已转 public | `docs/05-dev.md`、`docs/06-test.md` 的 private 措辞改为 public |

验证：`npm run verify` exit 0 —— **440 tests / 403 pass / 0 fail / 37 todo**；`client.js` 15 parts / 283274 B。

未做：书架宽度拖拽、节点折叠动画、卡片宽度拖拽（R8 剩余）。
