/**
 * 04 §4.2 #4 / #22–24 的契约回归（t28，来自 t11 路由探针的四条发现）。
 *
 * 覆盖：
 * 1. `POST /books/import` 的 `name` 必填（缺字段 / 空串 / 路径穿越三种 400，且不落盘）；
 * 2. `GET /exports` 空目录 200 + 空列表，并惰性创建 `reading/exports/`；
 * 3. `POST /books/:id/export` 501 时 `/health.capabilities.exports` 不再宣称支持；
 * 4. `GET /exports/:name` 路径穿越 400 `E_PATH`（不是 500），越界不读盘。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as http from 'node:http'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'
import { listenSafe } from '../helpers/net.js'
import { assertExportName } from '../../src/host/export/files.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const EPUB3 = path.join(fixtures, 'epub3-mini.epub')
const EPUB2 = path.join(fixtures, 'epub2-ncx.epub')

function createFakeHost() {
  const state = { routes: [], warnings: [] }
  const ctx = {
    dshVersion: '0.2.2-rc.5',
    logger: { info: () => {}, warn: (m) => state.warnings.push(m), error: (m) => state.warnings.push(m) },
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
    systemPrompt: { section: () => () => {} },
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
        /* already closed */
      }
    })
  })
  return listenSafe(server)
}

async function startHost() {
  const workspace = await mkdtemp(path.join(tmpdir(), 'rl-contract-'))
  const host = createFakeHost()
  const dispose = apply(host.ctx, { workspaceRoot: workspace })
  const listening = await serveRoutes(host.state.routes)
  const base = `http://127.0.0.1:${listening.port}${API_BASE}`
  return {
    workspace,
    base,
    exportsDir: path.join(workspace, 'reading', 'exports'),
    booksDir: path.join(workspace, 'reading', 'books'),
    dispose,
    close: async () => {
      await new Promise((resolve) => listening.server.close(resolve))
      dispose()
      await rm(workspace, { recursive: true, force: true })
    },
  }
}

async function call(base, pathname, init) {
  const response = await fetch(base + pathname, init)
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.status, headers: response.headers, body }
}

const postEpub = (base, name) => {
  const query = name === undefined ? '' : `?name=${encodeURIComponent(name)}`
  return call(base, `/books/import${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: readFileSync(EPUB3),
  })
}

describe('POST /books/import 的 name 校验（04 §4.2 #4）', () => {
  let host
  before(async () => {
    host = await startHost()
  })
  after(async () => {
    await host.close()
  })

  it('缺 name 字段 → 400 E_BAD_REQUEST{field:name,reason:missing} 且不建书', async () => {
    const res = await postEpub(host.base, undefined)
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'E_BAD_REQUEST')
    assert.deepEqual(res.body.error.details, { field: 'name', reason: 'missing' })

    const list = await call(host.base, '/books')
    assert.deepEqual(list.body.data.books, [])
    assert.deepEqual(await readdir(host.booksDir), [])
  })

  it('name 为空串 → 400 E_BAD_REQUEST{reason:empty}', async () => {
    const res = await call(host.base, '/books/import?name=', {
      method: 'POST',
      body: new Uint8Array(),
    })
    assert.equal(res.status, 400)
    assert.deepEqual(res.body.error.details, { field: 'name', reason: 'empty' })
  })

  it('name 全是空白 → 400 E_BAD_REQUEST{reason:empty}', async () => {
    const res = await call(host.base, '/books/import?name=%20%20', {
      method: 'POST',
      body: new Uint8Array(),
    })
    assert.equal(res.status, 400)
    assert.equal(res.body.error.details.reason, 'empty')
  })

  it('name 含 ../ → 400 E_PATH 且不落盘', async () => {
    const res = await postEpub(host.base, '../../escape.epub')
    assert.equal(res.status, 400)
    assert.equal(res.body.error.code, 'E_PATH')
    assert.equal(res.body.error.details.reason, 'name-traversal')

    const list = await call(host.base, '/books')
    assert.deepEqual(list.body.data.books, [])
    assert.deepEqual(await readdir(host.booksDir), [])
    // 工作区外不能出现以 name 命名的文件。
    const outside = path.join(host.workspace, '..', 'escape.epub')
    await assert.rejects(stat(outside), '越界文件不应被创建')
  })

  it('name 合法时仍 201，且书库可见（回归）', async () => {
    const res = await postEpub(host.base, 'mini.epub')
    assert.equal(res.status, 201)
    assert.equal(res.body.data.book.status, 'ready')
    const list = await call(host.base, '/books')
    assert.equal(list.body.data.books.length, 1)
    // 标题来自 EPUB 元数据；文件名只作 displayName 的兜底，不覆盖 title。
    assert.equal(list.body.data.books[0].title, 'The Lantern of Small Hours')
    assert.equal(list.body.data.books[0].format, 'epub')
  })
})

describe('GET /exports（04 §4.2 #23–24）', () => {
  let host
  before(async () => {
    host = await startHost()
  })
  after(async () => {
    await host.close()
  })

  it('空目录 → 200 + 空列表，并惰性创建 reading/exports/', async () => {
    const res = await call(host.base, '/exports')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.data.files, [])
    const info = await stat(host.exportsDir)
    assert.ok(info.isDirectory())
  })

  it('只列普通文件，按 mtime 降序，带 bytes 与 mtime', async () => {
    await writeFile(path.join(host.exportsDir, 'older.md'), '# old\n', 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeFile(path.join(host.exportsDir, 'newer.opml'), '<opml/>', 'utf8')
    await mkdir(path.join(host.exportsDir, 'nested'), { recursive: true })

    const res = await call(host.base, '/exports')
    assert.equal(res.status, 200)
    assert.deepEqual(
      res.body.data.files.map((file) => file.name),
      ['newer.opml', 'older.md'],
    )
    assert.equal(res.body.data.files[1].bytes, 6)
    assert.match(res.body.data.files[1].mtime, /^\d{4}-\d{2}-\d{2}T/)
  })

  it('下载已有文件 → 200 + 对应 Content-Type 与 attachment', async () => {
    const res = await fetch(`${host.base}/exports/older.md`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /text\/markdown/)
    assert.match(res.headers.get('content-disposition'), /attachment; filename\*=UTF-8''older\.md/)
    assert.equal(await res.text(), '# old\n')
  })

  it('下载不存在 → 404 E_NOT_FOUND', async () => {
    const res = await call(host.base, '/exports/nope.md')
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'E_NOT_FOUND')
    assert.equal(res.body.error.details.resource, 'export')
  })

  it('name 含 ../ → 400 E_PATH（不是 500）', async () => {
    for (const name of ['..%2Fmeta.json', '..%5Cmeta.json', '..%2F..%2Findex.json']) {
      const res = await call(host.base, `/exports/${name}`)
      assert.equal(res.status, 400, name)
      assert.equal(res.body.error.code, 'E_PATH', name)
    }
  })
})

describe('POST /books/:id/export 与 /health 的一致性（QA t11 发现 ③）', () => {
  let host
  before(async () => {
    host = await startHost()
  })
  after(async () => {
    await host.close()
  })

  it('/health 宣告的格式与真实能力一致（v0.2：md/opml/json）', async () => {
    const res = await call(host.base, '/health')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.data.capabilities.exports, ['md', 'opml', 'json'])
    assert.deepEqual(res.body.data.capabilities.formats, ['epub', 'pdf'])
  })

  it('未知书 POST /export → 404 E_NOT_FOUND（不再是 501 占位）', async () => {
    const res = await call(host.base, '/books/b000000000000/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'md' }),
    })
    assert.equal(res.status, 404)
    assert.equal(res.body.error.code, 'E_NOT_FOUND')
  })

  it('v0.3 格式仍 501，英文请求返回英文文案', async () => {
    const res = await call(host.base, '/books/b000000000000/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': 'en' },
      body: JSON.stringify({ format: 'html' }),
    })
    assert.equal(res.status, 501)
    assert.equal(res.body.error.code, 'E_UNSUPPORTED')
    assert.equal(res.body.error.details.availableIn, '0.3.0')
    assert.equal(res.body.error.message, 'This operation is not supported here')
  })
})

describe('assertExportName 单元边界', () => {
  it('单段文件名通过', () => {
    assert.equal(assertExportName('书名-20261120-101500.md'), '书名-20261120-101500.md')
  })

  it('拒绝空名、分隔符、点段与 ..', () => {
    for (const name of ['', '.', '..', 'a/b.md', 'a\\b.md', '../meta.json', 'x..y.md', 'a\0b']) {
      assert.throws(
        () => assertExportName(name),
        (error) => error.code === 'E_PATH',
        `应拒绝 ${JSON.stringify(name)}`,
      )
    }
  })
})

describe('导出目录的惰性创建不影响书库', () => {
  it('GET /exports 不创建 books/inbox（只碰 exports）', async () => {
    const host = await startHost()
    try {
      await call(host.base, '/exports')
      const entries = await readdir(path.join(host.workspace, 'reading'))
      assert.deepEqual(entries.sort(), ['books', 'exports', 'inbox'])
      assert.deepEqual(await readdir(host.booksDir), [])
    } finally {
      await host.close()
    }
  })
})

describe('PUT /books/order 书架排序（R4）', () => {
  const importEpub = (base, file, name) =>
    call(base, `/books/import?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/epub+zip' },
      body: readFileSync(file),
    })

  it('按传入 ids 重排，未列出的接在后面，revision 自增', async () => {
    const host = await startHost()
    try {
      const first = await importEpub(host.base, EPUB3, 'a.epub')
      const second = await importEpub(host.base, EPUB2, 'b.epub')
      assert.equal(first.status, 201)
      assert.equal(second.status, 201)
      const a = first.body.data.book.id
      const b = second.body.data.book.id
      const before = await call(host.base, '/books')
      assert.deepEqual(before.body.data.books.map((book) => book.id).sort(), [a, b].sort())

      // 索引数组本身就是展示顺序，所以按 [a, b] 传入后 GET 必须原样返回
      const res = await call(host.base, '/books/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [a, b] }),
      })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body.data.books.map((book) => book.id), [a, b])
      assert.ok(res.body.data.revision > before.body.data.revision)

      // 落盘顺序同样生效：重新读一次仍是 [a, b]
      const after = await call(host.base, '/books')
      assert.deepEqual(after.body.data.books.map((book) => book.id), [a, b])
    } finally {
      await host.close()
    }
  })

  it('未知 id 被忽略，不报错也不丢书', async () => {
    const host = await startHost()
    try {
      const first = await importEpub(host.base, EPUB3, 'a.epub')
      const a = first.body.data.book.id
      const res = await call(host.base, '/books/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['bffffffffffff', a] }),
      })
      assert.equal(res.status, 200)
      assert.deepEqual(res.body.data.books.map((book) => book.id), [a])
    } finally {
      await host.close()
    }
  })

  it('ids 非字符串数组 → 400 E_BAD_REQUEST{field:ids}', async () => {
    const host = await startHost()
    try {
      const res = await call(host.base, '/books/order', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [1, 2] }),
      })
      assert.equal(res.status, 400)
      assert.equal(res.body.error.code, 'E_BAD_REQUEST')
      assert.equal(res.body.error.details.field, 'ids')
    } finally {
      await host.close()
    }
  })
})
