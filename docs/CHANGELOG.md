# 文档变更记录

只记录 `docs/` 下的文档变更；产品与仓库级变更见根 [CHANGELOG](../CHANGELOG.md)。格式对齐 Keep a Changelog：新增 / 修订 / 修正 / 关闭偏差。

## [Unreleased]

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

### 修订

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
