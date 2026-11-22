/**
 * 设置与书库根解析（t33，docs/03-design.md §5.1，docs/04-api.md §4.2 #31/#32）。
 *
 * 重点不是「能读能写」，而是几条曾经坑过真实宿主的边界：
 * - 设置文件损坏时不能让插件加载失败；
 * - 回退到 cwd 时必须把 isFallback 置 true（以前把 profile 目录当工作区、静默成功）；
 * - 迁移失败必须回滚，不允许半迁移。
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import {
  LIBRARY_ENTRIES,
  directoryExists,
  dshHomeDir,
  migrateLibrary,
  normalizeSettings,
  readSettings,
  resolveLibraryRoot,
  settingsFile,
  validateLibraryRoot,
  writeSettings,
} from '../../src/host/settings.js'

let temp

before(async () => {
  temp = await mkdtemp(path.join(tmpdir(), 'rl-settings-'))
})

after(async () => {
  await rm(temp, { recursive: true, force: true })
})

const dir = (name) => path.join(temp, name)

describe('settings 读写', () => {
  it('home 目录按 DSH_HOME 解析，设置固定落在 reading-lab/settings.json', () => {
    assert.equal(dshHomeDir({ DSH_HOME: dir('home') }), path.resolve(dir('home')))
    assert.equal(settingsFile({ DSH_HOME: dir('home') }), path.join(dir('home'), 'reading-lab', 'settings.json'))
    assert.match(settingsFile({}), /[\\/]\.dsh[\\/]reading-lab[\\/]settings\.json$/)
  })

  it('normalizeSettings 丢弃脏值', () => {
    assert.deepEqual(normalizeSettings(null), { schemaVersion: 1, libraryRoot: null, exportRoot: null })
    assert.deepEqual(normalizeSettings({ libraryRoot: '  ' }), { schemaVersion: 1, libraryRoot: null, exportRoot: null })
    assert.deepEqual(normalizeSettings({ libraryRoot: dir('lib'), extra: 1 }), {
      schemaVersion: 1,
      libraryRoot: dir('lib'),
      exportRoot: null,
    })
  })

  it('文件缺失返回默认值，不抛', () => {
    const result = readSettings(path.join(temp, 'missing', 'settings.json'))
    assert.equal(result.corrupted, false)
    assert.equal(result.settings.libraryRoot, null)
  })

  it('文件损坏返回默认值并标记 corrupted', async () => {
    const file = path.join(temp, 'broken', 'settings.json')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, '{ not json', 'utf8')
    const result = readSettings(file)
    assert.equal(result.corrupted, true)
    assert.equal(result.settings.libraryRoot, null)
  })

  it('写入是可读的 JSON，且会建父目录', async () => {
    const file = path.join(temp, 'write', 'nested', 'settings.json')
    await writeSettings({ libraryRoot: dir('lib-a') }, file)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      schemaVersion: 1,
      libraryRoot: dir('lib-a'),
      exportRoot: null,
    })
    await writeSettings({ libraryRoot: null }, file)
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { schemaVersion: 1, libraryRoot: null, exportRoot: null })
  })
})

describe('根解析顺序', () => {
  it('① 设置优先：使用 settings.libraryRoot', async () => {
    const root = dir('pref-root')
    await mkdir(root, { recursive: true })
    const layout = resolveLibraryRoot({
      settings: { libraryRoot: root },
      ctx: { get: () => ({ defaultDirectory: dir('workspace') }) },
      cwd: temp,
    })
    assert.equal(layout.root, root)
    assert.equal(layout.source, 'settings')
    assert.equal(layout.isFallback, false)
  })

  it('② 无设置时用工作区下的 reading/', async () => {
    const workspace = dir('workspace-a')
    await mkdir(workspace, { recursive: true })
    const layout = resolveLibraryRoot({
      settings: { libraryRoot: null },
      ctx: { get: (name) => (name === 'workingDirectory' ? { defaultDirectory: workspace } : undefined) },
      cwd: temp,
    })
    assert.equal(layout.workspaceRoot, workspace)
    assert.equal(layout.root, path.join(workspace, 'reading'))
    assert.equal(layout.source, 'workspace')
    assert.equal(layout.isFallback, false)
  })

  it('③ 工作区缺失时回退 cwd 并标 isFallback', () => {
    const layout = resolveLibraryRoot({
      settings: { libraryRoot: null },
      ctx: { get: () => undefined },
      cwd: dir('cwd-only'),
    })
    assert.equal(layout.root, path.join(dir('cwd-only'), 'reading'))
    assert.equal(layout.source, 'cwd')
    assert.equal(layout.isFallback, true)
    assert.equal(layout.reason, 'workspace-unavailable')
  })

  it('设置里的路径不可用时继续解析工作区，并给出 settingsError', async () => {
    const workspace = dir('workspace-b')
    await mkdir(workspace, { recursive: true })
    const layout = resolveLibraryRoot({
      settings: { libraryRoot: dir('gone') },
      ctx: { get: () => ({ defaultDirectory: workspace }) },
      cwd: temp,
    })
    assert.equal(layout.root, path.join(workspace, 'reading'))
    assert.equal(layout.isFallback, false)
    assert.equal(layout.settingsError, 'unreadable')
  })

  it('显式 config.workspaceRoot 覆盖设置（测试隔离依赖这一条）', async () => {
    const workspace = dir('workspace-c')
    const preference = dir('preference-c')
    await mkdir(workspace, { recursive: true })
    await mkdir(preference, { recursive: true })
    const layout = resolveLibraryRoot({
      config: { workspaceRoot: workspace },
      settings: { libraryRoot: preference },
      ctx: { get: () => ({ defaultDirectory: dir('ignored') }) },
      cwd: temp,
    })
    assert.equal(layout.root, path.join(workspace, 'reading'))
    assert.equal(layout.source, 'workspace')
  })
})

describe('路径校验', () => {
  it('拒绝相对路径与空值', () => {
    assert.throws(() => validateLibraryRoot('relative/path'), (error) => error.code === 'E_PATH' && error.details.reason === 'not-absolute')
    assert.throws(() => validateLibraryRoot('   '), (error) => error.code === 'E_PATH' && error.details.reason === 'empty')
  })

  it('拒绝文件', async () => {
    const file = path.join(temp, 'not-a-dir.txt')
    await writeFile(file, 'x', 'utf8')
    assert.throws(() => validateLibraryRoot(file), (error) => error.code === 'E_PATH' && error.details.reason === 'not-a-directory')
  })

  it('目录不存在时创建，返回 realpath', async () => {
    const target = path.join(temp, 'created', 'library')
    const real = validateLibraryRoot(target)
    assert.equal(path.resolve(real).toLowerCase(), path.resolve(target).toLowerCase())
    assert.equal(directoryExists(target), true)
  })

  it('拒绝与当前根相同', async () => {
    const current = dir('same-root')
    await mkdir(current, { recursive: true })
    assert.throws(
      () => validateLibraryRoot(current, { current }),
      (error) => error.code === 'E_PATH' && error.details.reason === 'same-as-current',
    )
  })
})

describe('书库迁移', () => {
  async function seed(root) {
    await mkdir(path.join(root, 'books', 'b000000000001'), { recursive: true })
    await writeFile(path.join(root, 'books', 'b000000000001', 'meta.json'), '{"id":"b000000000001"}', 'utf8')
    await mkdir(path.join(root, 'exports'), { recursive: true })
    await writeFile(path.join(root, 'exports', 'a.md'), 'hello', 'utf8')
    await writeFile(path.join(root, 'index.json'), '{"revision":1}', 'utf8')
    await mkdir(path.join(root, 'inbox'), { recursive: true })
  }

  it('把四个条目整体搬过去，缺的记 skipped', async () => {
    const from = dir('migrate-from')
    const to = dir('migrate-to')
    await seed(from)
    await rm(path.join(from, 'inbox'), { recursive: true, force: true })
    const result = await migrateLibrary(from, to)
    assert.deepEqual(result.moved.map((item) => item.entry), ['books', 'exports', 'index.json'])
    assert.deepEqual(result.skipped, ['inbox'])
    assert.equal(directoryExists(path.join(to, 'books', 'b000000000001')), true)
    assert.equal(directoryExists(path.join(from, 'books')), false)
  })

  it('目标已有同名条目时拒绝，不动任何东西', async () => {
    const from = dir('migrate-clash-from')
    const to = dir('migrate-clash-to')
    await seed(from)
    await mkdir(path.join(to, 'books'), { recursive: true })
    await writeFile(path.join(to, 'books', 'stale.txt'), 'not empty', 'utf8')
    await assert.rejects(
      () => migrateLibrary(from, to),
      (error) => error.code === 'E_PATH' && error.details.reason === 'target-not-empty',
    )
    assert.equal(directoryExists(path.join(from, 'books', 'b000000000001')), true)
  })

  it('目标已是空目录（早先 ensureLayout 留下的）时直接复用，不误报 non-empty', async () => {
    const from = dir('migrate-empty-from')
    const to = dir('migrate-empty-to')
    await seed(from)
    // 目标根已存在且三个子目录都建好了，但一本书都没有——这是真实宿主切换根时最常见的样子。
    for (const entry of ['books', 'exports', 'inbox']) {
      await mkdir(path.join(to, entry), { recursive: true })
    }
    const result = await migrateLibrary(from, to)
    assert.deepEqual(result.moved.map((item) => item.entry), ['books', 'exports', 'inbox', 'index.json'])
    assert.equal(directoryExists(path.join(to, 'books', 'b000000000001')), true)
    assert.equal(await readFile(path.join(to, 'exports', 'a.md'), 'utf8'), 'hello')
    assert.equal(directoryExists(path.join(from, 'books')), false)
  })

  it('中途失败回滚已搬的条目，不留半迁移', async () => {
    const from = dir('migrate-fail-from')
    const to = dir('migrate-fail-to')
    await seed(from)
    let calls = 0
    const flakyMove = async (source, target) => {
      calls += 1
      if (calls === 2) throw new Error('simulated disk error')
      const fs = await import('node:fs/promises')
      await fs.rename(source, target)
      return 'rename'
    }
    await assert.rejects(
      () => migrateLibrary(from, to, { move: flakyMove }),
      (error) => error.code === 'E_IO' && error.details.op === 'migrate',
    )
    // 第一条（books）必须搬回原处，目标目录里不留副本。
    assert.equal(directoryExists(path.join(from, 'books', 'b000000000001')), true)
    assert.equal(directoryExists(path.join(to, 'books')), false)
  })

  it('四个条目顺序与 03 §5.1 一致', () => {
    assert.deepEqual(LIBRARY_ENTRIES, ['books', 'exports', 'inbox', 'index.json'])
  })
})