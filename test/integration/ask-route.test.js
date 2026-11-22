/**
 * IT-ASK-01..05 / IT-C06（06-test.md §2 FR-11；04 §4.2 #17-21、#26）。
 *
 * fake host + 真 HTTP：线程 CRUD → 提问入队（202）→ `session/event` 回写 →
 * 引用净化 → 反馈持久化 → 停止 → 超时置 failed（可观测，不静默）。
 */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const SUMMARY = '导图节点摘要'.repeat(10).slice(0, 60)
/**
 * 状态收敛窗口（QA-44-02）。
 *
 * 轮询窗口是为了等「磁盘状态稳定」，不是断言产品延迟。固定 1.5 s / 400 ms 在满载
 * （8 份 verify 并发）时会因调度抖动偶发红（9/10 绿，已定性非竞态），所以按
 * RL_SSE_WINDOW_MS 的同一约定改成可配置：默认值放宽，环境变量可覆写，不靠加 sleep。
 */
const WAIT_STATE_MS = positiveInt(process.env.RL_WAIT_STATE_MS, 5_000)
const WAIT_THREAD_MS = positiveInt(process.env.RL_WAIT_THREAD_MS, 15_000)
const WAIT_INTERVAL_MS = 25

function positiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

async function waitUntil(predicate, { timeoutMs = WAIT_STATE_MS, intervalMs = WAIT_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() >= deadline) return null
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

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
      warn: (message) => state.warnings.push(String(message)),
      error: (message) => state.warnings.push(String(message)),
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(listener)
      return () => listeners.get(name)?.delete(listener)
    },
    emit(name, ...args) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener(...args)
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

const BLOCKED_PORTS = new Set([5060, 5061, 6000, 6665, 6666, 6667, 6668, 6669, 6679, 6697])

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
  // undici（fetch）拒绝连某些「bad port」；listen(0) 可能正好抽到，抽到就重开。
  return new Promise((resolve) => {
    const listen = () => {
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port
        if (BLOCKED_PORTS.has(port)) {
          server.close(() => listen())
          return
        }
        resolve({ server, port })
      })
    }
    listen()
  })
}

async function startHost(workspace, options = {}) {
  const host = createFakeHost()
  if (options.noAgent) host.ctx.agents = { get: () => undefined, list: () => [] }
  const config = { workspaceRoot: workspace }
  if (options.askTimeoutMs) config.askTimeoutMs = options.askTimeoutMs
  const dispose = apply(host.ctx, config)
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
            questions: ['记忆如何被保存？', '灯火为什么重要？'],
          },
        ],
      },
    ],
  }
}

async function json(response) {
  const body = await response.json()
  return { status: response.status, body }
}

/**
 * 等线程回到 idle（QA-35-05）。
 *
 * 写入路径是「消息 → 线程状态」两次落盘加一次索引更新，满载（64 个测试文件
 * 并行）时可能超过 1s；早先的用例用固定 1s 轮询，超时后下一条用例还会因为
 * 线程仍是 running 合法地拿到 409。这里把等待抽成显式的、足够宽的条件等待，
 * 产品语义（同线程 running → 409）保持不变。
 */
async function waitForThread({
  base,
  bookId,
  threadId,
  predicate,
  timeoutMs = WAIT_THREAD_MS,
  intervalMs = WAIT_INTERVAL_MS,
}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    const listed = await json(await fetch(`${base}/books/${bookId}/threads`))
    const thread = listed.body.data.threads.find((item) => item.id === threadId) ?? null
    last = thread
    if (thread && predicate(thread)) return thread
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return last
}

describe('询问 AI 的路由与回写（IT-ASK / IT-C06）', () => {
  let workspace
  let instance
  let base
  let bookId
  let nodeId

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-ask-http-'))
    instance = await startHost(workspace)
    base = instance.base

    const bytes = await readFile(path.join(fixtures, 'epub3-mini.epub'))
    const created = await json(
      await fetch(`${base}/books/import?name=lantern.epub`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
      }),
    )
    assert.equal(created.status, 201)
    bookId = created.body.data.book.id

    // 先落一张真导图：POST /ask 要按 nodeId 找节点标题与引用块。
    const tool = instance.toolName('reading_map')
    const committed = await tool.execute(
      { action: 'commit', bookId, root: validTree() },
      { callId: 'c1', name: 'reading_map', agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(committed.ok, true, JSON.stringify(committed))

    const map = await json(await fetch(`${base}/books/${bookId}/map`))
    assert.equal(map.status, 200)
    const root = map.body.data.root
    nodeId = root.children[0].children[0].id
    assert.match(nodeId, /^n-[0-9a-f]{8}/)
  })

  after(async () => {
    await instance.close()
    await new Promise((resolve) => setTimeout(resolve, 60))
    await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('IT-ASK-01 GET /threads 空结构 → POST /threads 补 nodeTitle → 201', async () => {
    const empty = await json(await fetch(`${base}/books/${bookId}/threads`))
    assert.equal(empty.status, 200)
    assert.equal(empty.body.data.bookId, bookId)
    assert.deepEqual(empty.body.data.threads, [])

    const invalid = await json(
      await fetch(`${base}/books/${bookId}/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: { kind: 'page' } }),
      }),
    )
    assert.equal(invalid.status, 400)

    const unknownNode = await json(
      await fetch(`${base}/books/${bookId}/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: { kind: 'node', nodeId: 'n-deadbeef' } }),
      }),
    )
    assert.equal(unknownNode.status, 400)

    const created = await json(
      await fetch(`${base}/books/${bookId}/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: { kind: 'node', nodeId } }),
      }),
    )
    assert.equal(created.status, 201)
    assert.equal(created.body.data.id, 't-01')
    assert.equal(created.body.data.scope.nodeId, nodeId)
    assert.equal(created.body.data.scope.nodeTitle, '灯火与记忆')
    assert.equal(created.body.data.state, 'idle')
  })

  it('IT-ASK-02 POST /ask → 202，注入的 user 消息带 form=ask 与线程关联；重复提问 409', async () => {
    const sent = await json(
      await fetch(`${base}/books/${bookId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k-1' },
        body: JSON.stringify({ threadId: 't-01', question: '灯火为什么重要？' }),
      }),
    )
    assert.equal(sent.status, 202)
    assert.equal(sent.body.data.threadId, 't-01')
    assert.equal(sent.body.data.agentId, 'agent-main')

    const message = instance.host.state.injected.at(-1)
    assert.equal(message.source.kind, 'reading-lab')
    assert.equal(message.source.form, 'ask')
    assert.equal(message.source.threadId, 't-01')
    assert.equal(message.source.bookId, bookId)
    const text = message.content.map((part) => part.text).join('\n')
    assert.match(text, /<!-- reading-lab thread=t-01 message=m-01 -->/)
    assert.match(text, /我的问题：灯火为什么重要？/)
    assert.match(text, /\[c-00000[12]\]/)

    const running = await json(await fetch(`${base}/books/${bookId}/threads`))
    const thread = running.body.data.threads.find((item) => item.id === 't-01')
    assert.equal(thread.state, 'running')
    assert.equal(thread.messages[0].status, 'pending')
    assert.equal(thread.messages[0].feedback, null)

    const conflict = await json(
      await fetch(`${base}/books/${bookId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: 't-01', question: '再问一次' }),
      }),
    )
    assert.equal(conflict.status, 409)
    assert.equal(conflict.body.error.code, 'E_BUSY')
  })

  it('IT-ASK-03 assistant/message 回写：引用只留合法块，线程回 idle', async () => {
    instance.host.ctx.emit('session/event', { id: 'session-1' }, {
      type: 'assistant/message',
      data: {
        message: {
          id: 'msg-answer-1',
          content: [
            { type: 'text', text: '灯火是记忆的容器，见 [c-000001]；不存在 [c-777777]。' },
          ],
        },
      },
    })

    // QA-35-05：写回是两次落盘 + 索引更新，满载时 1s 不够；等到条件成立为止。
    const thread = await waitForThread({
      base,
      bookId,
      threadId: 't-01',
      predicate: (item) => item.messages.length === 2 && item.state === 'idle',
    })
    assert.ok(
      thread && thread.messages.length === 2 && thread.state === 'idle',
      `回答没有回写进 threads.json：${JSON.stringify(thread)}`,
    )
    const answer = thread.messages[1]
    assert.equal(answer.role, 'assistant')
    assert.equal(answer.status, 'done')
    assert.equal(answer.messageId, 'msg-answer-1')
    assert.deepEqual(answer.citations, [{ chunkId: 'c-000001' }])
    assert.equal(thread.state, 'idle')
  })

  it('IT-ASK-04 👍/👎 落盘且可取消；未知消息 404', async () => {
    const up = await json(
      await fetch(`${base}/books/${bookId}/threads/t-01/messages/m-02/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'up' }),
      }),
    )
    assert.equal(up.status, 200)
    assert.equal(up.body.data.feedback, 'up')

    const cleared = await json(
      await fetch(`${base}/books/${bookId}/threads/t-01/messages/m-02/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: null }),
      }),
    )
    assert.equal(cleared.body.data.feedback, null)

    const invalid = await json(
      await fetch(`${base}/books/${bookId}/threads/t-01/messages/m-02/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'meh' }),
      }),
    )
    assert.equal(invalid.status, 400)

    const missing = await json(
      await fetch(`${base}/books/${bookId}/threads/t-01/messages/m-99/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feedback: 'up' }),
      }),
    )
    assert.equal(missing.status, 404)

    // 持久化：重新读线程仍在
    const reloaded = await json(await fetch(`${base}/books/${bookId}/threads`))
    const thread = reloaded.body.data.threads.find((item) => item.id === 't-01')
    assert.equal(thread.messages[1].feedback, null)
  })

  it('IT-ASK-05 stop 把未完成消息标 stopped；删除线程后 404', async () => {
    // QA-35-05：如果上一条用例的写回还在落盘，线程仍是 running，409 是**正确**
    // 的产品行为；这里先显式等到 idle，避免把时序问题误判成产品缺陷。
    const idle = await waitForThread({
      base,
      bookId,
      threadId: 't-01',
      predicate: (item) => item.state === 'idle',
    })
    assert.equal(idle.state, 'idle', '前置条件：线程必须在空闲态才能再问')

    const sent = await json(
      await fetch(`${base}/books/${bookId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: 't-01', question: '再追问一句' }),
      }),
    )
    assert.equal(sent.status, 202)

    const stopped = await json(
      await fetch(`${base}/books/${bookId}/threads/t-01/stop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    assert.equal(stopped.status, 200)
    assert.equal(stopped.body.data.state, 'idle')
    assert.ok(stopped.body.data.messages.every((message) => message.status !== 'pending'))

    const removed = await json(await fetch(`${base}/books/${bookId}/threads/t-01`, { method: 'DELETE' }))
    assert.equal(removed.status, 200)
    assert.deepEqual(removed.body.data, { deleted: true })

    const again = await json(await fetch(`${base}/books/${bookId}/threads/t-01`, { method: 'DELETE' }))
    assert.equal(again.status, 404)
  })
})

describe('没有回答时的兜底（IT-ASK-06）', () => {
  it('超时把消息置 failed 并记原因（不静默悬挂）', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'rl-ask-timeout-'))
    const instance = await startHost(workspace, { askTimeoutMs: 80 })
    try {
      const bytes = await readFile(path.join(fixtures, 'epub3-mini.epub'))
      const created = await json(
        await fetch(`${instance.base}/books/import?name=lantern.epub`, {
          method: 'POST',
          headers: { 'content-type': 'application/octet-stream' },
          body: bytes,
        }),
      )
      const bookId = created.body.data.book.id
      const sent = await json(
        await fetch(`${instance.base}/books/${bookId}/ask`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: '整本书讲了什么？' }),
        }),
      )
      assert.equal(sent.status, 202)

      const file = path.join(workspace, 'reading', 'books', bookId, 'threads.json')
      // 失败回写是两次落盘（消息 → 线程状态），两件都到位才算完成。
      const failed = await waitUntil(async () => {
        const loaded = JSON.parse(await readFile(file, 'utf8'))
        const message = loaded.threads[0]?.messages?.[0]
        return message && message.status === 'failed' && loaded.threads[0].state === 'idle' ? message : null
      })
      assert.ok(failed, `超时后消息没有置 failed（窗口 ${WAIT_STATE_MS} ms）`)
      assert.equal(failed.error, 'E_AGENT')
      const final = JSON.parse(await readFile(file, 'utf8'))
      assert.equal(final.threads[0].state, 'idle')
      // 失败日志在两次落盘之后写：轮询等它出现，避免和磁盘状态抢跑。
      const warned = await waitUntil(() =>
        instance.host.state.warnings.some((line) => /ask 失败/.test(line)),
      )
      assert.ok(warned, instance.host.state.warnings.join('\n'))
    } finally {
      await instance.close()
      // 失败回写的落盘可能还在进行：等一拍再删，避免 Windows 上 ENOTEMPTY。
      await new Promise((resolve) => setTimeout(resolve, 60))
      await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })
})