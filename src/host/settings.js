/**
 * 插件设置与书库根解析（owner: host-core，docs/03-design.md §5.1 / §5.6，
 * docs/04-api.md §4.2 #31 / #32）。
 *
 * 为什么设置不放在书库里：书库根本身是设置项，如果把 settings.json 放进
 * `reading/`，换根的时候设置会跟着走，用户就再也无法把「设置」与「数据」分开备份。
 * 因此设置固定落在 `$DSH_HOME/reading-lab/settings.json`，与书库解耦。
 *
 * 根解析顺序（t33 修正，之前把宿主 profile 目录当成了工作区就静默成功了）：
 *   ① settings.libraryRoot（绝对路径，可创建）→ ② 工作区下的 `reading/` → ③ cwd 下的 `reading/`（回退）
 *
 * 只有 ③ 才把 `isFallback` 置 true——回退不是正常状态，面板必须能看出来。
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { ReadingError } from './errors.js'
import { READING_DIR } from './limits.js'

export const SETTINGS_SCHEMA_VERSION = 1
export const SETTINGS_DIR_NAME = 'reading-lab'
export const SETTINGS_FILE_NAME = 'settings.json'
/** 迁移时整体搬运的条目（03 §5.1）。 */
export const LIBRARY_ENTRIES = ['books', 'exports', 'inbox', 'index.json']

/** `$DSH_HOME`，缺省 `~/.dsh`（与 Host 自身一致）。 */
export function dshHomeDir(env = process.env) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return configured !== '' ? path.resolve(configured) : path.join(os.homedir(), '.dsh')
}

export function settingsFile(env = process.env) {
  return path.join(dshHomeDir(env), SETTINGS_DIR_NAME, SETTINGS_FILE_NAME)
}

/**
 * 规整设置对象：只保留契约里的字段，脏值一律降级为默认。
 * @param {unknown} raw
 * @returns {{ schemaVersion: number, libraryRoot: string | null }}
 */
export function normalizeSettings(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const libraryRoot = typeof value.libraryRoot === 'string' && value.libraryRoot.trim() !== ''
    ? value.libraryRoot.trim()
    : null
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, libraryRoot }
}

/**
 * 同步读设置（`apply` 是同步的，启动时必须立刻拿到根）。
 * 文件缺失或损坏都返回默认值，不抛：设置坏了不能导致插件加载失败。
 * @param {string} [file]
 * @returns {{ settings: { schemaVersion: number, libraryRoot: string | null }, corrupted: boolean }}
 */
export function readSettings(file = settingsFile()) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    const corrupted = error?.code !== 'ENOENT'
    return { settings: normalizeSettings(null), corrupted }
  }
  try {
    return { settings: normalizeSettings(JSON.parse(text)), corrupted: false }
  } catch {
    return { settings: normalizeSettings(null), corrupted: true }
  }
}

/**
 * 原子写设置：同目录 tmp + rename，2 空格缩进、末尾换行。
 * @param {{ libraryRoot: string | null }} value
 * @param {string} [file]
 */
export async function writeSettings(value, file = settingsFile()) {
  const target = path.resolve(file)
  const dir = path.dirname(target)
  await fs.mkdir(dir, { recursive: true })
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now().toString(16)}.tmp`)
  const body = `${JSON.stringify(normalizeSettings(value), null, 2)}\n`
  try {
    await fs.writeFile(temp, body, 'utf8')
    await fs.rename(temp, target)
  } catch (error) {
    try {
      await fs.unlink(temp)
    } catch {
      // tmp 可能根本没写出来。
    }
    throw new ReadingError('E_IO', { op: 'write', reason: 'settings' }, { cause: error })
  }
}

function ensureDirectorySync(target, op) {
  const info = statSync(target)
  if (!info.isDirectory()) throw new ReadingError('E_PATH', { op, reason: 'not-a-directory' })
  return realpathSync(target)
}

function workspaceDirectory(ctx) {
  try {
    // Cordis：未 inject 的 Service 键直接属性访问会抛（D-03-13），必须走 ctx.get。
    const workingDirectory = typeof ctx?.get === 'function' ? ctx.get('workingDirectory') : undefined
    const direct = workingDirectory?.defaultDirectory
    if (typeof direct === 'string' && direct.trim() !== '') return direct
    if (typeof workingDirectory?.ensure === 'function') {
      // 没有默认目录时才向宿主申请（某些宿主需要 agent 才能确定目录，失败就继续回退）。
      const ensured = workingDirectory.ensure()
      if (typeof ensured === 'string' && ensured.trim() !== '') return ensured
      if (typeof ensured?.path === 'string' && ensured.path.trim() !== '') return ensured.path
    }
  } catch {
    // 访问失败视为宿主没有提供工作区。
  }
  return undefined
}

/**
 * 解析书库根。
 * @param {{ ctx?: any, config?: Record<string, unknown>, settings?: { libraryRoot?: string | null }, cwd?: string }} options
 * @returns {{ root: string, workspaceRoot: string | null, isFallback: boolean, source: 'settings' | 'workspace' | 'cwd', reason: string | null, settingsError: string | null }}
 */
export function resolveLibraryRoot(options = {}) {
  const { ctx, config, settings, cwd = process.cwd() } = options
  const declared = typeof settings?.libraryRoot === 'string' ? settings.libraryRoot.trim() : ''
  const configuredWorkspace = typeof config?.workspaceRoot === 'string' && config.workspaceRoot.trim() !== ''
    ? config.workspaceRoot.trim()
    : undefined
  const workspaceCandidate = configuredWorkspace ?? workspaceDirectory(ctx)
  let workspaceRoot = null
  let settingsError = null

  if (workspaceCandidate) {
    try {
      workspaceRoot = realpathSync(path.resolve(workspaceCandidate))
    } catch {
      workspaceRoot = null
    }
  }

  if (declared !== '' && !configuredWorkspace) {
    // `config.workspaceRoot` 是显式部署/测试覆盖，优先级高于用户设置：
    // 测试用临时工作区时不能因为开发机上的 settings.json 把书写到别处去。
    try {
      if (!path.isAbsolute(declared)) throw new ReadingError('E_PATH', { field: 'libraryRoot', reason: 'not-absolute' })
      const root = ensureDirectorySync(declared, 'resolve-library')
      return { root, workspaceRoot, isFallback: false, source: 'settings', reason: null, settingsError: null }
    } catch (error) {
      // 设置里写了不可用的路径：不静默改成别处，继续按工作区解析并由调用方把原因报出去。
      settingsError = error instanceof ReadingError ? String(error.details?.reason ?? error.code) : 'unreadable'
    }
  }

  if (workspaceRoot) {
    return {
      root: path.join(workspaceRoot, READING_DIR),
      workspaceRoot,
      isFallback: false,
      source: 'workspace',
      reason: null,
      settingsError,
    }
  }

  return {
    root: path.join(path.resolve(cwd), READING_DIR),
    workspaceRoot: null,
    isFallback: true,
    source: 'cwd',
    reason: 'workspace-unavailable',
    settingsError,
  }
}

/**
 * 校验用户输入的书库根：绝对路径、不是文件、能创建、能写、与当前根不同。
 * @param {string} raw
 * @param {{ current?: string | null }} [options]
 * @returns {string} realpath
 */
export function validateLibraryRoot(raw, options = {}) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ReadingError('E_PATH', { field: 'path', reason: 'empty' })
  }
  const value = raw.trim()
  if (!path.isAbsolute(value)) {
    throw new ReadingError('E_PATH', { field: 'path', reason: 'not-absolute' })
  }
  try {
    const info = statSync(value)
    if (!info.isDirectory()) throw new ReadingError('E_PATH', { field: 'path', reason: 'not-a-directory' })
  } catch (error) {
    if (error instanceof ReadingError) throw error
    if (error?.code !== 'ENOENT') throw new ReadingError('E_IO', { op: 'stat', field: 'path' }, { cause: error })
    try {
      mkdirSync(value, { recursive: true })
    } catch (mkdirError) {
      throw new ReadingError('E_IO', { op: 'mkdir', field: 'path' }, { cause: mkdirError })
    }
  }

  let real
  try {
    real = realpathSync(value)
  } catch (error) {
    throw new ReadingError('E_IO', { op: 'realpath', field: 'path' }, { cause: error })
  }

  const current = typeof options.current === 'string' && options.current.trim() !== ''
    ? path.resolve(options.current)
    : null
  if (current && path.resolve(real) === current) {
    throw new ReadingError('E_PATH', { field: 'path', reason: 'same-as-current' })
  }

  // 写权限探针：目录存在但不可写时，要到第一次导入才暴露，体验很差。
  const probeFile = path.join(real, '.reading-lab-write-probe')
  try {
    writeFileSync(probeFile, '', 'utf8')
  } catch (error) {
    throw new ReadingError('E_IO', { op: 'write', field: 'path', reason: 'not-writable' }, { cause: error })
  } finally {
    try {
      unlinkSync(probeFile)
    } catch {
      // 探针可能没写成功。
    }
  }
  return real
}

async function movePath(from, to) {
  const parent = path.dirname(to)
  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.rename(from, to)
    return 'rename'
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await fs.cp(from, to, { recursive: true, errorOnExist: true, force: false })
    await fs.rm(from, { recursive: true, force: true })
    return 'copy'
  }
}

/**
 * 整体迁移书库：`books/`、`exports/`、`inbox/`、`index.json`。
 * 任一条失败就把已搬的搬回去；回滚失败会写进 `details.rollbackFailed`，绝不假装成功。
 * 目标位置已有同名条目时：空目录（早先的 `ensureLayout` 或空跑留下的）直接复用，
 * 非空则拒绝——合并两套书库不在本任务范围，静默合并比报错更危险。
 *
 * @param {string} fromRoot 旧的 `reading/` 目录
 * @param {string} toRoot 新的 `reading/` 目录
 * @param {{ move?: (from: string, to: string) => Promise<string> }} [options] 测试注入搬运用
 * @returns {Promise<{ moved: Array<{ entry: string, mode: string }>, skipped: string[] }>}
 */
export async function migrateLibrary(fromRoot, toRoot, options = {}) {
  const move = typeof options.move === 'function' ? options.move : movePath
  const from = path.resolve(fromRoot)
  const to = path.resolve(toRoot)
  if (from === to) throw new ReadingError('E_PATH', { reason: 'same-as-current' })

  const plan = []
  const skipped = []
  for (const entry of LIBRARY_ENTRIES) {
    const source = path.join(from, entry)
    if (!existsSync(source)) {
      skipped.push(entry)
      continue
    }
    const targetEntry = path.join(to, entry)
    let replaceEmpty = false
    if (existsSync(targetEntry)) {
      const stats = statSync(targetEntry)
      const empty = stats.isDirectory() && (await fs.readdir(targetEntry)).length === 0
      if (!empty) throw new ReadingError('E_PATH', { reason: 'target-not-empty', entry })
      replaceEmpty = true
    }
    plan.push({ entry, source, replaceEmpty })
  }

  await fs.mkdir(to, { recursive: true })
  const moved = []
  try {
    for (const item of plan) {
      const target = path.join(to, item.entry)
      if (item.replaceEmpty) await fs.rm(target, { recursive: true, force: true })
      const mode = await move(item.source, target)
      moved.push({ entry: item.entry, mode })
    }
  } catch (error) {
    const rollbackFailed = []
    for (const item of moved.reverse()) {
      try {
        await movePath(path.join(to, item.entry), path.join(from, item.entry))
      } catch (rollbackError) {
        rollbackFailed.push({ entry: item.entry, message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) })
      }
    }
    throw new ReadingError(
      'E_IO',
      { op: 'migrate', rollbackFailed: rollbackFailed.length > 0 ? rollbackFailed : undefined },
      { cause: error },
    )
  }

  return { moved, skipped }
}

/** 路径是否存在且为目录（`GET /settings` 的 `exists`）。 */
export function directoryExists(target) {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}