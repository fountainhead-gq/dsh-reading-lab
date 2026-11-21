# 11 修复验收：存储路径与生成看门狗

> 状态：**自动化与代码验收通过；现场门禁未执行（合并 main 前必须关闭 §8）**
> 验收对象：`16e5d54`、`457d9c2`（t33 存储路径）、`87f7698`（t34 活动感知看门狗）、`fe84419`（QA-35-01/02 修复）
> 验收人：qa；日期：2026-11-20；基线：dev `fe84419`
> 验证 worktree：`D:\Qunar\personal\dsh\.qa-t35b`（detached `fe84419`）；首轮为 `.qa-t35`（`457d9c2`）

## 1. 结论

两处修复的**主路径成立**，自动化门禁在干净 worktree 上 0 fail；但不能据此合并 main：

1. **t33 主路径通过**：根解析三段式、损坏设置容错、路径校验、同盘/跨盘迁移、空目标复用、反向回滚、`/health` 字段均有代码与测试证据；**面板「存储位置」行与运行中宿主的 `GET/PUT /settings` 未现场验证**（宿主是旧进程，见 §6）。
2. **t34 主路径通过；首轮两处中危已修复**：三段预算、活动重置、`claimedAt` 三类证据、分阶段失败文案、面板文案均有测试。首轮发现的 **QA-35-01**（看门狗重复/提前回调会立即误杀）与 **QA-35-02**（agent 级事件按 agent 广播，跨书互相污染）已由 `fe84419` 修复，新增 UT-GEN-15..19 与跨书 `agent/error` 集成用例，二轮复验通过（§4.3）。
3. **generate-map-observe 偶发红判定为测试时序抖动，不是产品竞态**：首轮 3 份并发单跑 9/9 全绿；满载下 400 ms SSE 收集窗口偶发只收到 hello；把窗口放宽到 2500 ms 后同一负载 9/9 全绿，且同批 IT-ASK-06 也出现超时红（§5）。`fe84419` 已把固定窗口改为轮询目标帧（QA-35-04），二轮 3 份并发 + 满载 4/4 exit 0。
4. **发布门禁现场手测未执行**：当前 7439 宿主仍是旧进程（pid 158840），`/settings` 404、`/health` 无 `rootPath`；按任务要求记为「未执行·待重启」，不标记通过（§6）。
5. **二轮自动化门禁**：干净 worktree `.qa-t35b` 连续 3 次 `npm run verify` exit 0，`426 tests / 389 pass / 0 fail / 37 todo`；QA-35-03/04/05 一并关闭。

## 2. 门禁与 diff 复核

### 2.1 干净 worktree 全量

```powershell
git worktree add --detach D:\Qunar\personal\dsh\.qa-t35 457d9c2
cd D:\Qunar\personal\dsh\.qa-t35
npm run verify
```

结果：**exit 0**（首次）；在该 worktree 复跑 2 次仍为 `417 / 380 / 0`，均 exit 0。

- `client.js is up to date (233582 bytes)`
- `fixtures:check`：9 个夹具与 manifest 一致
- `tests 417 / suites 64 / pass 380 / fail 0 / skipped 0 / todo 37`
- duration 7023.9 ms

二轮基线 `fe84419`（`.qa-t35b`）：

```powershell
git worktree add --detach D:\Qunar\personal\dsh\.qa-t35b fe84419
cd D:\Qunar\personal\dsh\.qa-t35b
npm run verify   # 连续 3 次
```

结果：**3 次均 exit 0**；`client.js is up to date (234560 bytes)`；9 个夹具一致；`tests 426 / suites 64 / pass 389 / fail 0 / skipped 0 / todo 37`（duration 5629.9 / 6614.1 / 7006.6 ms）。

在 dev `1ee0681`（仅多本报告）第一次 `npm run verify` 出现 **ask-route 两处红**（IT-ASK-03 回写未进 `threads.json`、IT-ASK-05 期望 202 实得 409），`ask-route.test.js` 单跑 3 次均 6/6，随后主工作区重跑全量 `417/380/0` exit 0。判定为**套件满载偶发**（与 t33 记录的 409 E_BUSY 同类），不是 t35 回归；登记为 QA-35-05，见 §5.3。

### 2.2 提交与文档

| 提交 | 规模 | 复核结论 |
|---|---|---|
| `16e5d54` t33 | 22 files，+1683/−27 | `settings.js` 313 行、`routes/settings.js` 136 行、单测/路由/渲染测试、client 存储区块、03/04/05/CHANGELOG 同步 |
| `457d9c2` 空目标修复 | 7 files，+38/−7 | `settings.js` +15/−4；单测/路由测试各补用例；03/04/CHANGELOG 同步 |
| `87f7698` t34 | 19 files，+578/−68 | `generation.js` +198；config/limits/tools/canvas/locale/测试；03 §7.5、04 §4.2 #9、07 M3-07、CHANGELOG 同步 |

文档抽查（`Select-String` 命中）：03 §5.1.1 根解析与迁移语义、§7.5 三段预算表；04 §4.1 #31–32、§4.2 #9 状态字段/状态机；05 §存储位置排障；CHANGELOG 的 `rootPath`/`rootSource`/`isFallback` 与 `claimedAt/budget`。未发现文档与实现相反的描述。

## 3. t33 逐项判定

| # | 验收项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 根解析顺序 settings → `workingDirectory/reading` → `cwd` | 通过 | `src/host/settings.js:126` `resolveLibraryRoot`；单测覆盖三种来源与设置不可用回退 |
| 2 | `isFallback` 仅 cwd 兜底为 true | 通过 | `settings.js:126`；`/health.isFallback` 断言；cwd 分支 `reason='workspace-unavailable'` |
| 3 | `settings.json` 只存 `{schemaVersion,libraryRoot}`、原子写 | 通过 | `readSettings`（`settings.js:58`）、`writeSettings`；PUT 后文件内容断言 |
| 4 | 设置文件缺失/损坏容错 | 通过（可见性低危） | 缺失/非法 JSON 返回默认值 + `corrupted:true`；`ENOENT` 不算损坏（`settings.js:58-69`）。**但** `corrupted` 未透出到 `/health.settingsError` 或 `/settings`（QA-35-03） |
| 5 | 拒绝相对路径/文件/与当前相同/缺字段/类型错 | 通过 | `validateLibraryRoot`（`settings.js:184`）；路由测试逐项断言 400 |
| 6 | 路径穿越 | 通过 | 导出下载 `..%2F` 已返回 400；库根只接受绝对路径并经 `realpath`，不允许相对穿越 |
| 7 | 目标非空拒绝 | 通过 | `E_PATH{reason:'target-not-empty', entry}`；测试覆盖 |
| 8 | 已存在的空目标目录复用 | 通过 | `457d9c2` 修复；单测 + 路由测试 |
| 9 | 同盘迁移 | 通过 | `migrateLibrary`（`settings.js:260`）`rename` 路径；集成测试 `moved` 含四条目 |
| 10 | 跨盘迁移 | 通过 | 手工脚本 C:\Windows\Temp → D:\...：四条目 `mode:"copy"`，源删除，内容一致 |
| 11 | 失败反向回滚 | 通过 | 注入失败测试断言已搬条目回滚、`details.rollbackFailed` 分支 |
| 12 | `/health` 新增 `rootPath/workspaceRoot/rootSource/isFallback/settingsError` | 代码通过，现场未验 | `src/host/routes.js:140-144`；旧宿主 health 无这些字段（§6） |
| 13 | `GET/PUT /settings/library-root` | 契约通过，现场未验 | 路由测试 23/23；旧宿主 `/settings` 404（§6） |
| 14 | 面板「存储位置」区块 | 部分通过 | `settings-render.test.js` 2 条渲染测试；GUI 未见（旧宿主） |
| 15 | PUT 后旧书可见、新导入落新根 | 通过 | 路由测试；t33 真机 Host 层已验证迁移后 5 本书 |

设置专项单跑：

```powershell
node --test test/unit/settings.test.js test/integration/settings-route.test.js
```

结果：`tests 23 / pass 23 / fail 0`（800.6 ms）。

## 4. t34 逐项判定

| # | 验收项 | 判定 | 证据 |
|---|---|---|---|
| 1 | `queueTimeoutMs` 60 s 从 `startedAt` 起算 | 通过 | `generation.js` 预算字段与 `checkBudget` 分支；单测 UT-GEN |
| 2 | `idleTimeoutMs` 180 s，每次活动重置 | 通过 | `noteActivity` + `armWatchdog`；UT-GEN-12 跨过旧 180 s 仍 running→done |
| 3 | `maxDurationMs` 30 min 绝对上限 | 通过 | UT-GEN-13；三预算取 `Math.min` |
| 4 | `claimedAt` 只由真实认领置位 | 通过 | `agent/inbox/claimed`→`inbox-claimed`；`agent/status running`→`agent-status`；只有工具活动→`tool-activity` 且 `claimedAt=null`（UT-GEN-11/14） |
| 5 | 失败文案分阶段 | 通过 | 排队/空闲/绝对上限三种 message；集成测试断言 `budget`、`claimEvidence` |
| 6 | 面板认领后显示耗时与最近活动 | 通过（渲染层） | `generation-render.test.js` 10/10；断言不再显示固定倒计时 |
| 7 | 长回合不再被固定预算误杀 | 通过 | `tools.js` 每次 `reading_map` 调用 `noteActivity`；集成用例跨旧预算 |
| 8 | agent 事件与具体生成记录的关联 | **通过（fe84419 修复）** | QA-35-01/02 首轮不通过；`fe84419` 按阶段截止、timer 代际、messageId 归因，UT-GEN-15..19 与跨书集成用例覆盖（§4.3） |

生成专项单跑：

```powershell
node --test test/unit/generation.test.js test/integration/generation-render.test.js test/integration/generate-map-observe.test.js
```

结果：`tests 33 / suites 3 / pass 33 / fail 0 / todo 0`。

### 4.1 QA-35-01：`checkBudget` 缺少阶段截止校验（中危）

`src/host/generation.js:475` 的 `checkBudget` 只对绝对上限比较 `now >= maxDeadline`；进入 running 分支后**不再检查** `lastActivityAt + idleTimeoutMs` 是否真的到期，直接判失败。定时器回调还无条件 `this.timers.delete(bookId)`，重复/旧回调会删掉新定时器。

确定性复现（假时钟、直接模拟重复回调）：

```text
after claim running 0 inbox-claimed
after early checkBudget failed timeout "agent 已开始处理，但已 0s 没有新的活动（空闲预算 180s；最近活动：inbox-claimed）"
```

影响：活动与超时同刻、或旧回调已入队时，可能把正在读原文的生成判超时；即使不误杀，删掉新定时器也会让后续 watchdog 缺失。当前测试没有「提前回调必须保持 running」的用例。

### 4.2 QA-35-02：agent 级错误按 agent 广播（中危）

`src/host/generation.js:364` 的 `onAgentError` 遍历**所有** pending/running 记录，只按 `agentId` 过滤，不区分消息/turn。DSH 的 `agent/error` payload 为 `{agent,turn,step,error}`，`Agent` 只有 `{id}`，没有 messageId，插件无法精确关联。

确定性复现：同一 agent 上 b1 已认领、b2 仍排队；一条 agent/error 后：

```text
b1 failed agent-error
b2 failed agent-error
```

影响：一本书的失败会把同 agent 下尚未开始的另一本书判失败，之后即使 `reading_map commit` 成功，状态也停在 failed。`agent/status` 的 running 分支同样会把该 agent 的所有 pending 记录置 running，idle 时再一起失败。

### 4.3 二轮复验：QA-35-01/02 已关闭（`fe84419`）

`fe84419` 对 `src/host/generation.js` 的修复（diff 已复核）：

| 问题 | 修复 | 回归用例 |
|---|---|---|
| QA-35-01 提前/重复回调 | 新增 `phaseDeadline(record)`；`checkBudget` 先比绝对上限，再比当前阶段截止，未到点就 `armWatchdog` 重新武装；`armWatchdog` 把自身 timer 传给 `onWatchdog(bookId, timer)`，只有 `timers.get(bookId) === timer` 才删除并判定，过期回调不碰新 timer | UT-GEN-15（提前回调保持 running）、UT-GEN-16（timer 代际） |
| QA-35-02 跨书广播 | 新增 `referencedMessageIds(payload)` + `attribute(payload, agentId, states)`：有 message id 只匹配 `promptId`，无 id 时仅单候选才归因，多候选不归因并写 info；`agent/error` 只失败 running，`agent/status` 只推进可归因记录 | UT-GEN-17（b1 报错不失败 b2）、UT-GEN-18（多候选无 id 不批量失败）、UT-GEN-19（status 带 id 只推进对应记录）、集成「同一 agent 下另一本书的 agent/error 不会失败本书记录」 |
| QA-35-03 设置损坏不可见 | `/health` 与 `GET /settings` 统一输出 `settingsError`；面板「存储位置」行渲染 `role=alert`；locale 增 `settings.corrupted/invalid` | `settings-route.test.js`、`settings-render.test.js` 各一条 |
| QA-35-04 固定 400 ms 窗口 | observe 的 `captureSse` 改为轮询目标帧（默认 3000 ms，`RL_SSE_WINDOW_MS` 可覆盖） | 满载 3 份并发 + full suite 4/4 exit 0 |
| QA-35-05 ask 偶发 409/回写 | 测试改为 `waitForThread` 条件等待线程 idle 再发送；产品语义不变 | 连续 3 次 verify 0 fail |

验证：`.qa-t35b @fe84419` 连续 3 次 `npm run verify` exit 0（426/389/0/37）；满载 3 份 `generate-map-observe` 单跑 + 完整 `npm test` 同时运行，4 个进程全部 exit 0。二轮未新增 finding。

## 5. generate-map-observe 偶发红：时序抖动，不是产品竞态

### 5.1 复跑矩阵

| 场景 | 次数 | 结果 |
|---|---|---|
| 单文件顺序 | 3 | 9/9、9/9、9/9，全部 exit 0 |
| 3 份并发单跑 | 3 | 3 份均 9/9，exit 0（约 2.8 s/份） |
| 满载：`npm test` + 3 份并发 | 4 | 1 次红：`agent/error...` 断言 SSE 只有 `event: hello`，无 `"phase":"failed"`；其余 3 次全绿 |
| 满载复跑 | 2 | 出现 `IT-ASK-06`、`超时把消息置 failed` 两处 2.3 s 超时红 |
| 诊断副本：SSE 收集窗口 400 ms → 2500 ms | 1（满载） | 9/9 全绿；同批 full suite 0 fail |

### 5.2 判定

- 失败断言读的是 `captureSse` 固定 `setTimeout(resolve, 400)` 之后的缓冲（`test/integration/generate-map-observe.test.js:164-185`）。满载时事件循环被 64 个测试文件占满，400 ms 内只泵到 hello 是**收集窗口不足**。
- 放宽到 2500 ms 后同一负载通过，说明失败帧最终会到达；若是 `onAgentError` 没匹配到记录，延长窗口也不会出现 `phase:failed`。
- 同批 `IT-ASK-06` 也出现 2.3 s 超时红，进一步说明是满载下的测试超时参数，而非单一产品路径。
- **结论：不是 t34 的产品竞态；但测试本身是门禁噪声，应改为「等到目标帧或总超时 2 s」**（QA-35-04，低危）。
- 二轮：`fe84419` 已按上述方式改为轮询目标帧（默认 3000 ms）；3 份并发 + 满负载 4/4 exit 0，未再复现（§4.3）。
- 注意：这不否定 §4.1 的代码缺陷；QA-35-01 是独立于该偶发红的真实边界问题，已随 `fe84419` 关闭。

证据日志：`reports/t35/verify-loaded-fail.out`、`reports/t35/observe-slow-diag.out`、`reports/t35/verify-loaded-pass.out`。

### 5.3 ask-route 全量偶发（QA-35-05，低危）

dev `1ee0681` 首次全量出现两处 ask 红：

- `IT-ASK-03`：`回答没有回写进 threads.json`；
- `IT-ASK-05`：创建线程期望 202，实得 409（E_BUSY）。

隔离复跑 `node --test test/integration/ask-route.test.js` 3 次均 6/6；`.qa-t35` 全量复跑 2 次、主工作区复跑 1 次均 0 fail。与 t33 记录的「满载时 ask-route 偶发 409 E_BUSY」一致，属于同套件内共享状态/时序的测试噪声。`fe84419` 已改为 `waitForThread` 条件等待线程 idle；二轮连续 3 次 `npm run verify` 0 fail，关闭 QA-35-05。

## 6. 现场手测：未执行·待重启

任务指定的门禁项需要在**已重启的桌面宿主**上执行：

```powershell
$base='http://127.0.0.1:7439/dsh-reading-lab/api/v1'
Invoke-RestMethod "$base/health" | Select-Object rootPath,isFallback,rootSource
Invoke-RestMethod "$base/settings/library-root" -Method Put -ContentType 'application/json' `
  -Body '{"path":"D:\\Qunar\\personal\\dsh\\reading","moveExisting":true}'
```

本轮检查：

- `GET /health` → 200，但**无** `rootPath/rootSource/isFallback` 字段；`storage:"ok"`、`workspaceRootName:"desktop"`。
- `GET /settings` → **404**。
- 端口 7439 的监听进程 **pid 158840**，仍是 t33 报告中的旧宿主（8:41 启动）。
- 结论：新代码未加载，**现场手测未执行**。禁止标记通过；须在 DSH 重启后由能操作宿主的人执行，并补齐：`resolvedRoot`、`moved` 四条目、`GET /books` 5 本、面板「存储位置」行显示新路径。该项为 **合并 main 前必须关闭**。

## 7. Findings（首轮，二轮已全部关闭）

| ID | 严重度 | 位置 | 问题 | 修复要求 |
|---|---|---|---|---|
| QA-35-01 | medium | `src/host/generation.js:475` | `checkBudget` 不校验阶段截止；running 直接失败；timer 回调无条件删新定时器。0 s 空闲也能判 timeout | 计算并比较 `phaseDeadline`，未到点直接 return；timer 闭包捕获自身句柄，仅当 map 中仍是自己时删除；补「提前/重复回调保持 running」单测 |
| QA-35-02 | medium | `src/host/generation.js:364` | `onAgentError` 失败该 agent 的所有 pending/running，跨书误杀；`agent/status running` 同样广播 | 至少只失败 `state==='running'` 且能关联的记录；pending 交给排队超时；补「b1 已认领、b2 排队，一条 agent/error 只影响 b1」集成测试；若 DSH 事件能带 messageId/turn 关联，优先精确匹配 |
| QA-35-03 | low | `src/host/settings.js:58`、`routes.js:140` | 设置损坏只写 `corrupted` 与启动 warn，`/health.settingsError`、`/settings` 不暴露，用户只能从 `rootSource` 变化猜 | `settingsView`/`/health` 增加 `settingsCorrupted` 或把损坏原因写入 `settingsError`；补断言 |
| QA-35-04 | low | `test/integration/generate-map-observe.test.js:181` | 固定 400 ms 收集窗口在满载下假红 | 改为轮询到目标帧（总超时 ≥2 s）；或提高窗口并断言收到 hello 后继续收集 |
| QA-35-05 | low | `test/integration/ask-route.test.js` | 全量满载时偶发 IT-ASK-03 回写断言失败、IT-ASK-05 期望 202 得 409；隔离 3/3、全量复跑通过 | 找出共享状态/时序（大概率是上一用例线程未清或 E_BUSY 门未释放），改为独立临时 workspace 或显式等待；门禁改连续 3 次全绿 |

二轮状态：QA-35-01..05 全部关闭（`fe84419`），无新增 finding。证据：§4.3、§5.2、§5.3、§11。

## 8. 合并 main 前必须关闭

- [x] QA-35-01、QA-35-02 修复并补回归测试；QA-35-03/04/05 随同关闭（`fe84419`）。
- [x] 修复后 `npm run verify` 在干净 worktree `.qa-t35b` 连续 3 次 0 fail（426/389/0/37）。
- [ ] §6 现场手测在**重启后的宿主**执行，记录 `resolvedRoot`、`moved`、`GET /books` 5 本、面板存储位置行截图。
- [ ] 现场门禁关闭后再合并 main；本轮**不建议**以「自动化全绿」替代现场门禁。

## 9. 证据索引

- 干净 worktree：二轮 `D:\Qunar\personal\dsh\.qa-t35b`（detached `fe84419`）；首轮 `D:\Qunar\personal\dsh\.qa-t35`（detached `457d9c2`）
- 全量日志：`reports/t35/verify-loaded-fail.out`（417/379/1 的满载红）、`reports/t35/verify-loaded-pass.out`（426/389/0 的放宽窗口满载绿）
- 慢窗口诊断：`reports/t35/observe-slow-diag.out`（9/9）
- 命令：`npm run verify`；`node --test test/unit/settings.test.js test/integration/settings-route.test.js`；`node --test test/unit/generation.test.js test/integration/generation-render.test.js test/integration/generate-map-observe.test.js`
- 现场宿主：`http://127.0.0.1:7439`，pid 158840，`/settings` 404

## 10. 未执行清单

1. 重启后端到端 PUT `/settings/library-root`（§6）。
2. 面板「存储位置」行的真实 GUI 视觉确认（仅有渲染测试）。
3. 桌面宿主 `/health` 新字段与 `rootSource` 的现场读取。
4. 跨盘迁移在真机 GUI 上的用户路径（代码层已用脚本验证）。

## 11. 二轮复验记录（attempt `e12fa54f`）

- 修复提交：`fe84419 fix(generation): 阶段预算、定时器代际与 agent 事件归因（QA-35-01/02）`，17 files / +582−51，含 `generation.js`、`routes.js`、`routes/settings.js`、`library.js`、locale、03/04/07/CHANGELOG 与 `client.js`。
- 文档复核：03 §5.1.1 增 `settingsError` 可见性、§7.5 增阶段截止/timer 代际/事件归因；04 §4.2 #9 增归因规则、存储位置增 `settingsError`；07 M3-07 增 t37 证据；根 CHANGELOG 与 `docs/CHANGELOG` 记录 QA-35-01..05；未发现反向描述。
- 自动化：`.qa-t35b @fe84419` 连续 3 次 `npm run verify` exit 0；`client.js 234560 B`；9 夹具一致；`426 tests / 64 suites / 389 pass / 0 fail / 37 todo`。
- 满载：3 份 `node --test test/integration/generate-map-observe.test.js` 与完整 `npm test` 同时运行，4 个进程全部 exit 0；QA-35-04 未复现。
- 现场：7439 宿主仍为 pid 158840（8:41 启动），`GET /health` 无 `rootPath/rootSource/isFallback`、`GET /settings` 404、`PUT /settings/library-root` 404；现场门禁仍为「未执行·待重启」。
- 判定：t33/t34 自动化与代码验收通过，QA-35-01..05 关闭；**唯一未关闭项是 §6 现场门禁**，合并 main 前必须完成，不能以自动化替代。