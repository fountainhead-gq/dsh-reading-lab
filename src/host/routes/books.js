/**
 * 书库路由（owner: store，docs/03-design.md §2.2）。
 *
 * M1 只有 `GET /books` 是真的（读 `reading/index.json`），单书相关一律
 * `E_NOT_IMPLEMENTED`，由 04 §7 映射成 501。路径与 id 校验已在 `routes.js` 完成。
 */
import { notImplemented } from '../errors.js'
import { API_BASE } from '../limits.js'

/** 带请求体的方法要把 body 读干净，否则 keep-alive 上会串包。 */
function drain(req) {
  req.resume?.()
}

/**
 * @param {{ method: string, params: Record<string, string>, url: URL, req: any }} context
 * @param {{ books: import('../books.js').BookService }} services
 */
export async function handleBookRoutes(context, services) {
  const { method, params, url } = context
  const prefix = `${API_BASE}/books/${encodeURIComponent(params.bookId)}`
  const suffix = url.pathname.slice(prefix.length) || '/'

  if (method === 'GET' && suffix === '/') {
    await services.books.get(params.bookId)
    return
  }
  if (method === 'PATCH' && suffix === '/') {
    drain(context.req)
    await services.books.rename(params.bookId)
    return
  }
  if (method === 'DELETE' && suffix === '/') {
    drain(context.req)
    await services.books.remove(params.bookId)
    return
  }
  if (method === 'POST' && suffix === '/retry') {
    drain(context.req)
    await services.books.retry(params.bookId)
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