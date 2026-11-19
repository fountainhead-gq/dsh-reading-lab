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

### Changed

- 2026-11-19 开发前文档门禁：统一 FR-11/DR-07 的提问注入机制为 `agent.followup`；修正 03 §12.3/§12.4 的夹具路径、夹具数量与 AC 映射；修正交叉引用、MAN 用例关联编号与 07 的 Q 编号；关闭 D-05-01/03/04 与 D-06-01/02/03/06。
- README 状态更新为「文档就绪、代码 M0」，文档表补齐 07/08 与索引。
