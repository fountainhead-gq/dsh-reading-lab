import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { assertSafeRelative, isInsideOrEqual, resolveInReading } from '../../src/host/paths.js'
import { readJson, writeJsonAtomic, SCHEMA_VERSION } from '../../src/host/json-file.js'
import { ERROR_CODES, ReadingError, messageFor, httpStatusOf, toWireError, pickLanguage } from '../../src/host/errors.js'
import { isBookId, isChunkId, isThreadId, bookIdFromBytes, chunkIdAt, threadIdAt } from '../../src/host/ids.js'
import { LIMITS, API_BASE } from '../../src/host/limits.js'
import { defaultWorkspaceFromRegistry, resolveLimits } from '../../src/host/config.js'
import { makeToolDefinitions, TOOL_NAMES } from '../../src/host/tools.js'
import { routeTable } from '../../src/host/routes.js'

const ROOT = path.resolve(import.meta.dirname, '../..')

describe('limits / config', () => {
  it('默认值与 04 §2.2 一致', () => {
    const limits = resolveLimits(undefined)
    assert.equal(limits.maxUploadBytes, 104857600)
    assert.equal(limits.maxPdfPages, 2000)
    assert.equal(limits.maxChunks, 20000)
    assert.deepEqual(limits.exportFormats, ['md', 'opml', 'json'])
    assert.equal(limits.allowAgentImportPaths, true)
    assert.equal(LIMITS.ssePingMs, 15000)
    assert.equal(API_BASE, '/dsh-reading-lab/api/v1')
  })

  it('非法配置回落默认值，未知导出格式被过滤', () => {
    const limits = resolveLimits({ maxUploadBytes: -1, exportFormats: ['html', 'docx'], allowAgentImportPaths: false })
    assert.equal(limits.maxUploadBytes, LIMITS.maxUploadBytes)
    assert.deepEqual(limits.exportFormats, ['html'])
    assert.equal(limits.allowAgentImportPaths, false)
  })

  it('多 workspace 时仍能解析默认根（QA-11-01）', () => {
    const services = {
      workingDirectory: { defaultDirectory: 'D:\\Qunar\\personal\\dsh' },
      workspaceRegistry: { list: () => [{ path: 'D:\\Qunar\\personal\\dsh' }, { path: 'D:\\Qunar\\PSAgent' }] },
    }
    assert.equal(defaultWorkspaceFromRegistry({ get: (name) => services[name] }), 'D:\\Qunar\\personal\\dsh')
  })

  it('可选服务未注入时不抛错，退回 registry', () => {
    const registry = { list: () => [{ path: '/w/a' }, { path: '/w/b' }] }
    const ctx = {
      get(name) {
        if (name === 'workspaceRegistry') return registry
        throw new Error(`cannot get property "${name}" without inject`)
      },
    }
    assert.equal(defaultWorkspaceFromRegistry(ctx), '/w/a')
  })

  it('没有 deployment defaultDirectory 时取 registry 第一项或 isDefault 项', () => {
    const withRegistry = (registry) => ({ get: (name) => (name === 'workspaceRegistry' ? registry : undefined) })
    assert.equal(defaultWorkspaceFromRegistry(withRegistry({ list: () => [{ path: '/w/a' }, { path: '/w/b' }] })), '/w/a')
    assert.equal(
      defaultWorkspaceFromRegistry(withRegistry({ list: () => [{ path: '/w/a' }, { path: '/w/b', isDefault: true }] })),
      '/w/b',
    )
    assert.equal(defaultWorkspaceFromRegistry(withRegistry({ list: () => [] })), undefined)
  })
})

describe('paths', () => {
  it('拒绝越界与危险名字', () => {
    for (const bad of ['', '..', '../x', '/abs', 'C:\\x', 'a\\b', 'a/../../b', 'con', 'aux.txt', 'x.', 'a\u0000b']) {
      assert.throws(() => assertSafeRelative(bad), (error) => error.code === 'E_PATH', `should reject ${JSON.stringify(bad)}`)
    }
  })

  it('接受并规范化正常相对路径', () => {
    assert.equal(assertSafeRelative('books/b0123456789ab/meta.json'), 'books/b0123456789ab/meta.json')
    assert.equal(assertSafeRelative('./inbox/./a.epub'), 'inbox/a.epub')
  })

  it('isInsideOrEqual 不把前缀相同的兄弟目录当成子目录', () => {
    assert.equal(isInsideOrEqual('/w/reading', '/w/reading/books'), true)
    assert.equal(isInsideOrEqual('/w/reading', '/w/reading'), true)
    assert.equal(isInsideOrEqual('/w/reading', '/w/reading-evil/x'), false)
  })

  it('resolveInReading 拒绝 reading/ 之外的路径', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'rl-paths-'))
    try {
      await mkdir(path.join(root, 'reading'), { recursive: true })
      const ok = await resolveInReading(root, 'books/x.json')
      assert.ok(ok.startsWith(path.join(root, 'reading')))
      await assert.rejects(() => resolveInReading(root, '../escape.json'), (error) => error.code === 'E_PATH')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('json-file', () => {
  let root
  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'rl-json-'))
  })
  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('缺失文件返回 null，写入补 schemaVersion 并可读回', async () => {
    const file = path.join(root, 'a.json')
    assert.equal(await readJson(file), null)
    await writeJsonAtomic(file, { hello: 1 }, { schemaVersion: SCHEMA_VERSION.index })
    const raw = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(raw.schemaVersion, SCHEMA_VERSION.index)
    assert.equal(raw.hello, 1)
    const back = await readJson(file, { schemaVersion: SCHEMA_VERSION.index })
    assert.equal(back.hello, 1)
  })

  it('版本不符报 E_SCHEMA，坏 JSON 报 E_IO', async () => {
    const versioned = path.join(root, 'v.json')
    await writeJsonAtomic(versioned, { a: 1 }, { schemaVersion: 2 })
    await assert.rejects(() => readJson(versioned, { schemaVersion: 1 }), (error) => error.code === 'E_SCHEMA')

    const broken = path.join(root, 'b.json')
    await writeFile(broken, '{ not json', 'utf8')
    await assert.rejects(() => readJson(broken), (error) => error.code === 'E_IO')
  })
})

describe('ids', () => {
  it('格式与生成函数一致', () => {
    assert.equal(isBookId(bookIdFromBytes(Buffer.from('x'))), true)
    assert.equal(isBookId('b123'), false)
    assert.equal(chunkIdAt(7), 'c-000007')
    assert.equal(isChunkId(chunkIdAt(7)), true)
    assert.equal(threadIdAt(3), 't-03')
    assert.equal(isThreadId(threadIdAt(3)), true)
  })
})

describe('errors / locale', () => {
  it('每个错误码在中英文 locale 里都有文案', async () => {
    for (const lang of ['zh', 'en']) {
      const raw = JSON.parse(await readFile(path.join(ROOT, 'locale', `${lang}.json`), 'utf8'))
      for (const code of [...ERROR_CODES, 'E_UNKNOWN']) {
        assert.equal(typeof raw.error[code], 'string', `${lang}.error.${code}`)
        assert.ok(raw.error[code].length > 0, `${lang}.error.${code} 非空`)
        assert.notEqual(messageFor(code, lang), code, `${lang} 文案未回退成 code`)
      }
    }
  })

  it('ui 段中英 key 完全一致', async () => {
    const zh = JSON.parse(await readFile(path.join(ROOT, 'locale/zh.json'), 'utf8'))
    const en = JSON.parse(await readFile(path.join(ROOT, 'locale/en.json'), 'utf8'))
    assert.deepEqual(Object.keys(zh.ui).sort(), Object.keys(en.ui).sort())
    assert.deepEqual(Object.keys(zh.error).sort(), Object.keys(en.error).sort())
  })

  it('wire 信封带 code/message/requestId，未知异常按 E_IO', () => {
    const wire = toWireError(new ReadingError('E_TOO_LARGE', { limit: 10 }), { requestId: 'req-1', lang: 'en' })
    assert.equal(wire.ok, false)
    assert.equal(wire.error.code, 'E_TOO_LARGE')
    assert.equal(wire.error.requestId, 'req-1')
    assert.equal(wire.error.details.limit, 10)
    assert.match(wire.error.message, /size limit/i)
    assert.equal(toWireError(new Error('boom'), { requestId: 'req-2' }).error.code, 'E_IO')
    assert.equal(httpStatusOf('E_NOT_IMPLEMENTED'), 501)
    assert.equal(pickLanguage('en-US,en;q=0.9'), 'en')
    assert.equal(pickLanguage(undefined), 'zh')
  })
})

describe('tools', () => {
  it('六个工具的 name/parameters 合法且与 04 §1.3 一致', () => {
    const definitions = makeToolDefinitions()
    assert.deepEqual(Object.keys(definitions).sort(), [...TOOL_NAMES].sort())
    for (const name of TOOL_NAMES) {
      const definition = definitions[name]
      assert.equal(definition.name, name)
      assert.match(name, /^reading_[a-z]+$/, '工具名不能带点')
      assert.equal(definition.parameters.type, 'object')
      // 桩工具用宽松 json；M3 起 reading_map 用 oneOf(ok/error) 精确约束信封。
      assert.ok(
        definition.output.schema.type === 'json' || Array.isArray(definition.output.schema.oneOf),
        `${name} output schema`,
      )
      assert.equal(typeof definition.execute, 'function')
    }
  })

  it('桩调用抛 E_NOT_IMPLEMENTED', async () => {
    const definitions = makeToolDefinitions()
    await assert.rejects(
      () => definitions.reading_import.execute({ path: 'a.epub' }, {}),
      (error) => error.code === 'E_NOT_IMPLEMENTED',
    )
  })
})

describe('route table', () => {
  it('25 条路由，方法 + 路径唯一', () => {
    const table = routeTable()
    assert.equal(table.length, 25)
    const keys = table.map((entry) => `${entry.method} ${entry.pattern}`)
    assert.equal(new Set(keys).size, 25)
  })

  it('包含 health / books / events 与全部工具面路由', () => {
    const keys = routeTable().map((entry) => entry.pattern)
    assert.ok(keys.some((pattern) => /\/health\$/.test(pattern)), 'health')
    assert.ok(keys.some((pattern) => /\/events\$/.test(pattern)), 'events')
    assert.ok(keys.some((pattern) => pattern.includes('/chunks')), 'chunks')
    assert.ok(keys.some((pattern) => pattern.includes('/threads')), 'threads')
  })
})