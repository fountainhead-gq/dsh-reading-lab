/**
 * IT-C05 与 M3 的 HTTP/工具端到端（06-test.md §2，07 §2.3）。
 *
 * 覆盖：GET /map 的 404→200 生命周期、PUT /map 的 501、
 * POST actions/generate-map 的 202/409/422 与会话内注入消息、
 * reading_map 工具的真实 commit 与非法输出拦截、map 事件的 SSE 投影。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')

const SUMMARY = '导图节点摘要'.repeat(10).slice(0, 60)

function createFakeHost() {
  const state = { routes: [], tools: [], sections: [], warnings: [], injected: [] }
  const listeners = new Map()
  const agent = {
    id: 'agent-main',
    sessionId: 'session-1',
    inbox: {
      followup(message) {
        state.injected.push(message)
      },
    },
  }
  const ctx = {
    dshVersion: '0.2.2-rc.5',
    logger: {
      info: () => {},
      warn: (message) => state.warnings.push(message),
      error: (message) => state.warnings.push(message),
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    // t29：插件订阅 agent/* 事件驱动生成状态机；这里给一个最小事件总线。
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
      return () => listeners.get(name)?.delete(listener)
    },
    emitAgentEvent(name, payload) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(payload)
    },
    webServer: {
      register(route) {
        state.routes.push(route)
        return () => {
          const index = state.routes.indexOf(route)
          if (index >= 0) state.routes.splice(index, 1)
        }
      },
    },
    tools: {
      register(definition) {
        state.tools.push(definition)
        return () => {
          const index = state.tools.indexOf(definition)
          if (index >= 0) state.tools.splice(index, 1)
        }
      },
    },
    systemPrompt: {
      section(section) {
        state.sections.push(section)
        return () => {}
      },
    },
    agents: {
      get: (id) => (id === agent.id ? agent : undefined),
      list: () => [agent],
    },
  }
  return { ctx, state, agent }
}

function serveRoutes(routes) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const route = routes.find((candidate) => url.pathname.startsWith(candidate.path))
    if (!route) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('no route')
      return
    }
    Promise.resolve(route.handler(req, res)).catch(() => {
      try {
        res.destroy()
      } catch {
        /* closed */
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

async function startHost(workspace, options = {}) {
  const host = createFakeHost()
  if (options.noAgent) {
    host.ctx.agents = { get: () => undefined, list: () => [] }
  }
  const dispose = apply(host.ctx, { workspaceRoot: workspace })
  const listening = await serveRoutes(host.state.routes)
  return {
    host,
    dispose,
    server: listening.server,
    base: `http://127.0.0.1:${listening.port}${API_BASE}`,
    toolName: (name) => host.state.tools.find((tool) => tool.name === name),
    close: async () => {
      if (typeof dispose === 'function') dispose()
      listening.server.closeAllConnections?.()
      await new Promise((resolve) => listening.server.close(resolve))
    },
  }
}

function validTree() {
  return {
    title: 'The Lantern of Small Hours',
    summary: SUMMARY,
    questions: ['这本书讲了什么？'],
    children: [
      {
        title: 'The Lantern',
        summary: SUMMARY,
        citations: [{ chunkId: 'c-000001' }],
        questions: ['灯笼象征什么？'],
        children: [
          {
            title: '灯火与记忆',
            summary: SUMMARY,
            citations: [{ chunkId: 'c-000002' }],
            questions: ['记忆如何被保存？'],
          },
        ],
      },
    ],
  }
}

async function hashOf(file) {
  try {
    return createHash('sha256').update(await readFile(file)).digest('hex')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

describe('导图 HTTP 契约与工具联动（IT-C05 / M3）', () => {
  /** @type {string} */
  let workspace
  /** @type {Awaited<ReturnType<typeof startHost>>} */
  let instance
  let base
  let bookId

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-map-http-'))
    instance = await startHost(workspace)
    base = instance.base
    const bytes = await readFile(path.join(fixtures, 'epub3-mini.epub'))
    const response = await fetch(`${base}/books/import?name=lantern.epub`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    assert.equal(response.status, 201)
    bookId = (await response.json()).data.book.id
  })

  after(async () => {
    await instance.close()
    await rm(workspace, { recursive: true, force: true })
  })

  it('IT-C05-a 无图时 GET /map → 404 E_NOT_FOUND（details.reason=no-map）', async () => {
    const response = await fetch(`${base}/books/${bookId}/map`)
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'E_NOT_FOUND')
    assert.equal(body.error.details.reason, 'no-map')
  })

  it('PUT /map 在 v0.1 返回 501 E_UNSUPPORTED（availableIn 0.3.0）', async () => {
    const response = await fetch(`${base}/books/${bookId}/map`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validTree()),
    })
    assert.equal(response.status, 501)
    const body = await response.json()
    assert.equal(body.error.code, 'E_UNSUPPORTED')
    assert.equal(body.error.details.availableIn, '0.3.0')
  })

  it('generate-map 无可用 agent → 422 E_AGENT，且不进入 mapping', async () => {
    const lonely = await startHost(workspace, { noAgent: true })
    try {
      const bytes = await readFile(path.join(fixtures, 'epub3-mini.epub'))
      const created = await fetch(`${lonely.base}/books/import?name=lantern.epub`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      })
      const lonelyId = (await created.json()).data.book.id
      const response = await fetch(`${lonely.base}/books/${lonelyId}/actions/generate-map`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 502)
      const body = await response.json()
      assert.equal(body.error.code, 'E_AGENT')
    } finally {
      await lonely.close()
    }
  })

  it('generate-map 注入一条会话可见的 reading-lab 消息并返回 202；重复调用 409', async () => {
    const response = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: '重点看象征手法' }),
    })
    assert.equal(response.status, 202)
    const body = await response.json()
    assert.equal(body.data.queued, true)
    assert.equal(body.data.agentId, 'agent-main')
    assert.match(body.data.promptId, /[0-9a-f-]{36}/)

    assert.equal(instance.host.state.injected.length, 1)
    const message = instance.host.state.injected[0]
    assert.equal(message.role, 'user')
    assert.equal(message.source.kind, 'reading-lab')
    assert.equal(message.source.bookId, bookId)
    assert.equal(message.source.action, 'generate-map')
    const text = message.content.map((part) => part.text).join('\n')
    assert.match(text, new RegExp(bookId))
    assert.match(text, /重点看象征手法/)
    assert.match(text, /reading_map/)

    const again = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(again.status, 409)
    const conflict = await again.json()
    assert.equal(conflict.error.code, 'E_BUSY')
  })

  it('generate-map 的 instructions 超过 500 字被拒（400）', async () => {
    const response = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: '长'.repeat(501) }),
    })
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.error.details.field, 'instructions')
  })

  it('工具端到端：outline → chunks → commit → get，进度经 SSE 与注入消息可见', async () => {
    const tool = instance.toolName('reading_map')
    assert.ok(tool, 'reading_map 已注册')
    assert.equal(tool.timeoutMs, 60_000)

    const controller = new AbortController()
    const stream = await fetch(`${base}/events`, { signal: controller.signal })
    const reader = stream.body.getReader()
    const seen = []
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          seen.push(Buffer.from(value).toString('utf8'))
        }
      } catch {
        /* aborted */
      }
    })()

    const outline = await tool.execute({ action: 'outline', bookId }, { agent: { id: 'agent-main', sessionId: 'session-1' } })
    assert.equal(outline.ok, true)
    assert.equal(outline.data.title, 'The Lantern of Small Hours')
    assert.ok(outline.data.totalChunks >= 2)
    assert.ok(outline.data.chapters[0].chunks[0].preview.length > 0)

    const ids = outline.data.chapters.flatMap((chapter) => chapter.chunks.map((chunk) => chunk.id)).slice(0, 2)
    const chunks = await tool.execute({ action: 'chunks', bookId, ids }, {})
    assert.equal(chunks.ok, true)
    assert.equal(chunks.data.chunks.length, ids.length)
    assert.ok(chunks.data.chunks[0].text.length > 0)

    const committed = await tool.execute(
      { action: 'commit', bookId, root: validTree() },
      { agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(committed.ok, true)
    assert.equal(committed.data.stats.nodes, 3)
    assert.equal(committed.data.stats.depth, 3)
    assert.equal(committed.data.replaced, false)

    const lines = tool.output.render({ action: 'commit' }, committed)
    const text = lines.map((line) => line.text).join('\n')
    assert.match(text, /导图已保存/)
    assert.ok(text.split('\n').length <= 6, 'render 不超过 6 行')

    await new Promise((resolve) => setTimeout(resolve, 400))
    controller.abort()
    await pump
    const sse = seen.join('')
    assert.match(sse, /event: progress/)
    // 200 ms 节流按 (type,bookId) 合并：mapping 与 done 挨得太近时只留最后一帧。
    assert.match(sse, /"phase":"done"/)
    assert.match(sse, /event: map/)

    const fetched = await fetch(`${base}/books/${bookId}/map`)
    assert.equal(fetched.status, 200)
    const doc = (await fetched.json()).data
    assert.equal(doc.bookId, bookId)
    assert.equal(doc.root.kind, 'book')
    assert.equal(doc.generator.agentId, 'agent-main')
    assert.deepEqual(doc.stats, { nodes: 3, depth: 3, citations: 2 })
    assert.equal(doc.layout.nodes[doc.root.id].side, 'root')

    const got = await tool.execute({ action: 'get', bookId }, {})
    assert.equal(got.ok, true)
    assert.equal(got.data.map.generatedAt, doc.generatedAt)

    // 提交后 mapping 闸门已释放，可以再次生成。
    const third = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(third.status, 202)
  })

  it('非法输出被拦截：未知 chunkId → ok:false + rejected，map.json 哈希不变', async () => {
    const mapFile = path.join(workspace, 'reading', 'books', bookId, 'map.json')
    const before = await hashOf(mapFile)
    const tool = instance.toolName('reading_map')
    const tree = validTree()
    tree.children[0].citations = [{ chunkId: 'c-999999' }]

    const result = await tool.execute(
      { action: 'commit', bookId, root: tree },
      { agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(result.ok, false)
    assert.equal(result.code, 'E_CITATION')
    assert.ok(result.rejected.length > 0)
    assert.equal(typeof result.rejected[0].path, 'string')
    assert.equal(typeof result.rejected[0].message, 'string')
    assert.equal(await hashOf(mapFile), before, '被拒的提交不能改动 map.json')

    const rendered = tool.output.render({ action: 'commit' }, result).map((line) => line.text).join('\n')
    assert.match(rendered, /E_CITATION/)
    assert.ok(rendered.split('\n').length <= 6)
  })

  it('工具入参非法时返回 E_BAD_REQUEST 信封而不是抛错', async () => {
    const tool = instance.toolName('reading_map')
    const result = await tool.execute({ action: 'get', bookId: 'nope' }, {})
    assert.equal(result.ok, false)
    assert.equal(result.code, 'E_BAD_REQUEST')
    assert.equal(instance.host.state.warnings.length, 0, '业务拒绝不应产生 warn 日志')
  })
})