# 文档变更记录

只记录 `docs/` 下的文档变更；产品与仓库级变更见根 [CHANGELOG](../CHANGELOG.md)。格式对齐 Keep a Changelog：新增 / 修订 / 修正 / 关闭偏差。

## [Unreleased] - 2026-11-22

### 修订

- [13 UI 重构规划](13-ui-rework-backlog.md)：R4 标为已落地（排序 + 隐藏，宽度拖动待做）、R8 标为「图标化/HUD/书架折叠已做，节点折叠与卡宽待做」，新增 [§8 第二批进度](13-ui-rework-backlog.md)（m01703 五项反馈的落点表与验证数据）。
- [05 开发指南](05-dev.md)、[06 测试方案](06-test.md)：仓库可见性由 private 改为 public（`gh repo create --public`，发布说明按公开文档标准书写）。
- [13 UI 重构规划](13-ui-rework-backlog.md)：R2 导出目录、R1 顶栏纯图标化标为已落地，并新增 [§7 本轮进度：feat/ui-polish](13-ui-rework-backlog.md)（六项反馈的落点表、导出目录实现细节与坑、验证数据、R4/R8 待办）。
- [13 UI 重构规划](13-ui-rework-backlog.md)：R1/R3/R10 标为已落地、R7 标为地基、R8 标为部分落地，并新增 [§6 本轮进度](13-ui-rework-backlog.md)（落点表、验证数据、未做项、重启后的手动验收清单）。

### 新增

- [13 UI 重构规划](13-ui-rework-backlog.md)：按 2026-11-22 用户评审记录 UI-01..11 问题与 R1–R10 改造项（设置统一入口、存储/导出路径可选、toast 反馈、书架排序、整书生成、内嵌分析栏、视图切换、图标化与折叠、AI 两级入口、视觉 token），附技术方案、未验证项与「每项独立分支」约定；同目录存入改造前截图 `assets/ui-before-v0.2.1.png`。

### 修正

- **QA-44-02**：[12 发布说明](12-release-v0.2.md) 第 5、60、135 行仍称 v0.2.1 的 tag/推送/Release「尚未执行，由 t43 完成」，而 t43 已于 2026-11-21 完成发布。错在把发布前的预期措辞留在了发布之后、没有回填结果；现按事实改为已发布并补 [v0.2.1 Release](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.1)，并在文首补更正记录。
- [06 测试](06-test.md) §3 补「等待窗口可配置」约定：集成测试不再用固定短 sleep 赌调度，统一为环境变量可覆盖的轮询窗口（`RL_WAIT_STATE_MS`、`RL_WAIT_THREAD_MS`、`RL_SSE_WINDOW_MS`、`RL_SSE_DRAIN_MS`、`RL_GEN_IDLE_MS`/`RL_GEN_TICK_MS`），任意 `listen(0)` 抽到 undici bad port 时自动重开。

## [0.2.1] - 2026-11-21

### 新增

- [12 发布说明](12-release-v0.2.md) 增「补丁版本 v0.2.1」：QA-40-01 的用户症状、根因、修法、影响面与故障注入回归证据；补 v0.2.1 门禁证据与 tag 状态。

### 修订

- [07 清单](07-checklist.md) §9：G-10 改为 `v0.2.0` tag/Release 已完成、v0.2.1 待 t43；G-02 更新为 432/395；G-06/G-08/V2-d 的 12 章节引用随重编号改为 §4；发布裁决明确不勾选「门禁稳定绿灯」。
- [README](README.md) 状态与 12 行描述更新为 v0.2.1；[根 README](../README.md) 状态行、版本与验证数字同步。

### 修正

- **QA-40-02**：12 旧版第 5、84 行称 tag/Release 未执行，与 v0.2.0 已发布不符；按 [v0.2.0 Release](https://github.com/fountainhead-gq/dsh-reading-lab/releases/tag/v0.2.0) 改写，并明确 v0.2.1 的 tag/push/Release 未执行。

## [0.2.0] - 2026-11-21

### 新增

- [12 发布说明](12-release-v0.2.md)：v0.2.0 范围、能力清单、已知限制、link/file 安装、升级与迁移注意、门禁证据。
- [07 清单](07-checklist.md) §9 按证据更新发布门禁；V2 组补 v0.2.0 发布裁决。
- [README](README.md) 索引加入 12；根 [README](../README.md) 状态与功能表更新为 v0.2.0。

### 修订

- [03 设计](03-design.md) §5.4 示例与 [04 接口](04-api.md) §4 `pluginVersion` 示例更新为 `0.2.0`，与 package 版本一致。
- 文档状态一览行数与编号表补 12；版本说明不再写「暂不发布」。

### 修正

- 发布口径统一为「v0.2 能力集」：v0.3 的节点编辑与 HTML/PNG 只写「未包含/下一轮」，不写成已交付。
- 发布时曾把 tag / GitHub Release 标为未执行；v0.2.0 发布后已在 0.2.1 小节按事实更正。AC-06 仍标「未验」，不以自动化结果替代。

### t36 文档同步：存储路径与生成预算（2026-11-20）

#### Renamed

- 术语统一：「生成超时」改为「活动感知的三段预算」；「180 s 看门狗」仅作为历史说法保留在偏差记录里。无文件或编号改名。

#### Added

- [02 需求](02-requirements.md)：新增 FR-16（书库存储位置）、FR-17（生成状态可判定）与 AC-11/AC-12；§9.2 手工门禁纳入两条新 AC。
- [06 测试](06-test.md)：§6.2 增 FR-16/17 行，§8.1 增 AC-11/12 行，§8.2 增 MAN-16；覆盖检查改为 FR-01..17 / AC-01..12。
- [07 清单](07-checklist.md)：新增 M4-24（自选存储路径）、M4-25（根解析回退可见）、§8 安装验证第 13 步；V2-b/V2-d/G-06 纳入 AC-11/12。
- [README](README.md)：索引加入 [11 修复验收](11-qa-fix.md)，编号表更新为 FR-01..17 / AC-01..12。

#### Changed

- [03 设计](03-design.md)：§5.1.1 收紧 `isFallback` 语义（只有 `process.cwd()` 兜底为 `true`，设置损坏与路径不可用必须由 `settingsError` 解释）；§7.5 补「排队看认领、认领后看活动、绝对上限只管失控回合」与 FR-17 引用。
- [04 接口](04-api.md)：§4.2 #9 标 FR-17/AC-12，存储位置 #31–32 标 FR-16/AC-11。
- [05 开发](05-dev.md)：§7.4 补改根后旧书位置、`moveExisting:false`、迁移/回滚、切回旧根、旧进程识别与三类回退排查。

#### Fixed

- 修正「设置损坏 = `isFallback`」的误读；回退与设置错误在 03/05/07 三处口径一致。
- 补上 docs 索引缺失的 11 号文档，修复验收报告不再是孤岛。

### 新增

- **2026-11-19** 建立文档索引 [README](README.md)：阅读顺序、编号权威、同步规则与状态一览。
- **2026-11-19** 新增 [07 里程碑清单](07-checklist.md)（M1–M5 DoD、发布门禁 11 条）。
- **2026-11-19** 新增 [08 开发前文档门禁报告](08-doc-gate.md)（文件清单、检查项、修正记录、结论）。
- **2026-11-19** [01 调研](01-research.md)：竞品对比、DSH 槽位/服务表、EPUB/PDF 解析实测、依赖与风险 R-01..08。
- **2026-11-19** [02 需求](02-requirements.md)：US-01..04、FR-01..15、NFR-01..12、AC-01..10、7 项决策 DR-01..07。
- **2026-11-19** [03 设计](03-design.md)：架构、文件所有权、数据契约、UI、算法、错误与里程碑。
- **2026-11-19** [04 接口](04-api.md)：25 条 HTTP 路由、6 个 agent 工具、SSE、错误码、契约测试 C-01..12。
- **2026-11-19** [05 开发](05-dev.md)：环境、命令、Client 拼接构建、安装/重载矩阵、调试与发布。
- **2026-11-19** [06 测试](06-test.md)：L0–L5 分层、FR/AC 矩阵、9 个夹具、手工验收与门禁。
- **2026-11-20** 新增 [09 v0.1 QA 记录](09-qa-v0.1.md)：t11 实测归档（21 项路由探针、7 个缺陷、门禁对照、未验证项）。
- **2026-11-20** 新增 [10 v0.2 QA 记录](10-qa-v0.2.md)：t17 实测归档（347 项自动化、FR/AC 矩阵、PDF 边界、AI 交互、导出样例、QA-17-01..06、放行条件）。

### 修订

- **2026-11-20 t37 阶段预算与事件归因** [03](03-design.md)：§7.5 新增「阶段截止与定时器代际（QA-35-01）」——排队期只比 `queueTimeoutMs`、认领后只比 `lastActivityAt + idleTimeoutMs` 并与绝对上限取先到者，未到点的提前回调重新武装，定时器回调按自身句柄做代际自检，过期回调不得删除新定时器；新增「agent 事件的归因（QA-35-02）」——事件带 `turn.messageId`/`message.id`/`promptId` 时只命中 `promptId` 相同的记录，无 id 且仅一条候选才归因，多候选不归因（`info` 日志 + 预算兜底），`agent/error` 只失败 `running` 记录，`agent/status running` 不再广播认领，`agent/disposed` 仍为 agent 级终态。[04](04-api.md)：§4.2 #9 补「阶段截止与事件归因（QA-35-01/02）」说明；§4.2 存储位置的 `GET /settings` 示例与说明补 `settingsError`（`settings-corrupted` 等，与 `/health` 同源）。
- **2026-11-20 t37 低危三则** [03](03-design.md)：§5.1.1 的存储位置警告以 `settingsError` 为准（设置文件损坏时面板必须显示可见文案，不再只写日志）。[07](07-checklist.md)：M3-07 补 t37 证据（UT-GEN-15..19、observe 跨书归因用例、`settingsError` 路由与渲染用例、ask-route 条件等待）。

- **2026-11-20 t33 迁移目标空目录** [03](03-design.md)：§5.1.1 迁移段改为「目标同名条目是空目录则复用，装了东西才 `E_PATH{reason:'target-not-empty'}`，不静默合并」；[04](04-api.md) §4.2 #32 同步该语义（真机手测第一次尝试即撞上：目标根已由 `ensureLayout` 建好，旧实现会误拒）。

- **2026-11-20 t33 存储位置** [03](03-design.md)：§5.1.1 新增「书库根解析与自选存储路径」——三段解析顺序（设置文件 → `workingDirectory` → cwd 兜底）、`isFallback` 语义、设置与 profile 解耦、迁移事务与回滚、`rootPath` 作为唯一可信来源。[04](04-api.md)：路由表新增 #31 `GET /settings`、#32 `PUT /settings/library-root`，并补 §4.2「31–32. 存储位置」规格（字段、校验顺序、错误码、迁移/回滚语义）。[05](05-dev.md)：§7.4 补改根命令、settings.json 位置、回退排查与「不要改 profile」的警告。
- **2026-11-20 t34 活动感知生成预算** [03](03-design.md)：§7.5 把「180 s 看门狗」改为三段预算（`queueTimeoutMs` 60 s / `idleTimeoutMs` 180 s / `maxDurationMs` 30 min），写明活动证据（`agent/inbox/claimed`、`agent/status` running、`reading_map` 工具调用）与 `claimedAt`/`claimEvidence` 语义，并记录真实宿主误报（agent 已 commit、状态却 timeout）。[04](04-api.md)：§4.2 #9 的 202 与状态查询补 `claimedAt`、`claimEvidence`、`lastActivityAt`、`lastActivityKind`、`idleMs`、`budget`（`timeoutMs` 降级为「当前阶段预算」兼容字段）；状态机图与 `reason=timeout` 三义对齐实现。[07](07-checklist.md)：M3-07 补 t34 证据（单测 UT-GEN-11..14、集成「活动不断跨过旧预算」、渲染「最近活动」）。
- **2026-11-20 t20 引导式学习** [03](03-design.md)：新增 §5.7 `tutor.json`（路径/步骤/掌握状态/游标/线程关联，含导图重生成后的迁移规则）；`index.json` 与 `import.log` 顺延为 §5.8，写入并发与版本迁移改为 §5.9/§5.10（D-20-01）。
- **2026-11-20 t20 引导式学习** [04](04-api.md)：路由表新增 #27–#30 与 §4.2「27–30. 引导式学习」规格（`stepId` 校验、201/202、错误码）；§5.7 `reading_tutor` 由「v0.3 预留」改为 as-built 四动作、`TutorDoc` 与规则（D-20-02）。
- **2026-11-20 t20 引导式学习** [06](06-test.md)：v0.3 扩展表中的引导式学习行改为已实现，列 UT-TUTOR-01..09、IT-TUTOR-01..06、`tutor-render.test.js` 并注明 D-20-03。
- **2026-11-20 t20 引导式学习** [07](07-checklist.md)：M5-07 勾选并附证据与未做项；Q-10 裁决为单条路径最多 60 步；§10 新增 D-20-01..03。

- **2026-11-20 t31 浮层焦点与引用** [07](07-checklist.md)：M4-13 由 `[~]` 改 `[x]`（打开即聚焦、Tab 环绕、Esc + 焦点归还、三元互斥、背景 `inert`/`aria-hidden`，证据 `ask-focus.test.js` ①–④），登记 D-31-01（`aria-modal` 改 `true`）、D-31-02（触发按钮已卸载时不强行归还）；M4-15 由 `[ ]` 改 `[x]`（引用 chip 可点、预览 + 高亮 3 s、「查看这张卡片」、失效引用不可点），并注明笔记面板的「生成笔记」为禁用态。

- **2026-11-20 t32 导出引用与 schema** [03](03-design.md)：§9.2 改为「行内 `[c-000003]` + 文末 `## 引用` 表」并写 as-built（弃用 `reading://`）；§9.3 的 `_note` 明确携带引用原文；§9.4 补 `citations` / `citationCount` / 每节 `citationIds`、`map:null`、schema 路径与零依赖校验器位置。
- **2026-11-20 t32 导出引用与 schema** [04](04-api.md)：§4.2 #1 的 `/health` 示例与说明补 `generateNotes`；#10 的 501 写明 `feature` / `availableIn` 与 v0.3 文案；#22 新增「导出物的正式契约」表（json → `schema/export-v1.schema.json`，嵌套 map + 引用两层，加字段的兼容策略）。
- **2026-11-20 t32 导出引用与 schema** [07](07-checklist.md)：M4-17 由 `[~]` 改 `[x]`（schema 入库 + UT-EXP-10 / IT-EXP-02 实跑）；D-16-02、QA-17-03（Host 侧）、QA-17-04、QA-17-05 标已关闭。
- **2026-11-20 t18 v0.2 文档同步** [01](01-research.md)：新增 §3.7「v0.2 实机回填」——依赖为空、零依赖 PDF 能力边界、扫描判定、AI 交互与导出实测；§3.1–§3.6 保留为选型期证据。
- **2026-11-20 t18 v0.2 文档同步** [02](02-requirements.md)：§9.2 补 v0.2 实测状态（通过/部分/未验证与阻塞），链接 10，验收标准不下调。
- **2026-11-20 t18 v0.2 文档同步** [03](03-design.md)：§6.4 补 PDF QA 实测；§8.2 `source` 改为 `{kind:'reading-lab', form:'ask',…}` 并记 D-10-01；§9.2 标注笔记导出 `[[c:…]]` 未统一的已知缺口。
- **2026-11-20 t18 v0.2 文档同步** [05](05-dev.md)：新增 §6.8 v0.2 安装与 QA 记录（qa-v02、391 ms、health/capabilities、重启恢复），并区分 5807 手工冒烟。
- **2026-11-20 t18 v0.2 文档同步** [06](06-test.md)：§3.4 更新安装说明（保留「待执行」与「尚未执行过安装验证」限定）；§6.1/§6.2 状态改为 v0.2 已实现及 QA 结果；§7 C 表按 QA 结果；§8.1 补 AC 实测；§9 刷新 NFR；§11.2 记录 V2 不通过；新增 §12.1；D-06-05 改「部分执行」。
- **2026-11-20 t18 v0.2 文档同步** [07](07-checklist.md)：M4-04/13/15 补 QA-17 证据；§3.2 明写 V2-a/b/d 不通过；§10 新增 QA-17-01..06，D-05-02 改已关闭。
- **2026-11-20 t18 v0.2 文档同步** [README](README.md)：状态改「v0.2 功能实现完成，QA 未通过」；读表加 10，路由数改 27；[08](08-doc-gate.md) 后续说明补 10；根 README 状态与文档表同步。

- **2026-11-20 t16 导出（as built）** [04](04-api.md)：§3.5 补实现落点（`export/index.js` 等五个文件）；§4.2 #1 的 `capabilities.exports` 示例与说明改为真实可生成格式 `["md","opml","json"]`（原为「空数组 + 501」的 v0.1 口径）；§4.2 #22 状态由「未实现 501」改为「已实现（v0.2，t16）」，写清命名去重、`includeThreads`、只读输入、`E_IO{stage}`、`html` 501 / `png` 400 与就绪校验。
- **2026-11-20 t16 导出（as built）** [06](06-test.md)：FR-13 行补 `export.test.js`（8）、`export-route.test.js`（6）、`export-render.test.js`（3）与状态；C-12 行标注由工具信封与 JSON 结构断言覆盖。
- **2026-11-20 t16 导出（as built）** [07](07-checklist.md)：M4-16/M4-18/M4-19 勾 `[x]` 并补证据；M4-17 标 `[~]`（导出 JSON 结构见 D-16-02，仓库暂无 schema 文件）；M4-20 标 `[~]`（失败有 `lastError`，无重试按钮与进度）。
- **2026-11-20 t15 询问 AI 浮层（as built）** [03](03-design.md) §5.6：`threads.json` 的 `messages[]` 增加 `feedback`（`up|down|null`，D-15-02）与 `error`（失败码）字段并补约束行；§8.3 补「session/event 给 sessionId、注入只有 agentId」的匹配实现注记（D-15-04）；§8.4 补降级只做一次并写回（D-15-03）与失败三处可见（消息/SSE/日志）。
- **2026-11-20 t15 询问 AI 浮层（as built）** [04](04-api.md)：路由表新增 #26 `POST .../messages/:messageId/feedback`；#17-19/#20/#21 标注「已实现（v0.2，t15）」；#20 的 `E_AGENT` 由 422 更正为 502（与 `ERROR_HTTP` 及 t29 口径一致），补超时兜底、注入消息 `source` 与隐藏标记；§3.4 补 `setFeedback` 与实现落点（`threads.js` / `ask.js`）。
- **2026-11-20 t15 询问 AI 浮层（as built）** [06](06-test.md)：FR-11 行补 `threads.test.js`（9）、`ask.test.js`（8）、`ask-route.test.js`（6）、`ask-render.test.js`（6）与状态「v0.2 已实现（t15），真实宿主待手工」。
- **2026-11-20 t15 询问 AI 浮层（as built）** [07](07-checklist.md)：§3 M4 的浮层/快捷指令/追问/反馈条目改 `[x]` 并补证据；未做虚拟化/长线程性能的部分标 `[~]`。

- **2026-11-20 t12 v0.1 范围重划** [02](02-requirements.md)：v0.1 = M1 + EPUB 导入 + 导图/只读画布；FR-05（PDF）与 FR-09（详情/引用）标 `v0.2`，保留验收但移出 v0.1 出口；DR-04 与 §6 版本表同步，新增「范围变更记录」；AC-02/03/04 标 v0.2，AC-05/AC-09 按版本拆分。
- **2026-11-20 t12 v0.1 范围重划** [07](07-checklist.md)：新增 `[>]` 图例；M2-04..06、M3-13..17、E-M2-b/c（PDF）标 `[>]` 并注明 t13/t14；M2 出口改为 EPUB-only；新增 §3.0 移入项表；V1-b、V2-b、G-03、G-06、P-03/04、A11Y-03 与安装步骤 10 按版本改写；M2-10/M2-14 按 t28 契约修正。
- **2026-11-20 t12 v0.1 范围重划** [03](03-design.md)：新增 D-03-13 与 §1.6「Host 可选服务必须 `ctx.get()`」；§12.4 AC 表加版本列；§13 M2/M3 出口按 EPUB/只读画布改写；头部记录范围收窄。
- **2026-11-20 t12 v0.1 范围重划** [04](04-api.md)：§2.1 约束补 `ctx.get`；§2.3 `workspaceRoot` 解析改为 `workingDirectory.defaultDirectory` → registry → `list()` → `cwd`，与 `src/host/config.js` 一致。
- **2026-11-20 t12 v0.1 范围重划** [06](06-test.md)：FR-05/FR-09 行移入 §6.2 并标「v0.1 移入」；§6.1 加范围说明；§8.1 AC 表加版本列；MAN-03/MAN-05 拆分 v0.1/v0.2 判定。
- **2026-11-20 t12** [README](README.md)：状态改为「M1 已落地，v0.1 范围已收窄」；读表加 09，D-03 编号范围改为 01..13。
- **2026-11-20 t12** [08 门禁报告](08-doc-gate.md)：注明行数/字节为 2026-11-19 快照，后续以 09 与本文 CHANGELOG 为准。

- **2026-11-20 t13 PDF 与笔记（as built）** [03](03-design.md)：§6.3 的「PDF 分支尚未实现」改为指向 §6.4；§6.4 标题下新增「M2 实现记录」——`pdfjs-dist` 未引入、零依赖 `parse/pdf.js` 的解析范围与不支持项、`validatePdfContainer` 五条前置错误（含 `dangling-pages`，MAN-05 依据）、行聚类/补空格/分段口径、块页码取起始段落页、扫描判定的采样与 `effectiveChars` 口径。
- **2026-11-20 t13 PDF 与笔记（as built）** [04](04-api.md)：§4 #10 `generate-notes` 改为 501（v0.2 由 Agent 调 `reading_notes`），#15 补 `sections[] = {title, body}` 形状，`PUT /notes` 补 `E_UNSUPPORTED{feature:'notes.write',availableIn:'0.3.0'}`；§5.4 新增实现记录（`context` 多返回 title/sectionTitles/emptySectionText/notesPath、`sections` 过滤未实现、`rejected[].path` 形状、`read` 多返回 `sections`）。
- **2026-11-20 t13 PDF 与笔记（as built）** [05](05-dev.md)：§1.3 改为「三个依赖均未引入」并列出零依赖替代（`zip.js`/`xml.js`/`parse/pdf.js`）与解禁条件；§7.5 新增两条 PDF 症状（422 `E_PARSE` / 422 `E_SCANNED`）。
- **2026-11-20 t13 PDF 与笔记（as built）** [07](07-checklist.md)：M2-04..06 由 `[>]` 改 `[x]` 并逐条补证据（pdf.test.js / pdf-notes.test.js）、M2-10 覆盖范围补 PDF；M4-01/M4-02 勾 `[x]`，M4-03/M4-04 标 `[~]`（严格解析无「未识别小节」、generate 端点仍 501），M4-05 保留 `[ ]`。
- **2026-11-20 t14 卡片详情与引用跳转** [07](07-checklist.md)：M3-13..16 由 `[>]` 改 `[x]` 并补证据（`detail-render.test.js` 11 条、`assets/m4-detail-*.png` 四张）；M3-17 标 `[~]`——详情列表仅 1–3 条引用/追问，未做虚拟化，200 节点首屏未专项计时，余项归 t11 手工。
- **2026-11-20 t14 卡片详情与引用跳转** [06](06-test.md)：FR-09 行补 `detail-render.test.js` 与状态「v0.2 已实现（t14），真实宿主待手工」。

- **2026-11-20 t28 API 契约对齐（QA t11 四项）** [04](04-api.md)：`POST /books/import` 明确 `name` 必填及三种 400（`E_BAD_REQUEST{field:'name',reason:'missing'|'empty'}`、`E_PATH{reason:'name-traversal'}`，且校验先于读体、不落盘）；`/health` 示例的 `capabilities.exports` 改为 `[]` 并说明「导出生成未实现时不宣告、实现后填 `limits.exportFormats`」；`POST /books/:id/export` 补「v0.1/v0.2 统一 501 `E_UNSUPPORTED{availableIn:'0.2.0'}` + 中英文案」；#23/#24 补「空目录 200 + 惰性建目录、越界 400 不是 500」的现状；§1.2 补「显式 message 优先于 `error.<CODE>`」例外。
- **2026-11-20 t28 API 契约对齐** [03](03-design.md) §1.5：`capabilities.exports` 必须与导出路由真实能力一致（v0.1/v0.2 为空数组），列出/下载已有导出与本能力无关。
- **2026-11-20 t28 测试**：新增 `test/integration/route-contract.test.js`（16 条）覆盖导入 name 必填/穿越不落盘、导出空目录/排序/下载/404/穿越、`/health` 与 501 一致性；`fake-host` 与 `degraded` 的 `capabilities.exports` 断言同步为 `[]`。

- **2026-11-20 t27 样式 token 修复** [03](03-design.md) §4.4：token 表换成 138 个真实别名（新增 g-layer-1/order-l1/order-l2/label-primary-inverted，删掉不存在的 g-primary/separator-primary/order-l/order-secondary/label-inverse/label-error），补「禁止使用」清单与主按钮对比度成对规则；§4.2 引用失效文案同步为 state-error-primary。
- **2026-11-20 t27 样式 token 修复** [05](05-dev.md)：§7.5 症状表加「深色主题下边框/文字消失」，新增 §7.6 主题 token 契约（白名单测试、成对取色、label-on-color 为何不用于主按钮）。
- **2026-11-19 重启后实测（attempt 3）** [05](05-dev.md)：新增 §6.7.1——真实宿主（2728 端口）上的
  路由/agents/SSE 首帧/404-405 实测、`/health` 500 缺陷的根因与修复、Client 图标与面板的真实窗口证据
  （含截图 `assets/m1-panel-empty-state.png` 与长连接数变化）、GUI 取证现状与仍需人工的一步。
- **2026-11-19 重启后实测** [07](07-checklist.md)：M1-13、E-M1-a 改为「部分通过」并附证据与缺口；
  M1-19 补「已装载」证据；M1-20 数字更新为 121 tests / 82 pass；E-M1-d 说明工具已注册、GUI 列表待人工。
- **2026-11-19 重启后实测** 根 [CHANGELOG](../CHANGELOG.md)：新增 Fixed（`/health` 500、面板 health 非致命）
  与 Known issues 更新（已加载、部分通过、需再重启生效）。
- **2026-11-19 文档门禁** [02](02-requirements.md)：FR-11 与 DR-07 的提问注入由 `commands.execute` 改为 `agent.followup`（`commands.execute` 只执行斜杠命令、不送模型）；头部补维护/评审批次。
- **2026-11-19 文档门禁** [01](01-research.md)：Host 服务表把 `commands` 的用途改为「只执行斜杠命令」，新增 `agents`（`agent.followup`）行；结论、链路图与 DR 摘要同步。
- **2026-11-19 文档门禁** [03](03-design.md)：§2.1 目录树的 `scripts/`（build-client、gen-fixtures、verify-schemas）与 `assets/` 用途改为实际布局；§12.3 夹具改为 `test/fixtures/` 9 个文件 + manifest 并核对体积；§12.4 AC 映射按 02 §9.1 重写；D-03-08/09 与 §14-2 状态更新；修正失效章节引用。
- **2026-11-19 文档门禁** [04](04-api.md)：SSE 交叉引用 §4.9 → §6.2；头部补维护/评审批次。
- **2026-11-19 文档门禁** [05](05-dev.md)：`build:client*` 标注 M1、最短路径去掉未落地命令；删除不存在的 `scripts/smoke.mjs` 计划；D-05-01/03/04 关闭。
- **2026-11-19 文档门禁** [06](06-test.md)：MAN-01/02/06/07/09 的关联编号改为 FR 或正确的 AC（不再误用 AC）；D-06-01/02/03/06 关闭。
- **2026-11-19 文档门禁** [07](07-checklist.md)：实现期未决问题由 Q-01..06 改为 Q-07..12，避免与 03 §15 重号；D-05-01/03/04 关闭。
- **2026-11-19 文档门禁** 根 [README](../README.md)：状态改为「文档就绪、代码 M0」，文档表补索引/07/08；[CHANGELOG](../CHANGELOG.md) 补文档与测试骨架条目。
- **2026-11-19 文档门禁** [手工验收手册](../test/manual/README.md)：修正指向 06 的相对链接（`../06-test.md` → `../../docs/06-test.md`）。

### 关闭的偏差

| 编号 | 关闭方式 |
|---|---|
| D-05-01 | 03 §12.4 按 02 §9.1 重写 |
| D-05-03 | 03 §2.1/§12.3 统一为 `test/fixtures/` |
| D-05-04 | 05 §3 与 `package.json` 逐条复核一致 |
| D-06-01 | 同 D-05-03 |
| D-06-02 | 同 D-05-01 |
| D-06-03 | 03 §12.3 列 9 个夹具 + manifest |
| D-06-06 | 02 FR-11/DR-07 已同步 `agent.followup` |

仍打开：D-06-04（中文 PDF 抽取策略待 M2 实测）、D-06-05（安装冒烟与手工 AC 待执行）。

### M1 代码落地（2026-11-19）

- **05**：§4 由「计划」改为「已落地」——记录实际标记（`/* @build:dicts */`、`/* @build:parts */`）、`PARTS` 顺序、字典内联与指纹规则、`new Function` 语法自检；§4.4 表格列出 `package.json` 的当前值；§6.2 补 `target="file:…"` 的实测写法；新增 **§6.7 兼容性与安装记录**（`install_bundle` 两次失败原文、5807 取证受限、替代证据、联动方案判定与解除条件）。
- **07**：§2.1 M1-01..23 与出口 E-M1-a..d 按证据勾选；安装/联动四项（M1-13、M1-19、E-M1-a、E-M1-d）标 `[!]` 并写明阻塞原因与替代证据；D-05-02/05/06 关闭。
- **根 README**：状态行改为「v0.1 开发中（M1 骨架完成）」，开发命令补 `build:client`，安装段改为实测命令并指向 05 §6.7。
- **根 CHANGELOG**：新增「M1 骨架」Added/Changed/Known issues 三节。

### 未执行（不得写成已验证）

安装冒烟、MAN-01..15、NFR 性能实测均未执行；06 与 07 中对应项保持「待执行 / 未勾选」。
M1 起「M1 联动五步」需要已加载的插件，本机 `install_bundle` 被 profile 环境挡住（05 §6.7），
07 里用 `[!]` 标注而不是 `[x]`。

### M2 代码落地（2026-11-19）

- **03 §6.3**：新增「M2 实现记录（as built）」——零依赖 zip.js/xml.js 取代 jszip/fast-xml-parser，alidateEpubContainer 前置校验，PDF 分支返回 E_UNSUPPORTED{reason:'pdf-pending'}。
- **07 §2.2**：M2-01..22 与 E-M2-a..e 按证据勾选：EPUB 侧 11 项通过、5 项部分（[!] 附现状）、PDF 3 项未开始；补「字段名以 03 §5.2/§5.3 为准」提示。
- **根 CHANGELOG**：新增「M2 导入与解析（EPUB）」Added/Changed/Known issues。
- **未执行**：PDF 解析与扫描版检测（t9/t13）、M2-17..22 的 UI 收尾、50 本冷启动性能实测，均保持 [ ]/[!]，不得写成已验证。

### M3 导图生成（Host 工具与校验，2026-11-20）

#### 新增

- `src/host/layout.js`：确定性 tidy-tree（03 §7.4）——根居中、一级子节点左右交替、`gapX=80+depth*8`、
  `gapY=24`、书卡 240×120 / 其它 220×96（摘要按行数自适应到 160）、父节点 y 取子树中位、绝对坐标 +
  80 padding、纯函数无随机。导出 `layoutTree`、`treeDepth`、`countNodes`、几何常量。
- `src/host/map.js`：`validateMap` 五级校验（结构/字段/引用/同级重名/根 kind）、`assignNodeIds`
  （`ids.nodeIdFrom`，未变节点 id 稳定）、`writeMap`（校验 → nodeId → 布局 → 备份 `map.bak.json` →
  原子写 `map.json` → 更新 `meta.mapUpdatedAt`/索引）、`MapService`（`get`/`outline`/`chunks`/`commit`/
  `beginGeneration`/`endGeneration`/`publishProgress`）。`commit` 支持 `targetNodeId` 做单节点/子树
  重生成：读旧图 → 定位 → 替换 → 整树复验（拒绝项 path 改写到 `root.` 前缀）→ 布局 → 落盘。
- `src/host/agent-bridge.js`：`buildMapPrompt`（三段式：outline → chunks ≤20 块 → commit）、
  `buildNoticeMessage`、`resolveAgent`、`injectAgentRequest`（`agent.inbox.followup`，失败折 E_AGENT）。
- 测试：`test/unit/map.test.js`（UT-MAP-01..12 + UT-LAYOUT-01..05）、
  `test/integration/map-route.test.js`（IT-C05：404→commit→200、PUT 501、generate-map 202/409/422、
  注入消息、SSE progress/map 帧、工具端到端、非法输出拦截）。

#### 变更

- `src/host/tools.js`：`reading_map` 从占位改为真实四动作，参数按 04 §5.3（`action`/`bookId`/`ids`/
  `from`/`to`/`root`/`maxNodes`/`targetNodeId`），execute 内自校验（原始 JSON Schema 由工具自己负责），
  统一 `{ok:true,data}` / `{ok:false,code,message,rejected}` 信封，`output.schema` 用 `oneOf`，
  `render` 输出 1–6 行纯文本（commit 含节点/层/引用计数与「已备份并替换上一版」），超时 60 s，
  `isConcurrencySafe` 只对 `get`/`outline`/`chunks` 为真。
- `src/host/prompt.js`：系统提示段按 04 §5.9 重写为六条规则（先 outline 再 chunks、引用与摘要约束、
  被拒后只修 `rejected` 再提交一次、单节点重生成用 `targetNodeId`、笔记五节、回答用 `[c-000123]`）。
- `src/host/index.js`：装配 `MapService` 并注入 `services.map`。
- `src/host/routes/content.js`：`GET /map` 返回 MapDoc（无图 404 `E_NOT_FOUND`/`no-map`）；
  `PUT /map` 返回 501 `E_UNSUPPORTED`（`availableIn:'0.3.0'`）。
- `src/host/routes/books.js`：`POST /books/:id/actions/generate-map` 落地——校验 `agentId`/
  `instructions`（≤500 字）→ `beginGeneration` 抢占（重复 409 `E_BUSY`）→ 注入会话消息 → 202
  `{queued,agentId,promptId}`；注入失败释放闸门并返回 `E_AGENT`。
- `test/unit/core.test.js`：输出契约断言接受 `oneOf` 信封（`reading_map` 不再用 `{type:'json'}`）。

#### 偏差（实现 vs 文档，需文档 owner 确认）

- **D-10-01 注入消息 source.kind**：04 §6.3 写作 `source.kind='plugin'`，但 session format V4 在消息
  准入处拒绝退役的 `{kind:'plugin',plugin}` 包装。实现改用模块自有 kind `'reading-lab'`
  （附 `form:'notice'`、`summary`、`bookId`、`action`）。04 §6.3 待改。
- **D-10-02 `output.schema` 用 `oneOf`**：04 §5.1 写 `anyOf`，而 `ValueSchemaSpec` 只支持
  `oneOf`（tools.zh.md「要求恰好命中一个分支」）。实现用 `oneOf:[成功信封, 失败信封]`；04 §5.1 待改。
- **D-10-03 无 agent 的状态码**：04 §4.2 #9 写 422，`E_AGENT` 在错误码总表固定 502，实现沿用 502。
- **D-10-04 进度通道**：v0.1 的「正在生成」由注入消息 + 工具 `render` + SSE `progress`/`map` 帧呈现；
  `conversation.chat.node` / `tool.call.toolview` 按 03 §3.1 留到 v0.2。SSE 的 200 ms 节流会把同一书的
  `mapping` 与 `done` 合并成最后一帧（04 §6.1 节流语义），手工验收应看工具视图而非帧数。
- **D-10-05 07 §2.3 勾选**：M3-01..03、M3-05..06、M3-08 已勾选并附证据；M3-04/M3-07 标 `[!]`
  （重试由 agent 依提示执行、面板按钮属 Client 联调）；E-M3-b 勾选，E-M3-a 保留未勾并注明已有
  fake host 全链证据。t9 先提交了画布（96b0dbe），本节在其后补入，未覆盖其 M3-09 记录。

#### 未执行

- 真实宿主里的「点生成 → 会话看到注入消息 → 模型实际跑完三段式」端到端（需要已加载插件与可用模型
  会话）；本轮用 fake host + 真 HTTP 验证到注入与工具执行层，06 的 MAN 项保持待执行。
- 1000 节点/移动端等 v0.3 门禁。

### t29 生成链路可观测性（QA-11-07，2026-11-20）

**问题**：`POST /books/:id/actions/generate-map` 返回 202 后，真实宿主上可能什么都不发生。
QA（qa-v01 profile）观察到 25 s 无产物、画布仍是夹具图。根因不是注入失败，而是
`agent.followup()` 是 fire-and-forget：调用成功只代表消息进了 inbox，不代表
回合被调度、更不代表模型会调用 `reading_map commit`。qa-v01 恰好没有 llm provider
配置，`preStep` 抛 `agent "<id>" has no provider/model: …`，driver 记
`turn/end{reason:{kind:'error'}}`、`kick()` 吞掉异常，插件此前对此完全无感。

#### 新增

- `src/host/generation.js`：`GenerationTracker` 状态机（`pending`→`running`→`done`/`failed`），
  订阅 Cordis 事件 `agent/error`、`agent/inbox/claimed`、`agent/inbox/discarded`、
  `agent/status`、`agent/disposed`；180 s 看门狗（`mapGenerationTimeoutMs`，可配）区分
  「从未认领」与「已认领未提交」；失败写 `log.warn` 并发 SSE
  `progress{phase:'failed',reason,message}`；终态保留 15 分钟供面板补读。
- `GET /books/:bookId/actions/generate-map` 状态查询（无生成记录返回 `state:'idle'` 而非 404）。
- 测试：`test/unit/generation.test.js`（UT-GEN-01..10）、
  `test/integration/generate-map-observe.test.js`（8 项：认领→running→done、`agent/error`
  三处可见、`turn-ended`、`inbox-discarded`、未认领超时、已认领超时、卸载不留定时器）。

#### 变更

- `src/host/routes/books.js`：202 响应补 `state`/`statusUrl`/`timeoutMs`；注入成功后
  `attachPrompt` 绑定 `promptId`；注入失败按 `agent-missing`/`inject-failed` 置 failed 再抛。
- `src/host/map.js`：`MapService` 接 `generation`；`beginGeneration`/`endGeneration`/
  `isGenerating` 委托 tracker；`commit` 成功时 `complete`（幂等），**校验失败不置 failed**——
  模型要按 `rejected` 重试，只有会话层失败/超时才终止。
- `src/host/index.js`：订阅五个 agent 事件（`ctx.on` 不可用时 warn 并退化到只有看门狗）；
  dispose 先 `generation.close()` 再关 hub。
- `src/host/limits.js` / `config.js`：新增 `mapGenerationTimeoutMs`（默认 180 000）。
- `docs/04-api.md` §4.2 #9：补真实 202 响应体、三行「断点→DSH 现象→插件如何发现」表、
  状态图、`reason` 六值表、状态查询契约与示例、失败后闸门立即释放；路由表 #9 加 9b 行，
  错误码 422→502 更正。

#### 偏差（实现 vs 文档）

- **D-29-01 状态只在内存**：`GenerationTracker` 不写 `meta.json`，DSH 重启后状态回到 `idle`
  （inbox 里的注入消息可能仍在，但插件不再跟踪）。v0.1 接受：这是瞬时状态而非文档数据。
- **D-29-02 `progress.phase` 多出 `failed`**：03 §5.2 的枚举是
  `queued|reading|extracting|chunking|mapping|done`，实现新增 `failed` 作为终态（仅 SSE 事件，
  不写 `meta.progress`）。03 §5.2 待补。
- **D-29-03 用 `promptId` 关联回合**：DSH 的 `followup` 不返回回合句柄，插件用自己生成的
  消息 id 匹配 `agent/inbox/claimed.message.id`；若 DSH 在投递时重建消息对象，匹配会失败并
  退化为看门狗超时（仍是显式失败，不会静默）。

#### 未执行

- 在真实宿主上让模型真正跑完「outline → chunks → commit」：需可用的 llm provider 会话。
  本轮用真实宿主取证到「`/agents` 为空 → 502」与事件/状态机层（fake host + 真 HTTP）。

### t30 画布消费生成状态（2026-11-20）

#### 变更

- `src/client/views/canvas.js`：新增生成状态引擎（`CANVAS_GENERATION_STORE` / 监听者集合 /
  inflight 去重 / 状态与 reason 白名单），把 Host 的 `progress`、`map` 事件与
  `GET actions/generate-map` 快照收敛为 `{state,reason,message,startedAt,finishedAt,elapsedMs,timeoutMs,mapRevision}`。
  `useCanvasGeneration(bookId)` 让画布组件订阅该状态；`VIEWS.CanvasGeneration` 在 pending/running
  时渲染顶部进度条与状态文案（无图时中央进度卡，有图时右上角 pill），failed 时渲染失败卡
  （原因文案、已耗时、超时上限、查看详情、重试）。
- 无图空态（`VIEWS.CanvasState` missing）新增「生成导图」主按钮，调用
  `POST /books/:id/actions/generate-map`；失败卡重试复用同一入口。
- `map` 事件到达后清 `CANVAS_MAP_CACHE` 并重取 `GET /map`，新图到达才替换 `mapState`；
  请求失败时保留旧图（不闪白），仅无图时才回到 missing。
- `src/client/views/overlay.js`：复用面板唯一的 EventSource，在 `onHello` / `onEvent` /
  `onError` 里分别调用 `canvasRuntimeHello()` / `canvasRuntimeEvent(type,payload)` /
  `canvasRuntimeOffline()`，不新开连接。
- locale zh/en 新增 22 个 `canvas.generate.*` 键（标题、pending/running 文案、已耗时、
  失败标题/重试/详情/收起、9 种 reason 文案），两语言 key 集合一致。
- 测试：新增 `test/integration/generation-render.test.js`（9 条，带状态 React 替身 +
  EventSource 桩 + 可暂停的 `/map` 响应）：挂载 GET 兜底、无图生成按钮 POST、
  pending/running 文案与计时、失败原因/耗时/查看详情/重试、重试回到 pending、
  `map` 事件后旧图保留到新图到达、hello 重连补读终态、reason 映射、仅 token CSS。
- 07 M3-07 由 `[!]` 改为 `[x]` 并补 t30 证据，仍保留「真实宿主端到端联调归手工」的缺口说明。
- `client.js` 重建为 178,266 B / 12 parts。

#### 偏差（实现 vs 文档）

- **D-30-01 客户端额外 reason**：Host 的六种失败原因是
  `agent-error|turn-ended|inbox-discarded|timeout|agent-disposed|agent-missing`；
  Client 另加 `inject-failed`（202 之前的注入失败）与 `request-failed`（网络/非信封错误），
  并统一把未知值回落 `unknown`。03 §4 的 reason 表待补这两项（仅 UI 文案层，不写 `map.json`）。
- **D-30-02 进度条是不确定态**：`progress{phase:'mapping'}` 的 `done/total` 固定为 0/0，
  顶部条只表达「生成中」，不显示百分比；待 Host 提供真实分块进度后再改确定态进度条。
- **D-30-03 生成状态仍只在内存**：刷新页面先显示 `idle`，挂载后靠
  `GET actions/generate-map` 补读；SSE 断线期间的终态由重连 `hello` 触发补读，
  离线时保留最后一次已知状态，不回退成 idle。

#### 未执行

- 真实宿主里从「生成导图」点击到 Agent 认领、commit、`map` 事件、画布替换的端到端联调
  （需已安装插件且 profile 有可用 agent）；本轮以 VM 集成测试与 fake host 事件序列取证。
- 失败卡在真实窗口里的视觉验收（浅/深主题截图）未单独归档，样式断言覆盖 token 与结构。
