import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'

import { API_BASE } from '../../src/host/limits.js'
import { EventHub, openStream } from '../../src/host/sse.js'
import { makeRoutes } from '../../src/host/routes.js'

/**
 * 降级与流式路径：这些分支手工很难触发，但正是 04 §4.2、§6.2、§7 的验收点。
 * 用假 req/res 直接驱动导出的路由与 openStream，不经过真 socket。
 */

/** 记录状态的假 ServerResponse（够 routes.js / sse.js 用）。 */
function createRes() {
  const res = new EventEmitter()
  res.status = 0
  res.headers = {}
  res.chunks = []
  res.ended = false
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = { ...headers }
    return res
  }
  res.setHeader = (name, value) => {
    res.headers[name] = value
  }
  res.write = (chunk) => {
    res.chunks.push(String(chunk))
    return true
  }
  res.end = (chunk) => {
    if (chunk !== undefined) res.chunks.push(String(chunk))
    res.ended = true
    res.emit('close')
  }
  res.destroy = () => {
    res.ended = true
  }
  res.body = () => JSON.parse(res.chunks.join(''))
  return res
}

function createReq(url, method = 'GET', headers = {}) {
  const req = new EventEmitter()
  req.url = url
  req.method = method
  req.headers = headers
  req.resume = () => {}
  return req
}

function baseServices(overrides = {}) {
  return {
    books: { list: async () => ({ books: [], revision: 0 }) },
    hub: new EventHub(),
    limits: { ssePingMs: 15_000, sseIdleTimeoutMs: 60_000, exportFormats: ['md', 'opml', 'json'] },
    storage: { available: true },
    root: '.',
    rootName: 'workspace',
    toolNames: ['reading_import'],
    ...overrides,
  }
}

async function call(routes, req, res) {
  for (const route of routes) {
    if (req.url.startsWith(route.path)) {
      route.handler(req, res)
      // 路由 handler 内部是 async，等一个宏任务让 sendJson 落盘。
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  return res
}

describe('/health 降级（存储不可用）', () => {
  it('返回 503，body 同时带 data 与 error', async () => {
    const services = baseServices({ storage: { available: false } })
    const res = await call(makeRoutes(services), createReq(`${API_BASE}/health`), createRes())

    assert.equal(res.status, 503)
    const body = res.body()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'E_IO')
    assert.equal(body.error.details.op, 'storage')
    assert.equal(typeof body.error.requestId, 'string')
    // Client 要靠 data 显示只读态，所以 503 也必须带 data。
    assert.equal(body.data.storage, 'unavailable')
    assert.equal(body.data.capabilities.sse, true)
  })
})

describe('未知异常映射', () => {
  it('业务层抛出的普通异常映射成 E_IO，且不泄露 message/堆栈', async () => {
    const services = baseServices({
      books: {
        list: async () => {
          throw new TypeError('boom: /secret/path/leaked')
        },
      },
    })
    const res = await call(makeRoutes(services), createReq(`${API_BASE}/books`), createRes())

    assert.equal(res.status, 500)
    const body = res.body()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'E_IO')
    assert.doesNotMatch(body.error.message, /boom|secret|leaked/i)
    assert.equal(body.error.details, undefined)
  })
})

describe('SSE 心跳与空闲断开', () => {
  it('按 ssePingMs 写 `: ping` 注释帧', async () => {
    const hub = new EventHub()
    const req = createReq(`${API_BASE}/events`)
    const res = createRes()
    const stream = openStream(req, res, {
      hub,
      limits: { ssePingMs: 10, sseIdleTimeoutMs: 5_000 },
      snapshot: async () => ({ books: [] }),
    })

    await new Promise((resolve) => setTimeout(resolve, 40))
    const text = res.chunks.join('')
    assert.match(text, /^event: hello\n/)
    assert.ok(text.includes(': ping\n\n'), 'expected a ping comment frame')

    // 事件帧：type 走 event 名，payload 里不重复 type/revision 之外的内部字段。
    hub.publish({ type: 'book', bookId: 'b0123456789ab', status: 'ready' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.match(res.chunks.join(''), /event: book\n/)

    res.emit('close')
    await stream
    assert.equal(hub.subscriberCount, 0)
  })

  it('心跳超过空闲阈值时主动断开（guard 分支）', async () => {
    const hub = new EventHub()
    const req = createReq(`${API_BASE}/events`)
    const res = createRes()
    // 正常情况下 ping(15 s) < idle(60 s)，这个分支不会走到；它保护的是定时器被挂起
    // 或事件循环长时间阻塞的情形。把 idle 压到 ping 以下即可稳定触达。
    const stream = openStream(req, res, {
      hub,
      limits: { ssePingMs: 10, sseIdleTimeoutMs: 5 },
      snapshot: async () => ({ books: [] }),
    })

    await stream
    assert.equal(res.ended, true)
    assert.equal(hub.subscriberCount, 0)
  })
})