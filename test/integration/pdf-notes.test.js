/**
 * PDF 导入 + 研究笔记（t13 / FR-05 / FR-14）。
 *
 * 真 Host 装配（假 Cordis 上下文）+ 真 HTTP 派发：验证 PDF 落到 ready、块带页码、
 * 扫描版成为 unsupported 而不是 failed、损坏文件在请求阶段 415；
 * 再直接驱动 `reading_notes` 工具的 context → write → read 闭环，以及拒绝路径不落盘。
 */
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'
import { renderNotesMarkdown, SECTION_TITLES } from '../../src/host/notes.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const readFixture = (name) => readFile(path.join(fixtures, name))

function createFakeHost() {
  const state = { routes: [], tools: new Map(), sections: [], warnings: [] }
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
        state.tools.set(definition.name, definition)
        return () => state.tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(section) {
        state.sections.push(section)
        return () => {}
      },
    },
    agents: { list: () => [] },
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

async function startHost(workspace) {
  const host = createFakeHost()
  const dispose = apply(host.ctx, { workspaceRoot: workspace })
  const listening = await serveRoutes(host.state.routes)
  return {
    host,
    dispose,
    server: listening.server,
    base: `http://127.0.0.1:${listening.port}${API_BASE}`,
    close: async () => {
      if (typeof dispose === 'function') dispose()
      await new Promise((resolve) => listening.server.close(resolve))
    },
  }
}

async function postBook(base, name, bytes) {
  const response = await fetch(`${base}/books/import?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  return { status: response.status, body: await response.json() }
}

describe('PDF 导入（03 §6.4 / §6.6）', () => {
  let workspace
  let instance
  let base
  let bookId

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-pdf-'))
    instance = await startHost(workspace)
    base = instance.base
  })

  after(async () => {
    await instance.close()
    await rm(workspace, { recursive: true, force: true })
  })

  it('文本 PDF：201 → ready，块带页码定位符', async () => {
    const uploaded = await postBook(base, 'pdf-text-2p.pdf', await readFixture('pdf-text-2p.pdf'))
    assert.equal(uploaded.status, 201)
    assert.equal(uploaded.body.ok, true)
    const book = uploaded.body.data.book
    bookId = book.id
    assert.equal(book.status, 'ready')
    assert.equal(book.format, 'pdf')
    assert.equal(book.stats.pages, 2)
    assert.equal(book.stats.chapters, 1)

    const list = await fetch(`${base}/books/${bookId}/chunks?limit=20`).then((response) => response.json())
    const pages = list.data.chunks.map((chunk) => chunk.page)
    assert.ok(pages.every((page) => Number.isInteger(page) && page >= 1), '每个块都要带整数页码')
    assert.equal(list.data.total, book.stats.chunks)

    // 两页加起来不足一个块的目标长度，块会跨页——起点记第一页；多页布局用 10 页夹具验证。
    const long = await postBook(base, 'pdf-text-10p.pdf', await readFixture('pdf-text-10p.pdf'))
    const longId = long.body.data.book.id
    const longChunks = await fetch(`${base}/books/${longId}/chunks?limit=50`).then((response) => response.json())
    const distinct = [...new Set(longChunks.data.chunks.map((chunk) => chunk.page))].sort((a, b) => a - b)
    assert.ok(distinct.length >= 2, `十页文档的块应覆盖多页，实际 ${JSON.stringify(distinct)}`)
    assert.ok(distinct.every((page) => page >= 1 && page <= 10))
  })

  it('扫描版：201 + status=unsupported + E_SCANNED，且不写 chunks.json', async () => {
    const uploaded = await postBook(base, 'pdf-scanned-5p.pdf', await readFixture('pdf-scanned-5p.pdf'))
    assert.equal(uploaded.status, 201)
    const book = uploaded.body.data.book
    assert.equal(book.status, 'unsupported')
    assert.equal(book.statusDetail.code, 'E_SCANNED')
    const chunksFile = path.join(workspace, 'reading', 'books', book.id, 'chunks.json')
    await assert.rejects(stat(chunksFile), (error) => error.code === 'ENOENT')
  })

  it('损坏 PDF：请求阶段 E_PARSE（422），不建书', async () => {
    const uploaded = await postBook(base, 'corrupt.pdf', await readFixture('corrupt.pdf'))
    assert.equal(uploaded.status, 422)
    assert.equal(uploaded.body.error.code, 'E_PARSE')
  })

  it('notes 路由：无笔记返回 200 空结构，不是 404', async () => {
    const response = await fetch(`${base}/books/${bookId}/notes`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.data, { updatedAt: null, markdown: '', sections: [] })
  })

  it('notes 路由：PUT 仍是 501（面板编辑在 v0.3）', async () => {
    const response = await fetch(`${base}/books/${bookId}/notes`, { method: 'PUT', body: '{}' })
    assert.equal(response.status, 501)
    const body = await response.json()
    assert.equal(body.error.code, 'E_UNSUPPORTED')
    assert.equal(body.error.details.availableIn, '0.3.0')
  })

  it('reading_notes：context → write → read 闭环，拒绝的写入不落盘', async () => {
    const tool = instance.host.state.tools.get('reading_notes')
    assert.ok(tool, 'reading_notes 必须已注册')

    const context = await tool.execute({ bookId, action: 'context' }, {})
    assert.equal(context.ok, true)
    assert.equal(context.data.bookId, bookId)
    assert.ok(context.data.chapters.length >= 1)
    assert.equal(context.data.citationFormat, '[[c:000003]]')
    const firstChunkId = context.data.chapters[0].chunks[0].id
    assert.match(firstChunkId, /^c-\d{6}$/)

    // 先交一份不合格的：引用不存在的块 → rejected，且 notes.md 不存在。
    const invalid = renderNotesMarkdown({
      bookId,
      title: '测试书',
      sections: SECTION_TITLES.map((title) => ({ title, body: `内容 ${title} [[c:999999]]` })),
    })
    const rejected = await tool.execute({ bookId, action: 'write', markdown: invalid }, {})
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'E_CITATION')
    assert.equal(rejected.rejected[0].path.startsWith('sections.') || rejected.rejected[0].path === 'markdown', true)
    assert.match(rejected.rejected[0].message, /999999/)
    const missing = await tool.execute({ bookId, action: 'read' }, {})
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'E_NOT_FOUND')

    // 合格的一份：五节各一条真实引用。
    const markdown = renderNotesMarkdown({
      bookId,
      title: '测试书',
      sections: SECTION_TITLES.map((title) => ({ title, body: `${title} 的结论 [[${firstChunkId.replace(/^c-/, 'c:')}]]` })),
    })
    const written = await tool.execute({ bookId, action: 'write', markdown }, {})
    assert.equal(written.ok, true)
    assert.equal(written.data.sections, 5)
    assert.equal(written.data.citations, 1)
    assert.equal(written.data.path, `reading/books/${bookId}/notes.md`)

    const read = await tool.execute({ bookId, action: 'read' }, {})
    assert.equal(read.ok, true)
    assert.equal(read.data.markdown, markdown)
    assert.equal(read.data.sections.length, 5)

    // 面板侧走 HTTP：同一份 markdown 与 updatedAt。
    const httpNotes = await fetch(`${base}/books/${bookId}/notes`).then((response) => response.json())
    assert.equal(httpNotes.data.markdown, markdown)
    assert.ok(httpNotes.data.updatedAt)
    assert.equal(httpNotes.data.parseError, undefined)

    // 手工改坏的笔记：仍可读，但带 parseError 且 sections 为空。
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path.join(workspace, 'reading', 'books', bookId, 'notes.md'), '# 我手写的\n\n随便写点。\n', 'utf8')
    const broken = await fetch(`${base}/books/${bookId}/notes`).then((response) => response.json())
    assert.equal(broken.data.parseError, true)
    assert.deepEqual(broken.data.sections, [])
    assert.match(broken.data.markdown, /我手写的/)
  })
})