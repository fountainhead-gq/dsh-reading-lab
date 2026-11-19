# 阅读实验室 / Reading Lab

DeepSeek Harness（DSH）的本地阅读分析插件：把一本 PDF / EPUB 变成**带引用的思维导图**和**研究笔记**，每张卡片都能唤起 AI 追问，结果可以导出。

> 状态：**v0.1 开发中（M1 骨架完成，插件已装入 profile）**。Host 已装配路由/SSE/工具/提示节，Client 已有可渲染的主面板壳（书库空态）与侧栏图标；导入、导图、笔记、询问、导出仍是 `E_NOT_IMPLEMENTED` 桩，按 [07 清单](docs/07-checklist.md) 从 M2 继续。插件已用 `link:` 装进 `desktop` profile（重启 DSH 后生效），M1 的图标联动与截图仍待重启后人工补，记录见 [05 §6.7](docs/05-dev.md)。

## 目标能力

| 能力 | 说明 |
|---|---|
| 导入 | 本地 PDF / EPUB，书库列表与元数据；扫描版 PDF 暂不支持 OCR |
| 导图 | 按目录层级生成的卡片树，叶节点带摘要与引用角标，可平移/缩放/选中 |
| 研究笔记 | 全书视角的主题脉络、核心论点、术语表与阅读建议 |
| 询问 AI | 卡片悬浮入口 + 快捷指令（深入探索 / 解释 / 简化 / 举例 / 引导式学习） |
| 导出 | Markdown、OPML、JSON（后续 HTML / PNG） |

## 架构主张

**确定性工作下沉到插件代码，LLM 工作交给会话 agent。**

- 解析 / 分块 / 目录提取是纯代码，快速、可测、不耗配额。
- 摘要、导图节点、研究笔记、追问建议由会话 agent 通过 `reading.*` 工具完成，过程在会话流里可见、可中断、可复现。

## 目录结构

```
src/host/        Host 半：书库、解析管道、存储、agent 工具、导出
src/client/      Client 半：侧栏图标、主面板（书库 + 画布）、询问 AI 浮层
locale/          插件文案（en / zh），meta.title / meta.description 供插件管理器展示
docs/            调研、需求、设计、接口、开发、测试、清单与门禁报告
scripts/         仓库脚本（夹具生成、Client 构建、Schema 校验）
test/            自动化测试与夹具
assets/          截图与发布素材
icon.svg         插件图标
cordis.patch.yml bundle 插入的插件行
```

## 开发

```bash
npm install              # 无运行时依赖，仅生成锁文件
npm run build:client     # 把 src/client/** 拼成根目录 client.js（单入口约束，见 05 §4）
npm run check            # client.js 比对 + Host/Client 入口语法检查
npm test                 # 单元/集成/契约测试（node --test）
npm run verify           # check + fixtures:check + test，合并前必须 exit 0
```

分支约定：`main` 保持可发布，日常开发在 `dev` 上进行，测试通过后合回 `main`。

安装到 DSH（本地目录方式，开发期用 `link:` 以便改代码即时生效）：

```text
plugin_manager action="install_bundle" target="link:D:\\Qunar\\personal\\dsh\\dsh-reading-lab"
```

`link:` 不能覆盖已有安装，换形式前先 `remove_bundle`。装好后**必须重启 DSH** 才会加载 Host 与侧栏图标；
安装顺序、失败重试与 5807 取证的实测记录见 [05 §6.7](docs/05-dev.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [文档索引](docs/README.md) | 阅读顺序、编号权威与同步规则 |
| [01-research](docs/01-research.md) | 参考产品与 DSH 机制调研 |
| [02-requirements](docs/02-requirements.md) | 需求、验收口径与 7 项决策（编号权威） |
| [03-design](docs/03-design.md) | 总体设计、模块边界与文件所有权 |
| [04-api](docs/04-api.md) | Host 服务、Remote 路由与 agent 工具接口 |
| [05-dev](docs/05-dev.md) | 开发流程、构建、调试与发布 |
| [06-test](docs/06-test.md) | 测试策略、夹具与手工验收 |
| [07-checklist](docs/07-checklist.md) | M1–M5 里程碑 DoD 与发布门禁 |
| [08-doc-gate](docs/08-doc-gate.md) | 2026-11-19 开发前文档门禁报告 |

根 [CHANGELOG](CHANGELOG.md) 记产品/仓库变更；文档变更另见 [docs/CHANGELOG](docs/CHANGELOG.md)。

## License

[MIT](LICENSE) © fountainhead-gq
