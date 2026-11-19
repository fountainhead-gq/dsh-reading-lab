# 05 开发

> 状态：**生效**（Owner：核心工程 / host-shell；评审：架构）
> 适用版本：v0.1 起。最近更新：2026-11-19。

本文是**可执行**的开发手册：环境、命令、客户端构建、本地安装与重载、调试、分支与发布。
设计口径见 [03-design](03-design.md)，接口口径见 [04-api](04-api.md)，测试细节见 [06-test](06-test.md)，
验收与里程碑清单见 [07-checklist](07-checklist.md)。

**唯一事实源**：命令以仓库根 `package.json` 为准，接口以 04 为准，设计与所有权以 03 为准。
本文与它们冲突时，先改文档（§9），再改代码。

---

## 1. 环境要求

| 项 | 要求 | 本机实测（可作为下限参考） |
|---|---|---|
| Node.js | ≥ 22.19（`node --test` 的 glob 与 `node:test` 稳定行为）；推荐 24 LTS | v24.19.0 |
| npm | ≥ 10（lockfile v3） | 11.17.0 |
| git | ≥ 2.40 | 2.50.1.windows.1 |
| DSH | ≥ `0.2.2-rc.1`（`package.json` 的 `dsh.engines.dsh`）；以 0.2.2-rc.5 联调 | 0.2.2-rc.5 |
| 操作系统 | Windows 11 为主；macOS / Linux 走同一套 Node 命令，路径分隔符由 `node:path` 处理 | Windows 11 |
| Shell | PowerShell 7 或 bash；本文命令两种写法都给出 | PowerShell 7 |
| 磁盘 | ≥ 300 MB（依赖 + 夹具 + 生成物） | — |
| 网络 | **仅首次 `npm install` 需要**；安装后导入/浏览/导出/提问全离线（NFR-04） | — |

- 不要用 Bun / Deno 跑测试：`node --test` 的语义与 `node:test` 报告格式是门禁的一部分。
- 插件运行期不依赖 Python、Java、系统 PDF 工具；PDF 解析走 `pdfjs-dist`（M2 引入，见 §1.3）。
- `DSH_NODE_EXECUTABLE`、`DSH_HOME` 等变量由 DSH 注入当前会话；调试脚本里不要硬编码盘符（§7.1）。

### 1.1 首次准备

```powershell
git clone <repo-url> dsh-reading-lab
cd dsh-reading-lab
git switch dev
npm install
npm run check
npm run build:client    # M1 起必需；见 §4
```

```bash
git clone <repo-url> dsh-reading-lab
cd dsh-reading-lab
git switch dev
npm install
npm run check
npm run build:client
```

`<repo-url>` 在私有仓库创建后确定（§5.4）。在当前阶段，仓库可能还没有远端，直接使用本地目录即可。

### 1.2 Node 版本声明

`package.json` 目前只声明了 `dsh.engines.dsh`，没有 `engines.node`。M1 由 host-shell 补：

```json
{ "engines": { "node": ">=22.19.0" } }
```

登记为 D-05-05（§12）。在此之前，以 §1 表格为准，不用低版本 Node 跑门禁。

### 1.3 运行时依赖计划（M2 引入，锁精确版本）

| 依赖 | 版本 | 许可证 | 用途 | 引入里程碑 |
|---|---|---|---|---|
| `jszip` | 3.10.2 | MIT | EPUB 解包 | M2 |
| `fast-xml-parser` | 4.5.0 | MIT | container.xml / OPF / nav / NCX | M2 |
| `pdfjs-dist` | 5.4.296 | Apache-2.0 | PDF 文本层（legacy build） | M2 |

约束：

- 只允许这三个运行时依赖；新增依赖必须先在 03 §6 / 04 §2 记账，并在 PR 描述里写体积与许可证。
- 版本写**精确值**，不用 `^` / `~`；`package-lock.json` 一并提交。
- 不用 `epubjs`、`pdf-parse`、`unpdf`（03 §6 已给出取舍理由）。
- `pdfjs-dist` 只引 `legacy/build/pdf.mjs`，不引 worker 的 DOM 版本；Node 侧禁用 canvas 渲染。

---

## 2. 仓库结构与 owner 速查

完整目录树与「不碰」列表见 03 §2.1 / §2.2。下表只用于日常找人和找文件。

| 目录 / 文件 | Owner | 说明 |
|---|---|---|
| `src/host/index.js`、`config.js`、`prompt.js` | host-shell | 装配、Config、系统提示；入口不放业务 |
| `src/host/limits.js`、`errors.js`、`paths.js`、`json-file.js`、`queue.js`、`ids.js` | host-core | 阈值、错误、路径安全、原子写、队列、ID |
| `src/host/books.js`、`routes/books.js` | store | 书库 CRUD 与状态机 |
| `src/host/import.js`、`parse/*`、`chunk.js`、`routes/content.js` | parse | 解析、分块、chunks 只读路由 |
| `src/host/layout.js`、`map.js` | map | 导图校验、布局、原子写 |
| `src/host/notes.js` | notes | 五节笔记解析/渲染/校验 |
| `src/host/ask.js`、`threads.js`、`agents.js` | ask | 上下文、注入、线程 |
| `src/host/export/*` | export | md / opml / json / html |
| `src/host/routes.js`、`routes/events.js`、`sse.js` | api | 路由编排、SSE、错误映射 |
| `src/host/tools.js` | tools | 六个工具注册（薄层） |
| `src/client/index.js`、`api.js`、`store.js`、`i18n.js`、`styles.js` | client-shell | 槽位、请求、面板状态、文案、样式 |
| `src/client/views/canvas.js`、`svg.js` | canvas | 画布渲染与几何 |
| `src/client/views/library.js`、`header.js` | library | 书库列表与顶栏 |
| `src/client/views/detail.js` | detail | 详情抽屉与原文定位 |
| `src/client/views/ask.js`、`overlay.js` | ask-ui | 右浮层、全窗预览、toast |
| `docs/*`、`schema/*`、`scripts/*`、`test/*`、`CHANGELOG.md` | qa/docs | 文档、schema、脚本、测试 |

**03 未列、本文补充的共享文件**（改动需在 PR 里 @ 对应 owner）：

| 文件 | Owner | 说明 |
|---|---|---|
| `package.json`、`package-lock.json`、`cordis.patch.yml`、`icon.svg` | host-shell | 元数据、bundle 行、图标 |
| `locale/en.json`、`locale/zh.json` | client-shell | 文案 key；`meta.*` 改动要 host-shell 复核 |
| `README.md`、`docs/README` 索引（若有） | qa/docs | 状态行、文档表 |
| `client.js`（构建产物） | client-shell | 只由构建脚本生成，不手改（§4） |

---

## 3. 命令清单

全部命令在仓库根执行。当前 `package.json` 的 `scripts` 是权威版本；若下表与它不一致，改表。

| 命令 | 作用 | 何时跑 | 通过标准 |
|---|---|---|---|
| `npm install` | 安装依赖、生成/校验 lockfile | 首次；`package.json` 变更后 | exit 0；`git diff package-lock.json` 符合预期 |
| `npm run check` | `node --check` 校验 Host 与 Client 入口 | 每次提交前 | exit 0，无输出 |
| `npm run build:client` | 拼接 `src/client/**` → `client.js`（§4） | 改任何 Client 文件后、安装前 | exit 0；`client.js` 含 `id: 'dsh-reading-lab'` |
| `npm run build:client:check` | 重新生成并与磁盘比对（不写盘） | 合并前、发布前 | exit 0；不一致时按提示重建 |
| `npm test` | 全部 `test/**/*.test.js`（`node --test`） | 每次提交前 | exit 0；用例分层见 06 |
| `npm run test:unit` | 纯函数单测（解析、分块、布局、导出、路径） | 改 `parse/*`、`chunk.js`、`layout.js`、`export/*` | exit 0 |
| `npm run test:integration` | HTTP 契约（`makeRoutes` + 临时 server） | 改 `routes*`、`sse.js`、`tools.js` | exit 0 |
| `npm run test:smoke` | 包契约与夹具冒烟 | 改 `package.json`、`test/fixtures/*` | exit 0 |
| `npm run fixtures` | 重新生成 `test/fixtures/`（确定性） | 改 `scripts/gen-fixtures.mjs` | exit 0；`git status` 只含预期夹具 |
| `npm run fixtures:check` | 重新生成并逐字节比对 | 每次提交前 | exit 0；不一致说明夹具被手改或生成器漂移 |
| `npm run verify` | `check` + `fixtures:check` + `test` | 合并 `main` 前 | exit 0 |
| `npm pack --dry-run` | 核对发布清单 | 发布前 | 含 `src/`、`client.js`、`locale/*.json`、`icon.svg`、`cordis.patch.yml`、`README.md`、`LICENSE`；不含 `test/`、夹具、`node_modules/`、`*.tgz` |

状态说明：`build:client` / `build:client:check` 属 M1（D-05-02），在它们落地前不要写进 `verify`；
`test*` 与 `fixtures*` 由测试 owner 随夹具 PR 加入，合并时以 `package.json` 为准复核（D-05-04）。
§3.2 的命令尚未存在，不属于当前门禁。

### 3.1 最短路径

```powershell
npm install
npm run check
npm run build:client
npm test
npm run verify
```

### 3.2 计划中、尚未落地的命令

| 命令 | Owner | 里程碑 | 说明 |
|---|---|---|---|
| `node scripts/verify-schemas.mjs` | qa/docs | M4 | 用 `schema/*.json` 校验导出与样例（03 §2.1） |
| `node scripts/smoke.mjs` | qa/docs | M2 | 夹具全链冒烟（解析 → 分块 → 布局 → 导出） |

在它们落地前，不要把它们写进 `verify`，也不要声称已通过。

### 3.3 常见失败

| 症状 | 原因 | 处理 |
|---|---|---|
| `node --test` 报 unknown option / 匹配不到文件 | Node < 22 或 glob 被 shell 吃掉 | 用 Node 24；PowerShell 下保留引号 `"test/**/*.test.js"` |
| `fixtures:check` 失败 | 夹具被手改，或生成器与 Node 版本组合变了 | 先 `npm run fixtures`，确认 `manifest.json` 变化合理再提交 |
| `npm install` 403 | 镜像缺包（01 R-07） | 换官方 registry 或离线缓存；不要提交 `node_modules` |
| `npm run check` 指向已删除文件 | 入口改名但 scripts 未同步 | 改 `package.json`（host-shell），不要绕开检查 |

---

## 4. 客户端构建（M1 前置，必读）

### 4.1 为什么需要构建

DSH 的浏览器侧不是 ESM import map，而是**脚本 + 模块表**：

1. Host 在 boot manifest 里给出每个插件的 `client` 入口 URL（`rev` 参数做缓存失效）。
2. 浏览器用 `<script src>` 加载该入口（`dsh-client-modules/lib/client.js` 的 `defaultLoadBundle`）。
3. 入口脚本必须调用 `window.__ModuleLoader__.load({ id, factory(require) {...} })`，`id` 等于包名。
4. `factory` 收到的 `require` 只解析**宿主模块表**里的包（`react`、`react-dom` 等）和其它已注册插件；
   它**不解析相对路径**。相对文件要走 `require.async('./chunk-*.js')` 的分块协议，该协议依赖 Host
   侧的 chunk 清单，第三方插件尚无先例，v0.1 不用。

结论：一个插件只能有一个 `client` 入口文件。03 §2.1 把 Client 拆成 `index.js` + `views/*.js` 是为了
**让多人并行改不同文件**，因此必须有一步把它们合成单文件。当前仓库骨架只有 `src/client/index.js`，
所以还没暴露这个问题；**第一次拆 view 前必须先把构建落地**（D-05-02）。

### 4.2 约定（零依赖拼接）

- `src/client/index.js`：入口，负责 `window.__ModuleLoader__.load(...)`、`require('react')`、组装 `apply`。
- `src/client/views/*.js`：**普通脚本片段**，不含 `import` / `export` / 顶层 `require`；
  文件末尾调用 `__readingLabView('<name>', function (deps) { ... return Component })` 注册。
- 注册顺序写在构建脚本的 `ORDER` 数组里，不在文件系统里扫（保证确定性）。
- 文件之间不互相引用；共享逻辑放 `store.js` / `svg.js`，通过 `deps` 注入。
- view 文件里不出现 `document.querySelector` 之外的全局查找；样式走 `styles.js` 注入的 class。

`src/client/views/canvas.js` 的形状：

```js
/* 由 scripts/build-client.mjs 包进 IIFE，因此这里可以直接用 __readingLabView */
__readingLabView('canvas', function (deps) {
  const React = deps.React
  const { api, store, t } = deps

  function renderCanvas(props) {
    // 纯渲染 + 事件回调；数据从 store 取
  }

  return { renderCanvas }
})
```

`src/client/index.js` 的形状（构建后仍是同一个文件，只是前面多了片段）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-reading-lab',
  factory(require) {
    const React = require('react')
    const views = {}
    const __readingLabView = (name, factory) => { views[name] = factory }
    // ---- 构建时在这里插入 views/*.js 的 IIFE ----
    const deps = { React, api, store, t, styles }
    const modules = Object.fromEntries(
      Object.entries(views).map(([name, factory]) => [name, factory(deps)]),
    )
    return { apply(ctx) { /* 注册槽位、样式、监听器；返回清理 */ } }
  },
})
```

> 兼容性说明：`views/*.js` 里的 `__readingLabView` 由 `index.js` 在同一函数作用域内定义，构建脚本只做
> **文本拼接**，不做作用域改写。因此 view 文件不能声明与入口同名的顶层变量（`React`、`views`、`deps`）。

### 4.3 `scripts/build-client.mjs` 行为（M1 由 client-shell + qa/docs 实现）

1. 读取固定顺序：`views/header.js`、`views/library.js`、`views/canvas.js`、`views/detail.js`、
   `views/ask.js`、`views/overlay.js`（不存在的文件跳过并打印警告）。
2. 每个文件包成 `;(function () { <内容> })();`，缩进不改写，便于定位。
3. 读 `src/client/index.js`，在标记 `// ---- build:views ----` 处插入拼接结果。
4. 写临时文件 `client.js.tmp` → `node --check` 通过后原子改名 `client.js`；失败保留旧产物并 exit 1。
5. `--check` 模式：生成到内存，与磁盘上的 `client.js` 逐字节比较，不一致 exit 1 并提示重建。
6. 产物头部写 `/* generated by scripts/build-client.mjs — do not edit */` 与源文件哈希；**不写时间戳**，
   保证同一输入的产物稳定，避免无意义 diff。

### 4.4 需要同步修改的 `package.json`（D-05-02，M1 门禁）

| 字段 | 现状 | 目标 |
|---|---|---|
| `exports["./client"]` | `./src/client/index.js` | `./client.js` |
| `files` | 无 `client.js` | 增加 `"client.js"` |
| `scripts` | 无构建 | 增加 `build:client`、`build:client:check`，并把 `client.js` 纳入 `check` |
| `scripts.verify` | 未包含构建检查 | 增加 `npm run build:client:check`（M1 起） |

`client.js` **入库**（与 `dsh-weread-gather` 的做法一致）：克隆即可加载、review 能看到生成差异；
代价是合并冲突时不能手改——**永远重新生成**（§5.6）。Owner：host-shell 改 `package.json`，
client-shell 改脚本与入口；两者在同一个 M1 PR 里落地。

### 4.5 不采用的方案

| 方案 | 不用的原因 |
|---|---|
| esbuild / tsdown 打包 | 引入 devDependency 与联网安装（R-07 离线约束），收益只是 tree-shaking；本项目 Client 体积小 |
| `require.async('./chunk-*.js')` 分块 | 依赖 Host 侧 chunk 清单与 `CLIENT_CHUNK` 命名协议，第三方插件无先例，验证成本高于收益 |
| 每个 view 做成独立插件 | 槽位归属混乱，locale 与 store 无法共享，且用户会看到多个 bundle 行 |

---

## 5. 分支、提交与合并

### 5.1 分支模型

```
main ──●────────────●──────────────●   （可发布；只接受 dev 的 --no-ff 合并与 hotfix）
        \          /              /
dev      ●──●──●──●──●──●──●─────●     （集成分支；日常开发）
              \      /
feat/*         ●────●                   （可选：跨多天的功能，合并回 dev 后删除）
```

- `main` 永远可安装、可打包；**禁止**直接 commit 到 `main`（hotfix 例外，需当天回合 `dev`）。
- 日常从 `dev` 切 `feat/<module>-<topic>`，例如 `feat/canvas-pan-zoom`、`feat/parse-epub-ncx`。
  单人一天内的小改动可以直接在 `dev` 上提交，但每次提交前 `git pull --rebase`。
- 分支名小写、连字符；不用中文、不用 `feature/`、`bugfix/` 前缀。
- 合并回 `dev` 用 `git merge --no-ff`，保留一次合并记录；不用 squash 抹掉实现过程。

### 5.2 提交规范（Conventional Commits）

格式：`<type>(<scope>): <subject>`

| type | 用途 |
|---|---|
| `feat` | 用户可见的新能力 |
| `fix` | 修复缺陷 |
| `docs` | 只改文档 |
| `test` | 只改测试与夹具 |
| `refactor` | 不改行为的结构调整 |
| `perf` | 性能 |
| `build` | 构建脚本、依赖、打包 |
| `chore` | 其它（gitignore、元数据） |

`scope` 用 03 §2.2 的角色名：`host`、`parse`、`map`、`store`、`notes`、`ask`、`export`、`api`、`tools`、
`client`、`canvas`、`library`、`detail`、`ask-ui`、`docs`、`test`。

规则：

- subject 用中文，≤ 50 字，动词开头，不加句号；例如 `feat(parse): 支持 EPUB2 NCX 目录回退`。
- body 写**为什么**与影响面；行为变化附验证命令；破坏性变更写 `BREAKING CHANGE:`。
- 一次提交只做一件事；格式化、重命名、依赖升级各自独立，不混进功能提交。
- 文档与代码同一提交（§9）；`CHANGELOG.md` 的 `Unreleased` 同步更新。
- 不在提交信息里写「测试通过」除非真的跑了（§10.2 的证据要求）。

### 5.3 合并前检查（dev → main）

```powershell
git switch dev
git pull --rebase
npm ci
npm run verify
npm run build:client:check
npm pack --dry-run
git switch main
git merge --no-ff dev -m "chore(release): v0.1.0"
```

再按 [07-checklist](07-checklist.md) 勾完 v0.1 的出口项，然后打标签、推送（§5.5、§10）。

### 5.4 远端与私有仓库

当前 `git remote -v` 为空。首次推送：

```powershell
gh auth status
git remote add origin git@github.com:fountainhead-gq/dsh-reading-lab.git
git push -u origin main
git push -u origin dev
```

没有现成仓库时用 `gh` 创建私有仓库（`--source` 指向当前目录，会立即推送当前分支）：

```powershell
gh repo create fountainhead-gq/dsh-reading-lab --private --source . --remote origin --push
```

- 仓库必须 **private**；`README`、`LICENSE`、`CHANGELOG` 一并推送。
- 不在仓库里提交 `reading/`、`exports/`、`*.epub`、`*.pdf`、日志（`.gitignore` 已覆盖，夹具例外见 06）。
- 凭据用 `gh auth login` 或 SSH key，不写进 remote URL。

### 5.5 版本与标签

- 版本与里程碑：v0.1.0 = M1–M3（导入 + 导图），v0.2.0 = M4（笔记/询问/导出），v0.3.0 = M5（编辑/HTML/PNG/引导）。
- 版本号只改 `package.json` 的 `version`（与 04 §8 的 `schemaVersion` 无关），同步 `CHANGELOG.md`。
- 打附注标签：

```powershell
git tag -a v0.1.0 -m "v0.1.0: EPUB/PDF 导入、带引用导图、画布与详情"
git push origin v0.1.0
```

- 不重复使用标签；发布后发现问题，发 `v0.1.1`，不回滚标签。

### 5.6 冲突处理

- `package-lock.json` 冲突：取一边后 `npm install` 重生成，不手改。
- `client.js` 冲突：取任意一边，然后 `npm run build:client` 重生成，再提交。
- 夹具冲突：`npm run fixtures` 重生成，`fixtures:check` 通过后提交（说明生成器一致）。
- 文档冲突：以 `dev` 的最新决策为准；拿不准就回到 03 §0 裁决摘要。

---

## 6. 本地安装、重载与卸载

### 6.1 安装前

1. `npm run check && npm run build:client`（Client 入口必须存在且是最新产物）。
2. 确认 DSH 正在运行，profile 为 `desktop`（`$env:DSH_PROFILE`）。
3. 记录本仓库绝对路径，例如 `D:\Qunar\personal\dsh\dsh-reading-lab`。

### 6.2 安装（本地目录方式）

在会话里调用插件管理器（等价于 GUI 的 **Settings → Plugins → Add plugin → 本地目录**）：

```text
plugin_manager action="install_bundle"
               target="D:\\Qunar\\personal\\dsh\\dsh-reading-lab"
```

- `target` 是**绝对包目录**，不是 `package.json` 路径，也不是 tarball。
- 本地目录安装是**链接**（profile 的 `node_modules/dsh-reading-lab` 指向 checkout；`dsh-weread-gather`
  已实测为 Junction），所以改文件立即反映到磁盘；但**已加载的 JS 模块不会自动换代**（§6.4）。
- 该操作需要 `danger-full-access` 级权限；审批被拒时安装不会发生，不要改用「手工改 profile」绕过。
- 安装结果看 `application`、`warnings`、`pendingBuilds` 三个字段；`restart-required` 表示必须重启 DSH。

### 6.3 安装后验证（每次首次安装或重装都做）

| # | 检查 | 期望 |
|---|---|---|
| 1 | `plugin_manager action="list_bundles"` 搜索 `dsh-reading-lab` | `installed: true`、`enabled: true`、`availability: "profile"` |
| 2 | Settings → Plugins 行 | 标题「阅读实验室 / Reading Lab」，图标与描述来自 `locale/*.json` |
| 3 | 侧栏 `sidebar.panellist` | 出现阅读实验室图标（`key` / `id` 均为 `reading-lab`） |
| 4 | 点击图标 | `main` 区域切到阅读实验室面板（03 §3.2 五步联动） |
| 5 | `GET /dsh-reading-lab/api/v1/health` | 200，`data.storage: "ok"`，`data.capabilities.sse: true` |
| 6 | `GET /dsh-reading-lab/api/v1/events` | 首帧 `event: hello`，含 `revision` 与 `books` |
| 7 | 新会话里问「有哪些阅读工具」 | 出现 `reading_import` 等工具（名字带下划线，不带点） |
| 8 | 系统提示 | 出现阅读实验室一节（`systemPrompt.section`） |
| 9 | 刷新页面（Ctrl+R） | 面板状态可恢复；无 console 报错 |

前 4 项任一失败，按 §7.5 排查；第 5 项失败先看 `/health` 的 `storage` 与 `workspaceRootName`。

### 6.4 重载矩阵

| 改动 | 生效方式 | 说明 |
|---|---|---|
| `src/client/**` | `npm run build:client` → 刷新页面 | 构建产物变了，但页面不会自动重载脚本 |
| `src/host/**` | 重启 DSH（退出并重开） | Node 侧模块已缓存，替换包必须重启 |
| `package.json` 的 `dsh.*`、`cordis.patch.yml` | 重新 `install_bundle`（或重启） | bundle 行与入口声明在启动时解析 |
| `locale/*.json` | 刷新；不生效则重启 | 文案由 Client locale 服务缓存 |
| `icon.svg`、`README.md` | 刷新插件面板 / 重启 | 展示元数据 |
| `docs/**` | 不需要重载 | 只影响仓库 |

**不要**用「删 profile 的 `node_modules` 再装」当日常流程；只在安装状态损坏时按 §6.6 处理。

### 6.5 为什么替换已装包要重启

DSH 的 Host 侧是长驻 Node 进程，ESM 模块按 specifier 缓存；`client.js` 由页面加载，刷新即可换下一页。
因此：

- 只改 Client：构建 + 刷新足够（最快循环）。
- 改 Host：必须重启整个 DSH（或让 DSH 自行报告 `restart-required`）。
- 同时改两端：按 Host 处理（重启一次，Client 自然重新加载）。

### 6.6 卸载与回滚

```text
plugin_manager action="set_plugin" target="dsh-reading-lab" enabled=false   # 停用
plugin_manager action="remove_bundle" target="dsh-reading-lab"              # 移除
```

- 数据不会随插件删除：工作区的 `reading/` 仍在，重装后可继续用。
- 回滚到上一版本：`git switch --detach v0.1.0`（或切回上一个 tag），`npm run build:client`，重启 DSH。
- 禁止手工编辑 `$DSH_HOME/profiles/desktop/{package.json,cordis.patch.yml}`；插件管理器负责一致性。

---

## 7. 调试速查

### 7.1 Host 侧

| 目标 | 位置 / 命令 |
|---|---|
| 启动日志 | `$env:DSH_HOME\logs\startup-<ISO 时间戳>-<uuid>.log`（每次启动一个） |
| 崩溃日志 | `%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log` |
| 组合后的 profile | `dsh --profile desktop --dump-config`（见下） |
| 插件业务日志 | `<workspace>/reading/books/<bookId>/import.log`（NDJSON，字段见 03 §5.7） |
| 读取 asar 内源码 | `$env:ELECTRON_RUN_AS_NODE=1; & $env:DSH_NODE_EXECUTABLE -e "..."` |

`dsh` CLI 在 `D:\Program\dsh\resources\runtime\cli\bin\dsh.cmd`（本机）；跨机器用 `Get-Command dsh`：

```powershell
dsh --profile desktop --dump-config | Select-String -Pattern 'reading-lab' -Context 2,2
```

日志查看：

```powershell
Get-ChildItem "$env:DSH_HOME\logs\startup-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1 |
  Get-Content -Tail 100
```

读 DSH 安装包内的模块（排查 Host 服务签名时用；不要在业务代码里依赖 asar 路径）：

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& $env:DSH_NODE_EXECUTABLE -e "const fs=require('fs');console.log(fs.readdirSync('$env:DSH_INSTALL_DIR/../dsh-client-ui-layout'))"
```

### 7.2 Client 侧

| 目标 | 做法 |
|---|---|
| 打开 DevTools | 窗口内 `Ctrl+Shift+I`（macOS `Cmd+Option+I`） |
| 看错误 | Console 过滤 `reading-lab`、`ModuleLoader`、`client-modules` |
| 看请求 | Network 过滤 `dsh-reading-lab/api`；检查状态码与 `{ok,error}` 信封 |
| 看槽位 | Console：`window.__DSH_BOOT__` 看 boot manifest；面板 DOM 看 `data-plugin` 属性 |
| 看状态 | React 组件树（若装了 React DevTools）；否则在 `store.js` 的 setState 处打日志 |
| 强制重载 | 关闭窗口重开（比 Ctrl+R 更彻底）；确认 `client.js` 的 `rev` 已变 |

Console 里中文可能显示为 GBK 乱码（Windows 控制台编码），**文件本身是 UTF-8**；以编辑器/`read` 工具为准。

### 7.3 `cordis_inspect` 自检

只读工具，不改运行时。先列 provider，再按 manifest 里的名字查：

| platform | provider | method | 用途 |
|---|---|---|---|
| host | `Service` | `listService` | 查 Host 服务是否存在（`webServer`、`tools`、`agents` 等） |
| host | `Tool` | `listTools` | 确认 `reading_*` 已注册、参数 schema 正确 |
| host | `Config` | `listConfigs` | 查插件 Config 的投影 schema 与 `entry` 状态 |
| host | `Event` | `listEvents` | 查 `session/event` 等事件声明 |
| client | `Slots` | `listSubTree` | 查 `main`、`sidebar.panellist` 子树的 key 与顺序 |
| client | `Theme` | `listTokens` | 查 `--dsw-alias-*` 的真实 token 名 |

示例（参数按 provider 的 input schema 传）：

```text
cordis_inspect_query platform="host" provider="Tool" method="listTools"
cordis_inspect_query platform="host" provider="Config" method="listConfigs" input={"entry":"include:reading-lab"}
cordis_inspect_query platform="client" provider="Slots" method="listSubTree" input={"root":"main"}
```

已知限制（01 §2.2 与本次实测一致）：

- `Slots.listSubTree` 可能 **10 s 超时**（页面未聚焦/连接抖动）。重试一次；仍失败就看安装包源码
  （`dsh-client-ui-layout`、`dsh-client-ui-sidebar` 的 `slots.d.ts`），不要据此判定槽位不存在。
- `Config.listConfigs` 的 `status: "absent"` 表示该插件没有导出 Config，不是错误。
- Inspect 是只读的：不能用它调用业务方法或改状态；业务验证走 HTTP。

### 7.4 HTTP / SSE 手工验证

基路径 `/dsh-reading-lab/api/v1`；端口以当前 GUI 地址为准（本机 `http://127.0.0.1:5807`）。

```powershell
$base = 'http://127.0.0.1:5807/dsh-reading-lab/api/v1'
Invoke-RestMethod "$base/health" | ConvertTo-Json -Depth 5
Invoke-RestMethod "$base/books" | ConvertTo-Json -Depth 5
```

上传（裸字节，不 multipart）：

```powershell
curl.exe -sS -X POST "$base/books/import?name=demo.epub" `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@D:\Qunar\personal\dsh\dsh-reading-lab\test\fixtures\epub3-mini.epub"
```

SSE（`curl.exe` 会持续输出；Ctrl+C 结束）：

```powershell
curl.exe -N "$base/events"
```

期望：先 `event: hello`，随后 `: ping`；导入时出现 `event: progress`。中文书名在 PowerShell 里可能乱码，
用 `-o` 落盘再看，或改用浏览器 Network 面板。

### 7.5 常见症状

| 症状 | 最可能的原因 | 处理 |
|---|---|---|
| 侧栏没有图标 | 插件未装/未启用；`panellist` 的 `key` 与 `main` 不一致 | 查 `list_bundles`；核对 `key` 与 `id` 都是 `reading-lab`（03 §3.1） |
| 点图标没反应 | `main` 槽位没注册，或注册在错误的 scope | 用 `Slots.listSubTree {root:"main"}`（超时则读源码）核对；确认 `main` 是 keyed root |
| 面板空白 | Client 入口抛错；`client.js` 未构建/过期 | DevTools Console 看第一条错误；`npm run build:client` 后刷新 |
| `/health` 404 | 路由没注册，或前缀写错 | 查 `routes.js` 的 `kind:'prefix'` 与路径；确认 `inject: ['webServer']` |
| `/health` 503 `E_IO` | 工作区不可写 / `workspaceRoot` 解析失败 | 看 04 §2.3 解析顺序；手动检查 `reading/` 权限 |
| SSE 无事件 | 反向代理缓冲；连接被 60 s 心跳断开 | 直连本机端口；确认 `text/event-stream` 与 `Cache-Control: no-store` |
| 导入 413 | `Content-Length` 超 `maxUploadBytes` | 换小文件；确认限制与 04 §2.2 一致 |
| 导入一直 `parsing` | 队列被前一个任务占住；解析抛错未落状态 | 看 `import.log` 与 Host 日志；`POST /books/:id/retry` |
| `map` 404 | 尚未生成（正常） | 触发 `reading_map`；确认 `status: ready` |
| 工具列表没有 `reading_*` | `tools` 注入缺失；名字带点被拒 | 查 `inject`；搜索 Host 日志里的 function-name 报错 |
| 改了代码没生效 | Host 模块缓存 / Client 未重建 | 按 §6.4 矩阵处理 |
| `restart-required` | 替换了已安装包的 JS | 重启 DSH，不是刷新页面 |
| 控制台中文乱码 | GBK 终端 | 用 UTF-8 查看；或 `chcp 65001` |

---

## 8. 模块所有权与并发约定

1. **一个文件一个 owner**（03 §2.2）。跨文件改动由 owner 提交，或在 PR 描述里写明「已获 @owner 同意」。
2. 不改别人的文件来「顺手修」。需要改就发消息，或把问题记进 07 的偏差表。
3. 接口变更顺序：**02/03/04 先改 → Host 与 Client 同步 → 契约测试（04 §9）→ 合并**。
   禁止先改实现再补文档（§9）。
4. 同一 checkout 多人协作时：
   - `git add <自己的路径>`，**禁止 `git add -A` / `git commit -a`**（会把别人的未完成改动带进来）。
   - 提交前 `git status` 确认只包含自己的文件；推送前 `git pull --rebase`。
   - 不批量重命名、不整体格式化（会制造大面积冲突）。
5. 共享文件的改动集中到一个人：`package.json`（host-shell）、`locale`（client-shell）、`client.js`（构建）。
6. 评审：每个 PR 至少一位非 owner 看「与 03/04 是否一致」；架构 owner 看跨模块影响。

---

## 9. 文档先行与同步规则

### 9.1 变更顺序

```
需求变化 → 02（范围/验收）→ 03（设计/契约）→ 04（接口）→ 代码 → 06（测试）→ 05/07（流程/清单）→ CHANGELOG
```

小改动可以合并步骤，但**不允许跳过 03/04**：只要接口、数据文件、槽位、错误码有变，先改文档。

### 9.2 哪类改动改哪份文档

| 改动 | 必须更新 |
|---|---|
| 新功能 / 范围变化 | 02（US/FR/AC）、03（设计）、07（清单） |
| 路由、入参、返回、错误码 | 04、03 §14（若偏离 02） |
| 数据文件字段 / `schemaVersion` | 03 §5、04 §10、`schema/*.json` |
| 槽位、面板 key、UI 结构 | 03 §3/§4、07（联动检查项） |
| 依赖 / 构建 / 脚本 | 01（体积与许可证）、05（命令）、`package.json` |
| 测试策略 / 夹具 | 06、`test/fixtures/manifest.json` |
| 发布流程 / 分支策略 | 05、07 |
| 任何用户可见行为 | `CHANGELOG.md` 的 `Unreleased` |

### 9.3 偏差登记

发现实现与 02/03 不一致时：

1. 不要静默改实现「对齐文档」或反之；
2. 在 03 §14（与 02 的偏差）或 07 §12（本文档发现的偏差）登记：编号、现象、裁决、影响版本；
3. 裁决后同步修改受影响的文档与测试。

### 9.4 文档自检

提交前对改过的文档跑一遍：

```powershell
Select-String -Path docs\*.md -Pattern 'T[O]DO|TB[D]|FI[X]ME|待[补定办]|占[位]'
(Select-String -Path docs\05-dev.md -Pattern '^```').Count   # 必须是偶数
```

- 相对链接指向的文件必须存在（`docs/03-design.md` 等）。
- 代码块里的 JSON 必须能 `JSON.parse`；命令必须能复制执行。
- 中文标点统一；表格每行列数一致。
- 不写「已完成/已验证」除非有命令输出或截图证据。

---

## 10. 发布流程

### 10.1 版本与里程碑

| 版本 | 里程碑 | 范围 |
|---|---|---|
| v0.1.0 | M1–M3 | EPUB/PDF 导入、分块、带引用导图、画布、详情与引用跳转、错误恢复 |
| v0.2.0 | M4 | 研究笔记、询问 AI、线程、浮层、md/opml/json 导出 |
| v0.3.0 | M5 | 导图编辑与变更审阅、HTML/PNG/SVG、引导式学习、搜索/小地图、i18n/a11y 收尾 |

出口标准以 02 §8 与 03 §13 为准；逐项勾选在 07。

### 10.2 发布前（合并 `main` 之前）

```powershell
npm ci
npm run verify
npm run build:client:check
npm pack --dry-run
```

再完成：

- [ ] 02 §9.2 的 5 条门禁全过（check / test / 夹具冒烟 / pack 清单 / 手工 AC）。
- [ ] 07 对应版本的清单全部勾选。
- [ ] `CHANGELOG.md` 已把 `Unreleased` 改为版本号与日期。
- [ ] 版本号已改；`README` 状态行不再写「骨架」。
- [ ] 真机安装过一遍（§6.3 九项）。

### 10.3 合并、打标、推送

```powershell
git switch dev
git merge --no-ff main        # 只在 main 有 hotfix 时需要
npm run verify
git switch main
git merge --no-ff dev -m "chore(release): v0.1.0"
git tag -a v0.1.0 -m "v0.1.0"
git push origin main
git push origin dev
git push origin v0.1.0
```

### 10.4 GitHub Release

```powershell
gh release create v0.1.0 --title "v0.1.0 阅读实验室" --notes-file CHANGELOG.md --verify-tag
```

- 说明里写：新增能力、已知限制（扫描版 PDF 不支持 OCR）、DSH 版本要求、安装方式。
- 不上传 `node_modules`、夹具大文件、`reading/` 数据。
- 私有仓库的 Release 只对协作者可见。

### 10.5 发布后验证与回滚

1. 新建一个干净 profile（或另一台机器）按 §6.2 安装 tag 对应的 checkout，跑 §6.3。
2. 用一本真实 EPUB + 一本文本 PDF 各走一遍「导入 → 出图 → 点卡 → 点引用」。
3. 出问题：`git switch --detach <上一 tag>` → 重建 → 重启；GitHub 上不要删 tag，发 patch 版本。

---

## 11. 安全与合规

- **不存密钥**：插件不申请、不读取、不落盘任何模型 Key（DR-02）；提问走会话 agent。
- **不遥测**：不发网络请求到第三方；`fetch` 只打同源 `/dsh-reading-lab/api/v1`。
- **日志不含正文**：`import.log` 只记阶段、字节数、错误码；不写书名以外的用户文本（03 §5.7、NFR-05）。
- **路径**：所有文件操作经 `paths.js` 的 `resolveInReading()`；拒绝 `..`、绝对路径、symlink 逃逸、
  Windows 保留名（03 §10.3）。
- **内容**：EPUB XHTML 白名单净化，禁止远程资源与脚本（03 §10.4）；引用只接受已知 `chunkId`。
- **依赖**：只允许 §1.3 的三个运行时依赖；新增需许可证审查（MIT/Apache-2.0/BSD 兼容）。
- **夹具版权**：`test/fixtures/*` 必须是原创或公有领域文本，由 `gen-fixtures.mjs` 合成，不塞第三方书。

---

## 12. 本文档发现的偏差（跟踪到 07 §10）

| 编号 | 现象 | 裁决 | 落地里程碑 |
|---|---|---|---|
| D-05-01 | 03 §12.4 的 AC 编号与 02 §9.1 不一致 | 以 02 为准；M5 前修正 03 §12.4 | M5 |
| D-05-02 | Client 拆多文件后缺构建步骤；`package.json` 仍指向 `src/client/index.js` | 采用 §4 的零依赖拼接构建；M1 落地四字段 | M1 |
| D-05-03 | 03 §12.3 写夹具在 `assets/fixtures/`，实际与 `.gitignore` 用 `test/fixtures/` | 以 `test/fixtures/` 为准；M1 前统一 03 措辞 | M1 |
| D-05-04 | `package.json` 的 `test/*`、`fixtures` 脚本由测试 owner 并行加入，本文按其当前形态记录 | 合并前以 `package.json` 为准复核本节 | 每次合并 |
| D-05-05 | `package.json` 缺 `engines.node` | M1 补 `>=22.19.0` | M1 |
| D-05-06 | `src/client/index.js` 注释仍写 `key="reading"`，与 DR-06（`reading-lab`）冲突 | 由 client-shell 在 M1 改注释与实现 | M1 |

---

## 13. 常见问题

**Q：必须重启 DSH 吗？**
只改 Client（视图、样式、文案）：构建 + 刷新即可。改 Host、`package.json` 的 `dsh.*`、`cordis.patch.yml`：
重启。拿不准就重启，成本低于排查缓存。

**Q：为什么不直接在 `src/client/index.js` 里写所有界面？**
短期可以，但 03 要求 canvas/library/detail/ask-ui 分人并行；单文件会让每次合并都冲突。构建是为此付的
一次性成本（§4）。

**Q：本地安装后 `node_modules` 里是链接，`npm install` 会不会覆盖？**
不会。链接由 DSH 插件管理器维护；在仓库里跑 `npm install` 只影响仓库自己的 `node_modules`。

**Q：能同时装两个版本吗？**
不能。一个 profile 一个包名一个版本；要对比就切换 tag 后重启。

**Q：`npm test` 里为什么有 skip？**
M1 的 stub 允许 skip，但必须在 `test/skip.txt` 登记，M2 清零（03 §2.4）。没有登记的 skip 视为失败。

---

## 14. 相关文档

- [01-research](01-research.md)：DSH 槽位/服务调研与实测数据
- [02-requirements](02-requirements.md)：需求、验收、版本出口
- [03-design](03-design.md)：架构、所有权、数据契约、UI、算法
- [04-api](04-api.md)：路由、工具、事件、错误码
- [06-test](06-test.md)：测试分层、夹具、必测路径
- [07-checklist](07-checklist.md)：里程碑与发布清单