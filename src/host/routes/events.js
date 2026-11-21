/**
 * 事件流路由（owner: api，docs/04-api.md §6.2）。
 *
 * `GET /events` 是 M1 唯一「真能用」的链路之一：首帧 hello 带全量书库快照，
 * 之后按 200 ms 节流推送事件，15 s 一次 ping。
 */
import { openStream } from '../sse.js'

/**
 * @param {{ req: any, res: any }} context
 * @param {{ hub: import('../sse.js').EventHub, limits: Record<string, number>, books: import('../books.js').BookService }} services
 */
export async function handleEventRoutes(context, services) {
  await openStream(context.req, context.res, {
    hub: services.hub,
    limits: services.limits,
    snapshot: () => services.books.listForHello(services.limits.helloBooksLimit ?? 200),
  })
}