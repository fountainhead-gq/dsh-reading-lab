/**
 * 导出服务（owner: export，docs/03-design.md §9、04 §3.5）。
 *
 * 职责：选格式 → 读源文件（meta/chunks/map/notes/threads）→ 渲染 → 命名去重 →
 * `.part` 原子改名 → 发 `export` 事件。**只读**源文件，导出前后哈希不变（FR-13）。
 */
import { existsSync } from 'node:fs'
import { stat, unlink, writeFile, rename } from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError } from '../errors.js'
import { readMap } from '../map.js'
import { displayTitle, readNotes } from '../notes.js'
import { readThreads } from '../threads.js'
import { ensureExportsDir } from './files.js'
import {
  IMPLEMENTED_FORMATS,
  FORMAT_EXT,
  fileStamp,
  sanitizeFileName,
  uniqueName,
} from './format.js'
import { renderJson } from './json.js'
import { renderMarkdown } from './markdown.js'
import { renderOpml } from './opml.js'

const RENDERERS = Object.freeze({
  md: (input) => renderMarkdown(input),
  opml: (input) => renderOpml(input),
  json: (input) => renderJson(input),
})

/** `reading/exports/<name>` 的工作区相对路径（POSIX 分隔符）。 */
function relativeExportPath(books, file) {
  return path.relative(books.root, file).split(path.sep).join('/')
}

export class ExportService {
  /**
   * @param {{
   *   books: import('../books.js').BookService,
   *   hub?: { publish: (event: any) => void } | null,
   *   limits?: { exportFormats?: string[] },
   *   logger?: any,
   * }} options
   */
  constructor(options) {
    this.books = options.books
    this.hub = options.hub ?? null
    this.limits = options.limits ?? {}
    this.logger = options.logger ?? null
  }

  /** 本实例允许生成的格式（配置 ∩ 已实现）。 */
  supportedFormats() {
    const configured = Array.isArray(this.limits.exportFormats) && this.limits.exportFormats.length > 0
      ? this.limits.exportFormats
      : IMPLEMENTED_FORMATS
    return IMPLEMENTED_FORMATS.filter((format) => configured.includes(format))
  }

  /**
   * 生成一份导出文件。
   *
   * @param {{ bookId: string, format?: string, includeThreads?: boolean, now?: Date }} input
   * @returns {Promise<{ path: string, name: string, bytes: number, format: string, includeThreads: boolean }>}
   */
  async create(input) {
    const bookId = input?.bookId
    const format = String(input?.format ?? 'md').toLowerCase()
    const includeThreads = Boolean(input?.includeThreads)
    const at = input?.now instanceof Date ? input.now : new Date()

    if (!IMPLEMENTED_FORMATS.includes(format)) {
      if (format === 'png') {
        // PNG 由客户端从 SVG 生成（03 §9.6 / D-03-10），服务端明确拒绝而不是假装支持。
        throw new ReadingError('E_BAD_REQUEST', { field: 'format', hint: 'png 由客户端导出' })
      }
      throw new ReadingError('E_UNSUPPORTED', { feature: `export.${format}`, availableIn: '0.3.0' })
    }
    const supported = this.supportedFormats()
    if (!supported.includes(format)) {
      throw new ReadingError('E_UNSUPPORTED', {
        feature: 'export.format',
        format,
        enabled: supported,
      })
    }

    // 导出与删除/导入共用一本书的队列：导出进行中删书会等在这之后（03 §9.7）。
    return this.books.enqueue(async () => {
      const meta = await this.books.get(bookId)
      if (meta.status !== 'ready') {
        throw new ReadingError('E_BUSY', { reason: 'not-ready', status: meta.status })
      }

      const [chunks, notes, threads, map] = await Promise.all([
        this.books.readChunks(bookId),
        readNotes(this.books, bookId),
        readThreads(this.books, bookId),
        readMap(this.books, bookId),
      ])

      const text = RENDERERS[format]({
        meta,
        map,
        notes,
        chunks,
        threads,
        includeThreads,
        exportedAt: at,
      })

      let dir
      try {
        dir = await ensureExportsDir(this.books)
      } catch (error) {
        throw new ReadingError('E_IO', { op: 'export', stage: 'mkdir', bookId }, { cause: error })
      }
      const base = `${sanitizeFileName(displayTitle(meta))}-${fileStamp(at)}`
      const name = uniqueName(base, FORMAT_EXT[format], (candidate) => existsSync(path.join(dir, candidate)))
      if (name === null) {
        throw new ReadingError('E_IO', { op: 'export', reason: 'export-name-exhausted', bookId })
      }

      const file = path.join(dir, name)
      const part = `${file}.part`
      try {
        await writeFile(part, text, 'utf8')
        await rename(part, file)
      } catch (error) {
        await unlink(part).catch(() => {})
        this.logger?.warn?.(
          `[reading-lab] export failed book=${bookId} format=${format}: ${error instanceof Error ? error.message : String(error)}`,
        )
        throw new ReadingError('E_IO', { op: 'export', format, bookId }, { cause: error })
      }

      let bytes = Buffer.byteLength(text, 'utf8')
      try {
        const info = await stat(file)
        bytes = info.size
      } catch {
        // stat 失败不影响结果，退回按字符串长度算。
      }

      const relative = relativeExportPath(this.books, file)
      try {
        this.hub?.publish?.({ type: 'export', bookId, format, path: relative })
      } catch {
        // 事件总线关闭（卸载中）不影响导出结果。
      }
      this.logger?.info?.(`[reading-lab] export book=${bookId} format=${format} path=${relative} bytes=${bytes}`)

      return { path: relative, name, bytes, format, includeThreads }
    })
  }
}