# 手工验收手册（L3 安装冒烟 + L4 验收）

本目录只放**必须在真实 DSH 中执行**的步骤。自动化命令见 [06 测试方案 §4](../../docs/06-test.md#4-测试命令)，用例定义见 [§8](../../docs/06-test.md#8-验收场景与手工步骤ac-01ac-10)。

> 当前状态：M0 骨架。以下步骤尚未执行；执行后按本文模板留证据，并更新任务系统。禁止在未执行时宣称“安装通过”。

## 1. 环境准备

1. 确认 DSH 版本为 0.2.2-rc.5（或 `package.json` 的 `engines.dsh` 允许的版本），GUI 为 `http://127.0.0.1:5807`。
2. 准备一个**专用测试工作区**，避免污染日常书库；记录绝对路径。
3. 在 `dev` 分支执行：

   ```powershell
   cd D:\Qunar\personal\dsh\dsh-reading-lab
   npm run verify
   npm pack --dry-run
   git rev-parse --short HEAD
   ```

   只有 `verify` 退出码 0 才继续。
4. 记录：日期、执行人、commit、DSH 版本、工作区、Node/npm 版本。

## 2. 安装冒烟（L3）

1. 通过 DSH 插件管理器安装本目录（开发安装）。
2. 确认 bundle 行 `reading-lab` 已启用；重启或重载 DSH。
3. 打开 5807：
   - 侧栏出现「阅读实验室 / Reading Lab」图标；
   - 点击打开主面板，且只有一个实例；
   - 切到会话再切回，面板仍在，选书/视口保持；
   - 空态有可点击的「导入」。
4. 打开 DevTools → Network：
   - `GET /dsh-reading-lab/api/v1/health` → 200；
   - body 含 `ok`、`version`、`capabilities`；
   - 无反复失败的请求。
5. 会话中触发 `reading_import`（用 `test/fixtures/epub3-mini.epub`）：
   - 工具出现在工具清单，调用卡可见；
   - 书库出现条目并最终 `ready`；
   - 工作区出现 `reading/books/<bookId>/`。
6. 退出 DSH 再启动：书库与上次选中的书恢复。
7. 卸载插件：`reading/` 数据仍在；重装后仍可读（数据不随插件删除）。
8. 将结果填入 §5 模板。

**失败即阻断**：安装失败、面板不出现、health 非 200、工具未注册，任一出现都不得进入 L4。

## 3. 验收走查（L4）

按 [06 §8.2](../../docs/06-test.md#82-手工用例man) 的 MAN-01..MAN-15 顺序执行。建议分组：

| 组 | 用例 | 预计 |
|---|---|---|
| 入口与书库 | MAN-01、MAN-02 | 10 min |
| 导入与解析 | MAN-03、MAN-04、MAN-05 | 25 min |
| 导图与画布 | MAN-06、MAN-07、MAN-08 | 25 min |
| 研究闭环 | MAN-09、MAN-10、MAN-11、MAN-12 | 35 min |
| 非功能 | MAN-13（双语/主题/离线） | 15 min |
| v0.3 | MAN-14、MAN-15 | 20 min |

注意：

- MAN-10 需要已配置模型；无模型时只验证禁用态与提示文案，并标注“模型不可用，问答未执行”。
- MAN-07 的帧率采样需关闭其他重负载程序，记录节点数、缩放级别与采样时长。
- MAN-05 中 100 MB 文件可用 `node scripts/gen-fixtures.mjs --large` 或系统大文件，但**不要**把大文件放进 `test/fixtures/`。
- 每完成一条立即记录，不要凭记忆补写。

## 4. 证据与失败

- 截图：`test/manual/evidence/<yyyyMMdd>/MAN-xx-01.png`；大视频只记链接。
- 日志：Host 日志与浏览器 Console 各取相关片段，去掉正文与密钥。
- 失败：记录最小复现步骤、预期/实际、关联 FR/AC，提交缺陷；修复后重跑该条，不跳步。
- 任何“通过”必须能在 06 §8.3 的模板中还原出执行人与证据路径。

## 5. 执行记录模板

```text
日期:
执行人:
commit:
DSH / Node / npm:
工作区:
安装方式:

[L3]
结果: PASS | FAIL
health: <status + body 摘要>
面板/工具/恢复/卸载:

[L4]
MAN-01: PASS | FAIL | BLOCKED — 证据:
MAN-02: ...
...
偏差与缺陷:
```
