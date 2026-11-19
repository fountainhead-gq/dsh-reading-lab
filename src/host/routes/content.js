/**
 * 内容路由（owner: parse / map / notes / ask / export，docs/03-design.md §2.2）。
 *
 * M1 全部是桩：签名与 04 §4 的路由表对齐，M2（chunks）、M3（map）、M4（notes/ask）、
 * M3（export）逐个填实现，不改 URL。
 */
import { notImplemented, ReadingError } from '../errors.js'
import { API_BASE } from '../limits.js'
import { readNotes } from '../notes.js'
import { sendOk } from '../routes.js'
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
    case 'GET /map': {
      // 04 §4.2 #13：有图 200 MapDoc，无图 404 E_NOT_FOUND{reason:'no-map'}。
      const { map } = await services.map.get(params.bookId)
      sendOk(res, map)
      return
    }
    case 'PUT /map':
      drain(context.req)
      // 手动编辑导图是 v0.3 的范围（04 §4.2 #13）。
      throw new ReadingError('E_UNSUPPORTED', { feature: 'map.write', availableIn: '0.3.0' })
    case 'GET /notes': {
      // 04 §4.2 #17：无笔记不是 404，返回空结构；手改/损坏的文件仍可读，带 parseError。
      sendOk(res, await readNotes(services.books, params.bookId))
      return
    }
    case 'PUT /notes':
      drain(context.req)
      // 面板编辑笔记是 v0.3（04 §4.2 #17）；v0.2 由 Agent 走 reading_notes 写入。
      throw new ReadingError('E_UNSUPPORTED', { feature: 'notes.write', availableIn: '0.3.0' }, {
        message:
          context.lang === 'en'
            ? 'Editing notes from the panel arrives in v0.3; ask the agent to write them with reading_notes.'
            : '在面板里编辑笔记将在 v0.3 提供；当前可以请 Agent 用 reading_notes 生成。',
      })
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
    case 'POST /export': {
      drain(context.req)
      // v0.1/v0.2 只开放「列出/下载已有导出」；生成导出到 v0.2（04 §4.2 #22）。
      // /health 的 capabilities.exports 因此是空数组——不能声称支持却回 501。
      throw new ReadingError('E_UNSUPPORTED', { feature: 'export.create', availableIn: '0.2.0' }, {
        message:
          context.lang === 'en'
            ? 'Export generation arrives in v0.2; this version lists and downloads existing files only.'
            : '导出生成将在 v0.2 提供；当前版本只能列出与下载已有导出文件。',
      })
    }
    default:
      throw notImplemented('routes.content', `no handler for ${method} ${suffix}`)
  }
}