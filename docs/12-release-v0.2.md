# v0.2.0 发布说明

> 状态：**发布文档定稿（2026-11-21）**；版本号 `0.2.0`。
> 维护：docs（qa/docs）；评审：架构 + 工程 + 发布负责人
> 适用范围：`dsh-reading-lab` v0.2.0 发布范围。合并 `main`、打 tag、GitHub Release 由 05 §10 的发布步骤执行；**本文不声称这些动作已经完成**。

## 1. 发布结论

- 版本：`0.2.0`（`package.json`、`package-lock.json`、`/health.pluginVersion` 同源，见 §6）。
- 范围：v0.2 能力集——EPUB/文本 PDF 导入、带引用导图与只读画布、卡片详情与引用跳转、研究笔记（只读）、询问 AI 浮层与线程、Markdown/OPML/JSON 导出、自选书库位置与生成状态可判定。
- 不包含：v0.3 的节点编辑（t19）、HTML/PNG/SVG 导出（t21），以及 `generate-notes`、搜索/小地图、多章并行、1000 节点性能与 i18n/a11y 收尾。
- 发布裁决：按方案 A 发布 v0.2 能力集；已知限制在 §3 逐条披露，不把未执行项写成已通过。

## 2. 发布范围与能力清单

| 能力 | v0.2.0 状态 | 需求/接口 |
|---|---|---|
| EPUB 3 / EPUB 2（NCX）导入、分块、目录 | 已实现并实测 | FR-01/02，04 §4.2 #3–8 |
| 文本型 PDF 导入（零依赖解析、中文 ToUnicode） | 已实现并实测；边界见 §3 | FR-05，04 §4.2 #9 |
| 扫描版/加密 PDF 识别与拒绝 | 已实现；扫描版返回 `E_SCANNED` | FR-05，04 §7 |
| 带引用导图生成、只读画布（平移/缩放/适应/展开） | 已实现 | FR-06/07，04 §4.2 #9–11 |
| 卡片详情、引用 chip、3 s 高亮跳转 | 已实现 | FR-09，04 §4.2 #12–16 |
| 研究笔记五节（只读展示） | 已实现；生成接口在 v0.3 | FR-10，04 §4.2 #10 |
| 询问 AI 浮层、快捷指令、线程落盘、会话留痕 | 已实现；真实回答依赖模型提供方 | FR-11/12/13，04 §4.2 #17–26 |
| 导出 Markdown / OPML / JSON | 已实现；HTML/PNG 不在本版 | FR-15，04 §4.2 #22–25 |
| 自选书库位置、迁移/回滚、`isFallback` 可见 | 已实现并现场手测 | FR-16，04 §4.2 #31–32 |
| 生成状态可判定（排队/运行/空闲/绝对上限） | 已实现并回归 | FR-17，04 §4.2 #9–10 |
| 中文 UI、亮暗主题 | 中文已验；英文/暗色未做发布级截图（AC-08 部分） | NFR-07/08 |

## 3. 已知限制

1. **扫描版 PDF 不支持 OCR**：首/中/末 3 页有效字符 <20 判为无文本层，导入结果为 `unsupported` 并返回 `E_SCANNED`，不写 `chunks.json`；需换文本版 PDF。
2. **部分 PDF 特性不支持**：加密/DRM、`LZW`/`DCT` 滤镜、线性化与增量更新按契约拒绝；不渲染页面图像。
3. **`generate-notes` 在 0.3.0**：本版 `/health.capabilities.generateNotes` 为 `{available:false, availableIn:"0.3.0"}`，接口返回 501；研究笔记只读展示。
4. **AC-06 未验**：无模型提供方的环境无法完成「真实回答 + 引用回写」，本版不以线程状态代替回答验证；有 provider 的 profile 需按 MAN-10/16 复测。
5. **v0.3 延后项**：节点编辑与变更审阅（t19）、HTML/PNG/SVG 导出（t21）、跨书搜索/小地图、多章并行、1000 节点性能指标、i18n/a11y 全量收尾。以上均**未包含**在本版，属于下一轮。
6. **未执行项**：XMind/Mubu 导入未实测；100 MB 上限只做了契约断言；离线场景（AC-10）未单独跑。

## 4. 安装方式

前置：DSH ≥ `0.2.2-rc.1`；从源码安装时 Node ≥ `22.19.0`，先 `npm install && npm run build:client`。

### 4.1 link 安装（开发/本地推荐）

```text
plugin_manager action="install_bundle"
               target="link:D:\\Qunar\\personal\\dsh\\dsh-reading-lab"
```

- profile 的 `node_modules/dsh-reading-lab` 是指向仓库的 Junction；改代码立即反映到磁盘，但**已加载的 Host 模块需重启 DSH**，Client 改动需 `npm run build:client` 后刷新页面。
- `link:` 不能覆盖已有安装；切换形式前先 `remove_bundle`。
- 安装结果看 `application`、`warnings`、`pendingBuilds`；出现 `restart-required` 必须重启。

### 4.2 file 安装（复制快照）

```text
plugin_manager action="install_bundle"
               target="file:D:\\Qunar\\personal\\dsh\\dsh-reading-lab"
```

- `file:` 在 pnpm 下是**复制**，不是链接；安装后仓库改动不会同步到 profile，升级或改代码都要重新安装。
- 适合固定版本验收；不要用它做日常开发循环。

安装后按 05 §6.3 的九项验证，至少确认：插件行出现、侧栏图标可开面板、`GET /health` 返回 `storage:"ok"` 且 `pluginVersion:"0.2.0"`、`GET /events` 首帧 `hello`。

## 5. 升级注意

- **数据位置**：书库默认在 workspace 的 `reading/`；可用 `PUT /settings/library-root` 改到自选目录。设置文件为 `$DSH_HOME/reading-lab/settings.json`，本版只认 `{schemaVersion:1, libraryRoot}`，不手工编辑 profile。
- **settings.json 兼容**：`0.1.0 → 0.2.0` 不改变该文件结构；缺失时按「workspace → cwd」解析。JSON 损坏时 `settingsError:"settings-corrupted"`，面板显示 `role=alert` 警告，不会静默当作正常。
- **旧书迁移**：升级本身**不移动**已有书。改根时 `moveExisting:true` 迁移 `books/`、`exports/`、`inbox/`、`index.json`；`moveExisting:false` 保留旧根文件，切回旧根即可见。目标非空返回 400 `E_PATH`（`target-not-empty`），源目录不动；迁移失败回滚，不要手工合并两份书库。
- **备份**：发布前备份 `reading/` 与 `settings.json`；回滚安装用 `git switch --detach v0.1.0`（或上一 tag）后重建并重启，数据目录不受影响。

## 6. 发布门禁证据

| 项 | 结果 | 证据 |
|---|---|---|
| 版本号 | `0.2.0` | `package.json` / `package-lock.json`；`/health.pluginVersion` 由 `package.json` 读取（`src/host/respond.js`） |
| Client 构建一致 | 通过 | `node scripts/build-client.mjs --check` → `client.js is up to date (234560 bytes)` |
| 自动化门禁 ×3 | 通过 | 干净 worktree `.qa-t35b @ fe84419` 连续 3 次 `npm run verify` exit 0：`426 tests / 64 suites / 389 pass / 0 fail / 37 todo` |
| 夹具 | 通过 | 9 个夹具与 `manifest.json` 一致；扫描版/损坏/越界路径均按契约拒绝 |
| QA-35-01..05 | 全部关闭 | `fe84419`；阶段预算、定时器代际、事件归因、`settingsError`、测试窗口修复，见 [11](11-qa-fix.md) §7/§11 |
| 现场手测 | 通过 | `rootPath=D:\Qunar\personal\dsh\reading`、`rootSource=settings`、`isFallback=false`，`GET /books` 返回 5 本（2026-11-21 记录） |
| 文档链接 | 通过 | `docs/` 相对链接检查 0 断；`npm run verify` 含文档契约 |
| tag / Release | 未执行 | 由发布步骤完成；本文不将其写成已完成 |

## 7. 相关文档

- [02 需求](02-requirements.md) §6/§9：版本范围、AC 与发布门禁（编号权威）
- [04 接口](04-api.md) §4.2：路由、错误码与生成状态/存储位置契约
- [05 开发](05-dev.md) §6/§10：安装、重载、发布步骤与回滚
- [07 清单](07-checklist.md) §9：可执行发布门禁
- [10 v0.2 QA](10-qa-v0.2.md)：v0.2 实测矩阵与缺陷
- [11 修复验收](11-qa-fix.md)：QA-35-01..05 与现场门禁