# Changelog

本项目的所有重要变更都记录在这里，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 初始化仓库骨架：`package.json`（`type: module`、bundle patch、`dsh.client.platform=web`、`engines.dsh`）、
  `cordis.patch.yml`（插入插件行 `reading-lab`）、`icon.svg` 占位、`locale/en.json` 与 `locale/zh.json` 的
  `meta` 文案。
- `src/host/index.js` 与 `src/client/index.js` 两个可加载的入口骨架（`apply` 暂为空）。
- `README.md` 与 `docs/01-research` ~ `docs/06-test` 六篇占位文档。
- `.gitignore`、`.gitattributes`（统一 LF 换行）、MIT `LICENSE`（fountainhead-gq）、
  目录骨架 `src/host` `src/client` `locale` `docs` `scripts` `test` `assets`。