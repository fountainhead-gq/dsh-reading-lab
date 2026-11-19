# 07 里程碑与验收清单

> 状态：**生效**（Owner：qa/docs；评审：架构 + 核心工程）
> 适用版本：v0.1.0 起。最近更新：2026-11-19。

这份清单把 [02-requirements](02-requirements.md) 的范围与验收、[03-design](03-design.md) 的里程碑、
[04-api](04-api.md) 的契约落成**可勾选项**。它不引入新需求：任何一条都能回溯到 02/03/04。

---

## 0. 用法与图例

### 0.1 何时用

| 场景 | 用哪一节 |
|---|---|
| 开始一个里程碑 | §2/§3/§4 对应小节，把 `[ ]` 复制进 PR 描述 |
| 提交代码前 | §1 通用 DoD + §5 文档更新检查 |
| 合并 `dev → main` 前 | §2.4 / §3.2 / §4.2 的出口判定 + §9 发布门禁 |
| 发布后 | §8 安装验证（在干净环境再走一遍） |
| 发现与文档不一致 | §10 偏差表 |

### 0.2 勾选规则

- `[ ]` 未开始 · `[x]` 已完成（有证据）· `[~]` 进行中 · `[!]` 阻塞（写原因）。
- **没有证据的 `[x]` 视为未完成**。证据是三者之一：
  1. 命令 + exit code（例如 `npm run verify` → 0）；
  2. 截图/录屏（放在 PR 描述或 `docs/assets/`，大文件不提交）；
  3. 可复现的 URL + 操作步骤（本机 DSH GUI）。
- 每条只由**非实现者**勾「验收类」项（标 `AC` 的）；实现者勾「实现类」项。
- 出口判定（§2.4/§3.2/§4.2）必须全绿，不接受「大部分完成」。

### 0.3 编号

- `M<milestone>-<nn>`：实现/验收项，例如 `M2-07`。
- `D-05-xx`：与本清单/05 相关的偏差，见 §10。
- `AC-xx` / `FR-xx` / `NFR-xx`：02 的权威编号；03 §12.4 的旧映射见 D-05-01。

---

## 1. 通用 DoD（每个 PR 都过）

- [ ] D-01 只改自己 owner 的文件；跨 owner 改动已在 PR 里 @ 对方并获同意（03 §2.2、05 §8）
- [ ] D-02 没有新增运行时依赖；若新增，已在 03 §6 / 04 §2 记账并附体积与许可证
- [ ] D-03 `npm run check` exit 0（含 `client.js` 的语法检查，D-05-02 落地后）
- [ ] D-04 `npm test` exit 0；新增/修改的行为有对应单测（纯函数优先）
- [ ] D-05 错误路径有测试：非法输入、缺文件、超限、损坏包、路径逃逸（04 §7）
- [ ] D-06 用户可见文案走 `locale/{en,zh}.json`，无硬编码中文/英文（NFR-07）
- [ ] D-07 样式只用 `--dsw-alias-*` 与 `currentColor`；亮暗两套都看过（NFR-08）
- [ ] D-08 文件写入走 `resolveInReading()` + 临时文件原子替换（03 §5.8、NFR-03）
- [ ] D-09 日志不含书正文与用户提问原文（NFR-05）
- [ ] D-10 文档与代码同一提交：改了什么就更新对应文档（§5）
- [ ] D-11 `CHANGELOG.md` 的 `Unreleased` 有对应条目
- [ ] D-12 `git status` 只含预期文件；没有 `reading/`、`exports/`、`*.log`、夹具大文件混入

---

## 2. v0.1.0（M1–M3）

范围：EPUB/PDF 导入、分块、带引用导图、画布、详情与引用跳转、错误恢复（02 §8.1）。
对应 FR-01..09、FR-15；AC-01..04、AC-08、AC-09。

### 2.1 M1 骨架

出口（03 §13）：入口装配完成、`/health` 200、书库空态可渲染、panellist ↔ main 联动、store/api/样式就位。

**装配与 Host**

- [x] M1-01 `src/host/index.js` 的 `apply` 只做装配：`inject = ['webServer','tools','systemPrompt','agents']`，按顺序注册路由、SSE、工具、提示节（04 §2） — 证据：`test/integration/fake-host.test.js`「入口导出符合 04 §2.1」（`inject` 深比较、单条 `prefix` 路由、六工具、一段提示）
- [x] M1-02 `config.js` 暴露 04 §2.2 的 8 个键与默认值；未配置时用默认值，不抛错 — 证据：`test/unit/core.test.js`（默认值、非法值回落、`exportFormats` 白名单过滤）
- [x] M1-03 `workspaceRoot` 解析顺序为 config → `workspaceRegistry` 默认 → `process.cwd()`；只读工作区返回 `E_IO`/503 而不是崩溃（04 §2.3） — 证据：`core.test.js`（`resolveWorkspaceRoot` 丢 `E_IO`）+ `test/integration/degraded.test.js`（`storage.available:false` → `/health` 503 且 body 带 `data`）
- [x] M1-04 `GET /dsh-reading-lab/api/v1/health` 返回 `{ok:true,data:{pluginVersion,apiVersion,dshVersion,storage,workspaceRootName,capabilities}}`；`storage:"unavailable"` 时 503 且 data 仍在 — 证据：fake-host「GET /health 返回 200 与能力清单」+ degraded「返回 503，body 同时带 data 与 error」
- [x] M1-05 路由前缀 `kind:'prefix'`、路径 `/dsh-reading-lab/api/v1`；重复注册抛错（03 §10.1） — 证据：fake-host 断言 `kind/path`；重复注册由宿主 `ctx.webServer` 抛 `duplicate prefix route`（`apply` 的 dispose 会释放，见「dispose 后路由清零」）
- [x] M1-06 `GET /events` SSE：首帧 `event: hello` + `data:{revision,books}`；15 s ping；60 s 无写断开；`Cache-Control: no-store`（04 §6.2） — 证据：fake-host 首帧断言；degraded 断言 `: ping` 注释帧与 guard 断开分支（正常节奏下 ping 会刷新 `lastWrite`，该分支只在定时器被挂起后补跑时触发，已在 `sse.js` 注释说明）
- [x] M1-07 统一错误信封 `{ok:false,error:{code,message,details?}}`；未知异常映射 `E_IO` 且不泄露堆栈（04 §7） — 证据：`core.test.js`（`toWireError`）+ fake-host（400/404/405/501）+ degraded「未知异常映射成 E_IO，且不泄露 message/堆栈」
- [x] M1-08 `limits.js` 常量与 02 一致：100 MB / 2000 页 / 50 M 字符 / 20000 块 / 块 800–1500（硬 2000，下限 100） — 证据：`core.test.js`
- [x] M1-09 `paths.js` 的 `resolveInReading()` 拒绝 `..`、绝对路径、盘符、symlink 逃逸、Windows 保留名；有单测 — 证据：`core.test.js`（字符串层）+ `test/unit/paths-escape.test.js`（junction 逃逸 → `E_PATH` / `symlink-escape`）
- [x] M1-10 `json-file.js` 提供原子读/写（tmp + rename）与 `schemaVersion` 校验；有单测 — 证据：`core.test.js`（缺文件 `null`、坏 JSON `E_IO`、版本不符 `E_SCHEMA`）
- [x] M1-11 stub 统一返回 `E_NOT_IMPLEMENTED`（HTTP 501 / 工具错误），不返回假数据（03 §2.4） — 证据：fake-host（`/books/:id` 501 + `details.module`、`POST /books/import` 501）；`core.test.js`（六个工具 `execute` 抛 `E_NOT_IMPLEMENTED`）

**Client 与槽位**

- [x] M1-12 `main` 槽位注册 `key:'reading-lab'`；`sidebar.panellist` 注册 `id:'reading-lab'`、图标与标签来自 locale（03 §3.1、DR-06） — 证据：`test/integration/client-panel.test.js`（用 vm 加载 `client.js`，断言两处注册参数与 `label` 取到「阅读实验室」）
- [!] M1-13 点侧栏图标 → `main` 切到阅读实验室面板；再点其它面板可切回；刷新后仍可用（03 §3.2 五步） — **阻塞（环境）**：`install_bundle` 两次失败（profile 锁文件/网络，见 05 §6.7），插件未加载到 5807，无法观察点击；注册参数已由 M1-12 的证据覆盖
- [x] M1-14 面板空态：标题、一句说明、「导入」按钮（禁用态可接受），无 console 报错 — 证据：`client-panel.test.js`（渲染出「书库还是空的 / 导入一本 EPUB 或 PDF / 导入第一本书 / 0 本书」，且 `console.error` 调用数为 0）
- [x] M1-15 `store.js` 提供面板级状态机（`empty|loading|ready|error`）与选中态；`api.js` 封装 04 的信封与错误码 — 证据：`src/client/store.js`（`status`/`selectedBookId`/`uiMode` + `subscribe`）、`api.js`（`ApiError` 与信封解包）；`client-panel.test.js` 走同一套 store
- [x] M1-16 `styles.js` 注入的面板样式只用 `--dsw-alias-*`；亮暗切换下无白块/黑块（NFR-08） — 证据：`client-panel.test.js` 扫描产物 CSS：无 hex/rgb/hsl、无 `prefers-color-scheme`，且含 `var(--dsw-alias-`；亮暗实看随 M1-13 一并阻塞
- [x] M1-17 i18n：`locale/en.json`、`locale/zh.json` 的 key 集合一致；`meta.title/description` 中英齐全 — 证据：`core.test.js`（`ui` 段中英 key 集合相等 + `meta` 非空）；CT-PKG-04 亦覆盖顶层 key 一致
- [x] M1-18 构建：`npm run build:client` 生成 `client.js`，`--check` 通过；`package.json` 四字段已同步（D-05-02） — 证据：`npm run build:client` → `wrote client.js (37709 bytes, 10 parts)`；`npm run build:client:check` → `client.js is up to date (37709 bytes)`；`package.json` 四字段见 05 §4.4
- [!] M1-19 卸载/停用插件后侧栏图标消失、无残留请求；重装后恢复（05 §6.6） — **阻塞（环境）**：依赖一次成功的安装，见 05 §6.7

**质量门**

- [x] M1-20 `npm run check`、`npm run build:client:check`、`npm test` 全绿；skip 只在 `test/skip.txt` 且每条有 M2 清零计划 — 证据：`npm run verify` → 0（tests 118 / pass 79 / fail 0 / skipped 0 / todo 39，约 2.6 s；IT-BOOT-01 由 skip 转 pass，`test/skip.txt` 现为空）
- [x] M1-21 `npm pack --dry-run` 含 `src/`、`client.js`、`locale/*.json`、`icon.svg`、`cordis.patch.yml`、`README.md`、`LICENSE`，不含测试与夹具 — 证据：`npm pack --dry-run --json` → 44 文件 / 165 KB 包 / 446 KB 解包，无 `test/`、`scripts/`
- [x] M1-22 README 状态行改为「v0.1 开发中」；文档表补 07（05 已存在） — 证据：`README.md` 状态节与文档表
- [x] M1-23 `CHANGELOG.md` 记 M1 的 Added/Changed — 证据：`CHANGELOG.md` 的 `0.1.0 — M1` 小节

**M1 出口判定**

- [!] E-M1-a §3.2 的联动五步全过（手动，截图） — **阻塞（环境）**：同 M1-13；解除条件见 05 §6.7
- [x] E-M1-b `GET /health` 200，`data.capabilities.sse === true` — 证据：fake-host「GET /health 返回 200 与能力清单」
- [x] E-M1-c `npm run check` exit 0 — 证据：`npm run verify` → 0（§2.1 M1-20）
- [!] E-M1-d 新会话里能看到 `reading_*` 工具（即使返回 `E_NOT_IMPLEMENTED`） — **阻塞（环境）**：需要已加载的 Host；工具定义与注册已由 fake-host「注册了六个工具与一段系统提示」验证

### 2.2 M2 导入

出口（03 §13）：一本 EPUB + 一本文本 PDF 走完「导入 → 分块 → 列表 → 进度」；扫描版判 `unsupported`；
夹具与单测全绿；5 MB EPUB ≤ 2 s。

**解析**

- [ ] M2-01 EPUB：`container.xml` → OPF → spine 顺序；EPUB3 `nav`、EPUB2 `NCX` 双路径；标题/作者/语言取自 OPF（FR-04；03 §6.2）
- [ ] M2-02 EPUB：XHTML 白名单净化（去 script/style/iframe/远程资源/事件属性）；实体与编码正确（FR-04）
- [ ] M2-03 EPUB：非文本资源（图片/字体/音频）跳过但有计数；纯图片章节产生的空文本章节不生成块（FR-04）
- [ ] M2-04 PDF：`pdfjs-dist` legacy build，逐页 `getTextContent()`；行聚类 + 断词合并；页眉/页脚剔除（03 §6.3）
- [ ] M2-05 PDF：页码从 1 起、章节来自 outline（无 outline 用「第 N 页」分段）；加密/损坏分别映射 `E_ENCRYPTED`/`E_PARSE`
- [ ] M2-06 扫描版检测：首/中/末各 1 页（不足 3 页全取），平均有效字符 < 20 → `unsupported`；10 s 内给出结论（02 §3.4）
- [ ] M2-07 分块：目标 800–1500 字、硬上限 2000、下限 100、合并后不跨章节；全书 ≤ 20000 块；块 ID 为序号（FR-06；03 §6.4、D-03-05）
- [ ] M2-08 解析失败不留半成品：`status:failed`、写 `import.log`、删除临时目录、不生成 `map.json`（02 §5.3）
- [ ] M2-09 重复导入按 SHA-256 命中已有书：返回同一 `bookId`，不重复解析（02 §5.2）
- [ ] M2-10 单测覆盖：EPUB3、EPUB2+NCX、中文 PDF、英文 PDF、扫描版、损坏包、加密包、`bomb.epub`、`evil-zip.epub`、路径逃逸

**存储与接口**

- [ ] M2-11 落盘 `<workspace>/reading/books/<bookId>/`：原文件、`meta.json`、`chunks.json`、`import.log`（03 §5）
- [ ] M2-12 `meta.json` 字段与 03 §5.1 一致（`schemaVersion`、`bookId`、`title`、`author`、`format`、`status`、`chunkCount`、`createdAt`、`sourceSha256`、`parserVersion`…）
- [ ] M2-13 `chunks.json` 字段与 03 §5.2 一致（`chunkId`、`chapterPath`、`page`、`text`、`charCount`）
- [ ] M2-14 `POST /books/import?name=` 裸字节上传；超限 413 `E_TOO_LARGE`；`name` 缺失用 `untitled`
- [ ] M2-15 `GET /books`、`GET /books/:id`、`PATCH /books/:id`（重命名）、`DELETE /books/:id`（取消进行中 + 二次确认语义）、`POST /books/:id/retry`
- [ ] M2-16 `GET /books/:id/chunks` 支持 `from/to` 或 `chunkId` 过滤；未知 `chunkId` 404 `E_NOT_FOUND`
- [ ] M2-17 进度事件 `book/created`、`book/progress`、`book/ready`、`book/failed` 经 SSE 到达面板；断线重连后靠 `hello` 快照收敛（04 §6）
- [ ] M2-18 错误码与恢复动作符合 02 FR-15；面板给「重试/删除/查看日志」三种出口

**UI**

- [ ] M2-19 书库列表：封面用默认图（无封面时显示书名首字）、标题、作者、状态徽标（解析中/就绪/不支持/失败）、块数、时间（FR-02）
- [ ] M2-20 导入交互：选择文件、拖入、进度条、可取消；`unsupported` 与 `failed` 的说明可读且不堆栈
- [ ] M2-21 空态/加载/错误三态齐全；50 本书冷启动 ≤ 800 ms（NFR-01）
- [ ] M2-22 键盘可达：Tab 到列表项、Enter 打开、Delete 触发确认

**M2 出口判定**

- [ ] E-M2-a 夹具四种（EPUB3、EPUB2、中文 PDF、英文 PDF）全部导入 `ready`
- [ ] E-M2-b 扫描版夹具 → `unsupported`，面板可删除
- [ ] E-M2-c 5 MB EPUB ≤ 2 s；50 MB / 500 页 PDF ≤ 30 s（本机记录，写进 PR）
- [ ] E-M2-d 损坏/加密/超限各返回预期错误码，磁盘无残留目录
- [ ] E-M2-e `npm test` 全绿；`test/skip.txt` 已清零或只剩有计划的项

### 2.3 M3 导图

出口（03 §13）：真 agent 通过 `reading_map` 出图；坏 `chunkId` 被拒；画布 200 节点 p95 ≤ 33 ms；详情与引用可回跳。

**导图生成与校验**

- [ ] M3-01 `reading_map` 接收 `bookId`，返回图或结构化错误；未知书 404 `E_NOT_FOUND`
- [ ] M3-02 三段式：`outline`（书卡 + 章节骨架）→ `chunks`（按需取块）→ `commit`（整图提交）；中间态不落 `map.json`（03 §7.1）
- [ ] M3-03 校验：根为书卡、2–4 层、非根节点 1–3 条真实引用、叶摘要 40–120 字、每节点 1–3 条追问；未知 `chunkId` 拒该节点（FR-07）
- [ ] M3-04 整图失败重试一次；仍失败保留旧图并报 `E_CITATION`；`map.json` 原子替换（tmp + rename）
- [ ] M3-05 `nodeId = sha1(chapterPath + title)` 稳定；重复生成不改变已有 `nodeId`（D-03-06）
- [ ] M3-06 `map.json` 字段与 03 §5.3 一致（`schemaVersion`、`bookId`、`generatedAt`、`nodes[]`、`edges[]`、`stats`）
- [ ] M3-07 未生成导图时 `GET /map` 404 `E_NOT_FOUND`，面板显示「生成思维导图」按钮而非错误

**布局与画布**

- [ ] M3-08 `layout.js` 纯函数：tidy-tree，同层间距/子树不重叠；同输入同输出；首布局 ≤ 500 ms（NFR-01）
- [ ] M3-09 画布：SVG 卡片树、贝塞尔连线、层级配色、标题截断 + tooltip（03 §4.3）
- [ ] M3-10 平移/缩放 25%–200%（滚轮 + 按钮 + 键盘 `+/-`）；`0` 复位；`Esc` 关闭浮层/取消选中
- [ ] M3-11 200 节点 p95 帧 ≤ 33 ms；1000 节点可操作（v0.3 门禁）；不因选中重排整棵树
- [ ] M3-12 视口与选中在切换书/会话后保留（AC-05 的一部分）；刷新可恢复

**详情与引用**

- [ ] M3-13 点卡片 → 详情抽屉：标题、摘要、1–3 条引用、1–3 条追问（FR-09）
- [ ] M3-14 点引用 → 打开原文并高亮 3 s；跨章节/跨页可定位；不静默跳书首
- [ ] M3-15 引用失效（`chunkId` 不在 `chunks.json`）不渲染该条并标注「引用失效」；其余条目正常
- [ ] M3-16 详情里可复制引用文本；键盘可达（Tab 进抽屉、Esc 关闭）
- [ ] M3-17 大列表虚拟化或分段渲染；200 节点首屏 ≤ 500 ms

**M3 出口判定**

- [ ] E-M3-a 真 agent 对一本 EPUB 生成 ≥ 2 层、≥ 8 个节点的导图，叶卡均有引用
- [ ] E-M3-b 故意给错 `chunkId`，该节点被拒且错误可读；整图不被破坏
- [ ] E-M3-c 200 节点画布 p95 ≤ 33 ms（DevTools Performance 记录）
- [ ] E-M3-d AC-01、AC-02、AC-04 手工通过（记录步骤与截图）

### 2.4 v0.1.0 出口

- [ ] V1-a M1/M2/M3 的「出口判定」全绿
- [ ] V1-b AC-01（EPUB 全链）、AC-02（中文 PDF 抽检 5 段 + 页码回跳）、AC-03（扫描版）、AC-04（引用往返）、AC-08（双语与对比度）、AC-09（边界错误码）通过
- [ ] V1-c 02 §9.2 门禁 ①–⑤ 全过（见 §9）
- [ ] V1-d 新装环境按 §8 九步验证通过
- [ ] V1-e `CHANGELOG` 写 v0.1.0、版本号 0.1.0、README 状态更新
- [ ] V1-f `git tag v0.1.0` 并推送；`main` 与 `dev` 同步

---

## 3. v0.2.0（M4）

范围：研究笔记、询问 AI、线程、面板内右浮层、md/opml/json 导出、生命周期（02 §8.2）。
对应 FR-10..14；AC-05..07、AC-10。

### 3.1 M4 研究

**笔记**

- [ ] M4-01 `reading_notes` 读 `chunks.json` 与 `map.json` 生成 `notes.md`：固定五节（主题脉络/核心论点/术语表/阅读建议/开放问题）
- [ ] M4-02 每节有内容时 ≥ 1 条引用；无内容写「本书未形成该部分」；不编造引用
- [ ] M4-03 解析器容错：手工编辑后仍能按标题切节；未知小节保留原文并在 UI 标「未识别小节」
- [ ] M4-04 `GET /notes` 返回 Markdown 与解析后的结构；`POST /books/:id/actions/generate-notes` 触发重生成
- [ ] M4-05 重生成失败保留旧 `notes.md`，报 `E_AGENT`/`E_IO`，UI 提示可重试

**询问 AI**

- [ ] M4-06 上下文 = 选中节点摘要 + 3–5 条相关块（≤ 6000 字）+ 书名/作者/章节路径；无选中用全书概览（FR-11、03 §8.1）
- [ ] M4-07 注入走 `agent.followup`（`commands.execute` 不送模型，D-03-08）；消息 `source = {kind:'plugin', plugin:'dsh-reading-lab'}`
- [ ] M4-08 答案回写：订阅 `session/event` 的 `assistant/message`，按 `messageId` 关联到线程；重复回写幂等
- [ ] M4-09 同线程串行；`POST /ask/:threadId/stop` 取消；超时 `askTimeoutMs` 返回 `E_AGENT`
- [ ] M4-10 模型不可用（断网/未配置）时提示「模型不可用」，线程保留、可重试（AC-10）

**线程与浮层**

- [ ] M4-11 `threads.json` 按 `nodeId`（或 `book`）分组；消息字段 `id/role/text/citations/createdAt/status/messageId`（FR-12）
- [ ] M4-12 重启后线程恢复；同一 `messageId` 不重复注入；删除节点时其线程标记孤立而非丢失
- [ ] M4-13 面板内右浮层：宽 ≥ 360 px、可关闭、Esc 关闭、不遮挡侧栏；焦点陷阱正确（DR-07）
- [ ] M4-14 会话流留痕：同一问答在会话里可见（`conversation.chat.node` 投影或原生消息），引用可点
- [ ] M4-15 浮层内引用点击 → 原文定位；与详情抽屉不打架（同时只开一个）

**导出**

- [ ] M4-16 `md`：标题层级、引用块、五节笔记附录；`opml`：`<outline text>` 层级正确，XMind 可打开
- [ ] M4-17 `json`：含 `schemaVersion`，通过 `schema/export.schema.json`；含 `meta`、`nodes`、`edges`、`notes`、`threads`
- [ ] M4-18 文件名 `<书名>-<yyyyMMdd-HHmmss>.<ext>`；重名加序号；原子写；不改源文件（FR-13）
- [ ] M4-19 `GET /books/:id/exports` 列表 + `GET /exports/:name` 下载；`..`/编码绕过 400 `E_PATH`
- [ ] M4-20 导出失败报 `E_IO`，UI 可重试；导出过程不阻塞面板

**生命周期**

- [ ] M4-21 删除书：二次确认、取消进行中任务、删除 `reading/books/<id>/`；失败回滚提示（FR-14）
- [ ] M4-22 重命名只改 `meta.title` 与索引，不改目录名；导出文件名用新标题
- [ ] M4-23 重解析前备份 `map.bak.json`；失败可回滚

### 3.2 v0.2.0 出口

- [ ] V2-a M4 全部实现项 + M1–M3 回归通过
- [ ] V2-b AC-05（重启恢复）、AC-06（卡片追问→浮层→会话流→引用→线程）、AC-07（三格式导出 + XMind + schema）、AC-10（离线）通过
- [ ] V2-c 截图 1/2/3 的三个场景可复现（03 §1）
- [ ] V2-d 02 §9.2 门禁全过（含新增的 AC-06/07/10）
- [ ] V2-e 版本 0.2.0、`CHANGELOG`、README、tag 齐备

---

## 4. v0.3.0（M5）

范围：导图编辑与变更审阅、HTML/PNG/SVG 导出、引导式学习、搜索/小地图、多章并行、i18n/a11y 收尾（02 §8.3）。

- [ ] M5-01 节点编辑：标题/摘要就地编辑，校验同 M3-03，保存即原子写 `map.json`
- [ ] M5-02 重生成产生 diff：新增/删除/修改三类，审阅后接受或回滚（`map.bak.json`）
- [ ] M5-03 变更审阅 UI：并排或列表，键盘可达；未审阅不覆盖旧图
- [ ] M5-04 `html` 导出：单文件、内联样式与 SVG、无远程资源、离线可开
- [ ] M5-05 `png` 导出：Client 侧离屏 SVG → canvas → blob，2x 清晰度，背景用主题 token
- [ ] M5-06 `svg` 导出：去掉交互属性，保留层级配色
- [ ] M5-07 `reading_tutor` 实现：引导式提问（每次 1 问 + 依据引用），不替代 `reading_ask`
- [ ] M5-08 搜索：书名/节点标题/摘要/引用文本；结果可跳转并高亮
- [ ] M5-09 小地图：> 100 节点时出现，拖拽视口，性能不回退
- [ ] M5-10 多章并行生成：并发上限 2，失败隔离，进度分别可见
- [ ] M5-11 i18n 收尾：中英 100% 覆盖，无拼接串，日期/数字本地化
- [ ] M5-12 无障碍收尾：键盘全操作、焦点可见、`aria-label`、画布 Tab + 方向键、对比度 ≥ 4.5:1
- [ ] M5-13 1000 节点可操作（p95 ≤ 33 ms 或降级策略生效）
- [ ] M5-14 性能全部指标复测（§6）并记录
- [ ] M5-15 文档全量复核：01/02/03/04/05/06/07 与实现一致；03 §12.4 的 AC 编号已修正（D-05-01）
- [ ] M5-16 安全复核：路径、XHTML、引用、导出文件名、SSE 头
- [ ] M5-17 v0.3.0 发布：门禁 + tag + Release + 干净环境安装验证

### 4.1 v0.3.0 出口

- [ ] V3-a 「编辑 → 重生成 → 审阅 → 回滚」闭环可用
- [ ] V3-b 1000 节点可操作；四种导出（md/opml/json/html/png + svg）可用
- [ ] V3-c 中英双语与键盘走查通过（AC-08）
- [ ] V3-d AC-01..10 全部通过
- [ ] V3-e 02 §9.2 门禁全过；版本 0.3.0

---

## 5. 每步文档更新检查

每个 PR 提交前逐条确认（对应 05 §9）：

- [ ] DOC-01 行为/范围变了 → 02 的 US/FR/AC 已更新
- [ ] DOC-02 设计/契约变了 → 03 对应小节已更新（§3 槽位、§5 数据、§6 解析、§7 导图、§8 上下文、§9 导出、§10 错误）
- [ ] DOC-03 路由/工具/事件/错误码变了 → 04 已更新（含 §4 总表、§5 工具、§7 错误码）
- [ ] DOC-04 数据文件字段或 `schemaVersion` 变了 → 03 §5 + 04 §10 + `schema/*.json` 同步
- [ ] DOC-05 依赖/脚本/构建变了 → 01（体积/许可）+ 05 §1.3/§3/§4 + `package.json`
- [ ] DOC-06 测试策略/夹具变了 → 06 + `test/fixtures/manifest.json`
- [ ] DOC-07 流程/分支/发布变了 → 05
- [ ] DOC-08 里程碑/验收变了 → 07（本文）
- [ ] DOC-09 `CHANGELOG.md` 的 `Unreleased` 已记
- [ ] DOC-10 偏差已登记（03 §14 或 07 §10），没有「文档说 A、代码做 B」而不记录
- [ ] DOC-11 文档自检：无遗留标记词（命令见 05 §9.4）；围栏成对；相对链接存在；JSON 示例可解析
- [ ] DOC-12 中文标点统一、表格列数一致、命令可复制执行

---

## 6. 性能检查项

测法：本机（Windows 11、Node 24、DSH 0.2.2-rc.5）；每项记录 3 次取中位数；结果写进 PR 或 06。

| 编号 | 指标 | 阈值 | 测法 | 里程碑 |
|---|---|---|---|---|
| P-01 | 50 本书冷启动到列表可交互 | ≤ 800 ms | 造 50 个 `meta.json`，从 `GET /books` 到首屏渲染（Performance 面板） | M2 |
| P-02 | 5 MB EPUB 导入到 `ready` | ≤ 2 s | 夹具 `--large` 生成 5 MB EPUB，计时 `book/ready` 事件 | M2 |
| P-03 | 50 MB / 500 页 PDF 导入到 `ready` | ≤ 30 s | `--large` 生成；记录解析与分块分段耗时 | M2 |
| P-04 | 100 MB PDF 峰值内存 | ≤ 1 GB | `process.memoryUsage().rss` 采样；分页释放 | M2 |
| P-05 | 导图首次布局 | ≤ 500 ms | 200 节点 `map.json`，`layout()` 计时 | M3 |
| P-06 | 画布 200 节点 p95 帧 | ≤ 33 ms | 连续平移/缩放 10 s，Performance 统计帧时长 | M3 |
| P-07 | 1000 节点可操作 | 无长时间卡死 | 拖拽/选中/展开导出，主观 + 帧统计 | M5 |
| P-08 | 详情打开到引用可点 | ≤ 200 ms | 点卡片到抽屉渲染完 | M3 |
| P-09 | SSE 首帧 | ≤ 500 ms | `curl -N` 或 Network 面板 | M1 |
| P-10 | 导出 md/opml/json（200 节点） | ≤ 2 s | 计时到文件落盘 | M4 |
| P-11 | 冷启动到面板可用（单书） | ≤ 1.5 s | 刷新页面到空态/列表 | M2 |

---

## 7. 无障碍与主题检查项

- [ ] A11Y-01 所有交互元素可 Tab 到达，焦点环可见（不用 `outline:none` 无替代）
- [ ] A11Y-02 面板/抽屉/浮层有 `role` 与 `aria-label`；打开时焦点进入，关闭后回到触发元素
- [ ] A11Y-03 画布可用键盘：Tab 进入、方向键在节点间移动、Enter 打开详情、`+/-` 缩放、`0` 复位
- [ ] A11Y-04 状态不只靠颜色：解析中/失败/不支持有文字或图标
- [ ] A11Y-05 正文对比度 ≥ 4.5:1；次要文字 ≥ 3:1（NFR-08）
- [ ] A11Y-06 亮/暗主题各自走查：背景、边框、骨架屏、选中态、引用高亮
- [ ] A11Y-07 缩放 200% 下不横向滚动溢出；文本可换行
- [ ] A11Y-08 动效遵守 `prefers-reduced-motion`（至少不自动播放）
- [ ] A11Y-09 屏幕阅读器读到书名、状态、节点标题与引用编号（抽查 NVDA/VoiceOver 之一）
- [ ] A11Y-10 快捷键不与宿主冲突（`Ctrl+K` 等）；有 `?` 帮助或 tooltip 说明

---

## 8. 插件安装验证步骤（每次发布前，干净环境）

前置：目标机器有 DSH ≥ 0.2.2-rc.1，已 `git clone` 并 `npm install && npm run build:client`。

| # | 步骤 | 期望 | 证据 |
|---|---|---|---|
| 1 | `plugin_manager action="list_plugins"` 确认未安装 | 无 `dsh-reading-lab` 行 | 截图/输出 |
| 2 | `plugin_manager action="install_bundle" target="<绝对包目录>"` | `application` 正常、无 `failed`；必要时 `restart-required` | 结果 JSON |
| 3 | 重启 DSH（若提示） | 正常启动，无插件加载错误 | 启动日志末 50 行 |
| 4 | Settings → Plugins | 「阅读实验室 / Reading Lab」、图标、描述、版本正确 | 截图 |
| 5 | `list_bundles` 搜索 | `installed:true`、`enabled:true`、`availability:"profile"` | 输出 |
| 6 | 侧栏图标 → `main` | 面板打开，空态正常，无 console 错误 | 截图 + Console |
| 7 | `GET /dsh-reading-lab/api/v1/health` | 200；`storage:"ok"`；`capabilities.sse:true` | 响应 JSON |
| 8 | `curl -N .../events` | `event: hello`，随后 `: ping` | 输出片段 |
| 9 | 新会话问「有哪些阅读工具」 | 列出 `reading_import` 等（下划线名） | 截图 |
| 10 | 导入夹具 EPUB → 出图 → 点卡 → 点引用 | 全链可用（v0.1 起） | 截图/录屏 |
| 11 | 停用插件 → 图标消失、无请求 | 停用生效 | 截图 |
| 12 | 重装 → 数据仍在 | `reading/` 未被删 | 文件列表 |

失败处理：先看 05 §7.5；`restart-required` 必须重启，不要反复重装。

---

## 9. 发布门禁（02 §9.2 的可执行版）

合并 `dev → main` 前全部勾选；缺一不可。

- [ ] G-01 `npm run check` exit 0
- [ ] G-02 `npm test` exit 0（解析/分块/布局；v0.2 起含导出；含恶意 EPUB 与路径逃逸）
- [ ] G-03 夹具冒烟 4 条：2 章 EPUB、2 页中文 PDF、10 页英文 PDF、扫描版 PDF 全部符合预期
- [ ] G-04 `npm run build:client:check` exit 0（D-05-02 落地后）
- [ ] G-05 `npm pack --dry-run` 清单正确（含 `client.js`；不含 `test/`、夹具、`node_modules`）
- [ ] G-06 手工 AC：v0.1 走 AC-01..04、AC-08、AC-09；v0.2 加 AC-06/07/10；v0.3 全量
- [ ] G-07 §8 安装验证在干净环境通过
- [ ] G-08 §6 性能指标达标或已登记的降级说明
- [ ] G-09 §7 无障碍检查通过（v0.1 至少 A11Y-01/02/05/06）
- [ ] G-10 `CHANGELOG`、版本号、README 状态、tag 就绪
- [ ] G-11 无未登记偏差（§10 全部有裁决）

---

## 10. 偏差与未决

与 05 §12 同步维护；关闭时写「已修 + 提交号」。

| 编号 | 现象 | 裁决 | 关闭条件 | 状态 |
|---|---|---|---|---|
| D-05-01 | 03 §12.4 的 AC 编号与 02 §9.1 不一致（03 的 AC-03=画布性能、AC-05=笔记、AC-09=删除/重命名） | 以 02 为准；本清单全部用 02 编号 | 03 §12.4 修正并复核 | 已关闭（2026-11-19 文档门禁） |
| D-05-02 | Client 拆 `views/*.js` 后缺构建；`package.json` 仍指向 `src/client/index.js` | 零依赖拼接构建；`client.js` 入库；四字段同 PR 改 | M1-18 完成 | 打开 |
| D-05-03 | 03 §12.3 写夹具在 `assets/fixtures/`，实际用 `test/fixtures/` | 以 `test/fixtures/` 为准 | 03 措辞统一 | 已关闭（2026-11-19 文档门禁） |
| D-05-04 | `package.json` 的 `test/*`、`fixtures` 脚本由测试 owner 并行加入，05 §3 按其当前形态记录 | 合并前以 `package.json` 为准复核 05 §3 | 测试 PR 合并后复核 | 已关闭（2026-11-19 文档门禁） |
| D-05-05 | `package.json` 缺 `engines.node` | M1 补 `>=22.19.0` | M1 完成 | 打开 |
| D-05-06 | `src/client/index.js` 注释仍写 `key="reading"`，与 DR-06 冲突 | client-shell 在 M1 改注释与实现 | M1-12 完成 | 打开 |

未决问题（03 §15 之外的实现期问题，不阻塞 M1）：

| 编号 | 问题 | 需要谁定 | 期限 |
|---|---|---|---|
| Q-07 | 导图节点上限（默认多少节点后折叠） | 架构 + 产品 | M3 前 |
| Q-08 | 线程上限与归档策略 | 产品 | M4 前 |
| Q-09 | PNG 导出最大边长与内存上限 | 架构 | M5 前 |
| Q-10 | 引导式学习的轮次上限 | 产品 | M5 前 |
| Q-11 | 多章并行的并发上限是否可配 | 架构 | M5 前 |
| Q-12 | 是否支持导出 SVG 之外的矢量格式 | 产品 | v0.3 后 |

---

## 11. 相关文档

- [01-research](01-research.md)：DSH 槽位与服务、实测数据、风险
- [02-requirements](02-requirements.md)：US/FR/NFR/AC 与版本出口（权威编号）
- [03-design](03-design.md)：架构、所有权、数据契约、UI、算法、里程碑
- [04-api](04-api.md)：路由、工具、事件、错误码
- [05-dev](05-dev.md)：环境、命令、构建、安装重载、调试、发布
- [06-test](06-test.md)：测试分层、夹具、必测路径
