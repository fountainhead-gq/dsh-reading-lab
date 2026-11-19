/**
 * t29 / QA-11-07：`generate-map` 的 202 之后必须可观测。
 *
 * 背景：`agent.followup()` 是 fire-and-forget，真实宿主上「注入成功但 agent
 * 根本没跑」有三种静默路径（无 provider/model 的 preStep 失败、消息从未被认领、
 * 回合结束却没提交导图）。本文件用 fake host 复现这三条，断言：
 *
 *   1. 状态查询能看到 pending → running → done/failed；
 *   2. 失败时 reason/message 同时出现在状态查询、SSE progress、日志三处；
 *   3. 超时不会永远 409 —— 记录进入 failed 后可以立即再发起一次。
 *
 * 真实宿主补充证据：qa-t29 宿主上 `GET /agents` 为空 → POST 直接 502 E_AGENT
 * （不是悬挂）；qa-v01 有 agent 但会话没有 provider，走的就是本文件的
 * `agent/error` 分支（`agent "<id>" has no provider/model`）。
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
  const state = { routes: [], tools: [], sections: [], warnings: [], infos: [], injected: [] }
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
      info: (message) => state.infos.push(message),
      warn: (message) => state.warnings.push(message),
      error: (message) => state.warnings.push(message),
    },
    effect(fn) {
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    // Cordis 的事件总线：t29 起插件订阅 agent/* 事件驱动生成状态机。
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
  return { ctx, state, agent, listeners }
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

async function startHost(workspace, config = {}) {
  const host = createFakeHost()
  const dispose = apply(host.ctx, { workspaceRoot: workspace, ...config })
  const listening = await serveRoutes(host.state.routes)
  return {
    host,
    dispose,
    server: listening.server,
    base: `http://127.0.0.1:${listening.port}${API_BASE}`,
    toolName: (name) => host.state.tools.find((tool) => tool.name === name),
    close: async () => {
      if (typeof dispose === 'function') dispose()
      // SSE 连接被 abort 之后服务端 socket 可能还挂着：不主动断开，
      // server.close() 会一直等，测试进程退不出去。
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
      },
    ],
  }
}

async function importBook(base) {
  const bytes = await readFile(path.join(fixtures, 'epub3-mini.epub'))
  const response = await fetch(`${base}/books/import?name=lantern.epub`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  })
  // 同一 workspace 里重复导入同一份夹具是 200（sha256 去重），首次是 201。
  assert.ok(response.status === 201 || response.status === 200, `unexpected ${response.status}`)
  return (await response.json()).data.book.id
}

/** 收集一段时间内的 SSE 帧。 */
async function captureSse(base, run) {
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
  await run()
  await new Promise((resolve) => setTimeout(resolve, 400))
  controller.abort()
  await pump
  return seen.join('')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

describe('generate-map 可观测性与看门狗（t29 / QA-11-07）', () => {
  /** @type {string} */
  let workspace
  /** @type {Awaited<ReturnType<typeof startHost>>} */
  let instance
  let base
  let bookId

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-gen-'))
    instance = await startHost(workspace)
    base = instance.base
    bookId = await importBook(base)
  })

  after(async () => {
    await instance.close()
    await rm(workspace, { recursive: true, force: true })
  })

  it('202 返回 state/statusUrl；未发起的书状态为 idle', async () => {
    const idle = await fetch(`${base}/books/${bookId}/actions/generate-map`)
    assert.equal(idle.status, 200)
    assert.equal((await idle.json()).data.state, 'idle')

    const response = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(response.status, 202)
    const body = (await response.json()).data
    assert.equal(body.queued, true)
    assert.equal(body.state, 'pending')
    assert.match(body.promptId, /[0-9a-f-]{36}/)
    assert.equal(body.statusUrl, `${API_BASE}/books/${bookId}/actions/generate-map`)
    assert.equal(body.timeoutMs, 180_000)

    const status = await fetch(`${base}/books/${bookId}/actions/generate-map`)
    const current = (await status.json()).data
    assert.equal(current.state, 'pending')
    assert.equal(current.promptId, body.promptId)
    assert.equal(current.agentId, 'agent-main')
    assert.ok(current.elapsedMs >= 0)
  })

  it('消息被认领 → running；commit 后 → done，且可以再次生成', async () => {
    const status = (await (await fetch(`${base}/books/${bookId}/actions/generate-map`)).json()).data
    assert.equal(status.state, 'pending')

    instance.host.ctx.emitAgentEvent('agent/inbox/claimed', {
      agent: instance.host.agent,
      message: { id: status.promptId },
      turn: { id: 'turn-1' },
    })
    const running = (await (await fetch(`${base}/books/${bookId}/actions/generate-map`)).json()).data
    assert.equal(running.state, 'running')
    assert.ok(running.claimedAt)

    // 生成中再次请求 → 409，并且 details 里带上状态，便于面板解释。
    const busy = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(busy.status, 409)
    const conflict = await busy.json()
    assert.equal(conflict.error.details.state, 'running')

    const tool = instance.toolName('reading_map')
    const committed = await tool.execute(
      { action: 'commit', bookId, root: validTree() },
      { agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(committed.ok, true)

    const done = (await (await fetch(`${base}/books/${bookId}/actions/generate-map`)).json()).data
    assert.equal(done.state, 'done')
    assert.equal(done.reason, null)
    assert.ok(done.finishedAt)
  })

  it('agent/error（无 provider/model）→ failed，reason+message 进状态、SSE 与日志', async () => {
    const queued = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(queued.status, 202)
    const promptId = (await queued.json()).data.promptId
    const warningsBefore = instance.host.state.warnings.length

    const sse = await captureSse(base, async () => {
      instance.host.ctx.emitAgentEvent('agent/inbox/claimed', {
        agent: instance.host.agent,
        message: { id: promptId },
      })
      instance.host.ctx.emitAgentEvent('agent/error', {
        agent: instance.host.agent,
        turn: { id: 'turn-2' },
        error: new Error('agent "agent-main" has no provider/model: set one in settings'),
      })
    })

    assert.match(sse, /"phase":"failed"/)
    assert.match(sse, /"reason":"agent-error"/)
    assert.match(sse, /has no provider\/model/)

    const failed = (await (await fetch(`${base}/books/${bookId}/actions/generate-map`)).json()).data
    assert.equal(failed.state, 'failed')
    assert.equal(failed.reason, 'agent-error')
    assert.match(failed.message, /has no provider\/model/)

    assert.ok(instance.host.state.warnings.length > warningsBefore, '失败必须留下 warn 日志')
    assert.match(
      instance.host.state.warnings[instance.host.state.warnings.length - 1],
      /导图生成失败.*agent-error/,
    )

    // 失败后闸门已释放：可以立即重试（不是永远 409）。
    const retry = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(retry.status, 202)
    // 清掉这条 pending，避免影响后续用例。
    instance.host.ctx.emitAgentEvent('agent/error', {
      agent: instance.host.agent,
      error: new Error('cleanup'),
    })
  })

  it('回合结束但没提交导图 → failed{turn-ended}', async () => {
    const queued = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const promptId = (await queued.json()).data.promptId
    instance.host.ctx.emitAgentEvent('agent/inbox/claimed', {
      agent: instance.host.agent,
      message: { id: promptId },
    })
    instance.host.ctx.emitAgentEvent('agent/status', { agent: instance.host.agent, status: 'idle' })

    const failed = (await (await fetch(`${base}/books/${bookId}/actions/generate-map`)).json()).data
    assert.equal(failed.state, 'failed')
    assert.equal(failed.reason, 'turn-ended')
  })

  it('注入的消息被会话丢弃 → failed{inbox-discarded}', async () => {
    const queued = await fetch(`${base}/books/${bookId}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const promptId = (await queued.json()).data.promptId
    instance.host.ctx.emitAgentEvent('agent/inbox/discarded', {
      agent: instance.host.agent,
      message: { id: promptId },
      reason: 'turn-cancelled',
    })
    const failed = (await (await fetch(`${base}/books/${bookId}/actions/generate-map`)).json()).data
    assert.equal(failed.state, 'failed')
    assert.equal(failed.reason, 'inbox-discarded')
    assert.equal(failed.message, 'turn-cancelled')
  })

  it('agent 不响应：看门狗超时 → failed{timeout}，不再无限期挂起', async () => {
    const fast = await startHost(workspace, { mapGenerationTimeoutMs: 80 })
    try {
      const id = await importBook(fast.base)
      const response = await fetch(`${fast.base}/books/${id}/actions/generate-map`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(response.status, 202)
      const queued = (await response.json()).data
      assert.equal(queued.timeoutMs, 80)

      await sleep(250)
      const status = (await (await fetch(`${fast.base}/books/${id}/actions/generate-map`)).json()).data
      assert.equal(status.state, 'failed')
      assert.equal(status.reason, 'timeout')
      assert.match(status.message, /没有被 agent 认领/)
      assert.ok(status.elapsedMs >= 80)

      // 超时后闸门释放：第三次请求应重新 202（而不是被旧记录卡住 409）。
      const again = await fetch(`${fast.base}/books/${id}/actions/generate-map`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      assert.equal(again.status, 202)
    } finally {
      await fast.close()
    }
  })

  it('已认领但迟迟不提交：超时消息区分「已认领」', async () => {
    const fast = await startHost(workspace, { mapGenerationTimeoutMs: 80 })
    try {
      const id = await importBook(fast.base)
      const queued = (await (await fetch(`${fast.base}/books/${id}/actions/generate-map`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })).json()).data
      fast.host.ctx.emitAgentEvent('agent/inbox/claimed', {
        agent: fast.host.agent,
        message: { id: queued.promptId },
      })
      await sleep(250)
      const status = (await (await fetch(`${fast.base}/books/${id}/actions/generate-map`)).json()).data
      assert.equal(status.state, 'failed')
      assert.equal(status.reason, 'timeout')
      assert.match(status.message, /没有提交导图/)
    } finally {
      await fast.close()
    }
  })

  it('插件卸载不留下未完成的定时器（close 后状态置 failed）', async () => {
    const fast = await startHost(workspace, { mapGenerationTimeoutMs: 60_000 })
    const id = await importBook(fast.base)
    const queued = await fetch(`${fast.base}/books/${id}/actions/generate-map`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    assert.equal(queued.status, 202)
    // 卸载即释放：dispose 会关掉 hub 与看门狗，进程不会因为悬挂的 timer 退出不了。
    fast.dispose()
    fast.server.closeAllConnections?.()
    await new Promise((resolve) => fast.server.close(resolve))
  })
})