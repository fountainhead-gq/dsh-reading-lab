/**
 * 书库路由（owner: store，03 §2.2；规格 04 §4.3–§4.5）。
 *
 * 这里只做 HTTP 层：校验查询参数、读请求体、把结果包成信封。业务全在
 * `BookService` / `import.js` 里，方便单测直接调用。
 */

import { buildMapPrompt, injectAgentRequest } from '../agent-bridge.js'
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
 * `POST /books/import`（04 §4.2 #4 / §4.3）：raw body + `?name=`，格式由魔数判定。
 *
 * `name` 必填：显式缺字段 → 400 `E_BAD_REQUEST{field:'name',reason:'missing'}`；
 * 传了但为空/全空白 → 同码 `reason:'empty'`；含路径分隔符或 `..` → 400 `E_PATH`
 * （name 只用于显示，但我们不接受看起来像路径的输入）。校验在落盘之前完成，
 * 失败请求不会在 `reading/` 留下任何文件。
 *
 * @param {{ req: any, res: any, url: URL, services: any }} context
 */
export async function handleImportRoute(context) {
  const { req, res, url, services } = context
  const rawName = url.searchParams.get('name')
  if (rawName === null) {
    drain(req)
    throw new ReadingError('E_BAD_REQUEST', { field: 'name', reason: 'missing' })
  }
  const name = rawName.trim()
  if (name.length === 0) {
    drain(req)
    throw new ReadingError('E_BAD_REQUEST', { field: 'name', reason: 'empty' })
  }
  if (/[\\/\u0000]/.test(name) || name === '.' || name === '..' || name.includes('..')) {
    drain(req)
    throw new ReadingError('E_PATH', { reason: 'name-traversal', field: 'name' })
  }
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
  if (method === 'GET' && suffix === '/actions/generate-map') {
    // 状态查询（t29）：202 之后面板/脚本用它确认链路的实际进展，
    // 不用等 SSE 或翻会话。无记录时 state='idle'。
    sendOk(res, services.map.getGeneration(params.bookId))
    return
  }
  if (method === 'POST' && suffix === '/actions/generate-map') {
    const body = await readJsonBody(context.req)
    const agentId = body.agentId === undefined || body.agentId === null ? null : body.agentId
    if (agentId !== null && typeof agentId !== 'string') {
      throw new ReadingError('E_BAD_REQUEST', { field: 'agentId', reason: 'type' })
    }
    const instructions = body.instructions === undefined || body.instructions === null ? '' : body.instructions
    if (typeof instructions !== 'string') {
      throw new ReadingError('E_BAD_REQUEST', { field: 'instructions', reason: 'type' })
    }
    if ([...instructions].length > 500) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'instructions', reason: 'too-long', limit: 500 })
    }

    const book = await services.books.get(params.bookId)
    if (book.status !== 'ready') {
      throw new ReadingError('E_BUSY', { reason: 'not-ready', status: book.status })
    }
    // 已在生成中 → 409（04 §4.2 #9）。记录只在内存里，DSH 重启后自动失效。
    const map = services.map
    map?.beginGeneration?.(params.bookId)
    try {
      const title = String(book.displayName ?? book.title ?? '')
      const injected = injectAgentRequest({
        ctx: services.ctx,
        agentId,
        text: buildMapPrompt({
          bookId: params.bookId,
          title,
          totalChunks: book.stats?.chunks ?? null,
          instructions,
        }),
        summary: `正在为《${title}》生成导图`,
        bookId: params.bookId,
        action: 'generate-map',
      })
      // 认领事件只能按 message.id 对齐，注入成功后再补 promptId。
      const state = map?.attachPrompt?.(params.bookId, { agentId: injected.agentId, promptId: injected.promptId })
      services?.ctx?.logger?.info?.(
        `[dsh-reading-lab] generate-map queued book=${params.bookId} agent=${injected.agentId} prompt=${injected.promptId}`,
      )
      sendOk(
        res,
        {
          queued: true,
          agentId: injected.agentId,
          promptId: injected.promptId,
          state: state?.state ?? 'pending',
          statusUrl: `${API_BASE}/books/${encodeURIComponent(params.bookId)}/actions/generate-map`,
          timeoutMs: state?.timeoutMs ?? null,
        },
        202,
      )
    } catch (error) {
      // 注入失败要把占位清掉，否则用户要等到看门狗超时才能重试。
      map?.endGeneration?.(params.bookId, {
        state: 'failed',
        reason: error?.code === 'E_AGENT' ? 'agent-missing' : 'inject-failed',
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    return
  }
  if (method === 'POST' && suffix === '/actions/generate-notes') {
    drain(context.req)
    // v0.2 不由服务端生成笔记：Agent 直接调 reading_notes 写，人从面板读（03 §5.5）。
    // 明确 501 + 版本，而不是假装排队（QA-17-03）；面板按钮态由 Client 侧处理。
    throw new ReadingError(
      'E_UNSUPPORTED',
      { feature: 'notes.generate', availableIn: '0.3.0' },
      {
        message: context.lang === 'en'
          ? 'Automatic note generation arrives in v0.3. For now ask the Agent to write notes with reading_notes.'
          : '自动生成笔记将在 v0.3 提供；当前请让 Agent 用 reading_notes 撰写。',
      },
    )
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