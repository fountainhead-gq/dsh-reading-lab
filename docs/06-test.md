# 06 测试方案与用例矩阵

> 状态：**方案定稿，骨架可运行，产品用例待实现**（M0）
> 适用范围：v0.1.0 / v0.2.0 / v0.3.0；2026-11-20 起 v0.1 = M1 + EPUB + 导图/只读画布，PDF 与详情/引用随 v0.2（02 §6、07 §3.0）
> 维护：qa；文档同步：docs（qa/docs）；需求基线 [02](02-requirements.md)，设计基线 [03](03-design.md)，接口契约 [04](04-api.md)

本文是测试的单一入口：分层策略、FR→用例矩阵、契约/验收/非功能映射、夹具计划、命令、通过标准与合并 main 前的回归清单。任何“测试通过”的结论必须附本文 §4 的命令输出或 §8 的手工证据；口头断言不算通过。

## 1. 目标与判定口径

### 1.1 目标

1. 每个 `FR-01..FR-17` 至少有一条**自动化断言**和一条**可观察验收**；v0.3 扩展单独编号，不挤占 v0.1/v0.2 矩阵。
2. 每个 HTTP 契约 `C-01..C-12` 有对应用例；每个验收场景 `AC-01..AC-12` 有手工步骤与自动化替代。
3. 在 Windows + DSH 0.2.2-rc.5（GUI `http://127.0.0.1:5807`）上可重复执行；不依赖外网、不依赖真实模型即可跑完 L0–L2。
4. 测试失败能定位到模块与需求编号，而不是只报“某个接口挂了”。

### 1.2 非目标

- 不评估模型回答质量（只验证引用可定位、线程可回写、失败可降级）。
- 不做扫描版 OCR、版面还原、跨书搜索的正确性评估（v0.3 搜索只验证可用性与性能上限）。
- 不在自动化里启动真实 DSH 会话或占用 5807 端口；安装冒烟是显式的手工步骤（§3.4）。
- 不做浏览器矩阵（仅 Chromium/Electron 载体）；不做移动端。

### 1.3 “绿”的定义

| 口径 | 要求 |
|---|---|
| 命令绿 | `npm run verify` 退出码 0，且 `fail 0` |
| 通过率 | `todo` 不计入通过；`skipped` 只允许 §3.3 白名单内的条目 |
| 新增用例 | 每个实现 PR 必须把对应 `test.todo` 换成断言，或新增带编号用例；todo 只减不增 |
| 里程碑 | M1–M5 出口按 §11.2；发布门禁按 02 §9.2 |
| 证据 | 命令、退出码、关键输出行写入 PR 描述或 `CHANGELOG.md`；手工证据按 §8.4 归档 |

**当前基线（2026-11-19，骨架阶段）**：`npm test` → tests 77 / pass 37 / fail 0 / skipped 1 / todo 39，退出码 0。通过项为包契约（CT-PKG）、夹具契约（CT-FIX）、发布材料冒烟（SMK）、文档契约（DOC-06）；产品功能用例仍是 todo，**不能据此宣称功能已实现**。`skipped 1` 是 IT-BOOT-01 的动态闸门（`src/host/routes.js` 尚未实现），原因写在用例里并同步登记 `test/skip.txt`。

## 2. 环境矩阵

### 2.1 本机基线（必须记录）

| 项 | 值 | 说明 |
|---|---|---|
| OS | Windows 10.0.22621 x64 | 路径分隔符、文件锁、rename 语义均按 Windows 验证 |
| Shell | PowerShell 5.1 | 命令示例以 pwsh 为准；管道与引号差异见 §4.3 |
| Node | v24.19.0（`D:\Program\nodejs\node.exe`） | 使用内置 `node:test`，零测试依赖 |
| npm | 11.17.0 | `npm pack` 与安装演练 |
| DSH | 0.2.2-rc.5 | `engines.dsh >= 0.2.2-rc.1` |
| GUI | `http://127.0.0.1:5807` | 已运行的 DSH Web；测试**不得**监听该端口 |
| 项目根 | `D:\Qunar\personal\dsh\dsh-reading-lab` | 分支 `dev` |
| 工作区数据 | `<workspace>/reading/` | 书 `reading/books/<bookId>/`，导出 `reading/exports/` |
| API 前缀 | `/dsh-reading-lab/api/v1` | 见 04 §1.1 |
| 运行时依赖 | 无（骨架） | 实现期新增依赖必须锁版本并过许可证检查 |

> 换机或升级 Node/DSH 后，先重跑 `npm run verify` 与 §3.4 安装冒烟，再把新版本写回本表；否则测试结论只对旧环境有效。

### 2.2 DSH 0.2.2-rc.5 与 5807

- 5807 是开发者本机已启动的 DSH Web GUI，用于手工验收与安装冒烟。自动化测试用 `server.listen(0)` 拿随机端口，绝不占用 5807。
- 安装/升级通过插件管理器（设置中的插件页，或宿主提供的 `plugin_manager` 工具）加载本仓库；安装后确认 bundle 行 `reading-lab` 生效、侧栏出现入口。
- 面板数据落在**当前工作区**的 `reading/` 下；切换工作区等于切换书库，手工用例必须记录所用工作区路径。
- 插件日志位置以 DSH 设置页显示为准；排障时同时抓 Host 日志与浏览器 Console，两者都附在证据里。
- `main` 与 `sidebar.panellist` 使用同一个 id `reading-lab` 才会联动；验收步骤见 03 §3.2 五步法。

### 2.3 Windows 专项

| 风险 | 测试关注点 | 用例 |
|---|---|---|
| `\` 与 `/` 混用 | 路由、chunkId、导出文件名不接受反斜杠注入 | IT-C08、UT-PATH-01..04 |
| 文件占用 | 删除书前关闭读写句柄；失败可重试 | IT-C11、MAN-02 |
| `rename` 覆盖 | 原子写先 `unlink` 再 `rename`，失败重试 | UT-MAP-06、NFR-03 |
| 保留名/UNC | `CON`、`NUL`、`\\?\`、`\\server\share` 一律拒绝 | UT-PATH-04 |
| 控制台编码 | 测试断言不依赖 PowerShell 显示；Node 内部按 UTF-8 | 全部 |
| CRLF | `.gitattributes` 固定文本换行；夹具字节级校验 | CT-FIX-01、CT-FIX-09 |

### 2.4 Node 24 运行器注意事项

- `node --test` 的目录参数在 Node 24 会被当模块加载而失败，必须用 glob：`node --test "test/**/*.test.js"`。`package.json` 已按此配置。
- 各测试文件默认并行、独立进程；共享状态只能通过临时目录，且每个文件自建自清。
- 单文件调试用 `node --test test/unit/fixtures.test.js`；按名称过滤用 `--test-name-pattern`。

## 3. 分层策略

| 层 | 名称 | 工具/位置 | 依赖 | 何时跑 | 失败含义 | 预算 |
|---|---|---|---|---|---|---|
| L0 | 包与发布材料 | `test/unit/package-contract.test.js`、`test/smoke/package.smoke.test.js` | Node + npm | 每次提交 | 装不上/发不出/清单错 | <5 s |
| L1 | 纯函数单测 | `test/unit/*.test.js` | 零依赖 | 每次提交 | 解析、分块、布局、校验、导出逻辑错 | <10 s |
| L2 | HTTP 集成 | `test/integration/*.test.js` | Node `http` + 临时目录 | 每次提交 | 路由/状态码/SSE/原子写/契约错 | <30 s |
| L3 | 安装冒烟 | `test/manual/README.md` §安装 | 已安装的 DSH + 5807 | 每个里程碑、合并 main 前 | 插件装不上/入口不出现/工具未注册 | 10 min |
| L4 | 手工验收 | `test/manual/README.md` | DSH + 模型（仅问答） | 里程碑、发版 | 体验/视觉/键盘/离线不达标 | 60–90 min |
| L5 | 性能与安全采样 | 基准脚本 + 手工（见 §9） | 大文件夹具 | M2/M3/M5 | 超预算或有安全缺口 | 30 min |

### 3.1 隔离与确定性

1. 单测/集成禁止访问网络、真实用户目录、真实 DSH 进程；文件写入 `os.tmpdir()` 下 `mkdtemp` 创建的目录，`after` 清理。
2. 夹具由 `scripts/gen-fixtures.mjs` 生成，固定时间戳与对象顺序；禁止手工改夹具，改生成器后必须同步 `manifest.json`。导图夹具单独由 `scripts/gen-map-fixture.mjs` 生成到 `test/fixtures/map/`，同样禁止手改，`--check` 做字节级比对。
3. 时间相关断言使用注入时钟或只比较顺序/存在性，不断言“当前时间”。
4. 同一本书的写操作串行；并发用例必须使用不同 `bookId`。
5. 随机数据使用固定种子；失败信息打印种子与临时目录路径。
6. **等待窗口可配置，不靠固定 sleep 赌调度**（QA-44-02）：集成测试等待「状态收敛 / SSE 帧到达」时一律用轮询到条件成立 + 可覆盖的超时，默认值给足，满载（8 份并发）不因调度抖动假红。约定如下，新增用例沿用同名变量：

   | 环境变量 | 默认 | 用途 |
   |---|---|---|
   | `RL_WAIT_STATE_MS` | 5000 | 等磁盘/接口状态收敛（如失败回写两次落盘） |
   | `RL_WAIT_THREAD_MS` | 15000 | 等线程降到 `idle`（`waitForThread`） |
   | `RL_SSE_WINDOW_MS` | 3000 | SSE 帧收集窗口（`captureSse`，发事件前先等 `hello` 帧） |
   | `RL_SSE_DRAIN_MS` | 3000 | 收流等待目标帧（`map` + `progress` + `done` 齐了再 abort） |
   | `RL_GEN_IDLE_MS` / `RL_GEN_TICK_MS` | 1000 / 250 | 生成看门狗用例的空闲预算与心跳间隔（成对放大，保持「累计活动 > 预算」语义） |

   另外，`listen(0)` 抽到 undici 的 bad port 会让 `fetch` 报 `bad port`；所有绑定临时端口的集成测试统一走 `test/helpers/net.js` 的 `listenSafe(server)`——先查已知端口黑名单，再对实际端口发一次探测请求，连不上就换端口重开。探测失败只换端口，不重试断言。

### 3.2 用例编号约定

| 前缀 | 含义 | 示例 |
|---|---|---|
| `CT-PKG-*` | 包身份/发布材料契约 | `CT-PKG-03` |
| `CT-FIX-*` | 夹具自身契约 | `CT-FIX-11` |
| `UT-<模块>-*` | 纯函数单测 | `UT-CHUNK-01` |
| `IT-<域>-*` / `IT-C*` | HTTP 集成 / 04 契约 | `IT-IMP-02`、`IT-C05` |
| `SMK-*` | 安装/包冒烟 | `SMK-01` |
| `MAN-*` | 手工验收 | `MAN-08` |
| `V03-*` | v0.3 扩展 | `V03-REVIEW-01` |

一个编号只对应一个断言组；矩阵中引用的编号必须能在 `test/` 中找到（`test/unit/docs-contract.test.js` 会校验）。

### 3.3 skip 与 todo 政策

- 允许的 skip 只有“模块尚不存在”的动态闸门：`IT-BOOT-01` 在 `src/host/routes.js` 缺失时 skip，并打印原因。
- 其余 skip 必须登记在 `test/skip.txt`：`编号 | 原因 | 负责人 | 截止里程碑`。M2 结束时 v0.1 路径的 skip 必须清零；M4 结束时 v0.2 路径清零。
- `test.todo` 是待实现清单，不是通过项。实现某模块时，必须删除或替换对应 todo，禁止把 todo 留在已宣称完成的里程碑里。
- 阻塞超过一个里程碑的 todo 要在本文 §13 记录，不允许静默堆积。

### 3.4 安装冒烟（L3，当前状态：待执行）

> 以下步骤在 M1 产出可安装包后执行，结果记入 §8.4。插件已有 Host/Client 入口与打包产物；**本节 5807 桌面 8 步尚未执行过安装验证**。v0.2 在 `qa-v02` profile 做过 CLI `link` 安装与 health 检查（见 [10 §3](10-qa-v0.2.md)），那不等于本节的桌面点按流程。

1. 在 dev 分支确认 `npm run verify` 全绿，记录 commit。
2. 通过插件管理器安装本目录（开发安装），确认 bundle 行 `reading-lab` 出现在已启用列表。
3. 重启/重载 DSH，打开 5807；侧栏出现「阅读实验室 / Reading Lab」图标。
4. 点击图标：中心区打开主面板；再点一次不出现第二个实例；切到会话再切回，面板仍在。
5. 打开 DevTools Network，确认 `GET /dsh-reading-lab/api/v1/health` 返回 200 且 body 含 `ok`、`version`、`capabilities`。
6. 在会话中触发一次 `reading_import`（可先用夹具 EPUB），确认工具出现在工具清单、调用卡可见、书库新增条目。
7. 完全退出 DSH 再启动，确认书库与上次选中的书恢复；卸载插件后确认 `reading/` 数据仍在（重装可读）。
8. 记录：DSH 版本、安装方式、commit、health body、截图路径、异常日志。

## 4. 测试命令

### 4.1 标准命令

| 命令 | 用途 | 期望 |
|---|---|---|
| `npm run check` | 入口语法检查 | exit 0，无输出 |
| `npm run fixtures` | 重新生成全部夹具 | 打印“已生成 9 个夹具” |
| `npm run fixtures:check` | 字节级校验夹具与 manifest | 打印“fixtures:check 通过” |
| `npm test` | 全量 L0–L2 | exit 0；fail 0 |
| `npm run test:unit` | 仅单测/包契约 | exit 0 |
| `npm run test:integration` | 仅 HTTP 集成 | exit 0（M1 前允许 1 skip） |
| `npm run test:smoke` | 仅发布材料冒烟 | exit 0 |
| `npm run verify` | check + fixtures:check + test | exit 0，合并前必跑 |
| `npm pack --dry-run` | 检查发布清单 | 无 test/scripts，含 docs/06 |
| `node --test --test-name-pattern="CT-FIX" "test/**/*.test.js"` | 单组调试 | 仅匹配用例执行 |

### 4.2 直接运行单个文件

```powershell
cd D:\Qunar\personal\dsh\dsh-reading-lab
node --test test/unit/fixtures.test.js
node --test test/integration/http-contract.test.js
```

### 4.3 PowerShell 引号

glob 必须带双引号，否则 PowerShell 可能自行展开或传给 Node 的形态不一致：

```powershell
npm test
node --test "test/**/*.test.js"
```

不要写 `node --test test/`（Node 24 会当模块加载）。npm 脚本内部已处理，优先用 `npm test`。

### 4.4 环境变量

| 变量 | 默认 | 用途 |
|---|---|---|
| `READING_LAB_TMP` | 系统临时目录 | 集成测试工作区根；排障时保留现场 |
| `READING_LAB_KEEP_TMP` | 未设置 | 设为 `1` 时不清理临时目录 |
| `READING_LAB_FIXTURES` | `test/fixtures` | 指定夹具目录（仅调试） |

实现期新增变量必须在本表登记，并在 `test/support/env.mjs` 集中读取。

## 5. 目录与职责

```text
test/
├─ fixtures/               # 合成夹具（入库；EPUB/PDF 均 <50 KB/个）
│  ├─ manifest.json        # 体积 + sha256 + 用途
│  ├─ epub3-mini.epub
│  ├─ epub2-ncx.epub
│  ├─ pdf-text-2p.pdf
│  ├─ pdf-zh-2p.pdf
│  ├─ pdf-text-10p.pdf
│  ├─ pdf-scanned-5p.pdf
│  ├─ corrupt.pdf
│  ├─ evil-zip.epub
│  ├─ bomb.epub
│  └─ map/
│     └─ map-500.json      # 500 节点导图夹具（约 458 KB，由 scripts/gen-map-fixture.mjs 生成）
├─ support/
│  └─ zip.mjs              # 零依赖 ZIP 中央目录读取（夹具断言用）
├─ unit/
│  ├─ package-contract.test.js
│  ├─ fixtures.test.js
│  ├─ placeholders.test.js # 待实现模块的 todo 清单
│  └─ docs-contract.test.js# 本文档自身的一致性校验
├─ integration/
│  └─ http-contract.test.js
├─ smoke/
│  └─ package.smoke.test.js
├─ manual/
│  └─ README.md            # 安装冒烟与手工验收步骤、证据模板
└─ skip.txt                # 例外 skip 登记（当前为空）
```

`test/` 与 `scripts/` 不进入 npm 发布包（`files` 白名单与 SMK-01 双重保证）。

## 6. FR → 用例矩阵

> 状态列写的是**当前事实**：`骨架` = 仅登记 todo/skip；`部分` = 包/夹具层已可跑，功能未实现；`待 Mx` = 计划在里程碑补齐。手工编号见 §8。

### 6.1 v0.1 主路径

范围（2026-11-20）：M1 + EPUB 导入/分块 + 导图与只读画布。FR-05、FR-09 已移至 §6.2，不计入 v0.1 判定。

| 需求 | 关键行为（验收锚点） | 自动化用例 | 手工 | 状态 |
|---|---|---|---|---|
| FR-01 入口与主面板 | 侧栏图标、单实例、空态引导、切会话保持 | SMK-02、SMK-03（安装冒烟）；IT-BOOT-01 仅验证路由可加载 | MAN-01 | 已实现（t01）；MAN-01 待执行 |
| FR-02 书库列表 | 50 本可滚动、状态/格式徽标、最近打开排序 | IT-BOOK-01..04 | MAN-02 | 已实现（t02）；QA 书库列表通过 |
| FR-03 导入 | 扩展名+魔数、100 MB/2000 页、SHA-256 去重、状态机 | IT-IMP-01..06、IT-C02、IT-C03 | MAN-03、MAN-05 | 已实现（t02/t13）；QA 导入/去重通过 |
| FR-04 EPUB 解析 | nav/NCX、spine、净化、DRM→unsupported | UT-EPUB-01..06、CT-FIX-02/03/04、IT-IMP-01 | MAN-03 | 已实现（t02）；EPUB3/EPUB2 通过 |
| FR-06 分块与定位 | 800–1500 字、2000 上限、100 下限、确定性、20000 块 | UT-CHUNK-01..05、UT-TEXT-01..04 | MAN-05 | 已实现（t02）；块页码通过 |
| FR-07 导图生成 | 工具生成、1–3 引用、坏引用拒绝、旧图保留、原子写 | UT-MAP-01..06、IT-C05 | MAN-06 | 已实现（t03/t30）；agent 端到端未闭环（QA-17） |
| FR-08 画布 | 分栏布局、25–200% 缩放、适应窗口、200 节点 p95≤33 ms | UT-LAYOUT-01..04、UT-SVG-01..03 | MAN-07 | 已实现（t03/t30）；帧率未采样 |
| FR-15 错误与恢复 | 8 个错误码文案、无堆栈、无半成品、import.log 不含正文 | UT-ERR-01、IT-C01、IT-C02、IT-C08 | MAN-05 | 已实现（t02/t13）；QA 错误码通过 |

### 6.2 v0.2 闭环

| 需求 | 关键行为（验收锚点） | 自动化用例 | 手工 | 状态 |
|---|---|---|---|---|
| FR-05 PDF 解析（v0.1 移入） | 逐页文本、中文映射、扫描判定、加密降级；v0.1 只要求 `E_UNSUPPORTED{pdf-pending}` | UT-PDF-01..06、CT-FIX-06/07/08/10/11、IT-IMP-02 | MAN-04、MAN-05 | v0.2 已实现（t13）；2/10 页、中文、扫描/损坏通过 |
| FR-09 详情与引用（v0.1 移入） | 引用计数、点引用定位、失效标注、不遮挡；v0.1 只要求选中高亮 | IT-C04、IT-CONTENT-01..03、`detail-render.test.js`（11 条，含引用高亮/失效/不遮挡平移） | MAN-08、MAN-03 | v0.2 已实现（t14）；QA 5/5 引用通过 |
| FR-10 研究笔记 | 固定五节、每节引用、无内容声明、notes.md | UT-NOTES-01..04 | MAN-09 | v0.2 已实现（t13，只读）；generate-notes 501（QA-17-03） |
| FR-11 询问 AI | 右浮层、快捷指令、≤6000 字上下文、单并发、可停止 | UT-ASK-01..08、IT-ASK-01..06、`ask-render.test.js`（6 条） | MAN-10 | v0.2 已实现（t15）；Esc/焦点、chip 点击未闭环（QA-17-01/02） |
| FR-12 线程与留痕 | threads.json、重启恢复、不重复注入、删书级联 | UT-THREAD-01..09、IT-ASK-01..05、IT-C10、IT-C11 | MAN-10、MAN-11 | v0.2 已实现（t15）；重启恢复通过 |
| FR-13 导出 | Markdown/OPML/JSON、命名去重、源文件哈希不变 | UT-EXP（8）、IT-EXP（6）、export-render（3）、IT-C12 | MAN-12 | v0.2 已实现（t16）；三格式 QA 通过 |
| FR-14 生命周期 | 删除/重命名/整图重生成/重新解析备份 | IT-BOOK-01..04、IT-C11 | MAN-02 | 部分；卸载/升级未验（QA-17） |
| FR-15（v0.2 扩展） | 模型不可用、会话中断 → E_AGENT 可重试 | UT-ERR-01、IT-ASK-06（超时置 failed + error 码） | MAN-10 | 部分（t15）；无模型路径环境阻塞（QA-17-06） |
| FR-16 存储位置（t33） | 三段根解析、绝对路径校验、迁移/空目标复用/回滚、`isFallback` 与 `settingsError` 可见、重启仍生效 | `settings.test.js`（18）、`settings-route.test.js`（4）、`settings-render.test.js`（2） | MAN-16 | v0.2 已实现（t33）；面板存储行与运行中宿主待现场复测（11 §6） |
| FR-17 生成预算（t34/t37） | 三段预算、活动重置、`claimedAt` 三类证据、阶段截止与定时器代际、事件按记录归因、失败文案可区分 | UT-GEN-11..19、`generate-map-observe.test.js`（9）、`generation-render.test.js`（10） | MAN-16 | v0.2 已实现（t34/t37）；真实 agent 长回合待复测 |

### 6.3 v0.3 扩展（不改变 v0.1/v0.2 判定）

| 能力 | 关键行为 | 自动化用例 | 手工 | 状态 |
|---|---|---|---|---|
| 节点编辑与单节点重生成 | 改标题/摘要、增删/换位、写回并保留上一版 | V03-EDIT-01..03 | MAN-14 | 待 M5 |
| 变更审阅 | 节点级 diff、接受/回滚、计数准确 | V03-REVIEW-01..02 | MAN-14 | 待 M5 |
| HTML/PNG/SVG 导出 | 单文件 HTML 可打印、快照完整、无外链 | V03-EXPORT-01..02、IT-EXP-03 | MAN-12 | 待 M5 |
| 引导式学习 `reading_tutor` | 按导图生成 ≤60 步路径、每步 1 问 + 引用、掌握/跳过、重启恢复、与询问 AI 共享线程 | V03-STUDY-01..02、UT-TUTOR-01..09、IT-TUTOR-01..06、`tutor-render.test.js`（6 条） | MAN-15 | v0.3 已实现（t20）；两浮层互斥未端到端验证（D-20-03） |
| 搜索/小地图/1000 节点 | 书内搜索命中、小地图导航、1000 节点可操作 | V03-SEARCH-01..02 | MAN-07、MAN-15 | 待 M5 |

**覆盖检查**：FR-01..FR-17 全部在矩阵中出现；FR-05/FR-09 在 §6.2 标注 v0.1 移入；FR-16/FR-17 为 t33/t34 增补；v0.3 的五类扩展各有编号；没有“只写需求、没有用例”的行。

## 7. 接口契约矩阵（04 §9）

| 契约 | 内容 | 自动化用例 | 状态 |
|---|---|---|---|
| C-01 | 存储不可用 → `/health` 503，capabilities 仍返回 | IT-C01 | 通过（QA v0.2） |
| C-02 | 上传超 100 MB → 413，且无 `.part` 残留 | IT-C02 | 未验证（100 MB 未实测） |
| C-03 | 重复导入 → `duplicate:true`，bookId 稳定 | IT-C03 | 通过（QA v0.2） |
| C-04 | `chunks?ids=` 含未知 id → 200 + `missing` | IT-C04 | 通过（QA v0.2） |
| C-05 | map commit 未知 chunkId → 拒绝，`map.json` 哈希不变 | IT-C05 | 集成通过；真实 agent 未验 |
| C-06 | 同 `Idempotency-Key` 两次提问 → 同一 messageId | IT-C06 | 通过（QA v0.2） |
| C-07 | SSE 首帧 `hello`，心跳 ≤15 s，断线可重连 | IT-C07、IT-SSE-01..02 | 通过（QA v0.2） |
| C-08 | 导出路径逃逸 → 400 `E_PATH` | IT-C08 | 通过（QA v0.2） |
| C-09 | 六个工具 parameters 通过 `defineTool` 校验 | IT-C09、SMK-02 | 通过（QA v0.2） |
| C-10 | 线程只写 `threads.json`，无 `qa-threads.json` 别名 | IT-C10 | 通过（QA v0.2） |
| C-11 | 删除书 → GET 404 + SSE `book{deleted:true}` | IT-C11 | 通过（QA v0.2） |
| C-12 | `reading_export` 通过 `export-v1.schema.json` | IT-EXP-06（工具信封）+ IT-EXP-02（JSON 结构） | 部分（schema 缺失，QA-17-05） |

## 8. 验收场景与手工步骤（AC-01..AC-12）

### 8.1 AC → 用例映射

| AC | 版本 | 场景 | 自动化替代 | 手工 |
|---|---|---|---|---|
| AC-01 | v0.1（图）/ v0.2（引用） | EPUB 首次导入 → 出图 → 叶卡带引用 | IT-IMP-01、UT-MAP-*、CT-FIX-02 | MAN-03 |
| AC-02 | v0.2 | 中文 PDF → 5 段抽检 → 页码引用 | CT-FIX-10、UT-PDF-02、IT-IMP-02 | MAN-04 |
| AC-03 | v0.2 | 扫描版 PDF → 10 s 内 unsupported | CT-FIX-07、UT-PDF-03 | MAN-05 |
| AC-04 | v0.2 | 5 条引用往返一致 | IT-C04、UT-CHUNK-01 | MAN-08 |
| AC-05 | v0.1（书/图）/ v0.2（线程） | 重启恢复书库/导图/线程 | IT-BOOK-04、IT-C10 | MAN-11 |
| AC-06 | v0.2 | 卡片追问 → 会话流 → 引用 → 线程 | UT-ASK/THREAD、IT-C06 | MAN-10 |
| AC-07 | v0.2 | 三格式导出，OPML 可导入，JSON 过 schema | UT-EXP、IT-C12 | MAN-12 |
| AC-08 | v0.1 | 中英切换无硬编码；亮暗对比达标 | UT-ERR-01（文案覆盖） | MAN-13 |
| AC-09 | v0.1（EPUB/通用）/ v0.2（PDF） | 100 MB/2000 页/加密/损坏 → 错误码，无半成品 | IT-C02、UT-ERR-01、CT-FIX-08 | MAN-05 |
| AC-10 | v0.2 | 断网后导入/浏览/引用/导出可用 | 无（离线不可自动断言） | MAN-13 |
| AC-11 | v0.2 | 自选存储路径并迁移后新根可见、重启仍生效、失败可回滚、回退有可见警告 | `settings.test.js`、`settings-route.test.js`、`settings-render.test.js` | MAN-16 |
| AC-12 | v0.2 | 持续活动跨过空闲预算仍 `running`，排队/空闲/绝对超时有区分文案，状态字段完整 | UT-GEN-11..19、`generate-map-observe.test.js`、`generation-render.test.js` | MAN-16 |

**v0.2 实测（2026-11-20，`116ed9c`）**：AC-01/02/03/04/05/07/09 通过；AC-06/08 部分（无模型回答、无英文/暗色截图）；AC-10 未验证。阻塞缺陷 QA-17-01/02 见 [10 §6](10-qa-v0.2.md)；本表不因实测通过而改写通过标准。

### 8.2 手工用例（MAN）

所有手工用例默认在 5807、干净工作区、dev 分支最新构建上执行。前置“已安装”指 §3.4 已通过。

| 编号 | 前置 | 步骤 | 通过标准 | 关联 |
|---|---|---|---|---|
| MAN-01 | 已安装 | 冷启动 DSH → 点侧栏图标 → 切到会话 → 再切回 → 再点一次图标 | 主面板打开且仅一个实例；切回后选书/视口保持；空态有“导入”按钮 | FR-01、AC-05（运行内切换） |
| MAN-02 | 已导入 2 本 | 重命名一本 → 删除另一本（取消一次，再确认）→ 观察目录 | 重命名只改显示名；取消不删；确认后条目与 `reading/books/<id>/` 同步消失；无残留进程 | FR-02/14（无对应 AC） |
| MAN-03 | 干净书库 | 导入 `epub3-mini.epub` → 等待 ready → 生成导图 → 点叶卡（v0.2 再点引用） | v0.1：书卡为书名、≥2 层章节卡、画布可交互；v0.2：叶卡 ≥1 条引用且点击回到对应段落并高亮 | FR-01/08、AC-01（引用部分 v0.2/AC-04） |
| MAN-04 | 干净书库 | 导入 `pdf-zh-2p.pdf` → 抽检 5 段 → 生成导图 → 点带页码引用 | 文本与夹具一致；引用显示页码并回到对应页；无乱码 | AC-02 |
| MAN-05 | 干净书库 | 导入 `corrupt.pdf`、改名 txt、100 MB+ 文件；v0.2 再导入 `pdf-scanned-5p.pdf` | v0.1：`E_PARSE`/`E_FORMAT`/`E_TOO_LARGE`，无 `.part`、无 `map.json`，可删除重试；v0.2：扫描版 `E_SCANNED` 且 10 s 内出结论 | FR-03/15、AC-09（EPUB/通用）；PDF 部分 v0.2 |
| MAN-06 | 已有一张图 | 手工把工具返回的某 `chunkId` 改为不存在 → 重新生成；再断网重试 | 坏图被拒且旧图仍可打开；错误文案为“引用无效，已保留上一版”；无半写 `map.json` | FR-07（无对应 AC） |
| MAN-07 | 200 节点图（可用 `--large`/假 map） | 拖动、滚轮缩放、`+`/`-`、适应窗口、方向键、Tab 选中、Esc | p95 帧间隔 ≤33 ms（DevTools Performance 采样）；25–200% 边界正确；全部节点可见；键盘可完成 | FR-08、NFR-01（无对应 AC；v0.3 1000 节点） |
| MAN-08 | 已生成图 | 任取 5 条引用逐条点击；删 `chunks.json` 后再开详情 | 5/5 文本一致并高亮 3 s；失效引用标注“引用失效”，不跳到书首，不崩溃 | FR-09、AC-04 |
| MAN-09 | 已生成图 | 生成笔记 → 核对五节 → 复制一段 → 重新生成 | 五节齐全；无内容节写固定文案；引用 ≥5 且可定位；`notes.md` 与面板一致；`map.json` 哈希不变 | FR-10（无直接 AC） |
| MAN-10 | 已配置模型 | 选卡 → 浮层问“这个论点成立吗” → 连点发送 → 停止 → 刷新 | 回答含可点引用；会话流只有一条问答；连点不产生并发；停止生效；刷新后线程恢复 | FR-11/12、AC-06 |
| MAN-11 | 已完成一次问答 | 完全退出 DSH → 重启 → 打开同一本书 | 书库、导图、笔记、线程、引用完整；顺序稳定；无重复注入 | FR-12/14、AC-05 |
| MAN-12 | 已生成图/笔记 | 导出 md/opml/json；v0.3 再导出 html/png；用 XMind 打开 OPML | 文件在 `reading/exports/`；命名含时间戳且重名加序号；层级正确；JSON 过 schema；源文件哈希不变；HTML 无外链、PNG 完整 | FR-13、AC-07 |
| MAN-13 | 已导入书 | 切中/英；切亮/暗；断网后浏览、引用、导出、提问 | 无硬编码残留；对比度达标；离线功能可用；提问提示“模型不可用”且不崩溃 | FR-01/15、AC-08/10 |
| MAN-14 | v0.3 构建 | 编辑节点 → 单节点重生成 → 审阅 diff → 接受 → 回滚 | 写回 `map.json` 且保留上一版；diff 计数准确；接受/回滚可逆 | FR-07/08、v0.3 |
| MAN-15 | v0.3 构建 | `reading_tutor` 生成路径 → 逐卡推进；书内搜索；小地图 | 检查点可完成；搜索命中并定位；小地图导航正确；1000 节点不卡死 | v0.3 |
| MAN-16 | 已导入 1 本书、已配置 agent | 记录 `/health` 的 `rootPath/rootSource/isFallback` → `PUT /settings/library-root` 到新目录（`moveExisting:true`）→ 重启 → 再切回旧根；把 `settings.json` 改成非法 JSON 后重开面板；另触发一次生成并在 agent 持续读块时观察状态 | 新根可见且 5 类文件迁移完整，重启仍生效；目标非空 400 且源库不变；设置损坏时 `isFallback` 不为 `true`、`settingsError` 可见且面板有 `role=alert` 文案；生成认领后显示“最近活动”，跨过 180 s 不误报，失败文案区分排队/空闲/绝对上限 | FR-16/17、AC-11/12 |

### 8.3 手工执行记录格式

```text
日期 / 执行人 / commit / DSH 版本 / 工作区:
用例: MAN-08
结果: PASS | FAIL
证据: 截图路径、关键日志、录屏链接（可选）
偏差: 与预期的差异；失败时附最小复现步骤
```

失败必须登记到任务系统并关联 FR/AC；修复后重跑同一条用例，不能只跑“相关单测”就关闭。

### 8.4 证据归档

- 截图与短日志放 `test/manual/evidence/<yyyyMMdd>/`，文件名 `<MAN 编号>-<序号>.png`；大视频不入库，记录外部链接。
- 命令输出只保留关键行（退出码、汇总、失败断言），不粘贴整屏。
- 证据中不得包含书籍正文、模型密钥、个人路径以外的敏感信息；日志抽查本身也是 NFR-05 的验证。

## 9. 非功能验证（NFR-01..NFR-12）

| NFR | 要求 | 验证方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| NFR-01 | 50 本 ≤800 ms；5 MB EPUB ≤2 s；50 MB/500 页 ≤30 s；200 节点 p95≤33 ms；布局 ≤500 ms | 基准脚本 + DevTools 采样 | MAN-07、基准记录 | 部分（导入耗时有记录；200 节点/50 本未采样） |
| NFR-02 | 100 MB PDF 峰值 ≤1 GB，按页流式 | `process.memoryUsage` 采样 | IT-IMP-05、`--large` 2000 页 | 未验证（100 MB 未实测） |
| NFR-03 | 写入原子化，崩溃无半写 JSON | 注入 rename 失败/杀进程 | UT-MAP-06、MAN-06 | 通过（原子写单测） |
| NFR-04 | 断网可用（除 AI） | 手工断网 | MAN-13 | 未验证（AC-10 未跑） |
| NFR-05 | 本地存储、无遥测、日志不含正文 | 抓包 + 日志抽查 | MAN-13、代码审查 | 部分（无遥测；未抓包） |
| NFR-06 | DSH ≥0.2.2-rc.1，Node 24 API | 版本矩阵 + `npm run check` | SMK-02、§3.4 | 通过（DSH rc.5 / Node 24.19） |
| NFR-07 | 中英文案 100% 走 locale | locale key 覆盖率脚本 + 逐屏 | CT-PKG-04、MAN-13 | 部分（key 对齐已测；英文未截图） |
| NFR-08 | 只用 `--dsw-alias-*`，亮暗对比 ≥4.5:1 | 双主题截图 + 对比度检查 | MAN-13 | 部分（中文亮色通过；暗色/英文未截图） |
| NFR-09 | 键盘可达、焦点可见、aria-label | 键盘走查 + axe | MAN-07、MAN-13 | 失败（浮层 Esc/焦点，QA-17-01） |
| NFR-10 | XHTML 净化、路径限制、引用白名单、禁远程资源 | 恶意夹具 + 路径用例 | CT-FIX-04/05、UT-PATH、UT-EPUB | 通过（夹具/路径用例） |
| NFR-11 | 纯函数有单测、依赖锁版本、许可证兼容 | `npm test` + 许可证清单 | CT-PKG-08、`npm ls` | 部分（依赖为空，无许可证负担；覆盖未审计） |
| NFR-12 | 离线安装、锁文件指向官方 registry、tgz 兜底 | 干净环境安装演练 | §3.4、`npm pack` | 部分（CLI link 391 ms；离线安装未演练） |

## 10. 夹具计划

### 10.1 已入库夹具（9 个，均 <10 KB）

| 文件 | 体积 | 用途 | 关键断言 |
|---|---:|---|---|
| `epub3-mini.epub` | 2923 B | EPUB3 nav + 2 章正常路径 | mimetype 首条 store、opf 3.0、nav、两章 |
| `epub2-ncx.epub` | 3013 B | EPUB2 NCX 回退 | 无 nav、有 NCX、2 个 navPoint |
| `pdf-text-2p.pdf` | 1992 B | 2 页英文文本 | 2 页、`Tj`、元数据 |
| `pdf-zh-2p.pdf` | 4338 B | 2 页中文（ToUnicode） | CID 字体、Identity-H、bfchar、12 个文本操作 |
| `pdf-text-10p.pdf` | 8418 B | 10 页英文（02 §9.2 门禁） | 10 页、页脚、segment 60 |
| `pdf-scanned-5p.pdf` | 1877 B | 扫描版判定 | 5 页、无 `Tj` |
| `corrupt.pdf` | 82 B | 损坏结构 | 无 `/Root`，解析器应报 `E_PARSE` |
| `evil-zip.epub` | 1122 B | zip-slip | `../evil.txt`、`OEBPS/../../evil2.txt` |
| `bomb.epub` | 9102 B | 压缩炸弹 | 8 MB / 压缩比 >100，总体积 <50 KB |

`manifest.json` 记录每个文件的字节数与 sha256；`CT-FIX-01` 校验，`CT-FIX-09` 用 `--check` 重新生成逐字节比对。

### 10.2 生成方式与约束

```powershell
node scripts/gen-fixtures.mjs            # 重建全部夹具 + manifest
node scripts/gen-fixtures.mjs --check    # 只校验，不写盘
node scripts/gen-fixtures.mjs --large    # 额外生成 2000 页 PDF 到 .generated/
```

- ZIP 为手写实现（store/deflate、CRC32、固定 DOS 时间 2020-01-01），不依赖 jszip。
- PDF 为手写 1.4 对象/xref；英文使用 Helvetica；中文使用 Type0 + Identity-H + ToUnicode，**不嵌入字体文件**。因此夹具验证的是文本抽取路径，不用于字形渲染验收。
- 所有正文为原创示例，不含第三方版权内容；生成器与夹具均以 MIT 分发。
- 大文件（2000 页/50 MB）现场生成，放 `test/fixtures/.generated/` 并 gitignore；不入库、不进发布包。
- 修改生成器会改变哈希：必须同时提交夹具、`manifest.json` 与相应断言。

### 10.3 尚未纳入的夹具

| 缺口 | 影响 | 计划 |
|---|---|---|
| 加密 PDF | FR-05 加密分支只能用 mock/异常注入 | M2 用测试内构造或引入最小加密样本；在此之前 UT-PDF-04 用解析器单测桩 |
| EPUB 远程资源/脚本样本 | NFR-10 净化只覆盖路径与炸弹 | M2 增加 `xss.epub`（`<script>`、`onload`、远程 img） |
| 50 MB/500 页性能样本 | NFR-01/02 只能手工近似 | M2 扩展 `--large` 生成参数化大文件 |
| 真实中文排版 PDF | CMap 兼容性可能不足 | M2 用公版 PDF 补充（需确认许可证），不入库则记录下载脚本 |

## 11. 通过标准与回归清单

### 11.1 每个 PR / 每次提交

- [ ] `npm run check` exit 0
- [ ] `npm run fixtures:check` 通过（改夹具时）
- [ ] `npm test` exit 0，`fail 0`；新增行为有对应编号用例
- [ ] 已实现模块的 `test.todo` 已替换，todo 总数未增加
- [ ] 涉及需求/接口的变更同步更新 02/03/04 与本文矩阵
- [ ] 无 `test/`、`scripts/` 进入发布包（SMK-01）

### 11.2 里程碑出口

| 里程碑 | 自动化必须通过 | 手工必须通过 | 备注 |
|---|---|---|---|
| M1 骨架 | CT-PKG、CT-FIX、SMK-01..04、IT-BOOT-01（不再 skip） | MAN-01、§3.4 第 1–5 步 | `/health` 200；面板联动 |
| M2 导入 | UT-EPUB/PDF/TEXT/CHUNK/PATH/ERR、IT-IMP、IT-C01..C04/C07/C08 | MAN-03、MAN-04、MAN-05 | 9 个夹具全过；扫描版 ≤10 s |
| M3 导图 | UT-MAP/LAYOUT/SVG、IT-C05、IT-CONTENT | MAN-06、MAN-07、MAN-08 | 真 agent 一张图；坏引用被拒 |
| M4 研究 | UT-NOTES/THREAD/ASK/EXP、IT-ASK/EXP/C06/C10/C11/C12 | MAN-09、MAN-10、MAN-11、MAN-12 | 三格式导出；重启恢复 |
| M5 收口 | 全量 + V03-*（v0.3 范围内） | MAN-13、MAN-14、MAN-15、AC-01..12 | 02 §9.2 全绿；`npm pack` 清单正确 |

**v0.2 出口实测（2026-11-20，`116ed9c`）**：M1/M2 自动化与手工主链路通过；M3 的只读画布、详情与引用通过，但「真 agent 出一张图」仍未完成；M4 自动化通过，MAN-10 因无模型与 QA-17-01/02 未闭环。V2-a/b/d 不通过，v0.2 不发布。详见 [10 §1/§5](10-qa-v0.2.md)。

### 11.3 合并 main 前回归清单（必须逐项勾选）

> 顺序固定：先本地全绿，再安装冒烟，再手工 AC，最后推送。任何一项失败都停在本分支修复。

- [ ] 1. `git status` 干净，当前分支 `dev`，已 rebase/合并 main 最新提交
- [ ] 2. `git log --oneline main..dev` 只包含本次迭代的提交，提交信息符合约定
- [ ] 3. `npm ci`（或 `npm install`）exit 0；无未锁定依赖
- [ ] 4. `npm run check` exit 0
- [ ] 5. `npm run fixtures:check` 通过
- [ ] 6. `npm test` exit 0；记录 tests/pass/fail/skip/todo 数字
- [ ] 7. `npm pack --dry-run` 清单：含 src/locale/docs/README/LICENSE/icon/patch，不含 test/scripts/tgz
- [ ] 8. §3.4 安装冒烟全部通过（记录 DSH 版本与 commit）
- [ ] 9. v0.1/v0.2 对应 AC 手工走查通过；v0.3 范围按 MAN-14/15
- [ ] 10. 双主题、双语、键盘走查（MAN-13、MAN-07）通过
- [ ] 11. 文档同步：README 安装说明、`docs/05-dev.md`、`CHANGELOG.md`、本文状态与基线数字
- [ ] 12. 版本号与 tag 计划确认；main 合并后复跑 §3.4 与 `/health`
- [ ] 13. 推送 GitHub 仓库成功（当前 public）；记录 commit 与远端分支
- [ ] 14. 合并后在干净 clone 中执行一次 `npm ci && npm run verify`（防“只在本机绿”）

### 11.4 失败处理

| 失败类型 | 处理 |
|---|---|
| 单测/集成失败 | 阻断合并；修复或按 §3.3 登记 skip（需负责人+截止里程碑） |
| 夹具校验失败 | 阻断；确认是生成器变更还是误改；不得手改 manifest 绕过 |
| 安装冒烟失败 | 阻断发版；保留 DSH 日志与安装路径，回退上一可用 commit |
| 手工 AC 失败 | 关联 FR 开缺陷；修复后重跑该条，不因“其他用例通过”而放行 |
| 性能超标 | 记录采样环境与 p95；未达 NFR-01 不得宣称 M3/M5 完成 |

## 12. 基准与证据记录

性能与资源数据记录格式（每次采样追加一行，环境必须写明）：

```text
日期 | commit | 样本 | 指标 | 值 | 工具/方法 | 结论
2026-11-19 | d7eac44 | pdf-text-10p.pdf | 解析耗时 | 待测 | node scripts/bench.mjs | 待 M2
```

- 解析/分块基准：复用 `scripts/gen-fixtures.mjs --large` 产物，测 3 次取中位数。
- 画布帧率：DevTools Performance 录制 5 s 拖动，读 p95 帧间隔；同时记录节点数与缩放级别。
- 内存：解析前后 `process.memoryUsage().heapUsed/rss`，大文件用独立进程避免干扰。
- 所有基准脚本在 M2 建立；未建立前，NFR 相关结论只能标“待测”，不得估算充当证据。

### 12.1 v0.2 QA 采样（2026-11-20）

| 项 | commit / 环境 | 结果 |
|---|---|---|
| 全量门禁 | `116ed9c` / Node 24.19.0 / DSH 0.2.2-rc.5 | `npm run verify` exit 0；347 tests / 310 pass / 0 fail / 37 todo；client.js 189,832 B |
| 夹具 | 同上 | 9 个 + manifest，`fixtures:check` 一致 |
| 全新安装 | qa-v02 profile | CLI `link` 约 391 ms；health 200、storage ok |
| 手工 AC | qa-v01/qa-v02 | AC-01/02/03/04/05/07/09 通过；06/08 部分；10 未验证 |
| 缺陷 | 同上 | QA-17-01/02 高危阻塞；03/04/05 中低危；06 环境阻塞 |

逐条证据、导出样例与未验证清单见 [10 v0.2 QA](10-qa-v0.2.md)；性能数字仍按本节格式另行采样，不能拿本轮功能 QA 充当 NFR-01 证据。

## 13. 与 02/03 的偏差与维护

| 编号 | 偏差 | 处理 |
|---|---|---|
| D-06-01 | 03 §12.3 写夹具在 `assets/fixtures/`，实际为 `test/fixtures/` | **已关闭（2026-11-19 文档门禁）**：03 §12.3/§2.1 已改为 `test/fixtures/`；`assets/` 只放截图与发布素材。 |
| D-06-02 | 03 §12.4 的 AC 语义与 02 §9.1 不一致（03 把 AC-03 写成画布性能、AC-05 写成笔记等） | **已关闭（2026-11-19 文档门禁）**：03 §12.4 已按 02 §9.1 重写；本文 §8 编号与之一致。 |
| D-06-03 | 03 §12.3 列 8 个夹具，实际 9 个（新增 `pdf-text-10p.pdf`） | **已关闭（2026-11-19 文档门禁）**：03 §12.3 已列 9 个夹具 + `manifest.json`。 |
| D-06-04 | 夹具加入中文 PDF，使用 ToUnicode 而非嵌入字体 | 只为文本抽取；渲染字形不在验收内。若 pdfjs 实测无法抽取，M2 改为嵌入开源子集字体并重生成 |
| D-06-05 | 安装冒烟与手工 AC 尚未执行 | **部分执行（2026-11-20）**：v0.2 QA 在 qa-v01/qa-v02 做了 CLI 安装与 AC-01..09 走查（[10](10-qa-v0.2.md)）；§3.4 的 5807 桌面 8 步、AC-10 离线仍未执行，继续标「待执行」。 |
| D-06-06 | `FR-11` 的注入机制按 03 §14 第 2 条改为 `agent.followup` | **已关闭（2026-11-19 文档门禁）**：02 FR-11/DR-07 已同步；测试断言以“会话流出现同一问答”为准，不绑定 `commands.execute`。 |

维护规则：

1. 需求新增/改号 → 先改 02，再改本文矩阵，最后加用例；三者编号必须一致。
2. 用例改号 → 同步矩阵、`test/skip.txt`、任务系统；`docs-contract.test.js` 会因引用缺失而失败。
3. 每次发布前更新 §1.3 基线数字与 §2.1 环境表；过期数字视为文档缺陷。
4. 本文不写“已验证”除非有对应命令输出或 §8.4 证据；未执行的安装/手工项统一标“待执行”。
