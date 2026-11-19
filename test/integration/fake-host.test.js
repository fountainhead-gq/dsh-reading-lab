import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply, inject, name } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'

/**
 * fake host：最小的 Cordis 替身 + 真 http 服务器。
 * 目的不是模拟 DSH，而是用真路由、真 fs、真 HTTP 断言 04 §4 的信封。
 */
function createFakeHost() {
  const state = {
    routes: [],
    tools: [],
    sections: [],
    warnings: [],
    infos: [],
    effects: 0,
  }
  const ctx = {
    dshVersion: '0.2.2-rc.5',
    logger: {
      info: (message) => state.infos.push(message),
      warn: (message) => state.warnings.push(message),
      error: (message) => state.warnings.push(message),
    },
    effect(fn) {
      state.effects += 1
      const dispose = fn()
      return typeof dispose === 'function' ? dispose : () => {}
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
      list() {
        return [{ id: 'agent-1', name: 'agent-1', title: 'Default' }]
      },
    },
  }
  return { ctx, state }
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

describe('fake host boot', () => {
  let workspace
  let host
  let server
  let base
  let dispose

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-host-'))
    host = createFakeHost()
    dispose = apply(host.ctx, { workspaceRoot: workspace })
    const listening = await serveRoutes(host.state.routes)
    server = listening.server
    base = `http://127.0.0.1:${listening.port}${API_BASE}`
  })

  after(async () => {
    if (typeof dispose === 'function') dispose()
    if (server) await new Promise((resolve) => server.close(resolve))
    await rm(workspace, { recursive: true, force: true })
  })

  it('入口导出符合 04 §2.1', () => {
    assert.equal(name, 'dsh-reading-lab')
    assert.deepEqual(inject, ['webServer', 'tools', 'systemPrompt', 'agents'])
    assert.equal(host.state.routes.length, 1)
    assert.equal(host.state.routes[0].kind, 'prefix')
    assert.equal(host.state.routes[0].path, API_BASE)
  })

  it('建好 reading/{books,inbox,exports}', async () => {
    for (const dir of ['books', 'inbox', 'exports']) {
      const info = await stat(path.join(workspace, 'reading', dir))
      assert.ok(info.isDirectory(), `reading/${dir}`)
    }
  })

  it('GET /health 返回 200 与能力清单', async () => {
    const response = await fetch(`${base}/health`)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.match(response.headers.get('x-dsh-plugin'), /^dsh-reading-lab\//)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.match(body.data.pluginVersion, /^\d+\.\d+\.\d+/)
    assert.equal(body.data.apiVersion, 1)
    assert.equal(body.data.dshVersion, '0.2.2-rc.5')
    assert.equal(body.data.storage, 'ok')
    assert.equal(body.data.workspaceRootName, path.basename(workspace))
    assert.deepEqual(body.data.capabilities.formats, ['epub', 'pdf'])
    assert.deepEqual(body.data.capabilities.exports, ['md', 'opml', 'json'])
    assert.equal(body.data.capabilities.sse, true)
    assert.deepEqual(
      [...body.data.capabilities.tools].sort(),
      ['reading_ask', 'reading_export', 'reading_import', 'reading_map', 'reading_notes', 'reading_tutor'],
    )
  })

  it('GET /books 空库返回空数组而不是错误', async () => {
    const response = await fetch(`${base}/books`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body, { ok: true, data: { books: [], revision: 0 } })
  })

  it('GET /agents 透传 ctx.agents.list', async () => {
    const body = await (await fetch(`${base}/agents`)).json()
    assert.equal(body.ok, true)
    assert.equal(body.data.agents.length, 1)
    assert.equal(body.data.agents[0].id, 'agent-1')
  })

  it('不存在的书是 404 而不是假数据', async () => {
    const response = await fetch(`${base}/books/b0123456789ab`)
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'E_NOT_FOUND')
    assert.equal(body.error.details.bookId, 'b0123456789ab')
    assert.equal(typeof body.error.requestId, 'string')
  })

  it('POST /books/import 对未知魔数返回 415', async () => {
    const response = await fetch(`${base}/books/import?name=x.epub`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('not an archive'),
    })
    assert.equal(response.status, 415)
    const body = await response.json()
    assert.equal(body.error.code, 'E_FORMAT')
    assert.equal(body.error.details.reason, 'unknown-magic')
  })

  it('非法 bookId 是 400 且不查盘', async () => {
    const response = await fetch(`${base}/books/not-a-book`)
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.equal(body.error.code, 'E_BAD_REQUEST')
    assert.equal(body.error.details.field, 'bookId')
  })

  it('错误方法返回 405 并带 Allow 头', async () => {
    const response = await fetch(`${base}/books`, { method: 'PUT' })
    assert.equal(response.status, 405)
    assert.match(response.headers.get('allow') ?? '', /GET/)
  })

  it('未知路径 404 E_NOT_FOUND', async () => {
    const response = await fetch(`${base}/nope`)
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.equal(body.error.code, 'E_NOT_FOUND')
  })

  it('Accept-Language: en 时错误文案是英文', async () => {
    const response = await fetch(`${base}/books/b0123456789ab`, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    assert.equal(response.status, 404)
    const body = await response.json()
    assert.match(body.error.message, /not found/i)
  })

  it('GET /events 首帧是 hello，带 revision 与空书库', async () => {
    const controller = new AbortController()
    try {
      const response = await fetch(`${base}/events`, { signal: controller.signal })
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
      const reader = response.body.getReader()
      const { value } = await reader.read()
      const text = Buffer.from(value).toString('utf8')
      assert.match(text, /^event: hello\n/)
      assert.match(text, /"books":\[\]/)
      assert.match(text, /"revision":0/)
      controller.abort()
    } finally {
      controller.abort()
    }
  })

  it('注册了六个工具与一段系统提示', () => {
    assert.equal(host.state.tools.length, 6)
    assert.deepEqual(
      host.state.tools.map((tool) => tool.name).sort(),
      ['reading_ask', 'reading_export', 'reading_import', 'reading_map', 'reading_notes', 'reading_tutor'],
    )
    assert.equal(host.state.sections.length, 1)
    assert.equal(host.state.sections[0].name, 'reading-lab')
    assert.equal(typeof host.state.sections[0].text, 'string')
  })

  it('dispose 后路由与工具全部注销', () => {
    dispose()
    assert.equal(host.state.routes.length, 0)
    assert.equal(host.state.tools.length, 0)
  })
})