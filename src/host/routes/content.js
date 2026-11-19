/**
 * 内容路由（owner: parse / map / notes / ask / export，docs/03-design.md §2.2）。
 *
 * M1 全部是桩：签名与 04 §4 的路由表对齐，M2（chunks）、M3（map）、M4（notes/ask）、
 * M3（export）逐个填实现，不改 URL。
 */
import { notImplemented } from '../errors.js'
import { API_BASE } from '../limits.js'
import { sendChunkPage } from './books.js'

function drain(req) {
  req.resume?.()
}

function parseIntParam(value) {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * @param {{ method: string, params: Record<string, string>, url: URL, req: any, res: any }} context
 * @param {{ books: import('../books.js').BookService }} services
 */
export async function handleContentRoutes(context, services) {
  const { method, params, url, res } = context
  const prefix = `${API_BASE}/books/${encodeURIComponent(params.bookId)}`
  const suffix = url.pathname.slice(prefix.length) || '/'

  switch (`${method} ${suffix}`) {
    case 'GET /chunks': {
      const idsParam = url.searchParams.get('ids')
      const ids = idsParam
        ? idsParam.split(',').map((id) => id.trim()).filter(Boolean)
        : undefined
      const page = await services.books.listChunks(params.bookId, {
        ids,
        from: parseIntParam(url.searchParams.get('from')),
        to: parseIntParam(url.searchParams.get('to')),
        limit: parseIntParam(url.searchParams.get('limit')),
      })
      sendChunkPage(res, page)
      return
    }
    case `GET /chunks/${params.chunkId}`:
      sendChunkPage(res, await services.books.getChunk(params.bookId, params.chunkId))
      return
    case 'GET /map':
      // 没有 map 时 04 要求 404；M1 连读取都没实现，用 501 更诚实。
      throw notImplemented('map.read', 'mind map storage lands in M3')
    case 'PUT /map':
      drain(context.req)
      throw notImplemented('map.write', 'mind map storage lands in M3')
    case 'GET /notes':
      throw notImplemented('notes.read', 'notes storage lands in M4')
    case 'PUT /notes':
      drain(context.req)
      throw notImplemented('notes.write', 'notes storage lands in M4')
    case 'GET /threads':
      throw notImplemented('threads.list', 'question threads land in M4')
    case 'POST /threads':
      drain(context.req)
      throw notImplemented('threads.create', 'question threads land in M4')
    case `DELETE /threads/${params.threadId}`:
      throw notImplemented('threads.remove', 'question threads land in M4')
    case 'POST /ask':
      drain(context.req)
      throw notImplemented('ask.create', 'AI asking lands in M4')
    case `POST /threads/${params.threadId}/stop`:
      drain(context.req)
      throw notImplemented('ask.stop', 'AI asking lands in M4')
    case 'POST /export':
      drain(context.req)
      throw notImplemented('export.create', 'export lands in M3')
    default:
      throw notImplemented('routes.content', `no handler for ${method} ${suffix}`)
  }
}