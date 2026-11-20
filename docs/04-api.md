# 04 接口：阅读实验室 v0.1–v0.3

> 状态：**v1 定稿**（2026-11-19；同日文档门禁修订交叉引用）。上游：[03-design.md](./03-design.md)（模块、数据契约、UI）；本文只定义**跨边界契约**：Host 服务、HTTP 路由、Agent 工具、事件投影。
>
> 维护：docs（qa/docs）；评审：架构
>
> 与 03 冲突时以 03 为准并回改本文；与 02 冲突时以 02 的需求编号为准并登记在 03 §14。

## 1. 总则

### 1.1 传输与编码

| 项 | 约定 |
|---|---|
| 传输 | 同源 HTTP/1.1（`webServer.register({kind:'prefix'})`），JSON UTF-8；SSE 用 `text/event-stream` |
| 基路径 | `/dsh-reading-lab/api/v1`（与插件名绑定，避免路由冲突） |
| 版本 | 路径 `v1` + `apiVersion:1`；破坏性变更升 `v2`，`v1` 至少保留一个 minor |
| 时间 | ISO-8601 UTC，毫秒精度（`2026-11-19T09:30:00.000Z`） |
| 标识 | `bookId ^b[0-9a-f]{12}$`；`chunkId ^c-\d{6}$`；`threadId ^t-\d{2,}$`；`nodeId ^n-[0-9a-f]{8}(-\d+)?$` |
| 幂等 | `POST /ask`、`POST /books/:id/actions/*` 接受 `Idempotency-Key`；同 key 10 分钟内返回首次结果 |
| 并发 | 每书串行写；全局导入并发 1；冲突返回 `409 E_BUSY` |
| 缓存 | `GET /books` 与 `GET /books/:id` 带 `ETag`（`updatedAt` 的弱哈希）；`If-None-Match` 命中 304 |

### 1.2 成功/失败信封

成功（2xx）：

```json
{ "ok": true, "data": { } }
```

失败（4xx/5xx，**无 HTML 错误页**）：

```json
{
  "ok": false,
  "error": {
    "code": "E_TOO_LARGE",
    "message": "文件超出 100 MB 限制",
    "details": { "limit": 104857600, "actual": 157286400 },
    "requestId": "req-8f2c1a"
  }
}
```

- `message` 是**已本地化**的短句（与 `locale/*.json` 的 `error.<CODE>` 一致），不含堆栈、绝对路径、正文。
- 例外：路由可以在抛出错误时带**显式 message**（如 `E_UNSUPPORTED` 说明「v0.2 提供」），此时 wire 上的 `message` 用该句而非 `error.<CODE>` 的通用文案；`code` 与 `details` 不变，客户端仍按 code 分支。
- `details` 可选，仅放机器可读字段（limit/actual/field/format）。
- `requestId` 每次请求生成，写入 `import.log` 便于对账。

### 1.3 命名映射（D-03-02）

模型工具名只允许 `[A-Za-z0-9_-]`（`dsh-mcp-client/lib/index.js:68-69`），因此线上注册名与产品名不同：

| 产品名（文档/UI/事件） | 注册名（`ctx.tools.register`） | 备注 |
|---|---|---|
| `reading.import` | `reading_import` | v0.1 |
| `reading.map` | `reading_map` | v0.1 |
| `reading.notes` | `reading_notes` | v0.2 |
| `reading.ask` | `reading_ask` | v0.2 |
| `reading.export` | `reading_export` | v0.2 |
| `reading.tutor` | `reading_tutor` | schema 预留，v0.3 实现 |

事件、日志、提示词用产品名；`ctx.tools` 查询用注册名。**禁止**注册带点的名字（会被 function-name 校验拒绝）。

## 2. Host 装配

### 2.1 入口

```js
// src/host/index.js
export const name = 'reading-lab'
export const inject = ['webServer', 'tools', 'systemPrompt', 'agents']

export function apply(ctx, config) {
  const limits = resolveLimits(config)                 // config + limits.js 默认值
  const root = resolveWorkspaceRoot(ctx, config)       // §2.3
  const books = new BookService({ root, limits })
  const sse = new EventHub()                           // sse.js
  const services = { ctx, root, limits, books, sse, agents: new AgentDirectory(ctx) }

  ctx.effect(() => {
    const dispose = ctx.webServer.register(makeRoutes(services))
    return () => dispose()
  }, 'reading-lab: routes')

  ctx.effect(() => registerTools(ctx, services), 'reading-lab: tools')
  ctx.effect(() => ctx.systemPrompt.section(promptSection(limits)), 'reading-lab: prompt')
  ctx.effect(() => subscribeAnswerWriter(ctx, services), 'reading-lab: answer-writer')

  ctx.logger?.info?.(`[reading-lab] root=${root}`)
}
```

约束：

- `apply` 不做 I/O（除创建目录），所有耗时工作延后到请求/工具调用。
- 目录初始化：`ensureLayout(root)`（`books/`、`inbox/`、`exports/`）在首次请求或 `ctx.effect` 内异步执行，失败只在 `/health` 报 `storage:'unavailable'`，不让插件加载失败。
- `inject` 不含 `llm`（DR-02）；`commands` 不注入（D-03-08）。
- **可选服务一律 `ctx.get(name)`**（D-03-13）：`workspaceRegistry`、`workingDirectory` 不在 `inject` 里，直接属性访问在未注入的 profile 会抛 `cannot get property "..." without inject` 并让 `/health` 503。取不到就按「未配置」降级，不抛错。

### 2.2 配置

```ts
interface ReadingLabConfig {
  workspaceRoot?: string        // 绝对路径；缺省按 §2.3 解析
  maxUploadBytes: number        // 默认 104857600（100 MB）
  maxPdfPages: number           // 默认 2000
  maxEpubChars: number          // 默认 50_000_000
  maxChunks: number             // 默认 20000
  askTimeoutMs: number          // 默认 300000（5 min）
  exportFormats: ('md'|'opml'|'json'|'html')[]  // 默认 ['md','opml','json']
  allowAgentImportPaths: boolean // 默认 true；false 时 reading_import 只能用 HTTP 上传
}
```

默认值必须与 `src/host/limits.js` 同源（Config 的 default 从 `LIMITS` 读，不写两份）。

### 2.3 `workspaceRoot` 解析（顺序）

1. `config.workspaceRoot`（绝对路径，必须已存在且为目录）；
2. `workingDirectory.defaultDirectory`（部署级默认，`ctx.get('workingDirectory')`）；
3. `workspaceRegistry` 的默认工作区：直接属性（`defaultWorkspace` / `defaultWorkspacePath` / `activeWorkspace`）→ `getDefault()` → `list()` 中 `isDefault/default` 项，否则第一项（均经 `ctx.get`）；
4. `process.cwd()`。

每一步失败都继续下一个候选；全部失败 → `/health` 返回 `503 {code:'E_IO'}`，面板显示「无法确定工作区」。

解析结果 `realpath` 后使用；`reading/` 永远在其下。

## 3. Host 模块 API（进程内）

这些是模块导出，不跨进程；Client **不得**直接调用，只经 §4 路由。签名用 TS 记法，实现为 ESM。

### 3.1 `BookService`（`src/host/books.js`）

```ts
class BookService {
  list(filter?: { status?: BookStatus; q?: string }): Promise<BookSummary[]>
  get(bookId: string): Promise<BookMeta>                       // 不存在 → E_NOT_FOUND
  paths(bookId: string): BookPaths                              // 只构造路径，不保证存在
  importStream(stream: Readable, opts: { name: string; declaredBytes?: number; signal: AbortSignal }): Promise<{ book: BookMeta; duplicate: boolean }>
  importPath(path: string, opts?: { title?: string; signal?: AbortSignal }): Promise<{ book: BookMeta; duplicate: boolean }>
  rename(bookId: string, displayName: string | null): Promise<BookMeta>
  remove(bookId: string): Promise<void>                         // 幂等；不存在也成功
  retry(bookId: string, opts?: { signal?: AbortSignal }): Promise<BookMeta>
  readChunks(bookId: string, sel: { ids?: string[]; from?: number; to?: number; limit?: number }): Promise<Chunk[]>
  readChunk(bookId: string, chunkId: string, context?: number): Promise<{ chunk: Chunk; prev?: Chunk; next?: Chunk }>
  markStatus(bookId: string, status: BookStatus, detail?: StatusDetail | null): Promise<void>
  touch(bookId: string, field: 'mapUpdatedAt'|'notesUpdatedAt'|'threadsUpdatedAt', at?: string): Promise<void>
  rebuildIndex(): Promise<BookSummary[]>
}
```

行为：

- `importStream`：边写边算 SHA-256；`declaredBytes > maxUploadBytes` 时不读流直接 413；实际字节超限立即中止并删临时文件。
- `duplicate=true` 时返回既有 `book`（`status` 可能是 `parsing`），不重置其状态。
- `remove`：取消队列 → 目录移入 `.trash` → 异步删除；返回后列表不再可见。
- `readChunks`：`ids` 与 `from/to` 二选一；`limit` 默认 50、上限 200；越界 `E_BAD_REQUEST`。

### 3.2 解析与分块（`import.js` / `parse/*` / `chunk.js`）

```ts
interface Document {
  kind: 'epub' | 'pdf'
  title: string
  author: string | null
  language: string | null
  chapters: Array<{
    title: string
    path: string[]
    pageStart?: number
    pageEnd?: number
    blocks: Array<{ text: string; page?: number }>
  }>
}

parseBook(input: { kind: 'epub'|'pdf'; buffer: Buffer; signal: AbortSignal; onProgress?: (p: ParseProgress) => void }, limits: Limits): Promise<Document>

chunkDocument(doc: Document, limits: Limits): { chunks: Chunk[]; toc: TocEntry[]; stats: { chapters: number; chunks: number; chars: number; pages: number | null } }
```

- `parseBook` 纯输入（buffer），不读写文件；文件由 `import.js` 管理。
- `onProgress` 至少每 200 ms 或每页/每章回调一次；`import.js` 负责节流写 `meta.progress`。
- 错误抛 `ReadingError`，`code` 见 §7。

### 3.3 导图（`map.js` / `layout.js`）

```ts
readMap(bookId: string): Promise<MapDoc | null>                 // 无图返回 null（路由映射 404）
validateMap(root: MapNodeInput, chunkIds: Set<string>, limits: Limits): { ok: true } | { ok: false; rejected: Rejection[] }
writeMap(bookId: string, root: MapNodeInput, generator: Generator): Promise<MapDoc>   // 校验→布局→原子写；失败抛 E_CITATION
layoutTree(root: MapNode, opts: { card: { book: Size; node: Size }; gapX: number; gapY: number }): Layout
```

- `writeMap` 内部顺序：`validateMap` → `assignNodeIds` → `layoutTree` → 备份旧图 `map.bak.json` → 原子写 → `meta.stats/mapUpdatedAt`。
- 校验失败**不写任何文件**；返回的 `Rejection` 形如 `{ path: 'root.children[2].citations[0]', code: 'E_CITATION', message: 'unknown chunkId c-999999' }`。
- `layoutTree` 是纯函数，见 03 §7.4。

### 3.4 笔记与线程（`notes.js` / `threads.js` / `ask.js`）

```ts
renderNotes(input: { book: BookMeta; map: MapDoc|null; sections: NotesSection[]; generatedAt: string }): string
parseNotes(md: string): { meta: NotesMeta | null; sections: NotesSection[] }
validateNotes(sections: NotesSection[], chunkIds: Set<string>): { ok: boolean; rejected: Rejection[] }

readThreads(bookId: string): Promise<ThreadsFile>
createThread(bookId: string, scope: ThreadScope): Promise<Thread>
appendMessage(bookId: string, threadId: string, msg: NewMessage): Promise<Message>
updateMessage(bookId: string, threadId: string, messageId: string, patch: Partial<Message>): Promise<Message>
stopThread(bookId: string, threadId: string): Promise<Thread>
setThreadState(bookId: string, threadId: string, state: 'idle'|'running'): Promise<void>
setFeedback(bookId: string, threadId: string, messageId: string, feedback: 'up'|'down'|null): Promise<Message>

buildAskContext(input: { bookId: string; nodeId?: string; question: string }): Promise<{ prompt: string; contextChars: number; truncated: boolean }>
askAgent(input: { bookId: string; threadId: string; question: string; agentId: string }): Promise<{ messageId: string; agentId: string }>
```

- `askAgent` 内部：追加 user 消息（`status:'pending'`）→ `buildAskContext` → `agent.followup(createMessage(...))` → 返回；不等待回答。
- 实现落点：`src/host/threads.js`（存储，无 HTTP）+ `src/host/ask.js`（上下文、注入、回写、超时）。`stopThread` 的 v0.2 实现只做「标 `stopped` + 忽略后续回答」，`agent.cancel` 留到后续版本（D-15-03）。
- 回写订阅见 §6.3，不在 `askAgent` 内 await。
- `stopThread`：若线程是当前注入来源，调 `agent.cancel('user', { keepInbox: true })`；否则仅把 `pending|streaming` 消息标 `stopped`。

### 3.5 导出（`export/*`）

```ts
exportBook(input: { bookId: string; format: 'md'|'opml'|'json'|'html'; includeThreads?: boolean; signal?: AbortSignal }): Promise<{ path: string; bytes: number; format: string }>
```

- `path` 是**工作区相对路径**（`reading/exports/...`），不是绝对路径。
- 格式未启用（配置/版本）→ `E_UNSUPPORTED`。
- 写临时文件 + 原子改名；失败清理见 03 §9.7。
- 实现落点（v0.2，t16）：`export/index.js`（`ExportService.create`，负责格式闸门、串行化、命名与原子写）、`export/format.js`（转义、文件名净化、时间戳、重名 `-2`…`-99`）、`export/markdown.js`、`export/opml.js`、`export/json.js`。`export/files.js` 只服务 `GET /exports*`（列表/下载/路径校验）。

### 3.6 事件总线（`sse.js`）

```ts
type ReadingEvent =
  | { type: 'book'; book: BookSummary }
  | { type: 'progress'; bookId: string; phase: Phase; done: number; total: number; updatedAt: string }
  | { type: 'map'; bookId: string; mapUpdatedAt: string }
  | { type: 'notes'; bookId: string; notesUpdatedAt: string }
  | { type: 'thread'; bookId: string; threadId: string; state: string; updatedAt: string }
  | { type: 'export'; bookId: string; format: string; path: string }

publish(event: ReadingEvent): void        // 进程内，节流 ≥200 ms/相同 (type,bookId)
subscribe(fn: (e: ReadingEvent) => void): () => void
```

- 事件只在 Host 进程内；Client 通过 §6.2 的 SSE 接收。
- 不做持久化；断线由 `hello` 全量快照兜底。

## 4. Remote 路由（HTTP JSON）

### 4.1 路由表

| # | 方法 | 路径（相对基路径） | 作用 | 成功 | 主要错误 |
|---|---|---|---|---|---|
| 1 | GET | `/health` | 健康与能力 | 200 `Health` | 503 `E_IO` |
| 2 | GET | `/agents` | 可用 agent 列表 | 200 `{agents}` | 500 `E_AGENT` |
| 3 | GET | `/books` | 书库列表 | 200 `{books, revision}` | 500 `E_IO` |
| 4 | POST | `/books/import` | 上传导入（裸字节） | 201 `{book, duplicate}` | 400/413/415/422/409 |
| 5 | GET | `/books/:bookId` | 单本 meta | 200 `BookMeta` | 404/500 |
| 6 | PATCH | `/books/:bookId` | 重命名 | 200 `BookMeta` | 400/404/409 |
| 7 | DELETE | `/books/:bookId` | 删除 | 200 `{deleted:true}` | 404/409 |
| 8 | POST | `/books/:bookId/retry` | 重新解析 | 202 `BookMeta` | 404/409/422 |
| 9 | POST | `/books/:bookId/actions/generate-map` | 让 agent 生成导图 | 202 `{queued,agentId,promptId,state,statusUrl,timeoutMs}` | 404/409/502 |
| 9b | GET | `/books/:bookId/actions/generate-map` | 生成状态查询（t29 新增） | 200 `{state,promptId,reason,…}` | 404/500 |
| 10 | POST | `/books/:bookId/actions/generate-notes` | 让 agent 写笔记（v0.3） | 501 `E_UNSUPPORTED{feature:'notes.generate',availableIn:'0.3.0'}`，message 明说 v0.3（v0.2 由 Agent 直接调 `reading_notes`）；与 `/health.capabilities.generateNotes` 一致 | 404/409/422/501 |
| 11 | GET | `/books/:bookId/chunks` | 块读取（ids 或区间） | 200 `{chunks,total}` | 400/404 |
| 12 | GET | `/books/:bookId/chunks/:chunkId` | 单块 + 前后各 1 | 200 `{chunk,prev,next}` | 404 |
| 13 | GET | `/books/:bookId/map` | 导图 | 200 `MapDoc` | 404 `E_NOT_FOUND`(无图) |
| 14 | PUT | `/books/:bookId/map` | 编辑导图（v0.3） | 501 `E_UNSUPPORTED` | — |
| 15 | GET | `/books/:bookId/notes` | 笔记 | 200 `{markdown,sections,updatedAt}` | 404（无笔记时 `sections:[]`，200） |
| 16 | PUT | `/books/:bookId/notes` | 写笔记（v0.3） | 501 | — |
| 17 | GET | `/books/:bookId/threads` | 线程列表 | 200 `ThreadsFile` | 404 |
| 18 | POST | `/books/:bookId/threads` | 建线程 | 201 `Thread` | 400/404 |
| 19 | DELETE | `/books/:bookId/threads/:threadId` | 删线程 | 200 `{deleted:true}` | 404 |
| 20 | POST | `/books/:bookId/ask` | 提问（注入 agent） | 202 `{threadId,messageId,agentId}` | 400/404/409/422/502 |
| 21 | POST | `/books/:bookId/threads/:threadId/stop` | 停止 | 200 `Thread` | 404/409 |
| 22 | POST | `/books/:bookId/export` | 导出 | 200 `{path,bytes,format}` | 404/409/501/500 |
| 23 | GET | `/exports` | 导出文件列表 | 200 `{files}` | 500 |
| 24 | GET | `/exports/:name` | 下载导出文件 | 200 二进制 | 400/404 |
| 25 | GET | `/events` | SSE | 200 `text/event-stream` | — |
| 26 | POST | `/books/:bookId/threads/:threadId/messages/:messageId/feedback` | 回答反馈（t15 新增） | 200 `Message` | 400/404 |
| 27 | GET | `/books/:bookId/tutor` | 读学习路径（无则自动建，t20 新增） | 200 `TutorDoc` | 404 |
| 28 | POST | `/books/:bookId/tutor` | 重新开始一条学习路径 | 201 `TutorDoc` | 400/404 |
| 29 | POST | `/books/:bookId/tutor/steps/:stepId` | 标记掌握/跳过 | 200 `{ path, step }` | 400/404 |
| 30 | POST | `/books/:bookId/tutor/steps/:stepId/answer` | 就某一步向 AI 提问 | 202 `{ threadId, messageId, agentId }` | 400/404/409/502 |
| 31 | GET | `/settings` | 读存储位置（t33 新增） | 200 `SettingsView` | — |
| 32 | PUT | `/settings/library-root` | 切换书库根并可选迁移 | 200 `SettingsView + { previousRoot, moved, skipped }` | 400/500 |

通用：

- 未匹配的 `/books/...` → 404 `E_NOT_FOUND`；已知路径错方法 → 405，`Allow` 头。
- `:bookId` 先过正则，不合法直接 400 `E_BAD_REQUEST`（不查盘）。
- 所有响应带 `Cache-Control: no-store`（除 `/exports/:name` 可 5 min 私有缓存）。
- 不设 CORS 头（同源）；`OPTIONS` 返回 405。

### 4.2 逐条规格

#### 1. `GET /health`

```json
{ "ok": true, "data": {
  "pluginVersion": "0.1.0",
  "apiVersion": 1,
  "dshVersion": "0.2.2-rc.5",
  "storage": "ok",
  "workspaceRootName": "my-project",
  "capabilities": {
    "sse": true,
    "formats": ["epub","pdf"],
    "exports": ["md","opml","json"],
    "generateNotes": { "available": false, "availableIn": "0.3.0" },
    "tools": ["reading_import","reading_map","reading_notes","reading_ask","reading_export","reading_tutor"]
  }
} }
```

`workspaceRootName` 只给目录名（`path.basename`），不泄露绝对路径。`storage: 'unavailable'` 时 HTTP 503，`error.code='E_IO'`，但 `data` 仍返回能力信息（Client 可显示只读）。

`capabilities.exports` 是**导出生成**的格式列表，必须与 `POST /books/:bookId/export` 的真实能力一致：v0.2（t16）起为 `IMPLEMENTED_FORMATS ∩ limits.exportFormats`，默认 `["md","opml","json"]`；`html` 属 v0.3，未启用前不出现在这里也不接受请求（501）。“列出/下载已有导出文件”（#23/#24）不属于该能力，始终可用。

`capabilities.generateNotes` 描述「服务端自动生成笔记」这个动作；v0.2 固定为 `{available:false, availableIn:"0.3.0"}`，与 `POST /books/:bookId/actions/generate-notes` 的 501 一一对应（QA-17-03）。面板据此把按钮标成「v0.3」，而不是发一个必然失败的请求。

#### 2. `GET /agents`

```json
{ "ok": true, "data": { "agents": [
  { "id": "sess_…", "title": "当前会话", "status": "idle", "cwd": "my-project" }
] } }
```

来源：`ctx.agents.list()`（`dsh-agent` 的 `AgentRegistry`）。`title` 取会话标题（无则 null）；`cwd` 只给 basename；不返回 prompt 内容。0 个 agent 时 `agents: []`（不是错误），面板据此禁用提问。

#### 3. `GET /books`

查询：`status`（可选，多值逗号分隔）、`q`（标题/作者包含，≤100 字）。

```json
{ "ok": true, "data": {
  "revision": 42,
  "books": [{
    "id": "b3f9a1c07d2e",
    "title": "示例书名",
    "displayName": null,
    "author": "示例作者",
    "format": "epub",
    "status": "ready",
    "statusDetail": null,
    "stats": { "chapters": 12, "chunks": 843, "chars": 412000, "pages": null },
    "progress": { "phase": "done", "done": 12, "total": 12, "updatedAt": "…" },
    "hasMap": true,
    "hasNotes": false,
    "updatedAt": "…"
  }]
} }
```

`BookSummary = BookMeta` 去掉 `source.sha256`、`toc`（列表不传大字段）。`revision` 是进程内单调计数，用于 SSE 对齐。

#### 4. `POST /books/import`

**请求**：`Content-Type: application/octet-stream`；查询参数 `name`（**必填**，URL 编码的原文件名）；可选 `title`。**不解析 multipart**（避免依赖与解析漏洞），面板用 `fetch(url, { method:'POST', body: file })` 流式上传。

`name` 的校验在读取请求体之前完成，失败请求不会在 `reading/` 落任何文件：

| 情形 | 响应 |
|---|---|
| 缺 `name` 查询参数 | 400 `E_BAD_REQUEST{field:'name',reason:'missing'}` |
| `name` 为空或全空白 | 400 `E_BAD_REQUEST{field:'name',reason:'empty'}` |
| `name` 含 `/`、`\`、NUL，或为 `.`/`..`，或含 `..` | 400 `E_PATH{reason:'name-traversal',field:'name'}` |

```
POST /dsh-reading-lab/api/v1/books/import?name=%E7%A4%BA%E4%BE%8B.epub
Content-Type: application/octet-stream
Content-Length: 5242880
<binary>
```

**响应 201**：

```json
{ "ok": true, "data": {
  "duplicate": false,
  "book": { "id": "b3f9a1c07d2e", "title": "示例", "status": "parsing", "format": "epub", "stats": { "chapters": 0, "chunks": 0, "chars": 0, "pages": null } }
} }
```

- `duplicate=true` 时 `book` 为已有书（可能是 `parsing/ready/failed`），HTTP 仍 200（不是 201）。
- 体积：`Content-Length` 缺失时仍接受，但读到 `maxUploadBytes+1` 立即 413。
- `name` 仅用于显示与格式提示；真实格式由魔数判定。
- 解析异步：响应在临时文件落盘、`meta` 建好后立即返回（≤300 ms），解析进度走 SSE。若解析在 2 s 内完成（小 EPUB），`status` 可能已是 `ready`。
- 错误：415 `E_FORMAT`（魔数不符，在流写完后判定）、413 `E_TOO_LARGE`、422 `E_ENCRYPTED`/`E_SCANNED`、409 `E_BUSY`（同内容正在解析）。

#### 5–8. 单本操作

`GET /books/:id` → 200 `BookMeta`（完整，含 `toc`；`source.sha256` 保留，供去重诊断）。

`PATCH /books/:id`：

```json
{ "displayName": "我的书名" }
```

`displayName: null` 表示恢复默认。响应 `BookMeta`。空串/超 200 字 → 400。

`DELETE /books/:id` → `{ "deleted": true }`；解析中返回 409 `E_BUSY`（先 `POST /retry` 不行，要等或先 `stop`）。删除幂等：不存在也 200。

`POST /books/:id/retry` → 202 `BookMeta`（`status:'queued'`），后台重解析；`source` 必须存在，否则 404 `E_NOT_FOUND`。

#### 9–10. 生成动作

`POST /books/:id/actions/generate-map`

```json
{ "agentId": "sess_…", "instructions": "重点看第三章" }
```

- `agentId` 缺省：取 `/agents` 中最近活跃的 root agent；无 → 502 `E_AGENT`（`/agents` 为空）。
- `instructions` ≤500 字，会拼进提示词。
- 响应 202：

```json
{
  "ok": true,
  "data": {
    "queued": true,
    "agentId": "sess_…",
    "promptId": "6a1f…",
    "state": "pending",
    "statusUrl": "/dsh-reading-lab/api/v1/books/b3f9a1c07d2e/actions/generate-map",
    "timeoutMs": 60000,
    "claimedAt": null,
    "budget": { "queueTimeoutMs": 60000, "idleTimeoutMs": 180000, "maxDurationMs": 1800000 }
  }
}
```

- `timeoutMs` 是**当前阶段**的预算（排队期 = `queueTimeoutMs`，认领后 = `idleTimeoutMs`），保留给旧客户端；新代码请读 `budget`。
- `claimedAt` 只有在真有认领证据时才非空（见下方状态机），不要用它判断「是否已开始处理」的替代品。

- Host 行为：`agent.followup` 注入一段提示词（§5.9），由 agent 调 `reading_map`；HTTP 不等待结果。
- 已在生成（`state` 为 `pending`/`running`）→ 409 `E_BUSY`，`details` 带 `state`、`agentId`、`startedAt`。
- 会话语义：注入的消息在会话流可见（`source.kind='reading-lab'`、`source.form='notice'`，见 §6.3），用户可看到「正在为《…》生成导图」。

**202 之后为什么还可能失败（t29 / QA-11-07 实测）。** `agent.followup()` 是
fire-and-forget：它只把消息放进 agent 的 inbox，返回 `void`；调用成功既不代表
回合会被调度，也不代表模型会调用 `reading_map commit`。真实宿主上已确认三条
静默路径：

| 断点 | DSH 侧现象 | 插件如何发现 |
| --- | --- | --- |
| 会话没有可用 provider/model | `preStep` 抛 `agent "<id>" has no provider/model: …`，driver 记 `turn/end{reason:{kind:'error'}}`，`kick()` 吞掉异常 | 订阅 `agent/error` |
| 消息从未被认领（agent 忙/会话关闭/进程重启） | inbox 里一直有这条消息，没有 claim 事件 | 排队看门狗（`queueTimeoutMs`，默认 60 s） |
| 回合跑完但没提交导图 | 有 claim、有 `agent/status` 回到 idle，但没有 `reading_map` | 订阅 `agent/inbox/claimed` + `agent/status` |

因此每次生成都有状态记录（仅内存，DSH 重启即失效）：

```
pending ──(agent/inbox/claimed | agent/status running)──> running ──(reading_map commit)──> done
   │                                                        │
   ├── agent/error ─────────────────────────────────────────┤
   ├── agent/inbox/discarded ───────────────────────────────┤──> failed{reason, message}
   ├── agent/status(非 running) ────────────────────────────┤
   ├── 排队看门狗 60 s ──────────────────────────────────────┤
   └── 空闲看门狗 180 s / 绝对上限 30 min ───────────────────┘
```

**活动感知的预算（t34）。** 固定 180 s 会把「agent 正在读几十块原文」误判成超时——真实宿主
实测过 agent 已 `reading_map commit` 成功、状态却报 `failed{reason:'timeout'}`。现在的规则：

| 预算 | 默认 | 起算点 | 重置条件 |
| --- | --- | --- | --- |
| `queueTimeoutMs` | 60 000 | `startedAt` | 被认领即进入下一段 |
| `idleTimeoutMs` | 180 000 | `lastActivityAt` | 每次认领事件 / `agent/status` running / `reading_map` 工具调用 |
| `maxDurationMs` | 1 800 000 | `startedAt` | 不重置，防死循环 |

活动证据与 `claimEvidence`：`agent/inbox/claimed` → `'inbox-claimed'`（同时置 `claimedAt`）；
`agent/status` 进入 `running` → `'agent-status'`（同样置 `claimedAt`）；只有 `reading_map`
工具调用 → `'tool-activity'`（推进到 running，但 `claimedAt` 保持 `null`，不伪造认领）。
三项都报 `reason:'timeout'`，用 `message` 区分：排队期「没有被 agent 认领」、认领后「没有新的
活动（最近活动：…）」、绝对上限「超过绝对上限（已持续 Ns）」。

失败时三处同时可见：状态查询的 `reason`/`message`、SSE
`progress{phase:'failed', reason, message}`、Host 日志
`[reading-lab] 导图生成失败 book=… reason=… message=…`。`reason` 取值：

| reason | 含义 |
| --- | --- |
| `agent-error` | agent 回合报错（最常见：没有 provider/model） |
| `turn-ended` | 回合结束但未提交导图 |
| `inbox-discarded` | 注入的消息被会话丢弃（回合取消等） |
| `timeout` | 排队超时未被认领 / 认领后长时间无活动 / 超过绝对上限（看 `message`） |
| `agent-disposed` | 目标 agent 关闭 / 插件卸载 |
| `agent-missing` | 没有任何可用 agent（POST 直接 502，不进入 202） |

**状态查询**（与 POST 同路径的 GET，供面板与脚本使用；不消耗 agent 轮次）：

`GET /books/:id/actions/generate-map` → 200：

```json
{
  "ok": true,
  "data": {
    "bookId": "b3f9a1c07d2e",
    "state": "pending",
    "agentId": "sess_…",
    "promptId": "6a1f…",
    "startedAt": "2026-11-20T02:10:00.000Z",
    "updatedAt": "2026-11-20T02:10:00.000Z",
    "claimedAt": null,
    "claimEvidence": null,
    "lastActivityAt": "2026-11-20T02:10:00.000Z",
    "lastActivityKind": "begin",
    "finishedAt": null,
    "reason": null,
    "message": null,
    "timeoutMs": 60000,
    "idleMs": 0,
    "elapsedMs": 0,
    "budget": { "queueTimeoutMs": 60000, "idleTimeoutMs": 180000, "maxDurationMs": 1800000 }
  }
}
```

- `idleMs` / `elapsedMs` 都是服务端按当前时刻算的毫秒数；面板据此显示「已用 X 秒」和
  「最近活动 X 秒前」，不需要自己写死倒计时。
- `claimedAt` 为 `null` 有两种含义：还没认领，或只有工具活动（此时 `state` 已是 `running`、
  `claimEvidence='tool-activity'`）。

- 从未生成过 → `state: "idle"`（仍 200，面板不必把 404 当成错误）。
- 终态（`done`/`failed`）记录保留 15 分钟（`recordTtlMs`），之后回到 `idle`；面板错过 SSE 也能读到失败原因。
- 失败后闸门立即释放：可以直接再 POST 一次，不需要等 TTL。

#### 11–12. 块读取

`GET /books/:id/chunks?ids=c-000001,c-000002` 或 `?from=1&to=50`；`limit` 默认 50、上限 200。

```json
{ "ok": true, "data": { "total": 843, "chunks": [ { "id": "c-000001", "seq": 1, "chapterId": "ch-001", "chapterTitle": "第一章", "chapterPath": ["第一章"], "page": null, "text": "……", "chars": 968 } ] } }
```

- `ids` 中不存在的 id 被忽略，响应 `missing: ["c-999999"]`（不报错，供引用失效展示）。
- 单响应正文 ≤2 MB；超限 400 `E_BAD_REQUEST`，提示改用 `from/to`。

`GET /books/:id/chunks/:chunkId` → `{ chunk, prev, next }`（边界时 `prev/next` 为 null）；不存在 404。

#### 13–16. 导图与笔记

`GET /books/:id/map` → 200 `MapDoc`；无图 404，`error.code='E_NOT_FOUND'`，`details.reason='no-map'`。

`PUT /books/:id/map` → 501 `E_UNSUPPORTED`，`details.availableIn='0.3.0'`（v0.3 前不开放编辑）。

`GET /books/:id/notes`：

```json
{ "ok": true, "data": { "updatedAt": null, "markdown": "", "sections": [] } }
```

无笔记不是 404（面板要显示「尚未生成」）。无法解析的 notes.md → 200，`parseError: true`，`sections: []`，`markdown` 原文。

`sections[]` 的形状是 `{ "title": "主题脉络", "body": "…" }`，按固定顺序（主题脉络 / 核心论点 / 术语表 / 阅读建议 / 开放问题）返回，`body` 保留 `[[c:NNNNNN]]` 引用原文，客户端自行切分渲染。

`PUT /books/:id/notes` → 501 `E_UNSUPPORTED`，`details = { feature: 'notes.write', availableIn: '0.3.0' }`（v0.2 的写入口是 `reading_notes action=write`，由 Agent 调用）。

#### 17–19. 线程

状态：已实现（v0.2，t15；`src/host/threads.js` + `src/host/routes/content.js`）。

`GET /books/:id/threads` → `ThreadsFile`（§5.6 of 03）。`running` 状态在进程重启后已降级（进程内首次读取时降级并写回，D-15-03）。

`POST /books/:id/threads`：

```json
{ "scope": { "kind": "node", "nodeId": "n-4e5f6a7b" } }
```

`nodeTitle` 由 Host 从 `map.json` 补；节点不存在 → 400 `E_BAD_REQUEST`（`scope.kind='book'` 例外）。响应 201 `Thread`。

`DELETE /books/:id/threads/:tid` → `{deleted:true}`；运行中 409。

#### 20. `POST /books/:id/ask`

```json
{ "threadId": "t-01", "nodeId": "n-4e5f6a7b", "question": "这个论点成立吗？", "agentId": "sess_…" }
```

- `threadId` 省略时按 `nodeId` 找最近线程，没有则新建（scope=node；无 nodeId 则 book）。
- `question` 1–2000 字。
- 响应 202：`{ "threadId": "t-01", "messageId": "m-02", "agentId": "sess_…" }`，表示**已入队**，回答稍后经 SSE `thread` 事件到达。
- 同线程已有 `running` → 409 `E_BUSY`；同 `Idempotency-Key` → 返回首次的 202 结果。
- `agentId` 不存在/已销毁 → 502 `E_AGENT`（`ERROR_HTTP` 的既有映射；早期文档写的 422 不准确，t29 同口径修正）；无任何 agent → 502 `E_AGENT`。
- 上下文超 6000 字 → 截断并 `truncated:true`（不报错）。
- 无回答兜底：`askTimeoutMs`（默认 5 分钟）内没有 `assistant/message` → 消息 `status='failed'`、`error='E_AGENT'`，线程回 `idle`，SSE `thread{failed:true,reason:'timeout'}`，日志记 `[reading-lab] ask 失败 …`。
- 注入消息的 `source`：`{kind:'reading-lab', form:'ask', threadId, messageId, bookId}`；prompt 首行带隐藏标记 `<!-- reading-lab thread=… message=… -->` 供回写关联。

#### 21. 停止

`POST /books/:id/threads/:tid/stop` → 200 `Thread`（`state:'idle'`，未完成消息 `status:'stopped'`）。线程不存在 404；已 idle → 200（幂等）。

#### 26. `POST /books/:id/threads/:tid/messages/:messageId/feedback`（v0.2 新增，D-15-02）

```json
{ "feedback": "up" }
```

- `feedback` 只接受 `"up" | "down" | null`；`null` 表示取消（面板对同一按钮再点一次即发 `null`）。非法值 400 `E_BAD_REQUEST`（`details.field='feedback'`）。
- 响应 200：被更新的 `Message`（含 `feedback` 字段）。
- 线程或消息不存在 404 `E_NOT_FOUND`；`messageId` 不匹配正则时 400（路由层先校验）。
- 落盘：`threads.json` 的 `messages[].feedback`，同时 `meta.threadsUpdatedAt` 与索引更新，发 SSE `thread` 事件（面板据此重载并切换 `aria-pressed`）。

#### 22. 导出

```json
{ "format": "md", "includeThreads": true }
```

**状态（v0.2，t16 已实现）**：`format ∈ md|opml|json` 直接生成文件；`html`（v0.3）返回 501 `E_UNSUPPORTED{feature:'export.create',availableIn:'0.3.0'}`；`png` 不在服务端（D-03-10）→ 400，`details.hint='png 由客户端导出'`；其它 format → 501。`/health.capabilities.exports` 只列真实可生成的格式（当前 `["md","opml","json"]`），与实现取交集。

以下为 v0.2 实测行为（`test/integration/export-route.test.js` 覆盖）：

- 路径与命名：`reading/exports/<净化后的书名>-yyyyMMdd-HHmmss.<ext>`；净化去掉 `<>:"/\|?*` 与控制字符、空白转 `-`、截断到 60 码点；同一秒内重名依次 `-2`…`-99`，用尽 → `E_IO`。
- 只读输入：生成过程只读 `map.json` / `notes.md` / `threads.json`，不修改它们（集成测试比对导出前后哈希）；写 `.part` 再原子 rename，失败删除 `.part` 并返回 `E_IO{stage:'mkdir'|'write'}`。
- `includeThreads`：缺省 `false`；为 `true` 时 Markdown 追加 `## 问答精选`（每线程一节 `### 节点 · 问题前 40 字`，`**问**：`/`**答**：`），JSON 追加 `threads` 字段。OPML 不含问答。
- `format` 缺省 `md`；非 string 或空串 → 400 `E_BAD_REQUEST{field:'format'}`；`includeThreads` 非 boolean → 400 `{field:'includeThreads'}`。
- 书未 ready → 409 `E_BUSY{reason:'not-ready'}`；未知书 → 404 `E_NOT_FOUND`；导出过程中删除书走同一串行队列，不产生半截文件。

**导出物的正式契约**：

| 格式 | 契约位置 | 校验方式 |
|---|---|---|
| `md` | 03 §9.2 | `test/unit/export-citations.test.js` + `test/unit/export.test.js` |
| `opml` | 03 §9.3 | 同上（并用 `src/host/xml.js` 解析回来验层级） |
| `json` | `schema/export-v1.schema.json`（draft-07） | `test/helpers/json-schema-lite.js` 在 UT-EXP-10 / IT-EXP-02 里实跑 |

`json` 的关键约定（与实现一致，别再各说各话）：`map` 是 `map.json` 的**嵌套**原样（`root/layout/stats`），不是扁平 `nodes/edges`；引用有两层——节点 `citations[].chunkId` 与每节 `citationIds[]` 是机器层，文档级 `citations[]`（`id/chapterTitle/page/snippet`，缺失块带 `missing:true`）与 `citationCount` 是人读层。新增字段属向后兼容，`schemaVersion` 不变；删改字段必须升 `schemaVersion` 并保留旧版 schema 文件。

#### 23–24. 导出文件

`GET /exports`：

```json
{ "ok": true, "data": { "files": [ { "name": "示例书名-20261119-173000.md", "bytes": 48213, "mtime": "…" } ] } }
```

只列 `reading/exports/` 下的普通文件，按 mtime 降序，最多 200 条。

`GET /exports/:name`：

- `name` 只允许 `[^/\\\0]+`，且不得含 `..`；服务端 `basename` 后再拼接并 `path.relative` 校验。
- `Content-Type`：`.md → text/markdown; charset=utf-8`、`.opml → text/x-opml; charset=utf-8`、`.json → application/json`、`.html → text/html; charset=utf-8`；其它 `application/octet-stream`。
- `Content-Disposition: attachment; filename*=UTF-8''<encoded>`。
- 不存在 404；越界 400 `E_PATH`。

#### 25. SSE `/events`

见 §6.2。

#### 27–30. 引导式学习（t20 新增）

| 路由 | 请求 | 响应 |
| --- | --- | --- |
| `GET /books/:id/tutor` | — | 200 `TutorDoc`；无导图 404 `E_NOT_FOUND{reason:'no-map'}` |
| `POST /books/:id/tutor` | `{ goal? }`（非 `explain|quiz|socratic` → 400 `{field:'goal'}`） | 201 `TutorDoc`（pathId 递增、掌握状态清空） |
| `POST /books/:id/tutor/steps/:stepId` | `{ state }`（必须 string；非四态 → 400 `{field:'state',allowed}`） | 200 `{ path, step }` |
| `POST /books/:id/tutor/steps/:stepId/answer` | `{ question, agentId?, idempotencyKey? }`（question 1–2000） | 202 `{ threadId, messageId, agentId, stepId }`；同线程运行中 409；无 agent 502 |

`stepId` 需匹配 `^s-\d{2,}$`，否则 400 `{field:'stepId'}`（`bookRoute` 统一校验）。`answer` 的 `Idempotency-Key` 头与 `ask` 同语义（10 分钟内同键返回首次结果）。逐步语义见 §5.7。

#### 31–32. 存储位置（t33 新增）

`GET /settings` → 200：

```json
{
  "libraryRoot": "D:\\books\\reading",
  "resolvedRoot": "D:\\books\\reading",
  "isFallback": false,
  "workspaceRoot": "D:\\Qunar\\personal\\dsh",
  "exists": true
}
```

- `libraryRoot` 是设置文件里的用户值（`null` = 未设置，走默认解析）；`resolvedRoot` 是 Host 实际使用的绝对路径。
- `isFallback: true` 表示解析落到进程目录兜底，面板必须显示警告（03 §5.1.1）。
- `exists` 为 `resolvedRoot` 当前是否存在（切换失败后可能为 `false`）。

`PUT /settings/library-root`，body `{ "path": "D:\\books\\reading" | null, "moveExisting": true }`：

- `path: null` 恢复默认解析（工作区下的 `reading/`）。
- 校验顺序：必须 string 或 null → 必须绝对路径（400 `E_PATH{reason:'not-absolute'}`）→ 不能是文件（`not-a-directory`）→ 不存在则创建（失败 500 `E_IO{op:'mkdir'}`）→ 不能与当前根相同（400 `E_PATH{reason:'same-as-current'}`）→ 可写探针（500 `E_IO{op:'write',reason:'not-writable'}`）。`path` 缺失 400 `{field:'path',reason:'missing'}`，类型错 `invalid-type`。
- `moveExisting` 默认 `true`：按 `books/`、`exports/`、`inbox/`、`index.json` 顺序迁移；目标已有同名条目 → 400 `E_PATH{reason:'target-not-empty',entry}`（不半迁移）；中途失败反向回滚已搬条目，失败仍无法回滚时 `details.rollbackFailed`，返回 500 `E_IO{op:'migrate'}`。
- 成功 → 200，body 在 `SettingsView` 基础上加 `previousRoot`、`moved`（搬走的条目名）、`skipped`（原本就不存在而跳过的条目名），并立即切换 `BookService`；**不需要重启**。
- 设置文件写失败会把迁移回滚回去（不允许「设置没写成但文件搬走了」）。

### 4.3 上传实现要点

```js
// routes/books.js（伪代码）
async function handleImport(req, res, url) {
  const name = url.searchParams.get('name')
  if (!name) return fail(res, 400, 'E_BAD_REQUEST', { field: 'name' })
  const declared = Number(req.headers['content-length'] ?? NaN)
  if (Number.isFinite(declared) && declared > limits.maxUploadBytes) {
    req.resume() // 丢弃，避免客户端挂起
    return fail(res, 413, 'E_TOO_LARGE', { limit: limits.maxUploadBytes, actual: declared })
  }
  const result = await books.importStream(req, { name, declaredBytes: declared, signal: reqSignal(req, res) })
  return ok(res, result.duplicate ? 200 : 201, result)
}
```

- `reqSignal`：`req.on('aborted'|'close')` → AbortController；客户端断开即取消解析并删临时文件。
- 流式写：`pipeline(req, hashTap, createWriteStream(part))`；`hashTap` 同时更新计数，超限 destroy。
- 完成后：`rename(part, source.<ext>)`（同目录原子）→ 建 `meta` → 入队解析 → 立即响应。

### 4.4 错误映射

`ReadingError` → HTTP：

| code | HTTP | 说明 |
|---|---|---|
| `E_BAD_REQUEST` | 400 | 参数/路径格式 |
| `E_PATH` | 400 | 越界路径（含 `/exports/:name` 穿越） |
| `E_NOT_FOUND` | 404 | book/chunk/thread/map/exports |
| `E_BUSY` | 409 | 导入/生成/导出/删除并发 |
| `E_TOO_LARGE` | 413 | 体积/页数 |
| `E_FORMAT` | 415 | 魔数/结构 |
| `E_ENCRYPTED` / `E_SCANNED` / `E_PARSE` / `E_CITATION` / `E_AGENT` | 422 | 内容/生成类 |
| `E_IO` | 500 | 磁盘/权限 |
| `E_SCHEMA` | 500 | 数据版本 |
| `E_UNSUPPORTED` | 501 | 未实现（含 png/html/tutor） |
| `E_NOT_IMPLEMENTED` | 501 | 开发期 stub |
| 未知异常 | 500 | `code='E_IO'`，`message` 固定「内部错误」，堆栈只进日志 |

## 5. Agent 工具契约

### 5.1 通用

- 注册：`ctx.tools.register(defineTool({ name, description, parameters, output, execute, timeoutMs, isConcurrencySafe }))`。`output` 必填（DSH 0.2.2 的 `ToolDefinition` 要求）。
- **返回信封**：工具不抛业务错误，统一返回

成功：

```json
{ "ok": true, "data": { } }
```

失败：

```json
{ "ok": false, "code": "E_CITATION", "message": "3 个节点的引用无效", "rejected": [] }
```

这样模型能读懂并自我修复；只有参数 schema 校验失败（框架层）与程序 bug 才抛。

- `output.schema` 用 `anyOf` 覆盖成功/失败两个分支；`render` 输出 1–6 行纯文本（不渲染 Markdown 表格），便于会话流阅读。
- 超时：import 180 s、map 60 s、notes 60 s、ask 30 s、export 60 s、tutor 5 s。超时由框架中止，返回 `E_AGENT` 风格错误。
- 并发：`isConcurrencySafe` 仅对只读 action 返回 true（`map.get/outline/chunks`、`notes.read/context`、`ask.context/list`、`export` 读）；`commit/write/import/record` 返回 false（独占）。
- 路径：`reading_import` 的 `path` 必须工作区内（`realpath` 校验）；其它工具只收 `bookId`，不接收路径。
- `exec.agent` 用于记录 `generator.agentId/sessionId`；`exec.signal` 贯穿长任务。

### 5.2 `reading_import`

**描述（给模型）**：导入工作区内的 EPUB/PDF 到阅读实验室，返回 bookId 与解析状态。重复文件返回已有书。

**参数**

| 名 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `path` | string | 是 | 工作区内相对/绝对路径；`.epub`/`.pdf` 或按魔数 |
| `title` | string | 否 | ≤200 字，覆盖解析出的标题 |

**返回**

```json
{ "ok": true, "data": { "book": { "id": "b3f9a1c07d2e", "title": "示例", "format": "epub", "status": "ready", "stats": { "chapters": 12, "chunks": 843, "chars": 412000, "pages": null } }, "duplicate": false } }
```

**错误**：`E_PATH`、`E_FORMAT`、`E_TOO_LARGE`、`E_ENCRYPTED`、`E_SCANNED`、`E_PARSE`、`E_IO`、`E_BUSY`。

**副作用**：写 `books/<id>/`、`index.json`；不写 map/notes。

### 5.3 `reading_map`

一个工具四个动作，避免工具数量膨胀与系统提示过长。

**参数**

| 名 | 类型 | 必填 | 适用 | 约束 |
|---|---|---|---|---|
| `action` | enum | 是 | 全部 | `outline\|chunks\|commit\|get` |
| `bookId` | string | 是 | 全部 | 存在且 `ready` |
| `ids` | string[] | 否 | chunks | 1–20 个 `chunkId` |
| `from` / `to` | int | 否 | chunks | 与 ids 二选一；跨度 ≤20 |
| `root` | object | 否 | commit | `MapNodeInput`（§5.3.2） |
| `maxNodes` | int | 否 | commit | 默认 300；>300 拒绝 |

**动作返回**

`outline`：

```json
{ "ok": true, "data": { "bookId": "…", "title": "示例书名", "author": "…", "totalChunks": 843,
  "chapters": [{ "chapterId": "ch-001", "title": "第一章", "chunkCount": 64, "truncated": false,
    "chunks": [{ "id": "c-000001", "chars": 968, "preview": "正文前 120 字…" }] }] } }
```

上限：200 个块预览、200 KB 响应；`truncated` 标记。

`chunks`：

```json
{ "ok": true, "data": { "bookId": "…", "chunks": [{ "id": "c-000003", "text": "……", "chars": 968 }], "chars": 4830 } }
```

上限：20 块或 20000 字（以先到为准）；超限 400 `E_BAD_REQUEST` 并提示分批。

`commit`：

```json
{ "ok": true, "data": { "bookId": "…", "mapUpdatedAt": "…", "stats": { "nodes": 42, "depth": 3, "citations": 61 }, "replaced": true } }
```

失败：

```json
{ "ok": false, "code": "E_CITATION", "message": "校验未通过", "rejected": [
  { "path": "root.children[2].citations[0]", "code": "E_CITATION", "message": "unknown chunkId c-999999" },
  { "path": "root.children[1].summary", "code": "E_BAD_REQUEST", "message": "summary 长度 35，需 40–120" }
] }
```

`get`：`{ "ok": true, "data": { "map": MapDoc } }`；无图 `{ ok:false, code:'E_NOT_FOUND', message:'尚未生成导图' }`。

**5.3.2 `MapNodeInput`**

```ts
interface MapNodeInput {
  title: string          // 1–60
  summary: string        // 40–120
  kind?: 'chapter'|'section'|'point'   // 根由服务端置 'book'
  citations?: { chunkId: string; quote?: string }[]  // 非根 1–3
  questions?: string[]   // 1–3，每条 ≤80
  children?: MapNodeInput[]
}
```

`id` 不接受（服务端生成）；`generator` 不接受（服务端填）。

**副作用**：`commit` 写 `map.bak.json`（若有旧图）、`map.json`、`meta.mapUpdatedAt/stats`；`get/outline/chunks` 只读。

### 5.4 `reading_notes`

**参数**

| 名 | 类型 | 必填 | 适用 | 约束 |
|---|---|---|---|---|
| `action` | enum | 是 | 全部 | `context\|write\|read` |
| `bookId` | string | 是 | 全部 | `ready` |
| `markdown` | string | 否 | write | 五节完整；≤200 KB |
| `sections` | string[] | 否 | context | 只取指定节，默认全部 |

`context` 返回：全书结构 + 每章要点候选块（每章最多 3 块，总量 ≤12000 字）：

```json
{ "ok": true, "data": { "bookId": "…", "chars": 11842,
  "chapters": [{ "title": "第一章", "chunks": [{ "id": "c-000003", "preview": "…" }] }],
  "citationFormat": "[[c:000003]]" } }
```

`write`：校验五节标题、引用存在性（`[[c:NNNNNN]]`）、每节 ≥1 引用（有内容的节）；失败返回 `rejected`，不落盘。成功：

```json
{ "ok": true, "data": { "path": "reading/books/b3f9a1c07d2e/notes.md", "sections": 5, "citations": 18, "notesUpdatedAt": "…" } }
```

`read`：`{ "ok": true, "data": { "markdown": "…", "updatedAt": "…" } }`；无笔记 `E_NOT_FOUND`。

**M4 实现记录（as built，2026-11-20，t13）**：`reading_notes` 三动作已接线（`src/host/tools.js` 的 `notesToolDefinition`，`timeoutMs 60000`，`isConcurrencySafe` 仅 `context`/`read`）。

- `context` 实际返回还带 `title`、`sectionTitles`、`emptySectionText`、`notesPath`，供模型照抄固定标题与空节文案；`sections` 过滤参数**未实现**（v0.2 一律返回全部节候选），传了会被 `additionalProperties: false` 拒绝——这是与上表的已知偏差。
- `write` 的 `rejected[]` 形如 `{ "path": "sections.主题脉络", "code": "E_CITATION", "message": "…中文修法…" }`；`path` 在整体问题时是 `markdown`。`write` 会顺带更新 `meta.notesUpdatedAt`、`index.json` 摘要并推 SSE `notes` 事件。
- `read` 返回 `{ markdown, updatedAt, sections }`（比上表多一个 `sections`，与 HTTP 的 `GET /notes` 同构）。

### 5.5 `reading_ask`

**参数**

| 名 | 类型 | 必填 | 适用 | 约束 |
|---|---|---|---|---|
| `action` | enum | 是 | 全部 | `context\|record\|list` |
| `bookId` | string | 是 | 全部 | — |
| `nodeId` | string | 否 | context/list | 存在 |
| `question` | string | 否 | context/record | ≤2000 字；context 必填 |
| `threadId` | string | 否 | record | — |
| `answer` | string | 否 | record | ≤20000 字 |
| `citations` | string[] | 否 | record | chunkId 列表；未知的丢弃 |

`context`：建/取线程，返回注入用的 prompt 与 threadId（**不调用 agent**）：

```json
{ "ok": true, "data": { "threadId": "t-01", "messageId": "m-02", "prompt": "……", "contextChars": 5321, "truncated": false } }
```

`record`：写回问答（供 agent 主动落盘；面板路径由 Host 监听器自动回写）：

```json
{ "ok": true, "data": { "threadId": "t-01", "messageId": "m-02", "status": "done", "citations": ["c-000003"] } }
```

`list`：`{ "ok": true, "data": { "threads": [{ "id":"t-01","scope":{...},"messages":[…] }] } }`。

**语义边界**：`reading_ask` **不生成答案**（DR-02）；答案由当前会话 agent 在会话流产生。`context` 只组装上下文。

### 5.6 `reading_export`

**参数**

| 名 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `bookId` | string | 是 | 存在 |
| `format` | enum | 是 | `md\|opml\|json\|html`（html v0.3） |
| `includeThreads` | boolean | 否 | 默认 false |

**返回**

```json
{ "ok": true, "data": { "path": "reading/exports/示例书名-20261119-173000.md", "bytes": 48213, "format": "md" } }
```

**错误**：`E_NOT_FOUND`、`E_UNSUPPORTED`（html/png）、`E_IO`、`E_BUSY`。

### 5.7 `reading_tutor`

**已实现（v0.3，t20）**。

```ts
parameters: {
  bookId: string                 // 必填
  action?: 'plan'|'get'|'answer'|'mark'   // 缺省 plan
  goal?: 'explain'|'quiz'|'socratic'
  stepId?: string                // ^s-\d{2,}$
  question?: string              // 1–2000 字，action=answer 必填
  state?: 'pending'|'answered'|'mastered'|'skipped'   // action=mark 必填
}
```

动作：

| action | 行为 | 返回 `data` |
| --- | --- | --- |
| `plan` | 有 `goal` 时重新开始一条路径，否则读取（无则按导图建） | `TutorDoc` |
| `get` | 只读，缺路径时自动建 | `TutorDoc` |
| `mark` | 标记某一步 `mastered`/`skipped`（推进游标） | `{ path, step }` |
| `answer` | 就某一步向 agent 提一个检查点问题（复用该步线程） | `{ threadId, messageId, agentId, stepId }` |

`TutorDoc`：

```ts
{
  bookId: string
  pathId: string                 // p-01 递增
  goal: 'explain'|'quiz'|'socratic'
  mapUpdatedAt: string
  updatedAt: string|null
  cursor: number
  currentStepId: string|null
  rebuilt?: boolean              // map.json 变更后重建过
  steps: Array<{
    id: string                   // s-01
    nodeId: string
    title: string
    summary: string
    depth: number
    kind: 'chapter'|'section'|'point'
    question: string             // 检查点问题（优先节点自带追问）
    hint: string
    citations: string[]          // chunkId
    state: 'pending'|'answered'|'mastered'|'skipped'
    attempts: number
    threadId: string|null
    messageId: string|null
  }>
  progress: { total, answered, mastered, skipped, done, cursor, percent }
}
```

规则：

- 路径由导图节点 DFS 先序生成、跳过根卡，最多 `MAX_STEPS=60` 步（07 Q-10 的结论）；每步问题优先取节点 `questions[0]`，否则按 goal 兜底成「解释 / 自测 / 反问」三种问法。
- 导图重新生成后（`mapUpdatedAt !== doc.generatedAt`），读取时按 `nodeId` 迁移掌握状态：同名节点保留，消失的节点丢弃，新节点为 `pending`。
- `mark` 只在 `mastered`/`skipped` 时把游标推进到下一步；`answered` 不动游标。
- `answer` 委托 `ask.ask`：首次带 `nodeId` 建线程，之后复用 `step.threadId`，回答进同一线程（与浮层「询问 AI」共享 `threads.json`）。
- 无导图：`GET /tutor` → `E_NOT_FOUND{reason:'no-map'}`；无路径文件时 `mark` → `E_NOT_FOUND{reason:'no-path'}`；未知 step → `E_NOT_FOUND{reason:'step'}`。
- 状态变化发 SSE `tutor` 事件（`{bookId, updatedAt}`），面板据此刷新浮层。

### 5.8 工具输出 schema 与渲染

统一：

```ts
const okEnvelope = {
  type: 'object',
  properties: {
    ok: { const: true },
    data: { type: 'object', additionalProperties: true },
  },
  required: ['ok', 'data'],
  additionalProperties: false,
}
const errEnvelope = {
  type: 'object',
  properties: {
    ok: { const: false },
    code: { type: 'string' },
    message: { type: 'string' },
    rejected: { type: 'array', items: { type: 'object' } },
  },
  required: ['ok', 'code', 'message'],
  additionalProperties: false,
}
output: { schema: { anyOf: [okEnvelope, errEnvelope] }, render }
```

`render` 示例（`reading_map` commit 成功）：

```
已生成导图：42 个节点，3 层，61 条引用。
```

失败：

```
生成被拒绝：3 处引用无效（c-999999 等）。修复后重试一次。
```

不输出 JSON 原文，避免会话流刷屏；详细数据在工具面板可见。

### 5.9 系统提示片段（`prompt.js`）

```text
你是「阅读实验室」的阅读助手。工作区中的 reading/ 目录由插件维护，你只能通过 reading_* 工具读写，不要直接用文件工具改这些文件。

规则：
1. 生成导图前先 reading_map{action:"outline"} 看结构，再按需 reading_map{action:"chunks"} 取原文（每次 ≤20 块）。
2. 每个非根节点必须给 1–3 条真实引用；引用只能来自你读到的 chunkId；摘要 40–120 字；每个节点给 1–3 条追问。
3. 提交用 reading_map{action:"commit"}。若被拒绝，只修复 rejected 列出的节点，再提交一次。
4. 生成笔记用 reading_notes{action:"write"}，固定五节，不得编造引用。
5. 回答提问时用中文，引用格式 [c-000123]，只引用 given 的块；不确定就说明。
6. 你会收到形如 <!-- reading-lab thread=t-01 message=m-02 --> 的隐藏标记，原样保留在回答之外，不要复述。
```

## 6. 事件与投影

### 6.1 Host 事件 → SSE

| Host 事件（`publish`） | SSE `event` | data | 触发点 |
|---|---|---|---|
| `book` | `book` | `{book}` | 导入建书、状态变化、重命名、删除（`book:null` + `deleted:true`） |
| `progress` | `progress` | `{bookId,phase,done,total,updatedAt}`（生成失败帧另带 `reason`/`message`，`phase:'failed'`，见 §4.2 #9） | 解析/分块/生成，节流 ≥200 ms |
| `map` | `map` | `{bookId,mapUpdatedAt}` | `map.json` 写成功 |
| `notes` | `notes` | `{bookId,notesUpdatedAt}` | `notes.md` 写成功 |
| `thread` | `thread` | `{bookId,threadId,state,updatedAt}` | 提问、回写、停止 |
| `export` | `export` | `{bookId,format,path}` | 导出成功 |
| — | `hello` | `{apiVersion,revision,books,anyParsing}` | 每次连接/重连 |
| — | `ping` | `{t}` | 每 15 s |

### 6.2 SSE 协议

```
GET /dsh-reading-lab/api/v1/events
Accept: text/event-stream

HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store
Connection: keep-alive

event: hello
id: 42
data: {"apiVersion":1,"revision":42,"anyParsing":false,"books":[...]}

event: progress
id: 43
data: {"bookId":"b3f9a1c07d2e","phase":"extracting","done":3,"total":12,"updatedAt":"..."}

: keep-alive
```

- 连接即发 `hello` 全量快照（最多 200 本摘要）；**不依赖** `Last-Event-ID` 重放，避免环形缓冲。
- `id` 是进程内 revision，仅用于去重；Host 重启后从 1 开始，Client 发现 `revision` 回退即当作 reset（用 `hello` 覆盖）。
- 心跳：每 15 s 发一行注释 `: ping`；60 s 无写则主动断开（Client 3 s 后重连，指数退避到 30 s）。
- 背压：单连接待写队列 >100 事件时丢弃 `progress`（保留 `book/map/thread`），并补发一次最新 `progress`。
- 关闭：`req.on('close')` 清理订阅；插件卸载时向所有连接写 `event: bye` 并 end。

### 6.3 到会话流的投影

| 内容 | 机制 | 版本 |
|---|---|---|
| 「正在生成导图」 | `agent.followup` 注入的 user 消息（`source.kind='reading-lab'`、`form:'notice'`） | v0.1 |
| 导图结果 | 工具调用 `reading_map` 的 result（原生工具视图 + `render` 文本） | v0.1 |
| 生成失败 | 同一注入线程里不会出现结果；失败原因走 SSE `progress{phase:'failed'}`、状态查询与 Host 日志（§4.2 #9）。v0.2 可在会话结果卡上显示 | v0.1/v0.2 |
| 阅读结果卡 | `conversation.chat.node` key=`reading-lab.result`，匹配 `tool/call` 名 `reading_map/reading_notes` 的 result | v0.2 |
| 提问与回答 | user 消息（`reading-lab` 源）+ assistant 消息（原生） | v0.2 |
| 进度节点 | v0.1 用工具视图；v0.2 起可在结果卡显示阶段 | v0.1/v0.2 |

**答案回写器**（`subscribeAnswerWriter`）：

```ts
ctx.on('session/event', (session, event) => {
  if (event.type !== 'assistant/message') return
  const pending = pendingBySession.get(session.id)   // ask 时登记
  if (!pending) return
  const text = event.data.message.content
    .filter(b => b.type === 'text').map(b => b.text).join('\n')
  if (!text.trim()) return
  const citations = [...text.matchAll(/\[c-(\d{6})\]/g)]
    .map(m => `c-${m[1]}`).filter(id => chunkExists(pending.bookId, id))
  void appendMessage(pending.bookId, pending.threadId, {
    role: 'assistant', text, citations, status: 'done',
    messageId: event.data.message.id, createdAt: new Date().toISOString(),
  }).then(() => publish({ type: 'thread', ... }))
})
```

- `pendingBySession` 在 `askAgent` 时写入，消费后删除；10 分钟过期清理。
- 同一 `messageId` 只写一次；`reading_ask{action:'record'}` 已写则监听器跳过。
- 多线程并发：同一 session 只允许一个 pending（`E_BUSY` 已保证）；否则按 FIFO 消费。

### 6.4 到面板的状态

- 首选 SSE；`EventSource` 不可用（Electron 某些视图）时降级为轮询：`GET /books?since=<revision>` 每 1 s，仅当 `anyParsing` 或面板可见；页面隐藏时暂停。
- 单书视图打开时，额外轮询 `GET /books/:id`（500 ms）直到 `status` 离开 `parsing`。
- 所有写操作后本地乐观更新 + 下一次 SSE/轮询校准；冲突以 Host 为准。

## 7. 错误码总表（wire 层）

| code | HTTP | 工具 | 文案 key | 可重试 | 典型 details |
|---|---|---|---|---|---|
| `E_BAD_REQUEST` | 400 | 返回 | `error.E_BAD_REQUEST` | 否 | `{field}` |
| `E_PATH` | 400 | 返回 | `error.E_PATH` | 否 | `{reason:'outside-workspace'}` |
| `E_NOT_FOUND` | 404 | 返回 | `error.E_NOT_FOUND` | 否 | `{resource:'book'\|'chunk'\|'map'\|'thread'\|'export'}` |
| `E_BUSY` | 409 | 返回 | `error.E_BUSY` | 是（稍后） | `{scope:'import'\|'map'\|'thread'\|'export'}` |
| `E_TOO_LARGE` | 413 | 返回 | `error.E_TOO_LARGE` | 否 | `{limit,actual,unit}` |
| `E_FORMAT` | 415 | 返回 | `error.E_FORMAT` | 否 | `{detected}` |
| `E_ENCRYPTED` | 422 | 返回 | `error.E_ENCRYPTED` | 否 | — |
| `E_SCANNED` | 422 | 返回 | `error.E_SCANNED` | 否 | `{sampled:3,avgChars:4}` |
| `E_PARSE` | 422 | 返回 | `error.E_PARSE` | 是 | `{stage}` |
| `E_CITATION` | 422 | 返回 | `error.E_CITATION` | 是（修后重试） | `{rejected:[...]}` |
| `E_AGENT` | 422/502 | 返回 | `error.E_AGENT` | 是 | `{reason:'no-agent'\|'timeout'\|'cancelled'}` |
| `E_IO` | 500 | 返回 | `error.E_IO` | 是 | `{op:'read'\|'write'}` |
| `E_SCHEMA` | 500 | 返回 | `error.E_SCHEMA` | 否 | `{expected:1,actual}` |
| `E_UNSUPPORTED` | 501 | 返回 | `error.E_UNSUPPORTED` | 否 | `{availableIn}` |
| `E_NOT_IMPLEMENTED` | 501 | 返回 | `error.E_NOT_IMPLEMENTED` | 否 | `{module}` |
| 未知 | 500 | 抛/返回 | `error.E_IO` | 是 | 无（只进日志） |

约束：`details` 不含正文、不含绝对路径；`message` 由 locale 渲染，测试断言 key 而不是整句（避免文案漂移）。

## 8. 版本化与迁移

- `apiVersion=1` 与路径 `v1` 同步；新增可选字段/路由不升版本；删除/改语义升 `v2`。
- `schemaVersion`：`meta/chunks/map/threads/export` 各自独立，当前均为 1（03 §5.9）。
- 工具 schema：新增可选参数不升版本；重命名参数视为破坏性，需同时保留旧名一个 minor。
- **Typert 迁移条件**（同 03 §1.4）：满足后新增 `src/host/typert.js` 与 `src/client/remote.js`，路由层保留一个版本；本文档的路由表即迁移对照表。

## 9. 契约测试清单

| # | 断言 |
|---|---|
| C-01 | `/health` 在存储不可用时 503 且 `data.capabilities` 仍在 |
| C-02 | 上传 100 MB+1 字节 → 413，且不落盘残留 `.part` |
| C-03 | 重复导入同字节 → `duplicate:true`，`bookId` 相同，`updatedAt` 不变 |
| C-04 | `GET /books/:id/chunks?ids=` 含未知 id → 200 + `missing` |
| C-05 | `map commit` 注入未知 chunkId → `ok:false` + `rejected[]`，`map.json` 哈希不变 |
| C-06 | `POST /ask` 同 `Idempotency-Key` 两次 → 同一 `messageId`，只注入一次 |
| C-07 | SSE 首帧为 `hello`，含 `revision/books`；`ping` ≤15 s |
| C-08 | 越界路径 `/exports/..%2fmeta.json` → 400 `E_PATH` |
| C-09 | 六个工具的 `parameters` 通过 `defineTool` 校验（无点号、无未知字段） |
| C-10 | `threads.json` 中不出现 `qa-threads.json`；读取旧别名目录时报 `E_SCHEMA`（不静默） |
| C-11 | 删除书后 `GET /books/:id` → 404，SSE 收到 `book{deleted:true}` |
| C-12 | `reading_export` 产出通过 `schema/export-v1.schema.json` |

## 10. 附录：类型定义

```ts
type BookStatus = 'queued' | 'parsing' | 'ready' | 'unsupported' | 'failed'
type Phase = 'queued' | 'reading' | 'extracting' | 'chunking' | 'mapping' | 'done'
type ExportFormat = 'md' | 'opml' | 'json' | 'html'

interface BookMeta {
  schemaVersion: 1
  id: string
  title: string
  displayName: string | null
  author: string | null
  language: string | null
  format: 'epub' | 'pdf'
  source: { file: string; bytes: number; sha256: string; importedAt: string }
  status: BookStatus
  statusDetail: { code: string; message: string; at: string } | null
  progress: { phase: Phase; done: number; total: number; updatedAt: string }
  stats: { chapters: number; chunks: number; chars: number; pages: number | null }
  toc: Array<{ id: string; title: string; level: number; chunkStart: string; chunkEnd: string }>
  createdAt: string
  updatedAt: string
  mapUpdatedAt: string | null
  notesUpdatedAt: string | null
  threadsUpdatedAt: string | null
}

interface Chunk {
  id: string; seq: number
  chapterId: string; chapterTitle: string; chapterPath: string[]
  page: number | null
  text: string; chars: number
  startOffset: number; endOffset: number
}

interface MapNode {
  id: string; kind: 'book' | 'chapter' | 'section' | 'point'
  title: string; summary: string
  citations: Array<{ chunkId: string; quote?: string }>
  questions: string[]
  children: MapNode[]
}

interface MapDoc {
  schemaVersion: 1; bookId: string; generatedAt: string
  generator: { kind: 'agent'; agentId?: string; sessionId?: string; pluginVersion: string }
  root: MapNode
  layout: {
    version: 1; width: number; height: number
    nodes: Record<string, { x: number; y: number; w: number; h: number; depth: number; side: 'root'|'left'|'right' }>
    edges: Array<{ from: string; to: string }>
  }
  stats: { nodes: number; depth: number; citations: number }
}

interface Thread {
  id: string
  scope: { kind: 'book' } | { kind: 'node'; nodeId: string; nodeTitle: string }
  createdAt: string; updatedAt: string
  state: 'idle' | 'running'
  messages: Array<{
    id: string; role: 'user' | 'assistant'
    text: string
    citations: Array<{ chunkId: string }>
    createdAt: string
    status: 'pending' | 'streaming' | 'done' | 'stopped' | 'failed'
    messageId: string | null
  }>
}

interface ThreadsFile {
  schemaVersion: 1; bookId: string; updatedAt: string; threads: Thread[]
}

interface ApiOk<T> { ok: true; data: T }
interface ApiErr { ok: false; error: { code: string; message: string; details?: unknown; requestId: string } }

interface ReadingLabConfig {
  workspaceRoot?: string
  maxUploadBytes: number
  maxPdfPages: number
  maxEpubChars: number
  maxChunks: number
  askTimeoutMs: number
  exportFormats: ExportFormat[]
  allowAgentImportPaths: boolean
}
```

## 11. 与实现顺序的对应

| 里程碑 | 本文档需落地的契约 |
|---|---|
| M1 | §2、§4.1 的 1/3/25、§4.2 的 health/books/SSE hello、§6.2 |
| M2 | §4.2 的 4–12、§5.2、§6.1 progress/book、§7 全表 |
| M3 | §5.3、§4.2 的 9/13、§6.3 工具投影 |
| M4 | §5.4–5.6、§4.2 的 15–22、§6.3 回写器、§9 C-06/C-07 |
| M5 | §5.7、§4.2 的 14/16（501 保持）、§9 全量、§10 schema 校验 |
