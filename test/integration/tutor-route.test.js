/**
 * IT-TUTOR-01..06（06 §2 FR-11 / FR-12；04 §5.7 / §4.2 #27-30，t20）。
 *
 * fake host + 真 HTTP：GET /tutor 自动建路径 → 重新开始 → 标记掌握/跳过 →
 * 就某一步提问（202 + 注入消息 + 线程）→ 未知/非法入参 → 重启后进度保留 → 工具信封。
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

async function startHost(workspace) {
  const host = createFakeHost()
  const dispose = apply(host.ctx, { workspaceRoot: workspace })
  const listening = await serveRoutes(host.state.routes)
  return {
    host,
    dispose,
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

async function json(response) {
  const body = await response.json()
  return { status: response.status, body }
}

describe('引导式学习的路由与进度（IT-TUTOR）', () => {
  let workspace
  let instance
  let base
  let bookId
  let stepIds = []
  let noMapBookId

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-tutor-http-'))
    instance = await startHost(workspace)
    base = instance.base

    const lantern = await readFile(path.join(fixtures, 'epub3-mini.epub'))
    const created = await json(
      await fetch(`${base}/books/import?name=lantern.epub`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: lantern,
      }),
    )
    assert.equal(created.status, 201)
    bookId = created.body.data.book.id

    const other = await readFile(path.join(fixtures, 'epub2-ncx.epub'))
    const second = await json(
      await fetch(`${base}/books/import?name=second.epub`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: other,
      }),
    )
    assert.equal(second.status, 201)
    noMapBookId = second.body.data.book.id

    const tool = instance.toolName('reading_map')
    const committed = await tool.execute(
      { action: 'commit', bookId, root: validTree() },
      { callId: 'c1', name: 'reading_map', agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(committed.ok, true, JSON.stringify(committed))
  })

  after(async () => {
    await instance.close()
    await new Promise((resolve) => setTimeout(resolve, 60))
    await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('IT-TUTOR-01 GET /tutor 首次自动建路径，第二次不再重建', async () => {
    const first = await json(await fetch(`${base}/books/${bookId}/tutor`))
    assert.equal(first.status, 200)
    const path0 = first.body.data
    assert.equal(path0.pathId, 'p-01')
    assert.equal(path0.goal, 'explain')
    assert.equal(path0.rebuilt, true)
    assert.equal(path0.steps.length, 2)
    assert.deepEqual(
      path0.steps.map((step) => step.title),
      ['The Lantern', '灯火与记忆'],
    )
    assert.equal(path0.steps[0].question, '灯笼象征什么？')
    assert.deepEqual(path0.steps[0].citations, ['c-000001'])
    assert.equal(path0.progress.total, 2)
    assert.equal(path0.progress.done, 0)
    assert.equal(path0.currentStepId, 's-01')
    stepIds = path0.steps.map((step) => step.id)
    assert.deepEqual(stepIds, ['s-01', 's-02'])

    const second = await json(await fetch(`${base}/books/${bookId}/tutor`))
    assert.equal(second.body.data.pathId, 'p-01')
    assert.equal(second.body.data.rebuilt, false)
  })

  it('IT-TUTOR-02 无导图的书返回 404 no-map', async () => {
    const response = await json(await fetch(`${base}/books/${noMapBookId}/tutor`))
    assert.equal(response.status, 404)
    assert.equal(response.body.error.code, 'E_NOT_FOUND')
    assert.equal(response.body.error.details.reason, 'no-map')
  })

  it('IT-TUTOR-03 POST /tutor 重新开始：pathId 递增、可换 goal、非法 goal 400', async () => {
    const invalid = await json(
      await fetch(`${base}/books/${bookId}/tutor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'coach' }),
      }),
    )
    assert.equal(invalid.status, 400)

    const restarted = await json(
      await fetch(`${base}/books/${bookId}/tutor`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ goal: 'quiz' }),
      }),
    )
    assert.equal(restarted.status, 201)
    assert.equal(restarted.body.data.pathId, 'p-02')
    assert.equal(restarted.body.data.goal, 'quiz')
    assert.equal(restarted.body.data.cursor, 0)
    assert.equal(
      restarted.body.data.steps.every((step) => step.state === 'pending'),
      true,
    )
  })

  it('IT-TUTOR-04 标记掌握推进游标；非法状态 400、未知步骤 404、坏 stepId 400', async () => {
    const marked = await json(
      await fetch(`${base}/books/${bookId}/tutor/steps/${stepIds[0]}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'mastered' }),
      }),
    )
    assert.equal(marked.status, 200)
    assert.equal(marked.body.data.cursor, 1)
    assert.equal(marked.body.data.progress.mastered, 1)
    assert.equal(marked.body.data.progress.percent, 50)
    assert.equal(marked.body.data.step.state, 'mastered')

    const invalid = await json(
      await fetch(`${base}/books/${bookId}/tutor/steps/${stepIds[1]}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'done' }),
      }),
    )
    assert.equal(invalid.status, 400)

    const unknown = await json(
      await fetch(`${base}/books/${bookId}/tutor/steps/s-99`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'mastered' }),
      }),
    )
    assert.equal(unknown.status, 404)

    const badId = await json(
      await fetch(`${base}/books/${bookId}/tutor/steps/step-1`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ state: 'mastered' }),
      }),
    )
    assert.equal(badId.status, 400)
    assert.equal(badId.body.error.details.field, 'stepId')
  })

  it('IT-TUTOR-05 就某一步提问：202 + 注入消息进入线程，步骤记为 answered', async () => {
    const answered = await json(
      await fetch(`${base}/books/${bookId}/tutor/steps/${stepIds[1]}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k-tutor-1' },
        body: JSON.stringify({ question: '为什么灯火能保存记忆？' }),
      }),
    )
    assert.equal(answered.status, 202)
    const result = answered.body.data
    assert.equal(result.step.id, stepIds[1])
    assert.equal(result.step.state, 'answered')
    assert.equal(result.step.attempts, 1)
    assert.match(result.threadId, /^t-\d{2}$/)
    assert.match(result.messageId, /^m-\d{2}$/)

    const injected = instance.host.state.injected.at(-1)
    assert.equal(injected.source.kind, 'reading-lab')
    assert.equal(injected.source.form, 'ask')
    assert.equal(injected.source.threadId, result.threadId)
    const text = injected.content.map((block) => block.text).join('\n')
    assert.match(text, /thread=t-\d{2}/)
    assert.match(text, /为什么灯火能保存记忆/)

    // 线程里已经有这条 user 消息；步骤指向同一条线程。
    const threads = await json(await fetch(`${base}/books/${bookId}/threads`))
    const thread = threads.body.data.threads.find((candidate) => candidate.id === result.threadId)
    assert.ok(thread)
    assert.equal(thread.scope.nodeId, result.step.nodeId)
    assert.equal(thread.messages[0].role, 'user')
    assert.equal(thread.messages[0].status, 'pending')

    const empty = await json(
      await fetch(`${base}/books/${bookId}/tutor/steps/${stepIds[0]}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: '   ' }),
      }),
    )
    assert.equal(empty.status, 400)
  })

  it('IT-TUTOR-06 重启后进度保留；reading_tutor 工具返回信封', async () => {
    const second = await startHost(workspace)
    try {
      const resumed = await json(await fetch(`${second.base}/books/${bookId}/tutor`))
      assert.equal(resumed.status, 200)
      assert.equal(resumed.body.data.pathId, 'p-02')
      assert.equal(resumed.body.data.rebuilt, false)
      const mastered = resumed.body.data.steps.find((step) => step.id === stepIds[0])
      assert.equal(mastered.state, 'mastered')
      const answered = resumed.body.data.steps.find((step) => step.id === stepIds[1])
      assert.equal(answered.state, 'answered')
      assert.equal(answered.attempts, 1)
      assert.equal(resumed.body.data.progress.mastered, 1)
    } finally {
      await second.close()
      await new Promise((resolve) => setTimeout(resolve, 60))
    }

    const tool = instance.toolName('reading_tutor')
    assert.ok(tool)
    const plan = await tool.execute(
      { action: 'plan', bookId },
      { callId: 'c2', name: 'reading_tutor', agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(plan.ok, true, JSON.stringify(plan))
    assert.equal(plan.data.pathId, 'p-02')
    const rendered = tool.output.render({ action: 'plan', bookId }, plan)
    assert.ok(Array.isArray(rendered) && rendered.length >= 1)
    assert.match(rendered[0].text, /学习路径 p-02/)

    const invalid = await tool.execute(
      { bookId },
      { callId: 'c3', name: 'reading_tutor', agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(invalid.ok, true, '默认 action=plan 应可用')
  })
})