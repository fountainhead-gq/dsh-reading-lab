/**
 * 书库路由（owner: store，03 §2.2；规格 04 §4.3–§4.5）。
 *
 * 这里只做 HTTP 层：校验查询参数、读请求体、把结果包成信封。业务全在
 * `BookService` / `import.js` 里，方便单测直接调用。
 */

import { notImplemented, ReadingError } from '../errors.js'
import { API_BASE } from '../limits.js'
import { sendJson, sendOk } from '../routes.js'

const JSON_BODY_LIMIT = 64 * 1024

/** 把请求体读干净，避免 keep-alive 上串包。 */
function drain(req) {
  req.resume?.()
}

/**
 * 读取原始请求体，超过 `maxBytes` 抛 `E_TOO_LARGE`（04 §4.3）。
 * 丢弃超限之后到达的分片，但不立刻 destroy：先让路由把 413 写回去。
 * @param {any} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
export function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let oversize = false
    let settled = false
    const cleanup = () => {
      req.off?.('data', onData)
      req.off?.('end', onEnd)
      req.off?.('error', onError)
      req.off?.('aborted', onAborted)
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const onData = (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        oversize = true
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      if (oversize) {
        finish(reject, new ReadingError('E_TOO_LARGE', { reason: 'upload', limit: maxBytes }))
        return
      }
      finish(resolve, Buffer.concat(chunks))
    }
    const onError = (error) => {
      finish(reject, new ReadingError('E_IO', { op: 'read-body' }, { cause: error }))
    }
    const onAborted = () => {
      finish(reject, new ReadingError('E_BAD_REQUEST', { reason: 'aborted' }))
    }
    if (req.readableEnded) {
      resolve(Buffer.alloc(0))
      return
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('aborted', onAborted)
  })
}

/** @param {any} req @returns {Promise<Record<string, unknown>>} */
export async function readJsonBody(req) {
  const bytes = await readRawBody(req, JSON_BODY_LIMIT)
  if (bytes.length === 0) return {}
  try {
    const parsed = JSON.parse(bytes.toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'body' })
    }
    return parsed
  } catch (error) {
    if (error instanceof ReadingError) throw error
    throw new ReadingError('E_BAD_REQUEST', { field: 'body', reason: 'invalid-json' }, { cause: error })
  }
}

/**
 * `POST /books/import`（04 §4.3）：raw body + `?name=`，格式由魔数判定。
 * @param {{ req: any, res: any, url: URL, services: any }} context
 */
export async function handleImportRoute(context) {
  const { req, res, url, services } = context
  const name = url.searchParams.get('name') ?? undefined
  const limit = services?.limits?.maxUploadBytes ?? 0
  const bytes = await readRawBody(req, limit)
  const result = await services.books.importFromBytes(bytes, { name })
  const status = result.duplicate ? 200 : 201
  sendOk(res, { duplicate: result.duplicate, book: result.book }, status)
}

/**
 * @param {{ method: string, params: Record<string, string>, url: URL, req: any, res: any }} context
 * @param {{ books: import('../books.js').BookService }} services
 */
export async function handleBookRoutes(context, services) {
  const { method, params, url, res } = context
  const prefix = `${API_BASE}/books/${encodeURIComponent(params.bookId)}`
  const suffix = url.pathname.slice(prefix.length) || '/'

  if (method === 'GET' && suffix === '/') {
    sendOk(res, await services.books.get(params.bookId))
    return
  }
  if (method === 'PATCH' && suffix === '/') {
    const body = await readJsonBody(context.req)
    const displayName = body.displayName === undefined ? null : body.displayName
    sendOk(res, await services.books.rename(params.bookId, displayName))
    return
  }
  if (method === 'DELETE' && suffix === '/') {
    drain(context.req)
    sendOk(res, await services.books.remove(params.bookId))
    return
  }
  if (method === 'POST' && suffix === '/retry') {
    drain(context.req)
    sendOk(res, await services.books.retry(params.bookId), 202)
    return
  }
  if (method === 'POST' && suffix === '/actions/generate-map') {
    drain(context.req)
    throw notImplemented('map.generate', 'mind map generation lands in M3')
  }
  if (method === 'POST' && suffix === '/actions/generate-notes') {
    drain(context.req)
    throw notImplemented('notes.generate', 'notes generation lands in M4')
  }
  throw notImplemented('routes.books', `no handler for ${method} ${suffix}`)
}

/** 供测试复用：把 JSON 响应体长度卡在 2 MB 以内（04 §4.6）。 */
export function sendChunkPage(res, data, limitBytes = 2 * 1024 * 1024) {
  const payload = JSON.stringify({ ok: true, data })
  if (Buffer.byteLength(payload, 'utf8') > limitBytes) {
    throw new ReadingError('E_TOO_LARGE', { reason: 'response', limit: limitBytes })
  }
  sendJson(res, 200, JSON.parse(payload))
}