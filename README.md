# 阅读实验室 / Reading Lab

DeepSeek Harness（DSH）的本地阅读分析插件：把一本 PDF / EPUB 变成**带引用的思维导图**和**研究笔记**，每张卡片都能唤起 AI 追问，结果可以导出。

> 状态：**v0.2.1 补丁文档定稿（2026-11-21）**。v0.2 能力集（EPUB/文本 PDF 导入、导图/只读画布、卡片详情与引用、研究笔记（只读）、询问 AI 浮层、Markdown/OPML/JSON 导出、自选书库位置与生成状态）已落地；v0.2.1 修复 QA-40-01 线程回写竞态（永久 `running`）。自动化 `npm run verify` 432 tests / 395 pass / 0 fail / 37 todo，QA-35-01..05、QA-40-01 已关闭。v0.2.0 tag 与 GitHub Release 已发布；v0.2.1 的 tag/push/Release 待 t43。现场 `rootPath=D:\Qunar\personal\dsh\reading`、`rootSource=settings`、`isFallback=false`、`GET /books` 5 本为 v0.2.0 记录；v0.2.1 的 GUI 点击、link 安装、PUT 迁移、AC-06 真实模型**未复测**。发布范围与限制见 [12 发布说明](docs/12-release-v0.2.md)。

## 目标能力

| 能力 | 说明 |
|---|---|
| 导入 | 本地 PDF / EPUB，书库列表与元数据；扫描版 PDF 不支持 OCR（`E_SCANNED`） |
| 导图 | 按目录层级生成的卡片树，叶节点带摘要与引用角标，可平移/缩放/选中 |
| 研究笔记 | 全书视角的主题脉络、核心论点、术语表与阅读建议（只读；生成在 0.3.0） |
| 询问 AI | 卡片悬浮入口 + 快捷指令（深入探索 / 解释 / 简化 / 举例 / 引导式学习）；需模型提供方；v0.2.1 修复回写竞态，线程不再永久 `running` |
| 导出 | Markdown、OPML、JSON（HTML / PNG 属下一轮） |
| 书库位置 | 设置 → 工作区 → cwd 三段解析；可迁移、回滚，回退状态可见 |

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
| [09-qa-v0.1](docs/09-qa-v0.1.md) | v0.1 QA：21 项路由探针、缺陷去向 |
| [10-qa-v0.2](docs/10-qa-v0.2.md) | v0.2 QA：FR/AC 实测、PDF 边界、缺陷与放行条件 |
| [11-qa-fix](docs/11-qa-fix.md) | t33/t34/t35 修复验收：存储路径、生成预算、现场门禁未执行项 |
| [12-release-v0.2](docs/12-release-v0.2.md) | v0.2.0/v0.2.1 发布范围、QA-40-01 补丁说明、已知限制、安装/升级与门禁证据 |

根 [CHANGELOG](CHANGELOG.md) 记产品/仓库变更；文档变更另见 [docs/CHANGELOG](docs/CHANGELOG.md)。

## License

[MIT](LICENSE) © fountainhead-gq
