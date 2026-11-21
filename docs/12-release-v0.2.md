# v0.2 发布说明（v0.2.0 / v0.2.1）

> 状态：**v0.2.0 发布定稿（2026-11-21）；v0.2.1 补丁说明（2026-11-21）**；当前包版本 `0.2.1`。
> 维护：docs（qa/docs）；评审：架构 + 工程 + 发布负责人
> 适用范围：`dsh-reading-lab` v0.2 发布范围。v0.2.0 的 tag 与 GitHub Release 已发布（[v0.2.0](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.0)）；v0.2.1 的 tag、推送与 GitHub Release 也已发布（[v0.2.1](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.1)）。
> 更正记录：QA-40-02——本文旧版第 5、84 行曾把 v0.2.0 的 tag/Release 写成待发布状态，与已发布事实不符，本次按事实改写。
> 更正记录：QA-44-02（2026-11-21，t45）——本文旧版第 5、60、135 行仍称「v0.2.1 的 tag、推送与 Release 尚未执行，由 t43 完成」，而 t43 实际已在 2026-11-21 完成 tag `v0.2.1`、推送 `main` 与 GitHub Release。错在把「发布步骤待办」的措辞留在了发布之后：这几行是发布前的预期描述，发布完成后未回填结果，读者会以为补丁版还没发出去。现按事实改为已发布并补 Release 链接，版本状态与 §7 门禁表同步。

## 1. 发布结论

- 版本：`0.2.1`（补丁；`package.json`、`package-lock.json`、`/health.pluginVersion` 同源，见 §7）。`0.2.0` 是基线版本。
- 范围：v0.2 能力集——EPUB/文本 PDF 导入、带引用导图与只读画布、卡片详情与引用跳转、研究笔记（只读）、询问 AI 浮层与线程、Markdown/OPML/JSON 导出、自选书库位置与生成状态可判定。
- 不包含：v0.3 的节点编辑（t19）、HTML/PNG/SVG 导出（t21），以及 `generate-notes`、搜索/小地图、多章并行、1000 节点性能与 i18n/a11y 收尾。
- 发布裁决：按方案 A 发布 v0.2 能力集；已知限制在 §4 逐条披露，不把未执行项写成已通过。v0.2.1 只修缺陷，不扩范围。
- v0.2.1 的定位：修复 [QA-40-01](#2-补丁版本-v0212026-11-21) 线程回写竞态导致的永久 `running`；不新增能力、不改数据格式。

## 2. 补丁版本 v0.2.1（2026-11-21）

### 2.1 用户可见症状

- 提问后卡片一直显示「思考中」，线程停在 `running`，点「停止」也无法结束。
- 重启后该线程仍可能是 `running`；再次提问可能复用旧状态。
- 该问题与模型是否真的返回无关：宿主在把回答写回本地存储时出错，也能让线程永久停住。

### 2.2 根因（QA-40-01）

旧实现在收到 Agent 事件时先 `takePending`：把待回写记录从 `pending` 中**取出并消费**，然后才读 chunks/线程/消息并写回。若写回路径抛错（本地存储不可写、文件损坏、消息不存在等），记录已经被消费，失败处理与超时看门狗都找不到它：

- 线程状态不会被置回 `idle`，消息也拿不到 `failed`；
- `pending` 桶里留下空数组，`pending.size` 看起来非零，进一步掩盖了泄漏；
- 用户看到的只有「一直思考」，没有任何可重试的错误提示。

IT-ASK-05 的偶发失败是该竞态的下游表现之一；测试侧另有 `captureSse` 在事件早于 `hello` 帧到达时漏帧的假红。

### 2.3 修法

`src/host/ask.js`：

- **先确认可写，再消费**：`claimPending(agentId)` 只在记录上打 `inFlight` 标记，记录仍留在 `pending`；新增 `releasePending(record)` 在成功路径末尾显式释放。
- **成功顺序**：读 chunks/线程/消息确认可写 → `appendMessage` 写入 assistant `done` → `setThreadState(idle)` → 最后释放 pending。
- **失败闭环**：`handleSessionEvent` 的异常统一走 `failPending(record,'writeback')`——消息置 `failed`、`error:'E_AGENT'`、文案「回答写入失败（本地存储不可写或已损坏），可以重试或重新提问」；线程置 `idle`；写 warn 日志并推 SSE `thread{failed:true,reason:'writeback'}`；`finally` 保证释放。
- **次级场景**：问题消息缺失 → 线程 `idle` + warn；线程非 `running` 或消息已 `stopped` → 忽略该回答并释放；空文本 → 只清 `inFlight`，留给后续消息或超时看门狗。
- **幂等与并发**：同一 `messageId` 已有 assistant 消息则跳过；`withThreadLock(threadId)` 让同一线程的并发回写串行；`failPending`/`releasePending` 在桶空时删除键，避免 `pending.size` 假非零。

### 2.4 影响面

- 只影响「询问 AI」的线程回写路径；路由、错误码、`threads.json` 结构与设置文件均不变。
- 无数据迁移：升级到 `0.2.1` 不需要改 `threads.json` 或 `settings.json`；若升级前已有卡住的线程，先按 §6 排查，不要手工改状态。
- 失败时用户第一次能看到明确错误与重试入口，而不是无限等待。

### 2.5 回归证据

- 新增 `test/unit/ask-writeback.test.js` 6 条：成功写入；故障注入 `readChunks` 抛错 → `failed` + `idle` + 错误可见 + SSE + warn；同一 `messageId` 并发只写一条；`claim` 不消费 + `inFlight` 不重复认领 + 看门狗收尾；`stop` 后迟到回答忽略；问题消息缺失也回 `idle`。
- `test/integration/ask-route.test.js` 的 `waitForThread` 由 8 s 固定等待改为 15 s 条件等待；`generate-map-observe` 的 `captureSse` 发事件前先等 `hello` 帧，修掉漏帧假红。
- v0.2.1 干净 worktree 连续 3 次 `npm run verify` exit 0：**432 tests / 65 suites / 395 pass / 0 fail / 37 todo**；`ask-route` 单跑 5 次 6/6，`generate-map-observe` 单跑 3 次 10/10。
- 如实记录：v0.2.0 后的 7 次全量运行中有 1 次 IT-ASK-05 抖动，已定性为该竞态的下游表现；修复后 3 次连续通过，但**不把门禁称为「稳定绿灯」**。

### 2.6 版本状态

- `package.json` / `package-lock.json` 已为 `0.2.1`；`/health.pluginVersion` 由 package 读取。
- v0.2.1 的 tag `v0.2.1`、`main` 推送与 GitHub Release 已于 2026-11-21 执行完成（t43），Release 地址 <https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.1>；tag 指向 `release: v0.2.1` 提交，与 `package.json` 的 `0.2.1` 同源。

## 3. 发布范围与能力清单

| 能力 | v0.2.1 状态 | 需求/接口 |
|---|---|---|
| EPUB 3 / EPUB 2（NCX）导入、分块、目录 | 已实现并实测 | FR-01/02，04 §4.2 #3–8 |
| 文本型 PDF 导入（零依赖解析、中文 ToUnicode） | 已实现并实测；边界见 §4 | FR-05，04 §4.2 #9 |
| 扫描版/加密 PDF 识别与拒绝 | 已实现；扫描版返回 `E_SCANNED` | FR-05，04 §7 |
| 带引用导图生成、只读画布（平移/缩放/适应/展开） | 已实现 | FR-06/07，04 §4.2 #9–11 |
| 卡片详情、引用 chip、3 s 高亮跳转 | 已实现 | FR-09，04 §4.2 #12–16 |
| 研究笔记五节（只读展示） | 已实现；生成接口在 v0.3 | FR-10，04 §4.2 #10 |
| 询问 AI 浮层、快捷指令、线程落盘、会话留痕 | 已实现；v0.2.1 修回写竞态，真实回答依赖模型提供方 | FR-11/12/13，04 §4.2 #17–26 |
| 导出 Markdown / OPML / JSON | 已实现；HTML/PNG 不在本版 | FR-15，04 §4.2 #22–25 |
| 自选书库位置、迁移/回滚、`isFallback` 可见 | 已实现并现场手测 | FR-16，04 §4.2 #31–32 |
| 生成状态可判定（排队/运行/空闲/绝对上限） | 已实现并回归 | FR-17，04 §4.2 #9–10 |
| 中文 UI、亮暗主题 | 中文已验；英文/暗色未做发布级截图（AC-08 部分） | NFR-07/08 |

## 4. 已知限制

1. **扫描版 PDF 不支持 OCR**：首/中/末 3 页有效字符 <20 判为无文本层，导入结果为 `unsupported` 并返回 `E_SCANNED`，不写 `chunks.json`；需换文本版 PDF。
2. **部分 PDF 特性不支持**：加密/DRM、`LZW`/`DCT` 滤镜、线性化与增量更新按契约拒绝；不渲染页面图像。
3. **`generate-notes` 在 0.3.0**：本版 `/health.capabilities.generateNotes` 为 `{available:false, availableIn:"0.3.0"}`，接口返回 501；研究笔记只读展示。
4. **AC-06 未验**：无模型提供方的环境无法完成「真实回答 + 引用回写」，本版不以线程状态代替回答验证；有 provider 的 profile 需按 MAN-10/16 复测。
5. **v0.3 延后项**：节点编辑与变更审阅（t19）、HTML/PNG/SVG 导出（t21）、跨书搜索/小地图、多章并行、1000 节点性能指标、i18n/a11y 全量收尾。以上均**未包含**在本版，属于下一轮。
6. **未执行项**：XMind/Mubu 导入未实测；100 MB 上限只做了契约断言；离线场景（AC-10）未单独跑；v0.2.1 未在真实宿主复测 GUI 点击与 link 安装（见 §7）。

## 5. 安装方式

前置：DSH ≥ `0.2.2-rc.1`；从源码安装时 Node ≥ `22.19.0`，先 `npm install && npm run build:client`。

### 5.1 link 安装（开发/本地推荐）

```text
plugin_manager action="install_bundle"
               target="link:D:\\Qunar\\personal\\dsh\\dsh-reading-lab"
```

- profile 的 `node_modules/dsh-reading-lab` 是指向仓库的 Junction；改代码立即反映到磁盘，但**已加载的 Host 模块需重启 DSH**，Client 改动需 `npm run build:client` 后刷新页面。
- `link:` 不能覆盖已有安装；切换形式前先 `remove_bundle`。
- 安装结果看 `application`、`warnings`、`pendingBuilds`；出现 `restart-required` 必须重启。

### 5.2 file 安装（复制快照）

```text
plugin_manager action="install_bundle"
               target="file:D:\\Qunar\\personal\\dsh\\dsh-reading-lab"
```

- `file:` 在 pnpm 下是**复制**，不是链接；安装后仓库改动不会同步到 profile，升级或改代码都要重新安装。
- 适合固定版本验收；不要用它做日常开发循环。

安装后按 05 §6.3 的九项验证，至少确认：插件行出现、侧栏图标可开面板、`GET /health` 返回 `storage:"ok"` 且 `pluginVersion:"0.2.1"`、`GET /events` 首帧 `hello`。

## 6. 升级注意

- **数据位置**：书库默认在 workspace 的 `reading/`；可用 `PUT /settings/library-root` 改到自选目录。设置文件为 `$DSH_HOME/reading-lab/settings.json`，本版只认 `{schemaVersion:1, libraryRoot}`，不手工编辑 profile。
- **settings.json 兼容**：`0.1.0 → 0.2.0 → 0.2.1` 均不改变该文件结构；缺失时按「workspace → cwd」解析。JSON 损坏时 `settingsError:"settings-corrupted"`，面板显示 `role=alert` 警告，不会静默当作正常。
- **旧书迁移**：升级本身**不移动**已有书。改根时 `moveExisting:true` 迁移 `books/`、`exports/`、`inbox/`、`index.json`；`moveExisting:false` 保留旧根文件，切回旧根即可见。目标非空返回 400 `E_PATH`（`target-not-empty`），源目录不动；迁移失败回滚，不要手工合并两份书库。
- **`0.2.0 → 0.2.1`**：只需替换包并重启 Host；无 `threads.json` / `settings.json` 迁移。若升级前已有卡住的线程，先按本节排查，不要手工改状态。
- **备份与回滚**：发布前备份 `reading/` 与 `settings.json`；回滚安装用 `git switch --detach v0.2.0` 后重建并重启，数据目录不受影响。

## 7. 发布门禁证据

| 项 | 结果 | 证据 |
|---|---|---|
| 版本号 | `0.2.1` | `package.json` / `package-lock.json`；`/health.pluginVersion` 由 `package.json` 读取（`src/host/respond.js`） |
| Client 构建一致 | 通过 | `node scripts/build-client.mjs --check` → `client.js is up to date (234560 bytes)` |
| 自动化门禁 ×3（v0.2.1） | 通过 | 干净 worktree 连续 3 次 `npm run verify` exit 0：`432 tests / 65 suites / 395 pass / 0 fail / 37 todo` |
| 自动化基线（v0.2.0） | 通过 | `.qa-t35b @ fe84419` 连续 3 次 exit 0：`426 tests / 64 suites / 389 pass / 0 fail / 37 todo` |
| 夹具 | 通过 | 9 个夹具与 `manifest.json` 一致；扫描版/损坏/越界路径均按契约拒绝 |
| QA-35-01..05 | 全部关闭 | `fe84419`；阶段预算、定时器代际、事件归因、`settingsError`、测试窗口修复，见 [11](11-qa-fix.md) §7/§11 |
| QA-40-01 | 已修复并回归 | `d3383a8`；回写顺序、失败闭环、幂等/串行与 6 条故障注入测试，见 §2 |
| 现场手测（v0.2.0） | 通过 | `rootPath=D:\Qunar\personal\dsh\reading`、`rootSource=settings`、`isFallback=false`，`GET /books` 返回 5 本（2026-11-21 记录） |
| 文档链接 | 通过 | `docs/` 相对链接检查 0 断；`npm run verify` 含文档契约 |
| tag / Release | v0.2.0、v0.2.1 均已发布 | [v0.2.0](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.0)、[v0.2.1](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.1)（均 2026-11-21；v0.2.1 由 t43 执行） |
| 门禁稳定性 | 不称「稳定绿灯」 | v0.2.0 后 7 次全量中 1 次 IT-ASK-05 抖动，已定性为 QA-40-01 下游并修复；v0.2.1 连续 3 次通过，仍需更长观察窗口 |

## 8. 相关文档

- [02 需求](02-requirements.md) §6/§9：版本范围、AC 与发布门禁（编号权威）
- [04 接口](04-api.md) §4.2：路由、错误码与生成状态/存储位置契约
- [05 开发](05-dev.md) §6/§10：安装、重载、发布步骤与回滚
- [07 清单](07-checklist.md) §9：可执行发布门禁
- [10 v0.2 QA](10-qa-v0.2.md)：v0.2 实测矩阵与缺陷
- [11 修复验收](11-qa-fix.md)：QA-35-01..05 与现场门禁