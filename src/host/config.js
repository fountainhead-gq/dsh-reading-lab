/**
 * 配置解析（docs/04-api.md §2.2、§2.3）。
 *
 * 两件事：
 * - `resolveLimits(config)`：把用户配置叠在 `limits.js` 的默认值上，非法值按默认值处理（不抛错）；
 * - `resolveWorkspaceRoot(ctx, config)`：确定工作区根，失败抛 `E_IO`，由 `/health` 报 503。
 */
import { mkdirSync, realpathSync, statSync } from 'node:fs'
import * as path from 'node:path'

import { ReadingError } from './errors.js'
import { DEFAULT_EXPORT_FORMATS, EXPORT_FORMATS, LIMITS, READING_DIR } from './limits.js'

function positiveInt(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * @param {Record<string, unknown> | undefined} config
 * @returns {{ [K in keyof typeof LIMITS]: number } & { exportFormats: string[], allowAgentImportPaths: boolean, workspaceRoot?: string }}
 */
export function resolveLimits(config) {
  const source = config && typeof config === 'object' ? config : {}
  const formats = Array.isArray(source.exportFormats)
    ? EXPORT_FORMATS.filter((format) => source.exportFormats.includes(format))
    : [...DEFAULT_EXPORT_FORMATS]

  return Object.freeze({
    maxUploadBytes: positiveInt(source.maxUploadBytes, LIMITS.maxUploadBytes),
    maxPdfPages: positiveInt(source.maxPdfPages, LIMITS.maxPdfPages),
    maxEpubChars: positiveInt(source.maxEpubChars, LIMITS.maxEpubChars),
    maxChunks: positiveInt(source.maxChunks, LIMITS.maxChunks),
    askTimeoutMs: positiveInt(source.askTimeoutMs, LIMITS.askTimeoutMs),
    chunkTargetMin: LIMITS.chunkTargetMin,
    chunkTargetMax: LIMITS.chunkTargetMax,
    chunkHardMax: LIMITS.chunkHardMax,
    chunkMinChars: LIMITS.chunkMinChars,
    maxZipEntries: LIMITS.maxZipEntries,
    maxZipEntryBytes: LIMITS.maxZipEntryBytes,
    maxZipTotalBytes: LIMITS.maxZipTotalBytes,
    maxZipRatio: LIMITS.maxZipRatio,
    minDocumentChars: LIMITS.minDocumentChars,
    ssePingMs: LIMITS.ssePingMs,
    sseIdleTimeoutMs: LIMITS.sseIdleTimeoutMs,
    sseQueueLimit: LIMITS.sseQueueLimit,
    eventThrottleMs: LIMITS.eventThrottleMs,
    helloBooksLimit: LIMITS.helloBooksLimit,
    exportFormats: formats.length > 0 ? formats : [...DEFAULT_EXPORT_FORMATS],
    allowAgentImportPaths: source.allowAgentImportPaths !== false,
    workspaceRoot: typeof source.workspaceRoot === 'string' && source.workspaceRoot.trim() !== ''
      ? source.workspaceRoot
      : undefined,
  })
}

/**
 * 从 `ctx.workspaceRegistry`（dsh-workspace 服务）取默认工作区路径。
 * 该服务的形态在不同版本略有差异，这里只做保守探测：任何异常都当作「没有」。
 * @param {any} ctx
 * @returns {string | undefined}
 */
export function defaultWorkspaceFromRegistry(ctx) {
  const registry = ctx?.workspaceRegistry
  if (!registry) return undefined
  try {
    const direct = registry.defaultWorkspace ?? registry.defaultWorkspacePath ?? registry.activeWorkspace
    if (typeof direct === 'string' && direct.trim() !== '') return direct
    if (typeof registry.getDefault === 'function') {
      const value = registry.getDefault()
      if (typeof value === 'string' && value.trim() !== '') return value
      if (value && typeof value.path === 'string') return value.path
    }
    if (typeof registry.list === 'function') {
      const list = registry.list()
      if (Array.isArray(list) && list.length === 1 && typeof list[0]?.path === 'string') return list[0].path
    }
  } catch {
    // 探测失败即视为未配置，退回 process.cwd()。
  }
  return undefined
}

function assertDirectorySync(target) {
  const info = statSync(target)
  if (!info.isDirectory()) throw new ReadingError('E_IO', { op: 'resolve-root', reason: 'not-a-directory' })
  return realpathSync(target)
}

/**
 * 解析工作区根：config → workspaceRegistry 默认工作区 → process.cwd()。
 *
 * 同步实现：Cordis 的 `apply` 是同步调用的，入口需要拿到确定的 `root`
 * 再装配路由，否则 `/health` 会先报一轮假的 `unavailable`。
 *
 * @param {any} ctx
 * @param {Record<string, unknown> | undefined} config
 * @returns {string}
 */
export function resolveWorkspaceRoot(ctx, config) {
  const limits = resolveLimits(config)
  const candidates = [limits.workspaceRoot, defaultWorkspaceFromRegistry(ctx), process.cwd()]
  let lastError
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate.trim() === '') continue
    try {
      return assertDirectorySync(path.resolve(candidate))
    } catch (error) {
      lastError = error
    }
  }
  throw new ReadingError('E_IO', { op: 'resolve-root' }, { cause: lastError })
}

/**
 * 建 `reading/{books,inbox,exports}`。
 * 失败不抛：插件加载不能因为目录不可写而失败，`/health` 会报 `storage:'unavailable'`。
 * @param {string} root
 * @returns {boolean} 是否可用
 */
export function ensureLayout(root) {
  try {
    mkdirSync(path.join(root, READING_DIR, 'books'), { recursive: true })
    mkdirSync(path.join(root, READING_DIR, 'inbox'), { recursive: true })
    mkdirSync(path.join(root, READING_DIR, 'exports'), { recursive: true })
    return true
  } catch {
    return false
  }
}