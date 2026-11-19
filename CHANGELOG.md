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

#### Known issues

- 插件已装进 `desktop` profile（`link:D:/Qunar/personal/dsh/dsh-reading-lab`，Junction 指向仓库），
  但 Host `apply` 尚未执行（工作区无 `reading/`），**须重启 DSH** 才会加载；此前三轮 `install_bundle`
  失败分别来自 profile 的 `minimumReleaseAge` 闸门、镜像不可达与一次 `dsh-mobile-tailcat-win32-x64`
  的瞬时文件占用（原文见 05 §6.7），重试与换 `link:` 后已通过。
- `M1-13`、`M1-19`、`E-M1-a`、`E-M1-d` 仍为 `[!]`：需重启后由能访问票据 URL 的人点 03 §3.2 五步并截图。

### Changed

- 2026-11-19 开发前文档门禁：统一 FR-11/DR-07 的提问注入机制为 `agent.followup`；修正 03 §12.3/§12.4 的夹具路径、夹具数量与 AC 映射；修正交叉引用、MAN 用例关联编号与 07 的 Q 编号；关闭 D-05-01/03/04 与 D-06-01/02/03/06。
- README 状态更新为「文档就绪、代码 M0」，文档表补齐 07/08 与索引。
