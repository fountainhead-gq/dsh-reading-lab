# Changelog

本项目的所有重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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

### Changed

- 2026-11-19 开发前文档门禁：统一 FR-11/DR-07 的提问注入机制为 `agent.followup`；修正 03 §12.3/§12.4 的夹具路径、夹具数量与 AC 映射；修正交叉引用、MAN 用例关联编号与 07 的 Q 编号；关闭 D-05-01/03/04 与 D-06-01/02/03/06。
- README 状态更新为「文档就绪、代码 M0」，文档表补齐 07/08 与索引。
