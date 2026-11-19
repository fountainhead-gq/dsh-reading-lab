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
    mapGenerationTimeoutMs: positiveInt(source.mapGenerationTimeoutMs, LIMITS.mapGenerationTimeoutMs),
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
 * 读取可选 Host 服务。
 *
 * Cordis 对未注入的服务属性访问会抛 `cannot get property ... without inject`；
 * 这里的两项都是可选依赖（headless / 精简宿主可能没有），必须走 `ctx.get()`，
 * 不能写成 `ctx.workspaceRegistry`（t11 缺陷 QA-11-01 的根因）。
 * @param {any} ctx
 * @param {string} name
 * @returns {any}
 */
function optionalService(ctx, name) {
  try {
    return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

/**
 * 从宿主服务取默认工作区路径。
 *
 * 顺序：`workingDirectory.defaultDirectory`（部署级兜底）→ registry 的直接属性 /
 * `getDefault()` → `registry.list()` 的第一项。`list()` 按注册表顺序返回，第一项即
 * 用户最初的默认工作区；旧实现只在「恰好一个 workspace」时才采用，多 workspace 时
 * 退回 `process.cwd()`，见 t11 缺陷 QA-11-01。
 *
 * 任何异常都当作「没有」，退回下一个候选。
 * @param {any} ctx
 * @returns {string | undefined}
 */
export function defaultWorkspaceFromRegistry(ctx) {
  const workingDirectory = optionalService(ctx, 'workingDirectory')
  const deploymentDefault = workingDirectory?.defaultDirectory
  if (typeof deploymentDefault === 'string' && deploymentDefault.trim() !== '') return deploymentDefault
  const registry = optionalService(ctx, 'workspaceRegistry')
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
      if (!Array.isArray(list) || list.length === 0) return undefined
      const preferred = list.find((item) => item?.isDefault === true || item?.default === true) ?? list[0]
      if (typeof preferred?.path === 'string' && preferred.path.trim() !== '') return preferred.path
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