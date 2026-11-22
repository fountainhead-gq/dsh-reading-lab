# Changelog

本项目的所有重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 画布：卡片悬浮浮出「询问 AI / 详情」按钮条，点击直接打开对应浮层（`askNode` 新增）。
- 画布：非根卡右下角可拖拽调整宽度（200–640），宽度与折叠状态一起持久化到 localStorage。
- 画布：HUD 增加「展开全部 / 收起全部」，并支持 `Ctrl+→` / `Ctrl+←` 全树展开收起。
- 书架：右缘可拖拽调整宽度（220–480，键盘 ←/→ 16px 步进），宽度持久化。
- 动效：节点与连线进入动画，`prefers-reduced-motion` 下自动关闭。
- 画布：卡片悬浮工具条加透明桥接区，并给离开加 220ms 宽限，鼠标从卡片移到「询问 AI / 详情」不再中途消失。
- 画布：详情与询问浮层按被点卡片的屏幕矩形定位（默认卡片右侧、右边放不下翻左侧、顶边对齐、高度到容器底部留 12px），`Detail`/`Ask` 新增 `--anchored` 形态。

### Changed

- 笔记主区视图去掉顶部「研究笔记」标题行、元信息行与禁用的「生成笔记（v0.3）」按钮（侧栏形态不再出现）。
- `svg.buildScene` 新增 `widths` 选项：宽度覆盖时按「自身增量 + 前序兄弟增量」平移子树，布局仍以 Host 计算的 `layout` 为基准。
- 画布交互（m02220 反馈）：点卡片只选中不再弹详情，详情与询问只从悬浮工具条按钮（或 Enter）进入；「收起全部」连根节点一起折叠，画布上只剩根卡；卡片宽度拖拽按缩放换算世界宽度，松开鼠标后自动重新框住全图。

### Verification

- `npm run verify` exit 0：449 tests / 412 pass / 0 fail / 37 todo；`client.js` 302204 B / 15 parts。


### Added

- **书库排序与书架隐藏（R4，`feat/ui-polish` 第二批）**：`PUT /books/order {ids}` + `BooksService.reorder()`——按传入顺序重排索引数组（索引本身即展示顺序，未新增 `order` 字段），未知/重复 id 跳过、未列出的按原序接后，`revision` 自增；客户端卡片 `draggable`、`data-index`、落点高亮，Alt+↑/↓ 键盘等价操作，失败回滚并 toast。顶栏新增书架显隐按钮（`libraryOpen` 持久化，`.rl-body--library-closed`）。
- **笔记头部元信息（m01703 反馈）**：`notesMetaParts()` 拼「书名 · 章节数 · 块数 · 更新时间」，全空时回落 `notes.meta.empty`；头部改 `position:sticky` 常驻，不再出现整行空白。

- **导出目录可自定义（R2 导出半边，`feat/ui-polish`）**：`settings.json` 新增 `exportRoot`；`PUT /settings/export-root`（传 `null` 恢复默认 `<书库>/exports`），`GET /settings` 返回 `exportRoot / resolvedExportRoot / exportRootCustom`。`ExportService` 通过注入的 `resolveExportDir` 决定落盘目录，文件在书库根内仍返回相对路径、在根外返回绝对路径。设置抽屉「导出」节可编辑当前目录、应用、恢复默认，并有独立的成功/失败提示。
- **设置抽屉（R1）**：新增 `src/client/views/settings.js`，把存储位置、导出、诊断三块收进同一入口（非模态 `role=dialog`，Esc 关闭）。顶栏与书架底部只留「设置」按钮。
- **统一 toast（R3）**：新增 `src/client/views/toast.js`，成功 3.2 s、失败 5 s 自动消失，`sticky` 常驻；同类同键去重且最多 3 条；导入、导出、设置应用、刷新全部改走 toast，不再有 `alert/confirm/prompt`。
- **视图切换（R7 地基）**：`store.viewMode`（`map`/`notes`）+ 顶栏分段控件，研究笔记改为主区视图（`Notes variant="main"`），与导图共享选中书与节点。

### Changed

- **顶栏图标改经典线性风格（m01703 反馈）**：`ICONS` 全部换成 24×24 viewBox、1.7 描边、圆角端点/接合的 Lucide/Feather 几何（network / file-text / download / upload / gear / sparkles / message-circle / panel-left），`icon()` 支持 `{d}` 与 `{tag:'rect'|'circle'}`；新增书架显隐按钮与 `rl-header__divider`，`.rl-icon-btn` 32→28px、组内 gap 2px。
- **画布 HUD 自动隐藏（m01703 反馈）**：顶部搜索/统计/缩放条鼠标离开后收起（`transition:opacity 160ms`），移到画布顶部 64px 内重新出现；有搜索词或焦点在 HUD 内时保持可见，`data-hud-open` 便于断言。

- **顶栏纯图标化与降噪（`feat/ui-polish`）**：导入改为强调色图标按钮，视图切换改纯图标（`aria-label` + `title`），删掉顶栏「N 本书」计数与书架底部的存储路径块；导出菜单改为状态组件——点击开合、`Esc` 关闭、悬停展开 / 移出 100 ms 收起，菜单带「导出为」标题行与「中文名 + 扩展名」两段式条目。
- **顶栏图标化（R10 / R8 部分）**：导入保留文字按钮，询问 / 引导 / 导出 / 设置改为 16px 线性图标 + `aria-label`；导出菜单触发键带 `data-exporting` 与 `aria-busy`；画布缩放 / 适应窗口 / 1:1 从右下角挪到顶部 HUD，按钮图标化。
- **视觉 token（R10）**：`src/client/styles.js` 在 `.rl-root` 建立 `--rl-space-*`、`--rl-font-*`、`--rl-weight-*`、`--rl-radius-*`、`--rl-header-h`、`--rl-side-w`、`--rl-rail-w`、`--rl-shadow-*`；节点卡改为白卡 + 极浅描边 + 两级投影，标题 15/600、摘要 12.5px。颜色仍只引用 `--dsw-alias-*`，未新增字面色值。
- **测试按新契约更新**：`ask-focus`、`canvas-render`、`export-render`、`settings-render`、`tutor-render` 五处改为查 `aria-label`/`data-action`/`data-exporting`，设置相关用例改为「抽屉关闭时不渲染、打开后按节断言」，未放宽断言。

### Fixed

- **QA-44-02 文档过期断言**：[12 发布说明](docs/12-release-v0.2.md) 第 5/60/135 行仍称 v0.2.1 的 tag、推送与 Release「尚未执行，由 t43 完成」。t43 已于 2026-11-21 发布，现按事实改写为已发布并补 [v0.2.1 Release](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.1)，文首增更正记录写明原措辞错在「发布前的预期留在发布后未回填」。
- **测试等待窗口可配置（QA-44-02 同类）**：`ask-route` 的失败回写轮询（60×25 ms ≈ 1.5 s）与失败日志轮询（40×10 ms = 400 ms）改为 `waitUntil` + `RL_WAIT_STATE_MS`（默认 5000）；`waitForThread` 默认值改由 `RL_WAIT_THREAD_MS` 控制（默认 15000）。`map-route` 的 400 ms SSE 收流改为等 `map`+`progress`+`done` 三类帧齐（`RL_SSE_DRAIN_MS`，默认 3000）。`generate-map-observe` 的「认领后活动不断」用例把空闲预算/心跳从 120/60 ms 放大到 1000/250 ms（`RL_GEN_IDLE_MS`/`RL_GEN_TICK_MS`），保持「累计活动 > 预算」语义，避免满载时 sleep 被拖长后假红。
- **临时端口 bad port**：新增 `test/helpers/net.js` 的 `listenSafe(server)`——先查 undici 已知 bad port 黑名单（5060/6000/6665-6669/6679/6697 等），再对实际端口发一次探测请求，`fetch` 报 `bad port` 就换端口重开（Windows 动态端口范围因机器而异，只查黑名单会漏）。`fake-host`、`import`、`pdf-notes`、`route-contract`、`settings-route`、`generate-map-observe`、`map-route` 统一使用，修掉满载 `fetch failed: bad port` 抖动。

### Verification

- `npm run verify` exit 0：`440 tests / 403 pass / 0 fail / 37 todo`（`feat/ui-polish` 第二批：新增 `route-contract` 的 `PUT /books/order` 三例，路由总数 34→35）。
- 满载 5 轮 × 8 份并发（`ask-route` + `map-route` + `generate-map-observe`）：40/40 exit 0。

## [0.2.1] - 2026-11-21

### Fixed

- **QA-40-01 线程回写竞态**：旧实现先 `takePending` 消费记录再写回，写回抛错时线程永久停在 `running`，用户看到「一直思考」且停止无效。现在 `claimPending` 只打 `inFlight` 标记、记录留在 `pending`，成功路径按「确认可写 → 写 assistant `done` + 线程 `idle` → 释放」执行；失败统一 `failPending(record,'writeback')`，消息 `failed`/`E_AGENT`、线程 `idle`、SSE `thread{failed:true,reason:'writeback'}`，并用 `withThreadLock` 串行、`messageId` 幂等，桶空即删除。
- **IT-ASK-05 假红**：`captureSse` 改为先等 `hello` 帧；`ask-route` 的 `waitForThread` 改为 15 s 条件等待。
- **QA-40-02 文档过期断言**：[12 发布说明](docs/12-release-v0.2.md) 曾写「tag/Release 未执行」，与 v0.2.0 已发布的事实不符；已按 [v0.2.0 Release](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.0) 改写，并补 v0.2.1 补丁说明。

### Verification

- 干净 worktree 连续 3 次 `npm run verify` exit 0：`432 tests / 65 suites / 395 pass / 0 fail / 37 todo`。
- 新增 `test/unit/ask-writeback.test.js` 6 条（含故障注入 `readChunks` 抛错）；`ask-route` 单跑 5 次 6/6；`generate-map-observe` 单跑 3 次 10/10。
- 稳定性如实记录：v0.2.0 后 7 次全量中 1 次 IT-ASK-05 抖动，已定性为 QA-40-01 下游；修复后连续 3 次通过，不称「稳定绿灯」。

### Release status

- `package.json` / `package-lock.json` 为 `0.2.1`；v0.2.1 的 tag、push 与 GitHub Release **未执行**，由 t43 完成。
- v0.2.0 的 tag 与 GitHub Release 已于 2026-11-21 发布。

## [0.2.0] - 2026-11-21

### Added

- v0.2 能力集发布：EPUB/文本 PDF 导入、带引用导图与只读画布、卡片详情与引用跳转、研究笔记（只读）、询问 AI 浮层与线程、Markdown/OPML/JSON 导出、自选书库位置与生成状态可判定。
- [v0.2.0 发布说明](docs/12-release-v0.2.md)：范围、能力清单、已知限制、link/file 安装、升级与迁移注意、门禁证据。

### Changed

- 版本号 `0.1.0 → 0.2.0`：`package.json`、`package-lock.json` 同步；`/health.pluginVersion` 继续从 `package.json` 读取，不另设常量。
- 根 README 状态与功能表更新为 v0.2.0；docs/README 索引加入 12，07 的发布门禁按证据勾选并标注部分项。

### Known issues

- 扫描版 PDF 不支持 OCR（`E_SCANNED`）；加密/DRM、`LZW`/`DCT`、线性化/增量更新按契约拒绝。
- `generate-notes` 在 `0.3.0`（本版 501）；AC-06 在无模型提供方环境未验。
- 节点编辑（t19）、HTML/PNG/SVG 导出（t21）、搜索/小地图、多章并行、1000 节点性能与 i18n/a11y 收尾未包含在本版。

### Release evidence

- 干净 worktree `.qa-t35b @ fe84419` 连续 3 次 `npm run verify` exit 0：426 tests / 64 suites / 389 pass / 0 fail / 37 todo。
- QA-35-01..05 全部关闭；现场手测 `rootPath=D:\Qunar\personal\dsh\reading`、`rootSource=settings`、`isFallback=false`、`GET /books` 5 本（2026-11-21）。
- tag 与 GitHub Release 已于 2026-11-21 发布：[v0.2.0](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.0)。

### t36 文档同步：存储路径与生成预算（2026-11-20）

#### Renamed

- 文档术语：「生成超时」统一表述为「活动感知的三段预算」，「180 s 看门狗」不再作为默认描述；无文件、路由或编号重命名。

#### Added

- 02 新增 **FR-16 书库存储位置**、**FR-17 生成状态可判定**，并增补 **AC-11 / AC-12**；发布门禁手工项同步纳入。
- 06 新增 FR-16/FR-17 矩阵行、AC-11/12 映射与手工用例 **MAN-16**；07 新增 M4-24/M4-25（存储位置、根解析回退可见）与安装验证第 13 步。
- docs/README 索引加入 11 修复验收；编号表更新为 FR-01..17 / AC-01..12。

#### Changed

- 03 §5.1.1 收紧 `isFallback` 语义（只有 cwd 兜底为 `true`；设置损坏/路径不可用靠 `settingsError` 解释），§7.5 明确「排队看认领、认领后看活动、绝对上限只管失控回合」，并补 FR-17 引用。
- 04 §4.2 #9 标注 FR-17/AC-12，存储位置 #31–32 标注 FR-16/AC-11。
- 05 §7.4 补齐改根后旧书位置、`moveExisting:false`、迁移回滚、切回旧根、旧进程识别与三类回退的排查路径。
- 06 §6.2/§8.1 状态同步；07 V2-b/V2-d 与 G-06 纳入 AC-11/12。

#### Fixed

- 修正「设置文件损坏也算 `isFallback`」的潜在误读；文档不再把回退与设置错误混为一谈。
- 补上 docs/README 缺失的 11 号文档索引，避免修复验收报告成为孤岛。

### t37 阶段预算、定时器代际与事件归因（2026-11-20，QA-35-01/02 关闭）

#### Fixed

- **QA-35-01**：`checkBudget` 只比绝对上限，认领后 0 s 就可能被判 `failed{reason:'timeout'}`；
  定时器回调也无条件 `timers.delete(bookId)`，会把期间重新武装的新定时器删掉。现在按阶段取截止：
  排队期只比 `startedAt + queueTimeoutMs`，认领后只比 `lastActivityAt + idleTimeoutMs`，两者都与
  `startedAt + maxDurationMs` 取先到者；提前/重复回调重新武装而不是立刻失败；回调改为
  `onWatchdog(bookId, timer)`，句柄对不上就返回，不动新定时器。
- **QA-35-02**：`agent/error` 与该 agent 下所有生成记录是 agent 级广播，一本书的报错会把另一本书
  还在排队的记录一起判失败；`agent/status running` 同样会伪造认领。现在按记录归因：事件带
  `turn.messageId` / `message.id` / `promptId` 时只命中 `promptId` 相同的记录；无 id 时仅当该 agent
  只有一条目标状态记录才归因；多候选不归因，写一条 `info` 日志交给各自预算兜底。`agent/error`
  只失败 `running`，`agent/disposed` 仍是 agent 级终态。
- **QA-35-03**：设置文件损坏时面板看不出问题（只有 Host 日志）。`/health` 与 `GET /settings` 统一
  输出 `settingsError`（`settings-corrupted` / 路径原因），面板「存储位置」行渲染
  `role=alert` 的可见文案；locale 新增 `settings.corrupted`、`settings.invalid`（zh/en）。
- **QA-35-04**：`generate-map-observe` 用固定 400 ms 窗口收 SSE，满载并发下偶发只收到 `hello`。
  改为轮询到目标帧（默认 3000 ms，`RL_SSE_WINDOW_MS` 可覆盖），不再靠 `sleep` 赌时间。
- **QA-35-05**：ask-route 的「偶发 409 / 回写红」定性为**测试窗口不足**，不是产品竞态——上一条
  用例的写回还没落盘时线程仍是 `running`，此时 409 是正确行为。测试改为条件等待线程 `idle`
  再发送；产品语义未改。

#### Added

- 回归用例：`UT-GEN-15`（阶段截止与提前回调重新武装）、`UT-GEN-16`（定时器代际）、
  `UT-GEN-17/18/19`（跨记录错误归因、无 id 多候选不归因、`agent/status` 不广播认领）、
  `generate-map-observe`「同一 agent 下另一本书的 agent/error 不会失败本书记录」、
  `settings-route`/`settings-render` 各一条 `settingsError` 用例、ask-route 的 `waitForThread`。

#### Changed

- 文档：03 §7.5（阶段截止与定时器代际、事件归因）、03 §5.1.1（`settingsError` 必须可见）、
  04 §4.2 #9（阶段截止与归因）与存储位置 `settingsError`、07 M3-07 t37 证据、两份 CHANGELOG。
- 验证：`npm run verify` 连续 3 次 exit 0，426 tests / 389 pass / 0 fail；`client.js` 234 560 B
  （13 parts，`build-client --check` 通过）。

### t33 书库根解析修正与自选存储路径（2026-11-20）

#### Fixed

- 迁移到已由 `ensureLayout` 建好的目标目录时误报 `target-not-empty`：现在空目录直接复用，
  装了东西才拒绝（真机手测的第一次尝试就撞上这条）。迁移单测与路由测试补了对应情形。
- 书库曾被写到 profile 目录（`$DSH_HOME/profiles/desktop/reading/`），而 `/health` 只报
  `workspaceRootName: "desktop"`，看起来像成功。根解析改为三段式：
  设置文件 `libraryRoot` → `ctx.get('workingDirectory').defaultDirectory` 下的 `reading/` →
  进程 cwd 兜底；访问 `workingDirectory` 统一走 `ctx.get()`（D-03-13）。
- `/health` 新增 `rootPath`（绝对路径）、`workspaceRoot`、`rootSource`（`settings|workspace|cwd`）、
  `isFallback`、`settingsError`；回退时面板显示警告文案，不再把兜底画成正常。

#### Added

- `src/host/settings.js`：`$DSH_HOME/reading-lab/settings.json`（`{schemaVersion:1,libraryRoot}`）
  的读写（原子写、损坏容错）、根解析、路径校验、迁移与回滚。设置与书库解耦，不碰 profile 配置。
- `src/host/routes/settings.js` + 两条路由：`GET /settings`、`PUT /settings/library-root`
  （`{path: string|null, moveExisting?: boolean}`，迁移 `books/exports/inbox/index.json`，
  目标非空直接拒绝，失败反向回滚，成功后立即生效）。
- 面板「存储位置」区块：显示当前绝对路径、回退警告、路径输入、迁移复选、应用/恢复默认，
  成功与失败都有可见反馈（无弹窗）；locale 新增 10 个 `settings.*` key（zh/en）。

#### Changed

- `BookService` 支持以 `readingDir` 构造并新增 `setReadingDir`/`ensureLayout`，切换根不需要重启。
- `config.js` 的 `ensureLayout(root)` 改为委托 `ensureReadingLayout(readingDir)`。
- 文档：03 §5.1.1（根解析与迁移事务）、04 路由表 #31/#32 与逐条规格、05 §7.4（改根与排查）。

### t34 活动感知的生成看门狗（2026-11-20，QA-11-07 后续）

#### Fixed

- 真实宿主误报：agent 已 `reading_map commit` 成功（map.json 有 9 节点），`GET /actions/generate-map`
  却报 `failed{reason:'timeout'}`，且两次 `claimedAt` 都是 `null`。根因是固定 180 s 预算从
  `startedAt` 起算，不区分「agent 正在读几十块原文」与「agent 没接活」。
- `src/host/generation.js`：改为三段预算——排队 `queueTimeoutMs`（默认 60 s，从 `startedAt` 起算）、
  认领后空闲 `idleTimeoutMs`（默认 180 s，每次活动重置 `lastActivityAt`）、绝对上限
  `maxDurationMs`（默认 30 min，防死循环）；三项共用 `reason='timeout'`，由 `message` 区分。
- `claimedAt` 现在真正置位：`agent/inbox/claimed` → `claimEvidence='inbox-claimed'`，
  `agent/status` 进入 running → `'agent-status'`；只有 `reading_map` 工具活动时推进到 running
  但 `claimedAt` 保持 `null`（`claimEvidence='tool-activity'`），不伪造认领。
- `reading_map` 每次调用都会 `noteActivity`（`tool:<action>`），读原文的长回合不再被误杀。

#### Added

- 状态查询与 202 响应补 `claimedAt`、`claimEvidence`、`lastActivityAt`、`lastActivityKind`、
  `idleMs`、`elapsedMs`、`budget{queueTimeoutMs,idleTimeoutMs,maxDurationMs}`；`timeoutMs` 保留为
  「当前阶段预算」兼容字段。
- 面板：认领后显示「Agent 正在处理 · 已耗时 X · 最近活动 Y 前」，去掉失败卡上的固定预算文案；
  locale 新增 `canvas.generate.activity`（zh/en），`running` 文案改为「Agent 正在处理」。

#### Tests

- `test/unit/generation.test.js`：UT-GEN-11（认领证据与 `claimedAt`）、UT-GEN-12（持续活动跨过
  idle 窗口仍 running → done）、UT-GEN-13（绝对上限触发并带已用时长）、UT-GEN-14（只有工具活动时
  `claimedAt` 为 null）；UT-GEN-01/08 按新语义与文案改写。
- `test/integration/generate-map-observe.test.js`：新增「认领后活动不断：跨过旧的 180 s 预算仍在跑」，
  排队/空闲超时改用新配置键并断言 `budget` 与 `claimEvidence`。
- `test/integration/generation-render.test.js`：新增「认领后展示最近活动时间，不再展示固定预算倒计时」，
  原有 running/failed 文案断言同步。
- `npm run verify` exit 0：392 tests / 355 pass / 0 fail（在 HEAD `00a02df` + 本任务改动的干净
  worktree 上验证；主工作区当时混有并发任务的未完成改动）。

#### 偏差

- D-34-01：`GenerationTracker` 的构造参数由单个 `timeoutMs` 改为三段预算；旧配置项
  `mapGenerationTimeoutMs` 仍可作 queue+idle 的别名（`config.js`），不破坏已安装 profile。
- D-34-02：`lastActivityAt` 在 `begin` 时即置为 `startedAt`（`lastActivityKind='begin'`），
  因此 idle 计时在排队期也有起点；真正生效仍是认领后的空闲窗口。
- D-34-03：状态仍在内存（沿用 D-29-01），DSH 重启后回到 `idle`；`budget` 只反映当前配置，不改写历史记录。

### t20 引导式学习路径（2026-11-20）

#### Added

- `src/host/tutor.js`：按导图 DFS 先序生成学习路径（跳过根卡、最多 60 步），每步 1 个检查点问题 + 提示 + 引用；`TutorService.get / restart / mark / answer`，进度与掌握状态落盘 `tutor.json`；导图重新生成后按 `nodeId` 迁移掌握状态。
- 四条路由：`GET /books/:id/tutor`、`POST /books/:id/tutor`（重新开始，`pathId` 递增）、`POST /books/:id/tutor/steps/:stepId`（掌握/跳过）、`POST /books/:id/tutor/steps/:stepId/answer`（向 AI 提检查点问题，202）。
- `reading_tutor` 工具由桩改为真实实现：`action = plan|get|answer|mark`，`{ok:true,data}` 信封、两行 render、15 s 超时、仅 `plan`/`get` 并发安全。
- 客户端：顶栏「引导学习」入口与 `src/client/views/tutor.js` 浮层（进度条、当前步卡片、检查点与引用、线程回答列表、上一步/掌握/跳过/下一步、三种 goal 重新开始、提问输入）；与询问 AI 共享线程与回写链路。
- SSE 新增 `tutor` 事件；`store` 新增 `tutorOpen` / `tutorRevision`，浮层与询问 AI / 详情 / 笔记互斥，打开时背景 `inert`。

#### Changed

- 路由总数 27 → 31；`bookRoute` 支持 `stepId` 校验（`^s-\d{2,}$`）。
- `client.js` 重建为 224,547 B / 13 parts（新增 `views/tutor.js` 片段）。

#### Tests

- `test/unit/tutor.test.js`（UT-TUTOR-01..09）、`test/integration/tutor-route.test.js`（IT-TUTOR-01..06，含重启后进度保留）、`test/integration/tutor-render.test.js`（6 条 VM 渲染交互）。
- `npm run verify` exit 0：386 tests / 349 pass / 0 fail / 37 todo。

#### 偏差

- **D-20-01** `docs/03-design.md` 原无 `tutor.json`：新增 §5.7（路径/步骤/掌握/游标），`index.json` 顺延为 §5.8。
- **D-20-02** `docs/04-api.md` §5.7 原参数 `{bookId, nodeId?, goal?}` 无法表达读路径/标记/提问：改为四动作 `plan|get|answer|mark` + `stepId`/`question`/`state`，返回 `TutorDoc`（含 `progress`）。
- **D-20-03** 引导式学习不另存问答副本：`answer` 复用 `ask.ask` 的线程（首次建节点线程，之后复用 `step.threadId`）；两浮层在数据层不互斥，仅 UI 各开一个，待 v0.3 QA 端到端复测。

### t31 询问浮层焦点契约与可点引用（2026-11-20）

#### Added

- `src/client/index.js`：共享焦点工具 `FOCUSABLE_SELECTOR`、`focusElement`、`focusablesWithin`、`trapTabKey`、`captureFocus` / `restoreFocus`。
- 询问浮层：打开即聚焦关闭按钮，Tab / Shift+Tab 在浮层内首尾环绕，Esc 关闭；浮层声明 `aria-modal="true"` 与 `tabIndex=-1`。
- 引用 chip 可点：`button.rl-cite[data-chunk-id]` → GET `/books/:id/chunks/:chunkId` → 底部预览面板显示章节/页码/原文，滚动到命中片段并高亮 3 s；预览面板可「查看这张卡片」回到导图。失效引用变 `span.rl-cite--invalid` + 「引用失效」，不可点。
- 详情侧卡打开即聚焦容器（`rootRef` + `focusElement`）。
- 笔记面板新增禁用的「生成笔记（v0.3）」按钮（`disabled` + 提示），避免 v0.2 点到尚未实现的 `generate-notes`。

#### Changed

- 浮层 / 详情 / 笔记三元互斥：打开一个自动收起其它两个；浮层或详情打开时 Header / Library / Canvas 三层包 `inert` + `aria-hidden="true"`，背景不可聚焦也不再被 Tab 命中。
- `locale/zh.json`、`locale/en.json`：新增 `ask.cite.{panel,loading,invalid,backToCard}` 与 `notes.generate{,.hint}`；`client.js` 重建为 201,880 B / 12 parts。

#### Fixed

- QA-17-01：Esc 无响应、焦点不进浮层、Tab 跑到背景、关闭后焦点不回原位。
- QA-17-02：回答里的引用 chip 点击无反应。
- `ask-route.test.js` 的失败日志断言存在竞态，改为轮询等待落盘后再断言。

#### 偏差

- **D-31-01** `aria-modal` 由文档示例的 `false` 改为 `true`，与「背景 inert」的实现保持一致。
- **D-31-02** 从详情侧卡的「询问 AI」进入浮层时，触发按钮随详情收起而卸载，焦点归还目标为空；此时不强行把焦点移到别处。

### t32 导出引用可读化与 export schema 补齐（2026-11-20）

#### Added

- `src/host/export/citations.js`：引用解析纯函数（`normalizeChunkId` / `readableCitations` / `citationIdsIn` / `buildCitationIndex` / `resolveCitationIds` / `citationLine`），把 `[[c:000003]]` 与 `map` 节点的 `{chunkId}` 统一成「章节 · 页码 · 原文片段」。
- `schema/export-v1.schema.json`（draft-07）与 `test/helpers/json-schema-lite.js`（零依赖子集校验器）：JSON 导出的正式契约，`package.json` 的 `files` 加入 `schema`。
- `test/unit/export-citations.test.js`（UT-EXP-08..10）：引用转换、三种格式呈现、schema 正反例；`test/integration/export-route.test.js` 新增 IT-EXP-07。

#### Changed

- Markdown 导出：去掉 `reading://` 伪链接，正文用 `[c-000003]`，文末固定 `## 引用` 表（章节 · 页码 · 片段；缺失块写「引用已失效」）；OPML 的 `_note` 携带摘要 + 引用原文，`_citation` 仍保留 id；JSON 每节加 `citationIds` / `citationCount`，文档级加 `citations[]` / `citationCount`（QA-17-04）。
- `/health.capabilities` 新增 `generateNotes: {available:false, availableIn:"0.3.0"}`；`POST /books/:id/actions/generate-notes` 的 501 明确写 v0.3 并带 `details.availableIn`（QA-17-03）。

#### Fixed

- 导出 JSON 与文档口径统一为「嵌套 `map` + 引用两层」，补上 schema 文件，D-16-02 / QA-17-04 / QA-17-05 关闭（QA-17-03 的 Host 侧关闭）。

### Added

- 初始化仓库骨架：`package.json`（`type: module`、bundle patch、`dsh.client.platform=web`、`engines.dsh`）、
  `cordis.patch.yml`（插入插件行 `reading-lab`）、`icon.svg` 占位、`locale/en.json` 与 `locale/zh.json` 的
  `meta` 文案。
- `src/host/index.js` 与 `src/client/index.js` 两个可加载的入口骨架（`apply` 暂为空）。
- `README.md` 与 `docs/01-research` ~ `docs/06-test` 六篇占位文档（后续已全部替换为正式内容）。
- `.gitignore`、`.gitattributes`（统一 LF 换行）、MIT `LICENSE`（fountainhead-gq）、
  目录骨架 `src/host` `src/client` `locale` `docs` `scripts` `test` `assets`。
- 2026-11-19 文档体系完成：01 调研、02 需求（FR/NFR/AC/DR 权威编号）、03 设计、04 接口、05 开发、06 测试、07 里程碑清单；新增 [docs/README](docs/README.md) 索引、[docs/CHANGELOG](docs/CHANGELOG.md) 与 [08 文档门禁报告](docs/08-doc-gate.md)。
- 2026-11-19 测试骨架：9 个确定性夹具（`test/fixtures/` + `manifest.json`）、包/夹具/文档契约测试、HTTP 契约占位与手工验收手册；`npm run verify` 可执行。

### v0.2 文档同步与 QA 记录（2026-11-20 / t18）

#### Added

- 新增 [10 v0.2 QA 记录](docs/10-qa-v0.2.md)：347 项自动化、安装实测、FR/AC 矩阵、PDF 能力边界、AI 交互与导出样例、QA-17-01..06 去向、未验证清单与放行条件。
- [01 调研](docs/01-research.md) 新增 §3.7「v0.2 实机回填」：零依赖 PDF 的实际能力边界、扫描判定、AI 交互与导出实测；选型期的 pdfjs 假设保留为历史证据。
- [05 开发](docs/05-dev.md) 新增 §6.8：`qa-v02` 全新 profile 的 CLI link 安装（约 391 ms）、health/capabilities 与重启恢复记录。

#### Changed

- [02 需求](docs/02-requirements.md) §9.2 补 v0.2 实测状态（AC-01/02/03/04/05/07/09 通过，06/08 部分，10 未验证；未通过门禁），验收标准不下调。
- [03 设计](docs/03-design.md)：§6.4 补 PDF QA 实测；§8.2 注入消息 `source` 改为实际的 `{kind:'reading-lab', form:'ask', …}`（D-10-01）；§9.2 标注研究笔记导出仍保留 `[[c:…]]`（QA-17-04）。
- [06 测试](docs/06-test.md)：§3.4 区分 5807 桌面冒烟与 qa-v02 CLI 安装；§6/§7/§8/§9 状态按 v0.2 实测刷新；§11.2 记录 V2 不通过；新增 §12.1 QA 采样；D-06-05 改「部分执行」。
- [07 清单](docs/07-checklist.md)：M4-04/13/15 补 QA 证据；§3.2 写明 V2-a/b/d 不通过；§10 新增 QA-17-01..06 与 D-05-02 关闭。
- 根 README 状态改为「v0.2 功能实现完成，QA 未通过」；文档表补 09/10；[docs/README](docs/README.md) 补 10、路由数改 27、状态同步。

#### Known issues

- QA-17-01（浮层 Esc/焦点）与 QA-17-02（引用 chip 不可点）仍是 v0.2 发布阻塞；AC-06 因无模型未闭环，AC-08/10 未完成。v0.2 不合并 main、不打 tag。

### M1 骨架（v0.1.0 开发中）

#### Added

- Host 侧基础件：`limits.js`（02 的 8 组限额与 `API_BASE`/`PANEL_ID`）、`errors.js`（`E_*` → HTTP 映射、
  统一错误信封、从 `locale/*.json` 取文案）、`paths.js`（`resolveInReading` 拒绝 `..`/绝对路径/盘符/
  保留名/junction 逃逸）、`json-file.js`（原子写 + `schemaVersion`）、`ids.js`（book/chunk/thread/node id）、
  `config.js`（`resolveLimits`、`resolveWorkspaceRoot`、`ensureLayout`）。
- `books.js`（空书库读取 + `listForHello`，写操作留桩）、`sse.js`（`EventHub` + `openStream`，200 ms 合并、
  `hello` 快照、15 s ping）、`prompt.js`（系统提示节）、`tools.js`（`reading_import`/`_map`/`_notes`/`_ask`/
  `_export`/`_tutor` 六个工具定义，M2 起填实现）。
- `routes.js` 25 条路由表与信封（`/health`、`/agents`、`/books`、`/events`、书内容与导出占位），
  `routes/{books,content,events}.js` 按 03 §2.2 的 owner 边界拆分；`src/host/index.js` 改为只做装配
  （`inject` 四项、`ctx.effect` 注册、逆序 dispose）。
- Client 主面板壳：`src/client/index.js` 模板 + `i18n/styles/store/api` 四个共享片段 +
  `views/{header,library,canvas,detail,ask,overlay}.js`；`main` 注册 `key:'reading-lab'`、
  `sidebar.panellist` 注册同 id 图标；面板渲染空书库态（标题/说明/禁用的「导入第一本书」）。
- `scripts/build-client.mjs`：零依赖确定性拼接，`--check` 逐字节比对；生成物 `client.js` 入库。
- 测试：`test/unit/core.test.js`、`test/unit/paths-escape.test.js`、
  `test/integration/fake-host.test.js`（真 http + 假 Cordis ctx）、
  `test/integration/client-panel.test.js`（vm 加载 `client.js` 渲染面板）、
  `test/integration/degraded.test.js`（`/health` 503、未知异常、SSE ping/断开）。

#### Changed

- `package.json`：`exports["./client"]` 指向 `./client.js`，`files` 纳入 `client.js`，
  新增 `engines.node >=22.19.0`、`build:client`/`build:client:check`，`check`/`verify` 串上构建校验
  （D-05-02、D-05-05 关闭）。
- `locale/en.json`、`locale/zh.json` 扩为 `meta` + `ui` + `error` 三段（40 个 UI key、全部 `E_*` 文案，
  中英 key 集合一致）；客户端字典由构建脚本从同一份 JSON 内联，Host 文案同源。
- 文档：05 §4 改为「已落地」的实际构建契约，新增 §6.7 安装与联动实测记录（`install_bundle` 四轮尝试的
  原文摘要与归因、`link:` 安装方式、5807 取证受限、替代证据与人工两步）；07 §2.1 M1 按证据勾选。

#### Fixed

- `/health` 在真实 Cordis 上下文里 500：`ctx.app?.version` / `ctx.dsh?.version` 访问未 `inject` 的
  Service 键会抛错，被 `asReadingError` 折成 `E_IO`。改为 `probe()` 逐个安全读取（`dshVersion` 缺失
  回落 `'unknown'`），`/health` 任何字段都不得因宿主差异变 500；分派器对非 `ReadingError` 的 cause
  写 `ctx.logger.warn`，wire 仍不泄漏内部信息。回归用例：访问即抛的 Proxy ctx。
- 面板在 `/health` 失败时把整站判死：`overlay.js` 的 `loadHealth().catch` 不再写
  `status/storage: 'unavailable'`，只记 `lastError`（health 只是诊断探针）。回归用例：
  `/health` 500 时仍渲染空书库与 `0 本书`。

#### Known issues

- 插件已装入 `desktop` profile（`link:D:/Qunar/personal/dsh/dsh-reading-lab`，Junction 指向仓库），
  重启后**已加载并可点开**（2026-11-19 22:20，端口 2728）：侧栏出现「阅读实验室」，点击切主区、
  空书库文案正确，截图见 `assets/m1-panel-empty-state.png`；Host 侧 `GET /books`、`/agents` 200，
  `/events` 首帧 `hello` 已抓到。此前四轮 `install_bundle` 失败分别来自 profile 的
  `minimumReleaseAge` 闸门、镜像不可达与一次 `dsh-mobile-tailcat-win32-x64` 的瞬时占用
  （原文见 05 §6.7）。
- `M1-13`、`E-M1-a` 记为**部分通过**：缺 03 §3.2 第③步「切回其它面板再切回」与带票据 Console
  空白截图（本机无 CDP）；`M1-19`（卸载后图标消失）、`E-M1-d`（新会话工具列表）仍需人工看一眼。
- 本次修的两个缺陷要**再重启一次 DSH** 才在运行中生效（`link:` 安装，改文件后重启即可，无需重装）。

### M2 导入与解析（v0.1.0 开发中，EPUB）

#### Added

- 零依赖解析链：`src/host/zip.js`（EOCD/中央目录/本地头、`inflateRawSync`、zip 炸弹与 zip-slip 防护）、
  `src/host/xml.js`（宽容 XML）、`src/host/parse/text.js`（XHTML → 文本、`[图：alt]`、NFKC、控制字符）、
  `src/host/parse/epub.js`（`container.xml` → OPF → spine → nav/NCX TOC、`validateEpubContainer`）、
  `src/host/chunk.js`（目标 1000 / 上限 2000 / 下限 100，块 id `c-000001`，章节内码点偏移）。
- `src/host/import.js`：魔数判定 → 容器校验 → sha256 去重 → 原子落盘 `source.epub` → 解析 → 写
  `chunks.json` / `meta.json` → 更新 `index.json` → 发布 `book` 事件；失败保留 source 与 `status:failed`
  + `import.log`（NDJSON），供 `POST /books/:id/retry` 重试。
- 书库 CRUD：`books.js` 实现 `get/list/listChunks/getChunk/rename/remove/retry`，索引缺失或损坏时按
  `books/<bookId>/meta.json` 重建（重启持久化）；`routes/books.js` 实现裸字节上传（`?name=`、超限即断）、
  `PATCH`/`DELETE`/`retry`；`routes/content.js` 实现 `chunks` 列表与单块（`prev`/`next`）。
- GUI 导入：面板 header 与空态按钮唤起隐藏 `<input type="file" accept=".epub,.pdf">`，上传后刷新书库并
  选中新书；上传中按钮禁用，失败显示 `error.<CODE>` 文案。
- 测试：`test/unit/epub.test.js`（10）、`test/unit/chunk.test.js`（10）、
  `test/integration/import.test.js`（11，含磁盘结构、去重、坏包、重启、删除），
  以及 `client-panel.test.js` 的 GUI 导入用例（隐藏 input → POST → 列表刷新）。

#### Changed

- 03 §6.3 增加「M2 实现记录（as built）」：`jszip`/`fast-xml-parser` 未引入，改零依赖实现；PDF 分支
  返回 `E_UNSUPPORTED{reason:'pdf-pending'}`，留给后续里程碑。
- 07 §2.2 M2 按证据勾选（EPUB 侧 11 项通过、5 项部分、PDF 3 项未开始），并注明字段名以 03 §5.2/§5.3 为准。

#### Known issues

- PDF 导入、扫描版检测未实现（`M2-04`~`M2-06`、`E-M2-a` 的 PDF 部分）。
- 进度事件未细分 `created/progress/ready/failed`（`M2-17`）；面板缺「重试/删除/查看日志」出口（`M2-18`）、
  首字封面与时间列（`M2-19`）、拖入/进度条/取消（`M2-20`）、Delete 确认（`M2-22`）。
- `npm test` 中 `DOC-06-11`（夹具清单）因并发 teammate 的未跟踪夹具 `test/fixtures/map-500.json` 未登记而
  失败，与本功能无关；t8 相关 37 条用例全绿。

### M3 导图画布（v0.1.0 开发中，只读渲染）

#### Added

- `src/client/svg.js`：纯函数渲染层（IIFE 全局 `SVG`）——500 节点树索引/校验（重复 id、缺失 layout、
  几何越界）、`buildScene`（展开/收起、选中、视口裁剪）、`cullScene`、`navigate`/`ancestorsOf`、
  文本测量/截断/换行、`zoomAt`（指针锚点）、`fitView`、`edgePath`（三次贝塞尔）。
- `src/client/views/canvas.js`：`VIEWS.Canvas`/`CanvasSurface`/`CanvasNode`/`CanvasState`。分层分列卡片树、
  贝塞尔连线（选中节点出入边高亮）、书籍封面根卡（书名首字+作者，meta 无封面字段）、节点卡标题/摘要/
  引用角标/层级色条、拖拽平移、滚轮指针锚点缩放、`+`/`-`/`0`/`f`、适应窗口、点选高亮、双击展开收起、
  搜索定位（Enter 循环命中并展开居中）、键盘树导航与 roving tabindex、每书视口持久化
  （`localStorage['reading-lab:view:<bookId>']`）、rAF 合并重绘、>300 节点视口裁剪。
- 空态/加载态/无图态/错误态（含 `E_MAP_INVALID` 与重试按钮）覆盖；全部样式只用 `--dsw-alias-*` 与
  `currentColor`，明暗主题由 token 切换。
- `scripts/gen-map-fixture.mjs` + `test/fixtures/map/map-500.json`（500 节点、499 边、depth 3、
  layout 2296×31192、993 条引用，`--check` 字节级比对）；`scripts/preview-canvas.mjs` 用真实 DSH token
  渲染 9 个预览页供截图。
- 测试：`test/unit/svg.test.js`（24）、`test/integration/canvas-render.test.js`（10），覆盖 500 节点
  两两不重叠、收起/裁剪、缩放锚点、状态文案、CSS token 合规与 transform 有效。

#### Changed

- 03 §4.5 增补实现裁决：适应窗口允许大图缩到 2%，滚轮/按钮/键盘仍限 25%–200%。
- 06 §3.1/§5 登记导图夹具生成器与目录；07 M3-09 按证据勾选。

#### Known issues

- 滚轮缩放与 p95 帧率未做自动化性能采样（归 M3-10/11 与 t11）。
- 500 节点总览在 2.5% 下摘要不可读，属预期；已另存 90% 局部截图。
- 视觉验证用预览页 + Chrome headless 截图，未在真实宿主面板内点按滚轮（宿主无 CDP）。

### Fixed

- 2026-11-20（t28）导入/导出 API 与 04-api 对齐：`POST /books/import` 的 `name` 改为必填（缺字段/空串 → 400 `E_BAD_REQUEST{field:'name'}`，含 `..`/分隔符 → 400 `E_PATH`，校验先于读取请求体、失败不落盘）；`GET /exports` 与 `GET /exports/:name` 真正实现（此前桩里调用了未 import 的 `notImplemented`，抛 `ReferenceError` 后折成 `E_IO` 500）——空目录 200 + 惰性创建 `reading/exports/`、按 mtime 降序、下载带 Content-Type/Disposition、越界 400 `E_PATH`；`POST /books/:id/export` 统一 501 `E_UNSUPPORTED{availableIn:'0.2.0'}` 并在文案里说明 v0.2 提供，`/health.capabilities.exports` 同步改为 `[]`（不再「声称支持却 501」）；`toWireError` 支持显式 message 优先。新增 `test/integration/route-contract.test.js`（16 条）。
- 2026-11-20（t27）Client 样式曾引用 6 个主题里不存在的别名（--dsw-alias-bg-primary、--dsw-alias-separator-primary、--dsw-alias-border-l、--dsw-alias-border-secondary、--dsw-alias-label-inverse、--dsw-alias-label-error），浏览器静默回落导致深色主题下边框与文字不可读。现全部换成真实 token（g-layer-1、order-l1、order-l2、label-primary-inverted、state-error-primary），主按钮文字改 label-primary-inverted（浅色 ≈17.9:1、深色 ≈11.2:1）。新增 	est/unit/theme-tokens.test.js：内嵌 138 个真实别名白名单，扫描 src/client/**/*.js，禁止不存在的 token 与 styles.js 里的硬编码颜色。

### 合并与 v0.1 范围（2026-11-20）

- 合并 t28 API 契约对齐 `8635a92`（导入 `name` 必填与路径校验、`GET /exports` 实现、导出 501 与 health 能力一致、越界 400），含 `test/integration/route-contract.test.js` 16 条；`npm run verify` 235 tests / 196 pass / 0 fail / 39 todo。
- 合并 t27 主题 token 修复 `70194bb`；合并 QA-11-01 修复 `4ed4015`（`ctx.get` + 多 workspace 默认根），合并提交 `af0a58f`。
- **v0.1 范围收窄**：v0.1 = M1 面板壳 + M2 EPUB 导入 + M3 导图与只读画布；PDF（FR-05）与卡片详情/引用跳转（FR-09）移至 v0.2（t13/t14），验收项保留并标版本。同步修订 02 §6/DR-04/AC、07 §2/§3.0/§9、03 D-03-13/§12.4/§13、04 §2.3、06 §6/§8.1；新增 [09 QA 记录](docs/09-qa-v0.1.md)。
- 设计约束：Host 访问可选服务必须 `ctx.get(name)`，禁止直接属性访问（D-03-13）；`workspaceRoot` 解析顺序与 `src/host/config.js` 对齐。
- 当前版本仍未发布：v0.1 安装冒烟、手工 AC、性能与无障碍需在收口轮重跑（09 §7、07 §9）。

### Changed

- 2026-11-19 开发前文档门禁：统一 FR-11/DR-07 的提问注入机制为 `agent.followup`；修正 03 §12.3/§12.4 的夹具路径、夹具数量与 AC 映射；修正交叉引用、MAN 用例关联编号与 07 的 Q 编号；关闭 D-05-01/03/04 与 D-06-01/02/03/06。
- README 状态更新为「文档就绪、代码 M0」，文档表补齐 07/08 与索引。

### M4 PDF 导入与研究笔记（v0.2 开发中，2026-11-20 / t13）

#### Added

- `src/host/parse/pdf.js`（约 980 行、零依赖）：对象扫描（不看 xref）、`/ObjStm` 展开、`FlateDecode`/`ASCIIHexDecode`、页面树、`/ToUnicode`（bfchar + bfrange）、文本算子 `BT/ET/Tf/TL/Td/TD/Tm/T*/Tj/'/"/TJ`；行聚类按 y（容差 `max(2, size*0.5)`）、CJK 不补空格、1.8 倍行距分段、行尾连字符拼接；`/Outlines` 章节（无 outline 每 20 页一段）；页眉页脚剔除；扫描版采样判定；`validatePdfContainer` 五条落盘前错误（not-pdf / encrypted / no-catalog / no-pages / dangling-pages）。
- `src/host/notes.js`：`renderNotesMarkdown` / `parseNotesMarkdown` / `validateNotes` / `readNotes` / `writeNotes` / `notesContext`；五节标题、`[[c:NNNNNN]]` 引用、空节固定文案、200 KB 上限、未知引用整份拒绝。
- HTTP：`GET /books/:id/notes` 返回 `{updatedAt, markdown, sections:[{title,body}], parseError?}`；`PUT` 仍是 501 `E_UNSUPPORTED{feature:'notes.write', availableIn:'0.3.0'}`。
- 工具：`reading_notes` 的 `context|write|read` 三动作接线（`timeoutMs 60000`，只读动作 `isConcurrencySafe`），`write` 失败返回 `rejected[{path:'sections.<节名>', code, message}]` 且不落盘。
- Client：`src/client/views/notes.js`（只读五节 + 引用徽标 + 术语表表格 + `parseError` 警告），书库头部「研究笔记」入口；`api.getNotes`、`store.notesOpen`。

#### Changed

- `chunk.js` 接受 `{text, page}` 段落、`chunk.page` 取起始段落页码、`stats.pages` 记录真实页数；`import.js` 对 PDF 走 `validatePdfContainer` + `parsePdf`，删掉 `E_UNSUPPORTED{pdf-pending}` 桩。
- 03 §6.4 补「M2 实现记录（as built）」：零依赖偏差、能力边界、页码口径、扫描判定；05 §1.3 依赖表改为「三个依赖均未引入」并给出替代实现，§7.5 新增两条 PDF 症状；07 M2-04..06 与 M4-01/02 按证据勾选，M4-03/04 标 `[~]`。

#### Known issues

- `pdfjs-dist` 未引入，加密流、LZW/DCT 滤镜、线性化/增量更新不支持（03 §6.4 已登记）。
- `POST /books/:id/actions/generate-notes` 仍为 501（v0.3）；v0.2 的重生成路径是 Agent 再调一次 `reading_notes action=write`。
- `reading_notes context` 的 `sections` 过滤参数未实现（04 §5.4 已注明）；M4-05 的「失败后可重试」按钮随 generate 端点一起做。
- 面板只读、未在真实宿主里点击验证（GUI 需启动票据、Electron 无 CDP，见 05 §6.7）；证据以 `pdf.test.js` / `notes.test.js` / `pdf-notes.test.js` 与 `npm run verify` 为准。

### M4 卡片详情与引用跳转（v0.2 开发中，2026-11-20 / t14）

#### Added

- `src/client/views/detail.js`（约 650 行）：右侧 360px 覆盖层详情卡（顶部 64 / 右 16 / 底部 64，绝对定位不挤压画布），显示标题、面包屑、摘要、引用列表（chunkId、章节/页码、两行原文、`aria-pressed` 选中态）、追问建议、原文预览、更新时间与工具栏（复制正文、复制引用 `[c-id] 原文…`、询问 AI、关闭）。
- 引用跳转：点引用后一次批量请求 `/books/:id/chunks?ids=…`，展示对应 chunk 原文并高亮 3 s（`DETAIL_FLASH_MS=3000`，`rl-detail__chunk--flash` 带品牌色内描边）；chunk 缺失或请求失败时该条不渲染为链接，标「引用失效」，不跳书首。
- 画布联动：`detailOpen` 且选中卡落入抽屉安全区时，画布按需向左平移（不改缩放），保证详情不遮挡选中卡；详情打开不改变画布宽度。
- `scripts/preview-canvas.mjs` 增加 detail / detail-cite 两种预览（浅色 + 深色共 4 张），截图归档 `assets/m4-detail-light.png`、`m4-detail-cite-light.png`、`m4-detail-dark.png`、`m4-detail-cite-dark.png`。
- `test/integration/detail-render.test.js`（11 条，带状态 React 替身）：详情结构、仅 token CSS、点引用高亮、失效引用、复制与 Esc、chunks 缺失不崩溃、map 缺失/错误、与画布并存无抖动、详情打开时平移选中卡。
- locale zh/en 新增 `detail.*` 一组键（面板标签、类型、引用、追问、工具栏、时间、原文、加载/错误），`detail.empty.*` 改为「没有选中卡片」语义。

#### Changed

- `src/client/views/canvas.js`：新增详情安全区平移 effect（`detailPanRef` 记录已处理状态，用户手动平移后不反复抢回）。
- 07 M3-13..16 勾选并附证据，M3-17 标 `[~]`；06 FR-09 行补测试文件与状态；`client.js` 重建为 138,216 B / 12 parts。

#### Known issues

- 真实宿主中尚未点验（详情由 `detail-render.test.js` 与预览截图取证）。
- M3-17 的大列表虚拟化未做：详情只需渲染 1–3 条引用与 0–3 条追问；200 节点详情首屏耗时未专项测量。

### M4 导出 Markdown / OPML / JSON（v0.2 开发中，2026-11-20 / t16）

#### Added

- `src/host/export/format.js`：格式表（`md`/`opml`/`json`）、Markdown/XML 转义（引用 `[c-000123]` 原样保留）、
  文件名净化（60 码点、去 `<>:"/\|?*`）、`yyyyMMdd-HHmmss` 时间戳与重名 `-2`…`-99` 分配。
- `src/host/export/markdown.js` / `opml.js` / `json.js`：三种渲染器。Markdown = 书名 + 元信息 +
  `## 导图大纲`（缩进 2 空格、摘要 `>`、引用 `[c-id](reading://…)`）+ `## 研究笔记`（去掉 meta 行）+
  可选 `## 问答精选`；OPML 2.0 递归 `<outline text _note _citation>`；JSON = `{schemaVersion,exportedAt,
  generator,book:{meta,chunksIndex},map,notes,threads?}`，`map` 与 `map.json` 逐字段一致。
- `src/host/export/index.js`：`ExportService.create` —— 格式闸门（`html` 501 / `png` 400 / 未知 501）、
  `books.enqueue` 串行、只读输入、`.part` + rename 原子写、`hub.publish({type:'export'})`。
- HTTP `POST /books/:id/export` 由 501 改为真实生成；`/health.capabilities.exports` 改为
  `["md","opml","json"]`（与实现取交集）。
- `reading_export` 工具：`checkExportArguments` 自校验、`{ok:true,data}` 信封、两行 render（路径 + 格式/大小/含问答）。
- Client：顶栏「导出」下拉（Markdown/OPML/JSON 三项、无书或导出中禁用）、成功后显示「已导出 <name>」；
  `api.exportBook`、`store.exporting/lastExport`、8 个 `ui.export.*` 键、仅 token 的 `.rl-export*` 样式。
- 测试：`test/unit/export.test.js`（8）、`test/integration/export-route.test.js`（6）、
  `test/integration/export-render.test.js`（3）。

#### Changed

- 旧断言同步（v0.1 曾要求「导出 501 + capabilities 空数组」）：`degraded.test.js`、`fake-host.test.js`、
  `route-contract.test.js` 改为断言三格式与 501/400 的版本边界；`placeholders.test.js` 删除已实现的
  `UT-EXP`/`IT-EXP` todo。
- 04 §3.5/§4.2 #1/#22 与 06 FR-13/C-12、07 M4-16..20 按实现更新；`client.js` 重建为 189,832 B / 12 parts。

#### Fixed

- `.rl-export__menu` 原用不存在的 `--dsw-alias-shadow-l2` + `rgba()`，触发「无硬编码颜色」测试；
  改为 `box-shadow: 0 0 0 1px var(--dsw-alias-border-l2)`。

#### Known issues

- 导出 JSON 的结构沿用 03 §9 的 `map` 原样嵌套（`root`/`layout`），与 07 M4-17 文字的扁平
  `nodes`/`edges` 不同；仓库尚无 `schema/export-v1.schema.json`，schema 校验由逐字段断言代替（D-16-02）。
- 面板无「重试」按钮与导出进度，失败只写 `lastError`（M4-20 标 `[~]`）；XMind 实机导入 OPML 仍属手工验收。

### M4 询问 AI 浮层（v0.2 开发中，2026-11-20 / t15）

#### Added

- `src/host/threads.js`：`threads.json` 存储（`t-01`/`m-01` 递增、`state=idle|running`、
  消息 `status` 与 `citations`、`feedback`、`error`），所有读改写经 `BookService.enqueue` 串行；
  原子写 + `meta.threadsUpdatedAt` + 索引摘要 + SSE `thread` 事件。
- `src/host/ask.js`：`composeAskContext`（书名/作者/章节路径/节点摘要/3–5 条原文，≤6000 字，
  无选中给全书概览）、`buildAskPrompt`（首行隐藏标记 + 中文与 `[c-000123]` 引用要求）、
  `AskService`（提问入队、同线程串行、幂等键、5 分钟超时兜底、`session/event` 回写、停止、反馈）。
- HTTP：#17–21 由桩改为真实实现，新增 #26 `POST .../messages/:messageId/feedback`（路由总数 26→27）。
- Client：`views/ask.js` 重写为真实浮层（标题与节点范围、五项快捷指令、线程消息与引用 chip、
  追问建议、👍👎、运行中显示「停止」、无 agent 时提示并禁用）；`api.js` 新增七个线程方法。
- locale zh/en 的 `ask.*` 由 5 个键扩到 29 个；`styles.js` 新增浮层与 chip/cite 样式（只用 `--dsw-alias-*`）。
- 测试：`test/unit/threads.test.js`（9）、`test/unit/ask.test.js`（8）、
  `test/integration/ask-route.test.js`（6）、`test/integration/ask-render.test.js`（6）。

#### Fixed

- `views/ask.js` 用 `SVG.indexMap(...).byId[nodeId]` 取节点，但 `indexMap` 返回的是 `nodes`；
  任何有导图的书一打开浮层就抛 `TypeError`（`ask-render.test.js` 捕获后改为 `index.nodes`）。
- 线程降级原本每次读取都执行，进程内会把运行中的线程误判成 `idle`（运行中删线程不再 409）；
  改为每个 `BookService` 每本书只降级一次并写回（D-15-03）。
- 回写匹配原本只按 `agentId`，而 `session/event` 给的是 sessionId，导致回答永远回填不到线程；
  改为精确匹配失败后退「全局最早未消费记录」（D-15-04）。

#### Changed

- 03 §5.6 补 `feedback`/`error` 字段与约束；§8.3/§8.4 补实现注记。
- 04 §4.2 标注 #17–21 已实现、新增 #26 规格；#20 的 `E_AGENT` 由 422 更正为 502（与 `ERROR_HTTP` 一致）。
- 06 FR-11/FR-12/FR-15 行与 07 M4-06..M4-15 按证据勾选/标注；`client.js` 重建为 185,059 B / 12 parts。

#### Known issues

- 浮层内引用只展示不可点（M4-15 未做）；Esc 关闭、焦点陷阱、与详情抽屉互斥未做（M4-13 标 `[~]`）。
- 停止只做「标 `stopped` + 忽略后续回答」，未调 `agent.cancel`。
- 「引导式学习」是一次性提问模板，不是 v0.3 的学习路径（D-15-01）。
- 真实宿主上的「有 agent 但模型未配置/断网」路径未端到端复现；qa-v01 即属此类（见 t29 记录）。

### M3 生成状态消费（v0.1.0 开发中，2026-11-20 / t30）

#### Added

- 画布顶部生成进度条与状态文案（pending/running），无图时中央进度卡、有图时右上角 pill；
  「已耗时」每秒刷新（`m:ss`，超 1 小时 `h:mm:ss`）。
- 失败卡：按 Host `reason` 映射中英文案（含 timeout 的超时上限与「已耗时」），
  「查看详情」展开/收起 `message`，「重试」重发 `POST actions/generate-map`；
  无图空态新增「生成导图」主按钮（`data-generate-map`）。
- `src/client/views/canvas.js` 生成状态引擎与 `useCanvasGeneration`；复用 overlay 的
  EventSource 消费 `progress`/`map`，并在 `hello`/`onError` 时补读状态。
- `test/integration/generation-render.test.js`（9 条）：挂载兜底、生成按钮、进度/计时、
  失败原因与重试、重试回 running、`map` 事件后旧图不闪白再替换、hello 重连、reason 映射、
  仅 token CSS。

#### Changed

- `map` 事件到达后清缓存并重取 `/map`，新图落定才切换；请求失败保留旧图。
- locale zh/en 新增 22 个 `canvas.generate.*` 键；`client.js` 重建为 178,266 B / 12 parts。
- 07 M3-07 勾选并补证据（真实宿主端到端联调仍归手工）。

#### Known issues

- 进度条是不确定态（Host 的 `done/total` 固定 0/0）；生成状态仅存内存，刷新后靠状态查询补读。
- 失败卡在真实窗口的浅/深主题截图未归档，视觉以结构 + token 断言取证。
