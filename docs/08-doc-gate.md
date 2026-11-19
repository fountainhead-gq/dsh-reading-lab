# 08 开发前文档门禁报告

> 日期：2026-11-19
> 检查者：docs（qa/docs）
> 范围：`docs/01`–`07`、根 `README.md` / `CHANGELOG.md`、`test/manual/README.md`（并核对它们引用的夹具与测试骨架）
> 结论：**文档就绪**（阻塞项 0；7 项非阻塞遗留已列在 §5）
>
> 后续：2026-11-20 t12 又修订了 02/03/04/06/07（v0.1 范围收窄、D-03-13、QA 记录），新增 [09](09-qa-v0.1.md)。本文 §2 的行数/字节是 2026-11-19 快照，不再逐次回填；以各文件当前内容与 [docs/CHANGELOG](CHANGELOG.md) 为准。

## 1. 判定

| 问题 | 结论 |
|---|---|
| 01–07 是否齐全、非空？ | 是，7 篇均为正式内容，无占位章节 |
| 交叉链接是否可解析？ | 是，0 个断链（`reading://` 示例除外，见 §3） |
| 7 项决策是否一致？ | 是，DR-01..07 在 01/02/03/04/05/06/07 的表述一致 |
| 编号是否可追溯？ | 是，FR-01..15、NFR-01..12、AC-01..10 在 06/07 全覆盖；C-01..12、D-03/D-05/D-06 均有定义与引用 |
| 是否有 TODO/待补残留？ | 无撰写期占位；`test.todo` 是测试骨架的待实现清单，不是文档缺口 |
| 能否开始 M1？ | **能**。M1 的输入（槽位、契约、文件所有权、DoD）均已定稿 |

**结论：文档就绪。** 没有需要上游补充才能开工的阻塞项；§5 的遗留均属实现期或安装期动作。

## 2. 文件清单（2026-11-19）

| 文件 | 行数 | 字节 | 状态 | 维护 / 权威 |
|---|---:|---:|---|---|
| [01-research.md](01-research.md) | 299 | 30,589 | 完成 | docs；决策证据 |
| [02-requirements.md](02-requirements.md) | 391 | 30,167 | 完成，v0.1 基线 | docs；**FR/NFR/AC/DR 权威** |
| [03-design.md](03-design.md) | 1,221 | 72,612 | v1 定稿 | docs；D-03 设计裁决 |
| [04-api.md](04-api.md) | 1,016 | 44,469 | v1 定稿 | docs；C-01..12 契约 |
| [05-dev.md](05-dev.md) | 740 | 37,113 | 完成 | docs；D-05 流程 |
| [06-test.md](06-test.md) | 467 | 32,591 | 完成（安装/手工待执行） | qa；D-06 测试口径 |
| [07-checklist.md](07-checklist.md) | 413 | 27,156 | 完成（M1–M5 待执行） | qa；DoD 勾选 |
| [08-doc-gate.md](08-doc-gate.md) | — | — | 新增 | docs；门禁快照（本文件，不计自身体积） |
| [README.md](README.md)（docs 索引） | 62 | 4,374 | 新增 | docs；阅读顺序与编号权威 |
| [CHANGELOG.md](CHANGELOG.md)（docs） | 47 | 3,820 | 新增 | docs；文档变更 |
| [../README.md](../README.md)（仓库根） | 73 | 3,424 | 更新状态 | 入口 |
| [../CHANGELOG.md](../CHANGELOG.md) | 23 | 1,775 | 更新 | 产品/仓库变更 |
| [../test/manual/README.md](../test/manual/README.md) | 93 | 3,749 | 修正链接 | qa；手工验收 |

支撑材料（不在 docs 门禁范围，但被文档引用，已核对存在）：`test/fixtures/` 9 个夹具 + `manifest.json`、`scripts/gen-fixtures.mjs`、`test/unit/docs-contract.test.js`、`test/http-contract.test.js`、`test/placeholders.test.js`、`test/skip.txt`。

## 3. 检查项与证据

| # | 检查 | 方法 | 结果 |
|---|---|---|---|
| 1 | 存在性与非空 | 逐文件读取；行数/字节统计 | 13/13 存在，最小 23 行（根 CHANGELOG），无空文件 |
| 2 | 交叉链接 | 解析全部 Markdown 行内链接（`[]()` 语法），相对路径按文件所在目录解析并检查存在性 | 0 断链。`03-design.md` §9 的 `reading://...` 位于围栏代码块内，是**有意的伪链接示例**，检查器已排除 |
| 3 | 代码围栏 | 逐文件统计 ``` 开合 | 全部闭合（01:2、03:52、04:92、05:50、06:12，其余 0） |
| 4 | 编码 | 检查 UTF-8 BOM 与非法字节 | 无 BOM；全部 UTF-8 |
| 5 | TODO/占位 | 搜索 `TODO/TBD/FIXME/待补/占位/待定/待办` | 文档正文 0 处撰写占位；命中仅为 `test.todo` 政策说明与根 CHANGELOG 的历史记录（“占位文档，后续已替换”），不构成缺口 |
| 6 | 7 项决策一致性 | 逐条比对 DR-01..07 在 01 摘要表、02 §7、03 D-03-xx、05/06/07 的落地表述 | 7/7 一致；唯一历史分歧（FR-11 用 `commands.execute`）已在本门禁统一为 `agent.followup` |
| 7 | 编号可追溯 | 提取 02 的 FR/NFR/AC，检查 06/07 覆盖；检查 C-01..12、D-03/D-05/D-06 定义与引用 | FR-01..15 在 07 全覆盖（本次补 FR-02/04/06）；AC-01..10 在 06 全覆盖；NFR-01..12 在 06 全覆盖；C-01..12 在 04 §9 与 06 §3 均有映射 |
| 8 | 权威冲突 | 按 docs/README §2 的优先级抽查：线程文件名、面板 key、工具名、夹具路径、AC 语义、提问机制 | 6/6 一致；夹具路径与 AC 语义的旧冲突已修（D-05-01/03、D-06-01/02/03） |
| 9 | 负责人标注 | 检查各文档头部是否有维护者/评审 | 01/02/03/04 已补；05/06/07 原有 Owner/维护行；索引与门禁报告自带维护行 |
| 10 | 文档契约测试 | `npm run verify`（含 `test/unit/docs-contract.test.js`） | exit 0；77 tests / 37 pass / 0 fail / 1 skip / 39 todo |

## 4. 本次修正

| # | 问题 | 修正 | 文件 |
|---|---|---|---|
| 1 | FR-11/DR-07 仍写 `commands.execute` 注入提问；该 API 只执行斜杠命令、不送模型 | 统一为 `agent.followup`，并保留“为什么不用 commands.execute”的理由 | 02 FR-11、DR-07；01 结论/§2.3/§2.5/§4 |
| 2 | 03 §12.3 夹具路径写成 `assets/fixtures/`，只列 8 个 | 改为 `test/fixtures/`，列 9 个 + `manifest.json`，体积按实测；§2.1 目录树同步 | 03 |
| 3 | 03 §12.4 的 AC 语义是旧版（AC-03=画布性能、AC-05=笔记、AC-09=删除） | 按 02 §9.1 重写 10 条 AC 的自动化/手工映射 | 03 |
| 4 | D-03-09 指向不存在的 §7.6；03 引用不存在的 `05-dev-guide.md`；04 引用不存在的 §4.9 | 改为 §1.3/§8.4/04 §6、05-dev.md、§6.2 | 03、04 |
| 5 | 07 §10 的实现期问题复用 Q-01..06，与 03 §15 含义冲突 | 改为 Q-07..12，并注明“03 §15 之外” | 07 |
| 6 | 06 §8.2 的 MAN-01/02/06/07/09 误挂 AC 编号 | MAN-01→FR-01+AC-05（切换）；MAN-02→FR-02/14；MAN-06→FR-07；MAN-07→FR-08+NFR-01；MAN-09→FR-10 | 06 |
| 7 | 偏差已具备关闭条件但状态仍“打开” | 关闭 D-05-01/03/04、D-06-01/02/03/06，写日期与关闭方式 | 05、06、07 |
| 8 | 07 未引用 FR-02/04/06，追溯链缺口 | 在 M2-01/02/03（FR-04）、M2-07（FR-06）、M2-19（FR-02）补编号 | 07 |
| 9 | 根 README 状态仍写“文档占位”，文档表缺 07/08/索引 | 状态改为“文档就绪、代码 M0”；补 3 行；开发命令补 `test/verify` | 根 README |
| 10 | `test/manual/README.md` 的 `../06-test.md` 解析到 `test/06-test.md` | 改为 `../../docs/06-test.md`（含两个锚点） | 手工手册 |
| 11 | 05 §3 列出未落地的 `build:client`、`scripts/smoke.mjs`，最短路径照抄会失败 | 标注 M1；最短路径改为当前可执行；删除 smoke.mjs 计划（由 `test:smoke` 覆盖） | 05 |
| 12 | 01–04 头部缺维护/评审标注 | 统一补 `维护：docs（qa/docs）；评审：架构/工程` | 01–04 |

## 5. 遗留问题（均不阻塞文档就绪）

| 编号 | 问题 | 影响 | 责任 / 时点 | 阻塞？ |
|---|---|---|---|---|
| D-05-02 | Client 拆多文件后需要拼接构建，`package.json` 仍指向 `src/client/index.js` | M1 安装前必须落地 `build:client` 两命令与四字段 | 工程 / M1 | 否（M1 内） |
| D-05-05 | `package.json` 缺 `engines.node` | 低版本 Node 可能跑错门禁 | 工程 / M1 | 否 |
| D-05-06 | `src/client/index.js` 注释仍写 `key="reading"` | 与 DR-06 冲突，可能误导实现 | client-shell / M1 | 否 |
| D-06-04 | 中文 PDF 用 ToUnicode 而非嵌入字体，抽取策略待实测 | 若 pdfjs 抽取失败，M2 需换嵌入字体并重生成夹具 | parse / M2 | 否 |
| D-06-05 | 安装冒烟与 MAN-01..15 未执行 | 当前不能宣称“安装通过/功能可用” | qa / 安装时 | 否（安装期） |
| Q-01..06 | 03 §15 的设计期未决（sessionId、事件去重、rename 原子性、outline 兼容、主题 token、100 MB 内存） | 已有规避方案，M1–M4 实测后关闭 | 架构 / 各里程碑 | 否 |
| Q-07..12 | 07 §10 的实现期未决（节点上限、线程归档、PNG 上限、tutor 轮次、并行度、矢量格式） | 影响 v0.3 范围细节 | 产品/架构 / M3–M5 | 否 |

另有两条**代码事实**需在 M1 顺手处理，已登记在对应偏差而非文档缺陷：`package.json` 的 `engines` 与 Client 入口注释（见上表 D-05-05/06）。文档侧不再保留过期表述。

## 6. 复验记录

在 `D:\Qunar\personal\dsh\dsh-reading-lab`、`dev` 分支执行：

```text
$ npm run verify
> node --check src/host/index.js && node --check src/client/index.js
> node scripts/gen-fixtures.mjs --check
> node --test "test/**/*.test.js"
ℹ tests 77
ℹ pass 37
ℹ fail 0
ℹ skipped 1
ℹ todo 39
exit 0
```

文档结构检查（临时脚本，不入库）：

```text
$ node ../doc-link-check.mjs .
files=13 problems=0
$ node ../doc-fence-check.mjs .
01-research.md fences=2 balanced ... 07-checklist.md fences=0 balanced
```

`git status` 在提交前应只包含本报告 §4 所列文件；提交信息见 §7。

## 7. 门禁签署

- 判定：**文档就绪**，可以开始 M1。
- 生效条件：本报告与 §4 的修正一并提交到 `dev`；后续任何 FR/AC/契约变更按 [docs/README](README.md) §3 的同步规则执行。
- 复检触发：合并 `main` 前、每个里程碑出口、以及任何“文档与代码不一致”的缺陷修复后。
- 本次提交：`docs: 文档门禁通过（索引、一致性修正与门禁报告）`。
