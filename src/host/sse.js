/**
 * 事件总线与 SSE（docs/04-api.md §3.6、§6.1、§6.2）。
 *
 * - 进程内 pub/sub，不持久化；断线由 `hello` 全量快照兜底；
 * - 同一 `(type, bookId)` 200 ms 内合并：先到的立即发，后来的留一个 trailing 定时器；
 * - SSE 每 15 s 一行 `: ping`，60 s 无写主动断开，`req.close` 时清理订阅。
 */
import { API_VERSION } from './limits.js'

/** 事件类型白名单（04 §6.1）。 */
export const EVENT_TYPES = Object.freeze(['book', 'progress', 'map', 'notes', 'thread', 'export'])

export class EventHub {
  /**
   * @param {{ throttleMs?: number, now?: () => number }} [options]
   */
  constructor(options) {
    this.throttleMs = typeof options?.throttleMs === 'number' ? options.throttleMs : 200
    this.now = options?.now ?? Date.now
    this.revision = 0
    /** @type {Set<(event: { type: string, revision: number }) => void>} */
    this.listeners = new Set()
    /** @type {Map<string, number>} */
    this.lastEmitAt = new Map()
    /** @type {Map<string, { timer: any, event: any }>} */
    this.trailing = new Map()
    this.closed = false
  }

  /** 订阅；返回取消函数。 */
  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function')
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get subscriberCount() {
    return this.listeners.size
  }

  /**
   * 发布事件。返回是否立即发出（false 表示被节流合并）。
   * @param {{ type: string } & Record<string, unknown>} event
   */
  publish(event) {
    if (this.closed) return false
    if (!event || typeof event.type !== 'string' || !EVENT_TYPES.includes(event.type)) {
      throw new TypeError(`unknown event type: ${String(event?.type)}`)
    }
    const key = `${event.type}:${typeof event.bookId === 'string' ? event.bookId : ''}`
    const now = this.now()
    const last = this.lastEmitAt.get(key)
    if (last !== undefined && now - last < this.throttleMs) {
      const pending = this.trailing.get(key)
      if (pending) {
        pending.event = event
        return false
      }
      const delay = Math.max(0, this.throttleMs - (now - last))
      const entry = { event, timer: null }
      entry.timer = setTimeout(() => {
        this.trailing.delete(key)
        if (entry.event) this.emit(entry.event)
      }, delay)
      entry.timer.unref?.()
      this.trailing.set(key, entry)
      return false
    }
    this.emit(event)
    return true
  }

  /** 立即广播（不做节流）。 */
  emit(event) {
    if (this.closed) return
    this.revision += 1
    this.lastEmitAt.set(`${event.type}:${typeof event.bookId === 'string' ? event.bookId : ''}`, this.now())
    const envelope = { ...event, revision: this.revision }
    for (const listener of [...this.listeners]) {
      try {
        listener(envelope)
      } catch {
        // 单个订阅者出错不能影响其它连接。
      }
    }
  }

  /** 插件卸载：清定时器、断开所有连接（由 openStream 注册的 closeAll 回调负责关流）。 */
  close() {
    this.closed = true
    for (const { timer } of this.trailing.values()) clearTimeout(timer)
    this.trailing.clear()
    this.listeners.clear()
    for (const closer of this.closeHandlers ?? []) {
      try {
        closer()
      } catch {
        // ignore
      }
    }
    this.closeHandlers = []
  }
}

function frame(event, id, data) {
  return `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * 打开一条 SSE 连接。
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ hub: EventHub, limits: Record<string, number>, snapshot: () => Promise<{ books: unknown[] }>, now?: () => number }} options
 * @returns {Promise<void>} 连接结束时 resolve
 */
export async function openStream(req, res, options) {
  const { hub, limits } = options
  const pingMs = limits.ssePingMs ?? 15_000
  const idleMs = limits.sseIdleTimeoutMs ?? 60_000

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // 关掉代理缓冲，否则事件会被攒着一起发。
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()

  const snapshot = await options.snapshot()
  const anyParsing = snapshot.books.some((book) => book && typeof book === 'object' && book.status === 'parsing')
  let lastWrite = Date.now()
  let closed = false

  const write = (chunk) => {
    if (closed) return
    try {
      res.write(chunk)
      lastWrite = Date.now()
    } catch {
      cleanup()
    }
  }

  write(
    frame('hello', hub.revision, {
      apiVersion: API_VERSION,
      revision: hub.revision,
      anyParsing,
      books: snapshot.books,
    }),
  )

  const unsubscribe = hub.subscribe((event) => {
    const payload = { ...event }
    delete payload.type
    delete payload.revision
    write(frame(event.type, event.revision, payload))
  })

  // 心跳兼做空闲看门狗：正常节奏下 ping(15 s) < idle(60 s)，写会不断刷新 lastWrite，
  // 所以这个分支只会在定时器被系统挂起（休眠/长时间 GC）后补跑时触发。
  const pingTimer = setInterval(() => {
    if (Date.now() - lastWrite > idleMs) {
      cleanup()
      try {
        res.end()
      } catch {
        // 已经断开
      }
      return
    }
    write(': ping\n\n')
  }, pingMs)
  pingTimer.unref?.()

  function cleanup() {
    if (closed) return
    closed = true
    unsubscribe()
    clearInterval(pingTimer)
    hub.closeHandlers = (hub.closeHandlers ?? []).filter((fn) => fn !== cleanup)
  }

  hub.closeHandlers = [...(hub.closeHandlers ?? []), () => {
    cleanup()
    try {
      res.end()
    } catch {
      // 已经断开
    }
  }]

  req.on('close', cleanup)
  req.on('aborted', cleanup)

  await new Promise((resolve) => {
    res.on('close', () => {
      cleanup()
      resolve()
    })
  })
}