import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const readFixture = (name) => readFile(path.join(fixtures, name))
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

function createFakeHost() {
  const state = { routes: [], tools: [], sections: [], warnings: [] }
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
    tools: { register: () => () => {} },
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

describe('EPUB 导入到 ready（03 §5 / 04 §4.3）', () => {
  let workspace
  let instance
  let base
  let bookId

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-import-'))
    instance = await startHost(workspace)
    base = instance.base
  })

  after(async () => {
    await instance.close()
    await rm(workspace, { recursive: true, force: true })
  })

  it('POST /books/import 返回 201 与 ready 的书籍', async () => {
    const bytes = await readFixture('epub3-mini.epub')
    const response = await fetch(`${base}/books/import?name=${encodeURIComponent('lantern.epub')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.ok, true)
    assert.equal(body.data.duplicate, false)
    assert.match(body.data.book.id, /^b[0-9a-f]{12}$/)
    assert.equal(body.data.book.status, 'ready')
    assert.equal(body.data.book.format, 'epub')
    assert.equal(body.data.book.stats.chapters, 2)
    assert.ok(body.data.book.stats.chunks >= 2)
    bookId = body.data.book.id
  })

  it('磁盘结构与 03 §5 一致（meta.json / chunks.json / source.epub）', async () => {
    const dir = path.join(workspace, 'reading', 'books', bookId)
    for (const name of ['meta.json', 'chunks.json', 'source.epub']) {
      const info = await stat(path.join(dir, name))
      assert.ok(info.isFile(), name)
    }
    const meta = await readJson(path.join(dir, 'meta.json'))
    assert.equal(meta.schemaVersion, 1)
    assert.equal(meta.id, bookId)
    assert.equal(meta.title, 'The Lantern of Small Hours')
    assert.equal(meta.author, 'Reading Lab Fixtures')
    assert.equal(meta.language, 'en')
    assert.equal(meta.source.file, 'source.epub')
    assert.match(meta.source.sha256, /^[0-9a-f]{64}$/)
    assert.equal(meta.status, 'ready')
    assert.equal(meta.statusDetail, null)
    assert.equal(meta.stats.chapters, 2)
    assert.equal(meta.toc.length, 2)
    assert.deepEqual(meta.toc.map((entry) => entry.id), ['ch-001', 'ch-002'])

    const chunks = await readJson(path.join(dir, 'chunks.json'))
    assert.equal(chunks.schemaVersion, 1)
    assert.equal(chunks.bookId, bookId)
    assert.deepEqual(chunks.chunker, { version: 1, target: 1000, max: 2000, min: 100 })
    assert.equal(chunks.chunks[0].id, 'c-000001')
    assert.equal(chunks.chunks[0].chapterTitle, 'The Lantern')
    assert.ok(chunks.chunks[0].text.length > 100)
  })

  it('GET /books 列表是摘要：不含 sha256 / toc', async () => {
    const response = await fetch(`${base}/books`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.books.length, 1)
    const [summary] = body.data.books
    assert.equal(summary.id, bookId)
    assert.equal(summary.stats.chapters, 2)
    assert.equal(summary.hasMap, false)
    assert.equal(summary.hasNotes, false)
    assert.equal('toc' in summary, false)
    assert.equal('source' in summary, false)
    assert.ok(body.data.revision >= 1)
  })

  it('GET /books/:id 含 toc 与完整 source', async () => {
    const response = await fetch(`${base}/books/${bookId}`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.id, bookId)
    assert.equal(body.data.toc.length, 2)
    assert.match(body.data.source.sha256, /^[0-9a-f]{64}$/)
  })

  it('GET chunks 分页与单块上下文', async () => {
    const list = await fetch(`${base}/books/${bookId}/chunks?limit=1`)
    const listed = await list.json()
    assert.equal(listed.data.total, 2)
    assert.equal(listed.data.chunks.length, 1)
    const firstId = listed.data.chunks[0].id

    const single = await fetch(`${base}/books/${bookId}/chunks/${firstId}`)
    const body = await single.json()
    assert.equal(body.data.chunk.id, firstId)
    assert.equal(body.data.prev, null)
    assert.equal(body.data.next.id, 'c-000002')
    assert.equal(single.status, 200)
  })

  it('重复导入同一文件 → 200 duplicate=true，不新增书', async () => {
    const bytes = await readFixture('epub3-mini.epub')
    const response = await fetch(`${base}/books/import?name=again.epub`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: bytes,
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.data.duplicate, true)
    assert.equal(body.data.book.id, bookId)

    const list = await (await fetch(`${base}/books`)).json()
    assert.equal(list.data.books.length, 1)
  })

  it('坏文件给出可读错误：未知魔数 415、压缩炸弹 413、PDF 明确 501', async () => {
    const corrupt = await fetch(`${base}/books/import?name=corrupt.epub`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from('this is definitely not an epub archive'),
    })
    assert.equal(corrupt.status, 415)
    const corruptBody = await corrupt.json()
    assert.equal(corruptBody.error.code, 'E_FORMAT')
    assert.equal(corruptBody.error.details.reason, 'unknown-magic')
    assert.match(corruptBody.error.message, /EPUB|PDF|格式/i)

    const bomb = await fetch(`${base}/books/import?name=bomb.epub`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: await readFixture('bomb.epub'),
    })
    assert.equal(bomb.status, 413)
    assert.equal((await bomb.json()).error.code, 'E_TOO_LARGE')

    const pdf = await fetch(`${base}/books/import?name=paper.pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: await readFixture('pdf-text-2p.pdf'),
    })
    assert.equal(pdf.status, 501)
    const pdfBody = await pdf.json()
    assert.equal(pdfBody.error.code, 'E_UNSUPPORTED')
    assert.equal(pdfBody.error.details.reason, 'pdf-pending')
  })

  it('PATCH displayName 生效，GET 列表可见', async () => {
    const response = await fetch(`${base}/books/${bookId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '小时间之灯' }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).data.displayName, '小时间之灯')
    const list = await (await fetch(`${base}/books`)).json()
    const renamed = list.data.books.find((book) => book.id === bookId)
    assert.equal(renamed.displayName, '小时间之灯')
  })

  it('解析阶段失败 → status=failed，source 保留、import.log 有记录', async () => {
    const zip = makeStoreZip([
      { name: 'mimetype', text: 'application/epub+zip' },
      { name: 'META-INF/container.xml', text: '<container><rootfiles><rootfile full-path="OEBPS/missing.opf"/></rootfiles></container>' },
    ])
    const response = await fetch(`${base}/books/import?name=broken.epub`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: zip,
    })
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.data.book.status, 'failed')
    assert.equal(body.data.book.statusDetail.code, 'E_FORMAT')

    const dir = path.join(workspace, 'reading', 'books', body.data.book.id)
    assert.ok((await stat(path.join(dir, 'source.epub'))).isFile(), '失败也要保留 source 供重试')
    const log = await readFile(path.join(dir, 'import.log'), 'utf8')
    assert.match(log, /"phase":"failed"/)
  })

  it('重启（新的 apply + 新进程语义）后书库仍在', async () => {
    await instance.close()
    instance = await startHost(workspace)
    base = instance.base
    const list = await (await fetch(`${base}/books`)).json()
    assert.equal(list.data.books.length, 2)
    const ready = list.data.books.find((book) => book.id === bookId)
    assert.equal(ready.status, 'ready')
    assert.equal(ready.displayName, '小时间之灯')
  })

  it('DELETE 后书库为空且目录被清理', async () => {
    const list = await (await fetch(`${base}/books`)).json()
    for (const book of list.data.books) {
      const response = await fetch(`${base}/books/${book.id}`, { method: 'DELETE' })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).data.deleted, true)
    }
    const empty = await (await fetch(`${base}/books`)).json()
    assert.equal(empty.data.books.length, 0)
    await assert.rejects(() => stat(path.join(workspace, 'reading', 'books', bookId)))
  })
})

/** 最小 store-only ZIP（测试专用）。 */
function makeStoreZip(entries) {
  const locals = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.text, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)

    central.push(Buffer.concat([header, name]))
    locals.push(Buffer.concat([local, name, data]))
    offset += 30 + name.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}