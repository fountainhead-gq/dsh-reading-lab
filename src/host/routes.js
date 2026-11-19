/**
 * HTTP 路由装配（docs/04-api.md §4）。
 *
 * 这里只做三件事：匹配、信封、错误映射。业务在 `routes/books.js`、
 * `routes/content.js`、`routes/events.js` 里，M2 起逐个把桩换成实现。
 *
 * 通用约定（04 §4.1）：未匹配 → 404 `E_NOT_FOUND`；已知路径错方法 → 405 + `Allow`；
 * `:bookId` 不合法直接 400（不查盘）；所有响应 `Cache-Control: no-store`。
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import { ReadingError, newRequestId, pickLanguage, messageFor } from './errors.js'
import { isBookId, isChunkId, isMessageId, isThreadId } from './ids.js'
import { API_BASE, API_VERSION, SUPPORTED_FORMATS, PANEL_ID } from './limits.js'
import { PLUGIN_VERSION, SERVER_HEADER, sendError, sendJson, sendOk } from './respond.js'
import { contentTypeOf, listExports, resolveExportFile } from './export/files.js'
import { IMPLEMENTED_FORMATS } from './export/format.js'
import { handleBookRoutes, handleImportRoute } from './routes/books.js'
import { handleContentRoutes } from './routes/content.js'
import { handleEventRoutes } from './routes/events.js'

export { PLUGIN_VERSION, SERVER_HEADER, sendError, sendJson, sendOk }

/** 学习路径步骤 id（`tutor.json`，见 src/host/tutor.js）。 */
const STEP_ID_PATTERN = /^s-\d{2,}$/

/**
 * 带参数的路由表。`:bookId`/`:chunkId`/`:threadId` 转成正则捕获组。
 * @type {Array<{ method: string, pattern: RegExp, keys: string[], handler: Function }>}
 */
const ROUTES = buildRoutes()

function route(method, pattern, handler) {
  const keys = []
  const source = pattern.replace(/:([A-Za-z]+)/g, (_match, key) => {
    keys.push(key)
    return '([^/]+)'
  })
  return { method, pattern: new RegExp(`^${source}$`), keys, handler }
}

function buildRoutes() {
  return [
    route('GET', '/health', healthHandler),
    route('GET', '/agents', agentsHandler),
    route('GET', '/books', listBooksHandler),
    route('POST', '/books/import', handleImportRoute),
    route('GET', '/books/:bookId', bookRoute(handleBookRoutes)),
    route('PATCH', '/books/:bookId', bookRoute(handleBookRoutes)),
    route('DELETE', '/books/:bookId', bookRoute(handleBookRoutes)),
    route('POST', '/books/:bookId/retry', bookRoute(handleBookRoutes)),
    route('POST', '/books/:bookId/actions/generate-map', bookRoute(handleBookRoutes)),
    // t29：202 之后的状态查询（pending/running/done/failed + reason）。
    route('GET', '/books/:bookId/actions/generate-map', bookRoute(handleBookRoutes)),
    route('POST', '/books/:bookId/actions/generate-notes', bookRoute(handleBookRoutes)),
    route('GET', '/books/:bookId/chunks', bookRoute(handleContentRoutes)),
    route('GET', '/books/:bookId/chunks/:chunkId', bookRoute(handleContentRoutes, 'chunkId')),
    route('GET', '/books/:bookId/map', bookRoute(handleContentRoutes)),
    route('PUT', '/books/:bookId/map', bookRoute(handleContentRoutes)),
    route('GET', '/books/:bookId/notes', bookRoute(handleContentRoutes)),
    route('PUT', '/books/:bookId/notes', bookRoute(handleContentRoutes)),
    route('GET', '/books/:bookId/threads', bookRoute(handleContentRoutes)),
    route('POST', '/books/:bookId/threads', bookRoute(handleContentRoutes)),
    route('DELETE', '/books/:bookId/threads/:threadId', bookRoute(handleContentRoutes, 'threadId')),
    route('POST', '/books/:bookId/ask', bookRoute(handleContentRoutes)),
    route('POST', '/books/:bookId/threads/:threadId/stop', bookRoute(handleContentRoutes, 'threadId')),
    // t15：👍/👎 反馈落盘（04 §4.2 #26）。
    route(
      'POST',
      '/books/:bookId/threads/:threadId/messages/:messageId/feedback',
      bookRoute(handleContentRoutes, ['threadId', 'messageId']),
    ),
    route('POST', '/books/:bookId/export', bookRoute(handleContentRoutes)),
    route('GET', '/books/:bookId/tutor', bookRoute(handleContentRoutes)),
    route('POST', '/books/:bookId/tutor', bookRoute(handleContentRoutes)),
    route('POST', '/books/:bookId/tutor/steps/:stepId', bookRoute(handleContentRoutes, 'stepId')),
    route('POST', '/books/:bookId/tutor/steps/:stepId/answer', bookRoute(handleContentRoutes, 'stepId')),
    route('GET', '/exports', exportListHandler),
    route('GET', '/exports/:name', exportDownloadHandler),
    route('GET', '/events', eventRoute(handleEventRoutes)),
  ]
}

// ---------------------------------------------------------------------------
// 处理器
// ---------------------------------------------------------------------------

/**
 * 读取探针：宿主 ctx 是 Cordis 上下文，某些 Service 键在未 inject 的 fiber 上
 * 访问会抛错（而不是返回 undefined）。health 必须永远可答，所以逐个 try。
 */
function probe(read) {
  try {
    return read()
  } catch {
    return undefined
  }
}

function detectDshVersion(services) {
  const ctx = services?.ctx
  const candidates = [
    () => services?.dshVersion,
    () => ctx?.dshVersion,
    () => ctx?.app?.version,
    () => ctx?.dsh?.version,
    () => process.env.DSH_VERSION,
  ]
  for (const read of candidates) {
    const candidate = probe(read)
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
  }
  return 'unknown'
}

/** `/health.capabilities.exports`：只列本实例真能生成的格式（03 §9.1）。 */
function implementedExportFormats(services) {
  const configured = services?.limits?.exportFormats
  const enabled = Array.isArray(configured) && configured.length > 0
    ? configured
    : IMPLEMENTED_FORMATS
  return IMPLEMENTED_FORMATS.filter((format) => enabled.includes(format))
}

function healthHandler({ res, services }) {
  const available = services?.storage?.available !== false
  const data = {
    pluginVersion: PLUGIN_VERSION,
    apiVersion: API_VERSION,
    dshVersion: detectDshVersion(services),
    panelId: PANEL_ID,
    storage: available ? 'ok' : 'unavailable',
    workspaceRootName: probe(() => services.rootName) ?? '',
    capabilities: {
      sse: true,
      formats: [...SUPPORTED_FORMATS],
      // 只宣告**真的能用**的导出格式（v0.2 起 md/opml/json 已实现，html 仍 501）。
      // 与 `POST /books/:id/export` 的能力保持一致，避免「看到支持却拿到 501」。
      exports: implementedExportFormats(services),
      // v0.2 不生成笔记：Agent 用 reading_notes 写，人从面板读（03 §5.5）。
      // 这里显式宣告「未提供 + 何时提供」，与 POST /actions/generate-notes 的 501 对齐（QA-17-03）。
      generateNotes: { available: false, availableIn: '0.3.0' },
      tools: Array.isArray(services?.toolNames) ? [...services.toolNames] : [],
    },
  }
  if (available) {
    sendOk(res, data)
    return
  }
  // 存储不可用时 data 仍要带上（Client 显示只读态），状态码 503。
  sendJson(res, 503, {
    ok: false,
    data,
    error: {
      code: 'E_IO',
      message: messageFor('E_IO', 'zh'),
      details: { op: 'storage' },
      requestId: newRequestId(),
    },
  })
}

async function agentsHandler({ res, services }) {
  const list = typeof services?.ctx?.agents?.list === 'function' ? services.ctx.agents.list() : []
  const agents = (Array.isArray(list) ? list : []).map((agent) => ({
    id: typeof agent?.id === 'string' ? agent.id : String(agent?.name ?? ''),
    name: typeof agent?.name === 'string' ? agent.name : String(agent?.id ?? ''),
    title: typeof agent?.title === 'string' ? agent.title : undefined,
  })).filter((agent) => agent.id !== '')
  sendOk(res, { agents })
}

async function listBooksHandler({ res, services }) {
  const { books, revision } = await services.books.list()
  sendOk(res, { books, revision })
}

/** 04 §4.2 #23：空目录也 200；目录缺失时惰性创建。 */
async function exportListHandler({ res, services }) {
  sendOk(res, await listExports(services.books))
}

/** 04 §4.2 #24：文件名必须是单段且不含 `..`；越界 400 `E_PATH`，不存在 404。 */
async function exportDownloadHandler({ res, services, params }) {
  const { name, file } = await resolveExportFile(services.books, params.name)
  let info
  try {
    info = await stat(file)
  } catch {
    throw new ReadingError('E_NOT_FOUND', { resource: 'export', name })
  }
  if (!info.isFile()) throw new ReadingError('E_NOT_FOUND', { resource: 'export', name })
  res.writeHead(200, {
    'Content-Type': contentTypeOf(name),
    'Content-Length': String(info.size),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    // 04 §4.1：只有这个路径允许短缓存（导出文件生成后不再变）。
    'Cache-Control': 'private, max-age=300',
    'X-DSH-Plugin': SERVER_HEADER,
  })
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('error', reject)
    res.on('close', resolve)
    res.on('finish', resolve)
    stream.pipe(res)
  })
}

/** 书相关路由的统一入口：先校验 id，再交给业务处理器。 */
function bookRoute(handler, extraKey) {
  const extras = Array.isArray(extraKey) ? extraKey : extraKey ? [extraKey] : []
  return async (context) => {
    const { params, services } = context
    if (!isBookId(params.bookId)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'bookId' })
    }
    for (const key of extras) {
      if (key === 'chunkId' && !isChunkId(params.chunkId)) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'chunkId' })
      }
      if (key === 'threadId' && !isThreadId(params.threadId)) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'threadId' })
      }
      if (key === 'messageId' && !isMessageId(params.messageId)) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'messageId' })
      }
      if (key === 'stepId' && !STEP_ID_PATTERN.test(String(params.stepId ?? ''))) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'stepId' })
      }
    }
    await handler(context, services)
  }
}

function eventRoute(handler) {
  return async (context, services) => {
    await handler(context, services)
  }
}

// ---------------------------------------------------------------------------
// 匹配与分发
// ---------------------------------------------------------------------------

function matchRoute(method, pathname) {
  let pathMatched = false
  const allowed = new Set()
  for (const entry of ROUTES) {
    const match = entry.pattern.exec(pathname)
    if (!match) continue
    pathMatched = true
    allowed.add(entry.method)
    if (entry.method !== method) continue
    const params = {}
    entry.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1])
    })
    return { entry, params }
  }
  return { entry: null, params: null, pathMatched, allowed: [...allowed] }
}

/**
 * @param {{ books: any, hub: any, limits: Record<string, any>, storage: { available: boolean }, root: string, rootName: string, ctx?: any, toolNames?: string[] }} services
 * @returns {Array<{ kind: 'prefix', path: string, handler: (req: any, res: any) => void }>}
 */
export function makeRoutes(services) {
  const handler = (req, res) => {
    void handle(req, res, services).catch((error) => {
      try {
        sendError(res, error, { requestId: newRequestId(), lang: 'zh' })
      } catch {
        try {
          res.destroy()
        } catch {
          // 连接已经没了。
        }
      }
    })
  }
  return [{ kind: 'prefix', path: API_BASE, handler }]
}

async function handle(req, res, services) {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const pathname = url.pathname
  if (!pathname.startsWith(API_BASE)) {
    sendError(res, new ReadingError('E_NOT_FOUND'), { requestId: newRequestId(), lang: 'zh' })
    return
  }
  let relative = pathname.slice(API_BASE.length) || '/'
  if (!relative.startsWith('/')) relative = `/${relative}`
  if (relative.length > 1 && relative.endsWith('/')) relative = relative.slice(0, -1)

  const method = (req.method ?? 'GET').toUpperCase()
  if (method === 'OPTIONS') {
    res.writeHead(405, { Allow: 'GET, POST, PATCH, PUT, DELETE', 'Cache-Control': 'no-store' })
    res.end()
    return
  }

  const requestId = newRequestId()
  const lang = pickLanguage(req.headers?.['accept-language'])
  const { entry, params, pathMatched, allowed } = matchRoute(method, relative)

  if (!entry) {
    if (pathMatched && allowed.length > 0) {
      // 04 §4.1：已知路径错方法 → 405 + Allow。错误码沿用 E_BAD_REQUEST（04 §7 无单独 code）。
      sendJson(
        res,
        405,
        {
          ok: false,
          error: {
            code: 'E_BAD_REQUEST',
            message: messageFor('E_BAD_REQUEST', lang),
            details: { method, allow: allowed },
            requestId,
          },
        },
        { Allow: allowed.join(', ') },
      )
      return
    }
    sendError(res, new ReadingError('E_NOT_FOUND'), { requestId, lang })
    return
  }

  const context = { req, res, services, params, url, requestId, lang, method }
  try {
    await entry.handler(context, services)
  } catch (error) {
    // 非业务异常会被 asReadingError 折成 E_IO（不泄漏栈到 wire），因此这里必须留痕，
    // 否则线上只能看到 500 却查不到根因。
    if (!(error instanceof ReadingError) || error.cause !== undefined) {
      const detail = error instanceof ReadingError ? error.cause : error
      probe(() => services?.ctx?.logger?.warn?.(`reading-lab: ${method} ${relative} failed`, detail))
    }
    sendError(res, error, { requestId, lang })
  }
}

/** 供测试使用：路由表快照（方法 + 原文 pattern）。 */
export function routeTable() {
  return ROUTES.map((entry) => ({ method: entry.method, pattern: entry.pattern.source, keys: [...entry.keys] }))
}