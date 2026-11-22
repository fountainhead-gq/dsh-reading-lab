/**
 * 书库（docs/03-design.md §5、docs/04-api.md §3.1 / §4.3）。
 *
 * 目录布局（03 §5.1）：
 * ```
 * reading/
 *   index.json               书库索引（revision 单调递增）
 *   books/<bookId>/          source.epub、meta.json、chunks.json、import.log
 *   inbox/                   上传临时文件（写完后 rename 进 books/）
 *   exports/                 导出产物
 * ```
 * 所有写入都是原子写（tmp + rename），索引只是缓存：`index.json` 丢失或损坏时
 * 从各书目录的 `meta.json` 重建，所以「重启后书库还在」不依赖索引。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError, asReadingError, messageFor } from './errors.js'
import { importBytes } from './import.js'
import { isBookId } from './ids.js'
import { readJson, writeJsonAtomic, SCHEMA_VERSION } from './json-file.js'
import { READING_DIR } from './limits.js'

export const EMPTY_INDEX = Object.freeze({
  schemaVersion: SCHEMA_VERSION.index,
  revision: 0,
  updatedAt: null,
  books: [],
})

/** 索引里的书摘（04 §4.4：不含 source.sha256 与 toc）。 */
export function summaryOf(meta) {
  return {
    id: meta.id,
    title: meta.title,
    displayName: meta.displayName ?? null,
    author: meta.author ?? null,
    language: meta.language ?? null,
    format: meta.format,
    status: meta.status,
    statusDetail: meta.statusDetail ?? null,
    progress: meta.progress ?? null,
    stats: meta.stats ?? null,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    hasMap: Boolean(meta.mapUpdatedAt),
    hasNotes: Boolean(meta.notesUpdatedAt),
  }
}

function cloneIndex(index) {
  return {
    schemaVersion: SCHEMA_VERSION.index,
    revision: typeof index?.revision === 'number' ? index.revision : 0,
    updatedAt: typeof index?.updatedAt === 'string' ? index.updatedAt : null,
    books: Array.isArray(index?.books) ? index.books.map((book) => ({ ...book })) : [],
  }
}

function compareNewestFirst(left, right) {
  const a = String(left?.createdAt ?? '')
  const b = String(right?.createdAt ?? '')
  if (a === b) return String(right?.id ?? '').localeCompare(String(left?.id ?? ''))
  return b.localeCompare(a)
}

export class BookService {
  /**
   * @param {{ root?: string, readingDir?: string, limits: Record<string, unknown>, storage?: { available: boolean } }} options
   */
  constructor(options) {
    // t33：`readingDir` 可以独立于 `root` 指定（用户自选存储路径），书库目录不再
    // 由工作区根硬编码推导。
    this.root = typeof options.root === 'string' ? options.root : path.dirname(options.readingDir)
    this.limits = options.limits
    this.storage = options.storage ?? { available: true }
    this.setReadingDir(typeof options.readingDir === 'string' ? options.readingDir : path.join(this.root, READING_DIR))
    /** 由 `index.js` 装配时注入，用于推 SSE。 */
    this.hub = null
    // 全局导入/变更串行执行：同一时刻只允许一个写者，避免索引互相覆盖。
    this._queue = Promise.resolve()
  }

  /**
   * 换书库目录（t33：用户自选存储路径后立即生效，不需要重启）。
   * 只改派生字段，不动正在进行的写队列——迁移本身在 `settings.migrateLibrary`
   * 里完成，调用方必须先把目录搬好再切。
   * @param {string} readingDir 绝对路径
   */
  setReadingDir(readingDir) {
    this.readingDir = path.resolve(readingDir)
    this.root = path.dirname(this.readingDir)
    this.booksDir = path.join(this.readingDir, 'books')
    this.inboxDir = path.join(this.readingDir, 'inbox')
    this.exportsDir = path.join(this.readingDir, 'exports')
    this.indexFile = path.join(this.readingDir, 'index.json')
    return this
  }

  /** 串行化写操作。读操作不排队。 */
  enqueue(task) {
    const run = this._queue.then(task, task)
    this._queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 建好 `books/`、`inbox/`、`exports/`（换根后立刻补目录）。 */
  async ensureLayout() {
    await fs.mkdir(this.booksDir, { recursive: true })
    await fs.mkdir(this.inboxDir, { recursive: true })
    await fs.mkdir(this.exportsDir, { recursive: true })
    return this.readingDir
  }

  bookDir(bookId) {
    return path.join(this.booksDir, bookId)
  }

  metaFile(bookId) {
    return path.join(this.bookDir(bookId), 'meta.json')
  }

  chunksFile(bookId) {
    return path.join(this.bookDir(bookId), 'chunks.json')
  }

  // --- 索引 ----------------------------------------------------------------

  /** 读索引；缺失或损坏时从各书目录重建（重启恢复的关键）。 */
  async loadIndex() {
    if (!this.storage.available) return cloneIndex(EMPTY_INDEX)
    let index = null
    try {
      index = await readJson(this.indexFile, { schemaVersion: SCHEMA_VERSION.index })
    } catch (error) {
      // 坏索引不该让整个书库打不开：记一笔然后重建。
      this.hub?.publish?.({ type: 'book', bookId: null, reason: asReadingError(error).code })
      index = null
    }
    if (index) return cloneIndex(index)
    return this.rebuildIndex()
  }

  /** 扫描 `books/<bookId>/meta.json` 重写索引。没有任何书时不落盘，保持「空库」语义。 */
  async rebuildIndex() {
    const books = []
    let entries = []
    try {
      entries = await fs.readdir(this.booksDir, { withFileTypes: true })
    } catch (error) {
      if (error && error.code === 'ENOENT') return cloneIndex(EMPTY_INDEX)
      throw new ReadingError('E_IO', { op: 'readdir', dir: 'books' }, { cause: error })
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isBookId(entry.name)) continue
      try {
        const meta = await readJson(this.metaFile(entry.name), { schemaVersion: SCHEMA_VERSION.meta })
        if (meta) books.push(summaryOf(meta))
      } catch {
        // 单本坏掉不影响其它书；重试/删除仍可通过目录名定位。
      }
    }
    books.sort(compareNewestFirst)
    if (books.length === 0) return cloneIndex(EMPTY_INDEX)
    return this.saveIndex({ revision: 0, books })
  }

  /** @param {{ status?: string | string[], q?: string }} [filter] */
  async list(filter) {
    const index = await this.loadIndex()
    const wanted = normalizeStatusFilter(filter?.status)
    const q = typeof filter?.q === 'string' ? filter.q.trim().toLowerCase() : ''
    const books = index.books.filter((book) => {
      if (!book || typeof book !== 'object') return false
      if (wanted && !wanted.has(book.status)) return false
      if (q === '') return true
      const haystack = `${book.displayName ?? ''} ${book.title ?? ''} ${book.author ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
    return { books, revision: index.revision }
  }

  async listForHello(limit) {
    const { books, revision } = await this.list()
    return { revision, books: books.slice(0, Math.max(0, limit)) }
  }

  async saveIndex(index) {
    const next = {
      schemaVersion: SCHEMA_VERSION.index,
      revision: (typeof index?.revision === 'number' ? index.revision : 0) + 1,
      updatedAt: new Date().toISOString(),
      books: Array.isArray(index?.books) ? index.books : [],
    }
    await writeJsonAtomic(this.indexFile, next, { schemaVersion: SCHEMA_VERSION.index })
    return next
  }

  async upsertSummary(meta) {
    const index = await this.loadIndex()
    const summary = summaryOf(meta)
    const books = index.books.filter((book) => book && book.id !== meta.id)
    books.push(summary)
    books.sort(compareNewestFirst)
    return this.saveIndex({ revision: index.revision, books })
  }

  /**
   * R4 书架排序：按传入 id 顺序重排索引里的书目，未列出的按原顺序接在后面。
   *
   * 索引数组本身就是展示顺序（新书进首位），所以这里不需要额外的 order 字段；
   * 只接受已知 id，未知 id 忽略而不是报错——多端并发时别让一次陈旧排序把书弄丢。
   */
  async reorder(ids) {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'ids', reason: 'invalid' })
    }
    const index = await this.loadIndex()
    const byId = new Map(index.books.map((book) => [book.id, book]))
    const next = []
    const seen = new Set()
    for (const id of ids) {
      const book = byId.get(id)
      if (!book || seen.has(id)) continue
      next.push(book)
      seen.add(id)
    }
    for (const book of index.books) {
      if (!seen.has(book.id)) next.push(book)
    }
    const saved = await this.saveIndex({ revision: index.revision, books: next })
    return { books: saved.books, revision: saved.revision }
  }

  async removeSummary(bookId) {
    const index = await this.loadIndex()
    const books = index.books.filter((book) => book && book.id !== bookId)
    return this.saveIndex({ revision: index.revision, books })
  }

  // --- 单本 ----------------------------------------------------------------

  async get(bookId) {
    const meta = await readJson(this.metaFile(bookId), { schemaVersion: SCHEMA_VERSION.meta })
    if (!meta) throw new ReadingError('E_NOT_FOUND', { bookId })
    return meta
  }

  async writeMeta(meta) {
    const value = { ...meta, schemaVersion: SCHEMA_VERSION.meta, updatedAt: meta.updatedAt ?? new Date().toISOString() }
    await writeJsonAtomic(this.metaFile(meta.id), value, { schemaVersion: SCHEMA_VERSION.meta })
    return value
  }

  async readChunks(bookId) {
    const chunks = await readJson(this.chunksFile(bookId), { schemaVersion: SCHEMA_VERSION.chunks })
    if (!chunks) throw new ReadingError('E_NOT_FOUND', { reason: 'chunks', bookId })
    return chunks
  }

  /**
   * 取块列表（04 §4.6）：`ids` 优先；否则用 `from`/`to` 按 seq 区间。
   * @param {string} bookId
   * @param {{ ids?: string[], from?: number, to?: number, limit?: number }} [options]
   */
  async listChunks(bookId, options = {}) {
    const file = await this.readChunks(bookId)
    const all = Array.isArray(file.chunks) ? file.chunks : []
    const limit = clampLimit(options.limit)
    const selected = []
    const missing = []
    if (Array.isArray(options.ids) && options.ids.length > 0) {
      const byId = new Map(all.map((chunk) => [chunk.id, chunk]))
      for (const id of options.ids) {
        const chunk = byId.get(id)
        if (chunk) selected.push(chunk)
        else missing.push(id)
        if (selected.length >= limit) break
      }
    } else {
      const from = Number.isFinite(options.from) ? options.from : 1
      const to = Number.isFinite(options.to) ? options.to : Number.POSITIVE_INFINITY
      for (const chunk of all) {
        if (chunk.seq < from) continue
        if (chunk.seq > to) break
        selected.push(chunk)
        if (selected.length >= limit) break
      }
    }
    return {
      total: all.length,
      chunks: selected.map(toWireChunk),
      missing,
    }
  }

  /** 单块 + 前后邻居（04 §4.7）。 */
  async getChunk(bookId, chunkId) {
    const file = await this.readChunks(bookId)
    const all = Array.isArray(file.chunks) ? file.chunks : []
    const index = all.findIndex((chunk) => chunk.id === chunkId)
    if (index < 0) throw new ReadingError('E_NOT_FOUND', { reason: 'chunk', chunkId })
    return {
      chunk: toWireChunk(all[index]),
      prev: index > 0 ? toWireChunk(all[index - 1]) : null,
      next: index + 1 < all.length ? toWireChunk(all[index + 1]) : null,
    }
  }

  // --- 导入与 CRUD ----------------------------------------------------------

  /** GUI 上传入口（04 §4.3）：格式由魔数判定，`name` 只用于展示。 */
  async importFromBytes(bytes, options = {}) {
    return this.enqueue(() => importBytes(this, bytes, options))
  }

  async importFromPath(absolutePath, options = {}) {
    let bytes
    try {
      bytes = await fs.readFile(absolutePath)
    } catch (error) {
      throw new ReadingError('E_IO', { op: 'read', reason: 'source' }, { cause: error })
    }
    return this.importFromBytes(bytes, { name: options.name ?? path.basename(absolutePath) })
  }

  /** 重命名只改 `displayName`，`title` 保留解析结果。 */
  async rename(bookId, displayName) {
    return this.enqueue(async () => {
      const meta = await this.get(bookId)
      let nextName = null
      if (displayName !== null && displayName !== undefined) {
        if (typeof displayName !== 'string') throw new ReadingError('E_BAD_REQUEST', { field: 'displayName' })
        const trimmed = displayName.trim()
        if (trimmed === '') throw new ReadingError('E_BAD_REQUEST', { field: 'displayName' })
        if (trimmed.length > 200) throw new ReadingError('E_BAD_REQUEST', { field: 'displayName' })
        nextName = trimmed
      }
      const updated = await this.writeMeta({ ...meta, displayName: nextName })
      await this.upsertSummary(updated)
      this.hub?.publish?.({ type: 'book', bookId })
      return updated
    })
  }

  /** 删除是幂等的：目录不在也返回 deleted:true。解析中的书拒绝删除。 */
  async remove(bookId) {
    return this.enqueue(async () => {
      const meta = await readJson(this.metaFile(bookId), { schemaVersion: SCHEMA_VERSION.meta })
      if (!meta) {
        await this.removeSummary(bookId).catch(() => undefined)
        return { deleted: true }
      }
      if (meta.status === 'parsing' || meta.status === 'queued') {
        throw new ReadingError('E_BUSY', { bookId, status: meta.status })
      }
      await fs.rm(this.bookDir(bookId), { recursive: true, force: true })
      await this.removeSummary(bookId)
      this.hub?.publish?.({ type: 'book', bookId })
      return { deleted: true }
    })
  }

  /** 重新解析失败的书：保留原 `source.epub`。 */
  async retry(bookId) {
    return this.enqueue(async () => {
      const meta = await this.get(bookId)
      const sourceFile = path.join(this.bookDir(bookId), meta.source?.file ?? `source.${meta.format}`)
      let bytes
      try {
        bytes = await fs.readFile(sourceFile)
      } catch (error) {
        throw new ReadingError('E_NOT_FOUND', { reason: 'source', bookId }, { cause: error })
      }
      const { rerun } = await importBytes(this, bytes, { name: meta.source?.name, existing: meta })
      const result = await rerun()
      return result
    })
  }
}

function clampLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 50
  return Math.min(parsed, 200)
}

function normalizeStatusFilter(value) {
  if (value === undefined || value === null || value === '') return null
  const list = Array.isArray(value) ? value : String(value).split(',')
  const wanted = new Set(list.map((item) => String(item).trim()).filter(Boolean))
  return wanted.size > 0 ? wanted : null
}

/** wire 形状：不含内部字段，只给 Client 渲染需要的。 */
export function toWireChunk(chunk) {
  return {
    id: chunk.id,
    seq: chunk.seq,
    chapterId: chunk.chapterId,
    chapterTitle: chunk.chapterTitle,
    chapterPath: Array.isArray(chunk.chapterPath) ? chunk.chapterPath : [],
    page: chunk.page ?? null,
    text: chunk.text,
    chars: chunk.chars,
  }
}

/** 书的落盘目录：`reading/books/<bookId>/`。 */
export function bookDirOf(service, bookId) {
  return service.bookDir(bookId)
}

export { messageFor }