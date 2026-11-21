/**
 * 导出目录的只读访问（04 §4.2 #23–24）。
 *
 * 这里只做两件事：列目录、把 `name` 安全地解析成 `reading/exports/` 下的绝对路径。
 * 导出文件的**生成**还没实现（v0.2），所以本模块没有写入逻辑；目录按需惰性创建，
 * 保证 `GET /exports` 在空工作区也能 200 返回空列表。
 */
import { mkdir, readdir, stat } from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError } from '../errors.js'
import { isInsideOrEqual } from '../paths.js'

/** 04 §4.2 #23：只列普通文件，按 mtime 降序，最多 200 条。 */
export const EXPORT_LIST_LIMIT = 200

/** 扩展名 → Content-Type（04 §4.2 #24）。 */
const CONTENT_TYPES = Object.freeze({
  '.md': 'text/markdown; charset=utf-8',
  '.opml': 'text/x-opml; charset=utf-8',
  '.json': 'application/json',
  '.html': 'text/html; charset=utf-8',
})

export function contentTypeOf(name) {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * 校验用户给的导出文件名：只允许单段、无 `..`、无路径分隔符。
 * 不合规一律 400 `E_PATH`（04 §4.2 #24），不碰磁盘。
 */
export function assertExportName(name) {
  const text = typeof name === 'string' ? name : ''
  const problem = (reason) => new ReadingError('E_PATH', { reason, name: text.slice(0, 120) })
  if (text.length === 0) throw problem('export-name-empty')
  if (/[/\\\0]/.test(text)) throw problem('export-name-separator')
  if (text === '.' || text === '..' || text.includes('..')) throw problem('export-name-traversal')
  if (text.length > 200) throw problem('export-name-too-long')
  return text
}

/** 目录不存在时惰性创建；已存在则什么都不做。 */
export async function ensureExportsDir(service) {
  await mkdir(service.exportsDir, { recursive: true })
  return service.exportsDir
}

/**
 * @param {{ exportsDir: string }} service
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{ files: Array<{ name: string, bytes: number, mtime: string }> }>}
 */
export async function listExports(service, options = {}) {
  const limit = Number.isFinite(options.limit) ? Number(options.limit) : EXPORT_LIST_LIMIT
  const dir = await ensureExportsDir(service)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw new ReadingError('E_IO', { op: 'read', reason: 'exports-dir' }, { cause: error })
  }
  const files = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      const info = await stat(path.join(dir, entry.name))
      files.push({ name: entry.name, bytes: info.size, mtime: info.mtime.toISOString() })
    } catch {
      // 列表期间被删掉的文件直接跳过，不让整次请求失败。
    }
  }
  files.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : a.name.localeCompare(b.name)))
  return { files: files.slice(0, Math.max(0, limit)) }
}

/**
 * 把 `name` 解析成 `reading/exports/<name>` 的绝对路径，并复核没有逃出导出目录。
 * @returns {Promise<{ name: string, file: string }>}
 */
export async function resolveExportFile(service, name) {
  const safe = assertExportName(name)
  const dir = await ensureExportsDir(service)
  const file = path.resolve(dir, safe)
  if (!isInsideOrEqual(path.resolve(dir), file)) {
    throw new ReadingError('E_PATH', { reason: 'export-outside', name: safe })
  }
  return { name: safe, file }
}