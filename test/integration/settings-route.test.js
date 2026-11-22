/**
 * 设置路由（t33）：`GET /settings` 与 `PUT /settings/library-root`。
 *
 * 真 HTTP + 真文件系统：改根之后新书必须落在新目录、旧书仍然能读；
 * 改回默认也要能读——这三点是「自选存储路径」的全部可用性。
 */

import assert from 'node:assert/strict'
import * as http from 'node:http'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

import { apply } from '../../src/host/index.js'
import { API_BASE } from '../../src/host/limits.js'
import { listenSafe } from '../helpers/net.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')

function createFakeHost(workspace) {
  const state = { routes: [], tools: [], sections: [], warnings: [] }
  const ctx = {
    dshVersion: '0.2.2-rc.5',
    logger: {
      info: () => {},
      warn: (message) => state.warnings.push(message),
      error: (message) => state.warnings.push(message),
    },
    get(name) {
      return name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined
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
      res.writeHead(404)
      res.end()
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
  return listenSafe(server)
}

async function startHost(workspace) {
  const host = createFakeHost(workspace)
  const dispose = apply(host.ctx, {})
  const listening = await serveRoutes(host.state.routes)
  const base = `http://127.0.0.1:${listening.port}${API_BASE}`
  return {
    host,
    base,
    dispose,
    async close() {
      dispose()
      await new Promise((resolve) => listening.server.close(resolve))
    },
  }
}

async function call(base, method, route, body, headers = {}) {
  const response = await fetch(base + route, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

async function upload(base, name) {
  const bytes = await readFile(path.join(fixtures, name))
  const response = await fetch(`${base}/books/import?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  })
  return { status: response.status, body: await response.json() }
}

const exists = (target) => stat(target).then(() => true, () => false)

let temp
let workspace
let dshHome

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'rl-settings-route-'))
  workspace = path.join(temp, 'workspace')
  dshHome = path.join(temp, 'dsh-home')
  // 工作区必须真实存在，否则解析会回退到 cwd（isFallback=true）。
  await mkdir(workspace, { recursive: true })
  // 设置文件必须落在临时 DSH_HOME，绝不能读写开发机真实配置。
  process.env.DSH_HOME = dshHome
})

beforeEach(async () => {
  // 每个用例从干净状态开始：设置文件与书库目录都不继承上一个用例。
  await rm(path.join(dshHome, 'reading-lab'), { recursive: true, force: true })
  await rm(path.join(workspace, 'reading'), { recursive: true, force: true })
})

after(async () => {
  delete process.env.DSH_HOME
  await rm(temp, { recursive: true, force: true })
})

describe('书库根与自选存储路径', () => {
  it('GET /settings 报出工作区布局，health 带 rootPath 且不是回退', async () => {
    const host = await startHost(workspace)
    try {
      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(settings.status, 200)
      assert.equal(settings.body.data.libraryRoot, null)
      assert.equal(path.resolve(settings.body.data.resolvedRoot), path.resolve(workspace, 'reading'))
      assert.equal(settings.body.data.isFallback, false)
      assert.equal(settings.body.data.exists, true)
      assert.equal(path.resolve(settings.body.data.workspaceRoot), path.resolve(workspace))

      const health = await call(host.base, 'GET', '/health')
      assert.equal(health.status, 200)
      assert.equal(path.resolve(health.body.data.rootPath), path.resolve(workspace, 'reading'))
      assert.equal(health.body.data.isFallback, false)
      assert.equal(health.body.data.rootSource, 'workspace')
    } finally {
      await host.close()
    }
  })

  it('设置文件损坏时 /health 与 /settings 都报 settings-corrupted（QA-35-03）', async () => {
    const settingsFile = path.join(dshHome, 'reading-lab', 'settings.json')
    await mkdir(path.dirname(settingsFile), { recursive: true })
    await writeFile(settingsFile, '{ this is not json', 'utf8')

    const host = await startHost(workspace)
    try {
      const health = await call(host.base, 'GET', '/health')
      assert.equal(health.status, 200)
      assert.equal(health.body.data.settingsError, 'settings-corrupted')

      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(settings.status, 200)
      assert.equal(settings.body.data.settingsError, 'settings-corrupted')
      assert.equal(settings.body.data.libraryRoot, null)
      // 损坏不影响可用性：仍然落到工作区书库。
      assert.equal(path.resolve(settings.body.data.resolvedRoot), path.resolve(workspace, 'reading'))
    } finally {
      await host.close()
    }
  })

  it('改根 → 新导入落新目录、旧书可见；改回默认仍可读', async () => {
    const host = await startHost(workspace)
    try {
      const first = await upload(host.base, 'epub3-mini.epub')
      assert.equal(first.status, 201)
      const firstId = first.body.data.book.id
      const defaultBooks = path.join(workspace, 'reading', 'books', firstId)
      assert.equal(await exists(defaultBooks), true)

      const custom = path.join(temp, 'custom-library')
      const switched = await call(host.base, 'PUT', '/settings/library-root', { path: custom })
      assert.equal(switched.status, 200)
      assert.equal(path.resolve(switched.body.data.resolvedRoot), path.resolve(custom))
      assert.deepEqual(switched.body.data.moved, ['books', 'exports', 'inbox', 'index.json'])
      assert.equal(switched.body.data.isFallback, false)
      assert.equal(await exists(path.join(custom, 'books', firstId)), true)
      assert.equal(await exists(defaultBooks), false)

      const listAfterSwitch = await call(host.base, 'GET', '/books')
      assert.deepEqual(listAfterSwitch.body.data.books.map((book) => book.id), [firstId])
      const detail = await call(host.base, 'GET', '/books/' + firstId)
      assert.equal(detail.status, 200)

      const second = await upload(host.base, 'epub2-ncx.epub')
      assert.equal(second.status, 201)
      const secondId = second.body.data.book.id
      assert.equal(await exists(path.join(custom, 'books', secondId)), true)

      const settingsFile = path.join(dshHome, 'reading-lab', 'settings.json')
      assert.equal(JSON.parse(await readFile(settingsFile, 'utf8')).libraryRoot, custom)

      const restored = await call(host.base, 'PUT', '/settings/library-root', { path: null })
      assert.equal(restored.status, 200)
      assert.equal(path.resolve(restored.body.data.resolvedRoot), path.resolve(workspace, 'reading'))
      const listAfterRestore = await call(host.base, 'GET', '/books')
      assert.deepEqual(
        listAfterRestore.body.data.books.map((book) => book.id).sort(),
        [firstId, secondId].sort(),
      )
      assert.equal(JSON.parse(await readFile(settingsFile, 'utf8')).libraryRoot, null)
    } finally {
      await host.close()
    }
  })

  it('拒绝相对路径 / 与当前相同 / 缺字段，且不动书库', async () => {
    const host = await startHost(workspace)
    try {
      const relative = await call(host.base, 'PUT', '/settings/library-root', { path: 'relative/path' })
      assert.equal(relative.status, 400)
      assert.equal(relative.body.error.code, 'E_PATH')
      assert.equal(relative.body.error.details.reason, 'not-absolute')

      const same = await call(host.base, 'PUT', '/settings/library-root', {
        path: path.join(workspace, 'reading'),
      })
      assert.equal(same.status, 400)
      assert.equal(same.body.error.details.reason, 'same-as-current')

      const missing = await call(host.base, 'PUT', '/settings/library-root', {})
      assert.equal(missing.status, 400)
      assert.equal(missing.body.error.details.field, 'path')

      const badType = await call(host.base, 'PUT', '/settings/library-root', { path: 42 })
      assert.equal(badType.status, 400)
      assert.equal(badType.body.error.details.reason, 'invalid-type')

      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(settings.body.data.libraryRoot, null)
    } finally {
      await host.close()
    }
  })

  it('目标目录已有书库时拒绝迁移并保持原状', async () => {
    const host = await startHost(workspace)
    try {
      const first = await upload(host.base, 'epub3-mini.epub')
      const bookId = first.body.data.book.id
      const occupied = path.join(temp, 'occupied-library')
      const fsPromises = await import('node:fs/promises')
      await fsPromises.mkdir(path.join(occupied, 'books'), { recursive: true })
      // 空目录会被复用（真实宿主切根时目标目录往往已由 ensureLayout 建好）；
      // 只有真装了东西才算冲突，这里放一个文件模拟「另一个书库」。
      await fsPromises.writeFile(path.join(occupied, 'books', 'stale.txt'), 'another library', 'utf8')

      const response = await call(host.base, 'PUT', '/settings/library-root', { path: occupied })
      assert.equal(response.status, 400)
      assert.equal(response.body.error.code, 'E_PATH')
      assert.equal(response.body.error.details.reason, 'target-not-empty')

      assert.equal(await exists(path.join(workspace, 'reading', 'books', bookId)), true)
      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(settings.body.data.libraryRoot, null)
    } finally {
      await host.close()
    }
  })
})

﻿describe('导出目录（R2）：PUT /settings/export-root', () => {
  it('默认落在书库下 exports/，不算自定义', async () => {
    const host = await startHost(workspace)
    try {
      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(settings.status, 200)
      assert.equal(path.resolve(settings.body.data.resolvedExportRoot), path.resolve(workspace, 'reading', 'exports'))
      assert.equal(settings.body.data.exportRoot, null)
      assert.equal(settings.body.data.exportRootCustom, false)
    } finally {
      await host.close()
    }
  })

  it('设为自定义目录后，导出文件真的写进该目录且 /exports 能列出', async () => {
    const host = await startHost(workspace)
    try {
      const custom = path.join(temp, 'custom-export')
      const applied = await call(host.base, 'PUT', '/settings/export-root', { path: custom })
      assert.equal(applied.status, 200)
      assert.equal(path.resolve(applied.body.data.resolvedExportRoot), path.resolve(custom))
      assert.equal(applied.body.data.exportRootCustom, true)
      assert.equal(await exists(custom), true)

      const first = await upload(host.base, 'epub3-mini.epub')
      assert.equal(first.status, 201)
      const bookId = first.body.data.book.id
      const response = await fetch(`${host.base}/books/${bookId}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format: 'md' }),
      })
      assert.equal(response.status, 200)
      const result = await response.json()
      // 自定义目录在书库之外，路径只能是绝对的。
      assert.equal(path.isAbsolute(result.data.path), true)
      assert.equal(path.dirname(path.resolve(result.data.path)), path.resolve(custom))
      assert.equal(await exists(path.resolve(result.data.path)), true)

      const list = await call(host.base, 'GET', '/exports')
      assert.equal(list.status, 200)
      assert.equal(list.body.data.files.some((file) => file.name === result.data.name), true)
    } finally {
      await host.close()
    }
  })

  it('传 null 恢复默认目录；非法路径与等于书库根都被拒', async () => {
    const host = await startHost(workspace)
    try {
      const custom = path.join(temp, 'custom-export-2')
      assert.equal((await call(host.base, 'PUT', '/settings/export-root', { path: custom })).status, 200)

      const restored = await call(host.base, 'PUT', '/settings/export-root', { path: null })
      assert.equal(restored.status, 200)
      assert.equal(path.resolve(restored.body.data.resolvedExportRoot), path.resolve(workspace, 'reading', 'exports'))
      assert.equal(restored.body.data.exportRootCustom, false)
      assert.equal(restored.body.data.exportRoot, null)

      const relative = await call(host.base, 'PUT', '/settings/export-root', { path: 'relative/dir' })
      assert.equal(relative.status, 400)
      assert.equal(relative.body.error.code, 'E_PATH')

      const sameAsLibrary = await call(host.base, 'PUT', '/settings/export-root', {
        path: path.join(workspace, 'reading'),
      })
      assert.equal(sameAsLibrary.status, 400)
      assert.equal(sameAsLibrary.body.error.code, 'E_PATH')
      assert.equal(sameAsLibrary.body.error.details.reason, 'same-as-library')

      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(settings.body.data.exportRoot, null)
    } finally {
      await host.close()
    }
  })

  it('改书库根时保留已设的导出目录', async () => {
    const host = await startHost(workspace)
    try {
      const custom = path.join(temp, 'custom-export-3')
      assert.equal((await call(host.base, 'PUT', '/settings/export-root', { path: custom })).status, 200)

      const moved = path.join(temp, 'library-b')
      const changed = await call(host.base, 'PUT', '/settings/library-root', { path: moved })
      assert.equal(changed.status, 200)
      assert.equal(path.resolve(changed.body.data.resolvedExportRoot), path.resolve(custom))
      assert.equal(changed.body.data.exportRootCustom, true)

      const settings = await call(host.base, 'GET', '/settings')
      assert.equal(path.resolve(settings.body.data.exportRoot), path.resolve(custom))
      assert.equal(path.resolve(settings.body.data.resolvedRoot), path.resolve(moved))
    } finally {
      await host.close()
    }
  })
})
