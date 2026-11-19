/**
 * HTTP 路由装配（docs/04-api.md §4）。
 *
 * 这里只做三件事：匹配、信封、错误映射。业务在 `routes/books.js`、
 * `routes/content.js`、`routes/events.js` 里，M2 起逐个把桩换成实现。
 *
 * 通用约定（04 §4.1）：未匹配 → 404 `E_NOT_FOUND`；已知路径错方法 → 405 + `Allow`；
 * `:bookId` 不合法直接 400（不查盘）；所有响应 `Cache-Control: no-store`。
 */
import { ReadingError, newRequestId, pickLanguage, messageFor } from './errors.js'
import { isBookId, isChunkId, isThreadId } from './ids.js'
import { API_BASE, API_VERSION, SUPPORTED_FORMATS, PANEL_ID } from './limits.js'
import { PLUGIN_VERSION, SERVER_HEADER, sendError, sendJson, sendOk } from './respond.js'
import { handleBookRoutes, handleImportRoute } from './routes/books.js'
import { handleContentRoutes } from './routes/content.js'
import { handleEventRoutes } from './routes/events.js'

export { PLUGIN_VERSION, SERVER_HEADER, sendError, sendJson, sendOk }

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
    route('POST', '/books/:bookId/export', bookRoute(handleContentRoutes)),
    route('GET', '/exports', exportListStubHandler),
    route('GET', '/exports/:name', exportDownloadStubHandler),
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
      exports: Array.isArray(services?.limits?.exportFormats) ? [...services.limits.exportFormats] : [],
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

async function exportListStubHandler() {
  throw notImplemented('routes.export.list', 'export lands in M3')
}

async function exportDownloadStubHandler() {
  throw notImplemented('routes.export.download', 'export lands in M3')
}

/** 书相关路由的统一入口：先校验 id，再交给业务处理器。 */
function bookRoute(handler, extraKey) {
  return async (context) => {
    const { params, services } = context
    if (!isBookId(params.bookId)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'bookId' })
    }
    if (extraKey === 'chunkId' && !isChunkId(params.chunkId)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'chunkId' })
    }
    if (extraKey === 'threadId' && !isThreadId(params.threadId)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'threadId' })
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