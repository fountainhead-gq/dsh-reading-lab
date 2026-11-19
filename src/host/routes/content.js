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
import { readJsonBody, sendChunkPage } from './books.js'

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
    case 'GET /threads': {
      // 04 §4.2 #17：running 状态在进程重启后已由 readThreads 降级；节点被删的线程带 orphaned。
      sendOk(res, await services.ask.list(params.bookId))
      return
    }
    case 'POST /threads': {
      const body = await readJsonBody(context.req)
      const scope = body?.scope
      if (!scope || typeof scope !== 'object' || (scope.kind !== 'node' && scope.kind !== 'book')) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'scope', allowed: ['node', 'book'] })
      }
      sendOk(res, await services.ask.create(params.bookId, scope), 201)
      return
    }
    case `DELETE /threads/${params.threadId}`:
      sendOk(res, await services.ask.remove(params.bookId, params.threadId))
      return
    case 'POST /ask': {
      // 04 §4.2 #20：202 表示已入队；回答经 SSE `thread` 事件到达。
      const body = await readJsonBody(context.req)
      if (body?.threadId !== undefined && body?.threadId !== null && typeof body.threadId !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'threadId' })
      }
      if (body?.nodeId !== undefined && body?.nodeId !== null && typeof body.nodeId !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'nodeId' })
      }
      if (body?.agentId !== undefined && body?.agentId !== null && typeof body.agentId !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'agentId' })
      }
      if (typeof body?.question !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'question' })
      }
      const idempotencyKey = context.req?.headers?.['idempotency-key']
      const result = await services.ask.ask({
        bookId: params.bookId,
        threadId: body.threadId ?? null,
        nodeId: body.nodeId ?? null,
        question: body.question,
        agentId: body.agentId ?? null,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
      })
      sendOk(res, result, 202)
      return
    }
    case `POST /threads/${params.threadId}/stop`:
      sendOk(res, await services.ask.stop(params.bookId, params.threadId))
      return
    case `POST /threads/${params.threadId}/messages/${params.messageId}/feedback`: {
      // 反馈（t15 追加，04 §4.2 #26）：`up` / `down` / `null`（再点一次取消）。
      const body = await readJsonBody(context.req)
      const feedback = body?.feedback
      if (feedback !== null && feedback !== 'up' && feedback !== 'down') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'feedback', allowed: ['up', 'down', null] })
      }
      const updated = await services.ask.feedback(
        params.bookId,
        params.threadId,
        params.messageId,
        feedback,
      )
      sendOk(res, updated.message)
      return
    }
    case 'POST /export': {
      // 04 §4.2 #22（v0.2，t16）：生成 md/opml/json；html/png 属 v0.3。
      const body = await readJsonBody(context.req)
      const format = body?.format === undefined ? 'md' : body.format
      if (typeof format !== 'string' || format.trim() === '') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'format', allowed: ['md', 'opml', 'json'] })
      }
      if (body?.includeThreads !== undefined && typeof body.includeThreads !== 'boolean') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'includeThreads' })
      }
      const result = await services.exports.create({
        bookId: params.bookId,
        format,
        includeThreads: body?.includeThreads === true,
      })
      sendOk(res, result)
      return
    }
    case 'GET /tutor': {
      // 04 §5.7（v0.3，t20）：首次打开自动建路径；导图更新后重建并迁移掌握状态。
      sendOk(res, await services.tutor.get(params.bookId))
      return
    }
    case 'POST /tutor': {
      // 重新开始一条路径；body.goal 可选（explain|quiz|socratic）。
      const body = await readJsonBody(context.req)
      if (body?.goal !== undefined && typeof body.goal !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'goal' })
      }
      sendOk(res, await services.tutor.restart(params.bookId, { goal: body?.goal }), 201)
      return
    }
    case `POST /tutor/steps/${params.stepId}`: {
      const body = await readJsonBody(context.req)
      const state = body?.state
      if (typeof state !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'state', allowed: ['pending', 'answered', 'mastered', 'skipped'] })
      }
      sendOk(res, await services.tutor.mark(params.bookId, params.stepId, state))
      return
    }
    case `POST /tutor/steps/${params.stepId}/answer`: {
      // 202：问题已进线程，回答经 SSE `thread` 事件到达。
      const body = await readJsonBody(context.req)
      if (body?.agentId !== undefined && body?.agentId !== null && typeof body.agentId !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'agentId' })
      }
      if (typeof body?.question !== 'string') {
        throw new ReadingError('E_BAD_REQUEST', { field: 'question' })
      }
      const idempotencyKey = context.req?.headers?.['idempotency-key']
      const result = await services.tutor.answer(params.bookId, {
        stepId: params.stepId,
        question: body.question,
        agentId: body.agentId ?? null,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : null,
      })
      sendOk(res, result, 202)
      return
    }
    default:
      throw notImplemented('routes.content', `no handler for ${method} ${suffix}`)
  }
}