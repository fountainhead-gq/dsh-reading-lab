/**
 * IT-EXP-01..06 / IT-C12（06-test.md §2 FR-13；04 §4.2 #22–24、§5.6）。
 *
 * fake host + 真 HTTP：三种格式导出落盘 → 列表 → 下载；v0.3 格式与非法参数的
 * 错误码；源文件在导出前后哈希不变；导出能力与 /health 一致。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'
import { validate } from '../helpers/json-schema-lite.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const SUMMARY = '导图节点摘要'.repeat(10).slice(0, 60)

function createFakeHost() {
  const state = { routes: [], tools: [], sections: [], warnings: [], injected: [], events: [] }
  const listeners = new Map()
  const agent = {
    id: 'agent-main',
    sessionId: 'session-1',
    inbox: { followup: (message) => state.injected.push(message) },
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
    systemPrompt: { section: (section) => (state.sections.push(section), () => {}) },
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
    server: listening.server,
    base: `http://127.0.0.1:${listening.port}${API_BASE}`,
    toolName: (name) => host.state.tools.find((tool) => tool.name === name),
    close: async () => {
      if (typeof dispose === 'function') dispose()
      listening.server.closeAllConnections?.()
      await new Promise((resolve) => listenerClose(listening.server, resolve))
    },
  }
}

function listenerClose(server, resolve) {
  server.close(resolve)
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
        kind: 'chapter',
        citations: [{ chunkId: 'c-000001' }],
        questions: ['灯笼象征什么？'],
      },
    ],
  }
}

const NOTES_MD = [
  '<!-- reading-lab:notes {"schemaVersion":1} -->',
  '# 研究笔记',
  '',
  '## 主题脉络',
  '灯笼是记忆的容器。[[c:000001]]',
  '',
  '## 核心论点',
  '本书未形成该部分',
  '',
  '## 术语表',
  '本书未形成该部分',
  '',
  '## 阅读建议',
  '先读第一章。',
  '',
  '## 开放问题',
  '本书未形成该部分',
  '',
].join('\n')

async function json(response) {
  const body = await response.json()
  return { status: response.status, body }
}

function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

describe('导出的路由（IT-EXP）', () => {
  let workspace
  let instance
  let base
  let bookId
  let bookDir

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-export-http-'))
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
    bookDir = path.join(workspace, 'reading', 'books', bookId)

    const tool = instance.toolName('reading_map')
    const committed = await tool.execute(
      { action: 'commit', bookId, root: validTree() },
      { callId: 'c1', name: 'reading_map', agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(committed.ok, true, JSON.stringify(committed))

    await writeFile(path.join(bookDir, 'notes.md'), NOTES_MD, 'utf8')
  })

  after(async () => {
    await instance.close()
    await new Promise((resolve) => setTimeout(resolve, 60))
    await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })

  it('IT-EXP-01 /health 宣告三种格式；POST /export md → 200 且文件落盘', async () => {
    const health = await json(await fetch(`${base}/health`))
    assert.equal(health.status, 200)
    assert.deepEqual(health.body.data.capabilities.exports, ['md', 'opml', 'json'])
    // v0.2 不生成笔记：能力位要明说「未提供 + v0.3」，与 501 对齐（QA-17-03）。
    assert.deepEqual(health.body.data.capabilities.generateNotes, {
      available: false,
      availableIn: '0.3.0',
    })

    const result = await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'md' }),
      }),
    )
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.body.data.format, 'md')
    assert.equal(result.body.data.includeThreads, false)
    assert.match(result.body.data.path, /^reading\/exports\/.+\.md$/)

    const file = path.join(workspace, result.body.data.path)
    const info = await stat(file)
    assert.equal(result.body.data.bytes, info.size)
    const text = await readFile(file, 'utf8')
    assert.match(text, /^# The Lantern of Small Hours$/m)
    assert.match(text, /^## 导图大纲$/m)
    assert.match(text, /^## 研究笔记$/m)
    assert.ok(text.includes('灯笼是记忆的容器。'))
    assert.ok(!text.includes('<!-- reading-lab:notes'))
    assert.ok(!text.includes('## 问答精选'))
    // QA-17-04：导出物里不再有给模型看的 `[[c:…]]`，文末给出可读引用表。
    assert.ok(!text.includes('[[c:'))
    assert.match(text, /^## 引用$/m)
    assert.match(text, /^- \[c-000001\] The Lantern · — · 「/m)
  })

  it('IT-EXP-02 OPML/JSON 导出：可解析、map 与画布一致', async () => {
    const opml = await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'opml' }),
      }),
    )
    assert.equal(opml.status, 200)
    const opmlText = await readFile(path.join(workspace, opml.body.data.path), 'utf8')
    assert.match(opmlText, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
    assert.ok(opmlText.includes('<outline text="The Lantern of Small Hours"'))
    assert.ok(opmlText.includes('_citation="c-000001"'))

    const exported = await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'json' }),
      }),
    )
    assert.equal(exported.status, 200)
    const doc = JSON.parse(await readFile(path.join(workspace, exported.body.data.path), 'utf8'))
    const mapDoc = JSON.parse(await readFile(path.join(bookDir, 'map.json'), 'utf8'))
    assert.deepEqual(doc.map.root, mapDoc.root)
    assert.deepEqual(doc.map.layout, mapDoc.layout)
    assert.equal(doc.map.stats.nodes, 2)
    assert.deepEqual(doc.book.meta.id, bookId)
    assert.equal(doc.notes.sections.length, 5)
    assert.equal('threads' in doc, false)

    // QA-17-05：产物必须过正式 schema；引用既有 id 数组也有人读表。
    const schema = JSON.parse(
      await readFile(path.resolve(import.meta.dirname, '../../schema/export-v1.schema.json'), 'utf8'),
    )
    const checked = validate(schema, doc)
    assert.deepEqual(checked.errors, [])
    assert.ok(doc.citationCount >= 1)
    assert.equal(doc.citations[0].id, 'c-000001')
    assert.equal(typeof doc.citations[0].snippet, 'string')
    const filled = doc.notes.sections.find((section) => section.citationIds.length > 0)
    assert.ok(filled, '至少一节带引用')
    assert.equal(filled.citationCount, filled.citationIds.length)
  })

  it('IT-EXP-07 generate-notes 501：明说 v0.3，与 /health 能力位一致（QA-17-03）', async () => {
    const response = await json(
      await fetch(`${base}/books/${bookId}/actions/generate-notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept-language': 'zh-CN' },
        body: JSON.stringify({}),
      }),
    )
    assert.equal(response.status, 501)
    assert.equal(response.body.error.code, 'E_UNSUPPORTED')
    assert.equal(response.body.error.details.availableIn, '0.3.0')
    assert.equal(response.body.error.details.feature, 'notes.generate')
    assert.match(response.body.error.message, /v0\.3/)
  })

  it('IT-EXP-03 GET /exports 列表与下载：Content-Type/长度与源文件一致', async () => {
    const list = await json(await fetch(`${base}/exports`))
    assert.equal(list.status, 200)
    assert.ok(list.body.data.files.length >= 3)
    assert.ok(list.body.data.files.every((file) => typeof file.name === 'string' && file.bytes > 0))

    const target = list.body.data.files.find((file) => file.name.endsWith('.opml'))
    assert.ok(target)
    const download = await fetch(`${base}/exports/${encodeURIComponent(target.name)}`)
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'text/x-opml; charset=utf-8')
    assert.match(download.headers.get('content-disposition') ?? '', /filename\*=UTF-8''/)
    const body = Buffer.from(await download.arrayBuffer())
    assert.equal(body.length, target.bytes)
    const disk = await readFile(path.join(workspace, 'reading', 'exports', target.name))
    assert.equal(hashOf(body), hashOf(disk))
  })

  it('IT-EXP-04 参数与错误码：html 501、png 400、未知格式 501、越界名 400', async () => {
    const html = await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'html' }),
      }),
    )
    assert.equal(html.status, 501)
    assert.equal(html.body.error.code, 'E_UNSUPPORTED')

    const png = await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'png' }),
      }),
    )
    assert.equal(png.status, 400)
    assert.equal(png.body.error.code, 'E_BAD_REQUEST')

    const bad = await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'docx' }),
      }),
    )
    assert.equal(bad.status, 501)

    const traversal = await fetch(`${base}/exports/..%2Fmeta.json`)
    assert.equal(traversal.status, 400)
    const traversalBody = await traversal.json()
    assert.equal(traversalBody.error.code, 'E_PATH')

    const missing = await fetch(`${base}/exports/nope.md`)
    assert.equal(missing.status, 404)
  })

  it('IT-EXP-05 未知书 404；导出前后 map.json/notes.md 哈希不变', async () => {
    const mapFile = path.join(bookDir, 'map.json')
    const notesFile = path.join(bookDir, 'notes.md')
    const before = [hashOf(await readFile(mapFile)), hashOf(await readFile(notesFile))]

    await json(
      await fetch(`${base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'md', includeThreads: true }),
      }),
    )

    const after = [hashOf(await readFile(mapFile)), hashOf(await readFile(notesFile))]
    assert.deepEqual(after, before)

    const unknown = await json(
      await fetch(`${base}/books/bffffffffffff/export`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ format: 'md' }),
      }),
    )
    assert.equal(unknown.status, 404)
    assert.equal(unknown.body.error.code, 'E_NOT_FOUND')
  })

  it('IT-EXP-06 reading_export 工具：真实落盘 + 未知字段拒绝（IT-C12）', async () => {
    const tool = instance.toolName('reading_export')
    assert.ok(tool)
    assert.equal(tool.name, 'reading_export')

    const ok = await tool.execute(
      { bookId, format: 'json', includeThreads: false },
      { callId: 'e1', name: 'reading_export', agent: { id: 'agent-main', sessionId: 'session-1' } },
    )
    assert.equal(ok.ok, true, JSON.stringify(ok))
    assert.equal(ok.data.format, 'json')
    assert.ok(ok.data.bytes > 0)

    const rendered = tool.output.render({ format: 'json' }, ok)
    assert.ok(Array.isArray(rendered) && rendered.length === 1)
    assert.match(rendered[0].text, /^导出完成：reading\/exports\//)

    const rejected = await tool.execute(
      { bookId, format: 'md', includeNotes: true },
      { callId: 'e2', name: 'reading_export' },
    )
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'E_BAD_REQUEST')

    const unsupported = await tool.execute({ bookId, format: 'html' }, { callId: 'e3', name: 'reading_export' })
    assert.equal(unsupported.ok, false)
    assert.equal(unsupported.code, 'E_UNSUPPORTED')
  })
})