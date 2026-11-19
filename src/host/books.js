/**
 * 书库（docs/03-design.md §5、docs/04-api.md §3.1）。
 *
 * M1 只做两件事：
 * - 读 `reading/index.json` 得到书库列表（没有该文件就是空库，不是错误）；
 * - 其余方法保持签名并抛 `E_NOT_IMPLEMENTED`，等 M2 接手实现。
 *
 * 约定：`list()` 是**真读盘**（空库返回 `[]`），不返回假数据；未实现的方法一律
 * `E_NOT_IMPLEMENTED`，由路由映射成 501。
 */
import * as path from 'node:path'

import { notImplemented } from './errors.js'
import { readJson, writeJsonAtomic, SCHEMA_VERSION } from './json-file.js'
import { READING_DIR } from './limits.js'

const EMPTY_INDEX = Object.freeze({
  schemaVersion: SCHEMA_VERSION.index,
  revision: 0,
  updatedAt: null,
  books: [],
})

export class BookService {
  /**
   * @param {{ root: string, limits: Record<string, unknown>, storage?: { available: boolean } }} options
   */
  constructor(options) {
    this.root = options.root
    this.limits = options.limits
    this.storage = options.storage ?? { available: true }
    this.readingDir = path.join(this.root, READING_DIR)
    this.booksDir = path.join(this.readingDir, 'books')
    this.inboxDir = path.join(this.readingDir, 'inbox')
    this.exportsDir = path.join(this.readingDir, 'exports')
    this.indexFile = path.join(this.readingDir, 'index.json')
  }

  /** 书库摘要列表；`index.json` 不存在时返回空库。 */
  async list(filter) {
    if (!this.storage.available) return { books: [], revision: 0 }
    const index = (await readJson(this.indexFile, { schemaVersion: SCHEMA_VERSION.index })) ?? EMPTY_INDEX
    const revision = typeof index.revision === 'number' ? index.revision : 0
    const rawBooks = Array.isArray(index.books) ? index.books : []
    const status = typeof filter?.status === 'string' ? filter.status : undefined
    const q = typeof filter?.q === 'string' ? filter.q.trim().toLowerCase() : ''
    const books = rawBooks.filter((book) => {
      if (!book || typeof book !== 'object') return false
      if (status !== undefined && book.status !== status) return false
      if (q === '') return true
      const haystack = `${book.title ?? ''} ${book.author ?? ''}`.toLowerCase()
      return haystack.includes(q)
    })
    return { books, revision }
  }

  /** SSE hello 用：只取摘要，最多 `limit` 本（04 §6.2）。 */
  async listForHello(limit) {
    const { books, revision } = await this.list()
    return { revision, books: books.slice(0, limit) }
  }

  /** 写回 `index.json`（M2 起由导入/删除调用；这里先备好原子写入口）。 */
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

  // --- M2 接手 --------------------------------------------------------------

  async get(_bookId) {
    throw notImplemented('books.get')
  }

  async importFromPath(_absolutePath, _options) {
    throw notImplemented('books.import')
  }

  async importFromBytes(_bytes, _options) {
    throw notImplemented('books.import')
  }

  async rename(_bookId, _title) {
    throw notImplemented('books.rename')
  }

  async remove(_bookId) {
    throw notImplemented('books.remove')
  }

  async retry(_bookId) {
    throw notImplemented('books.retry')
  }
}

/** 书的落盘目录：`reading/books/<bookId>/`。 */
export function bookDirOf(service, bookId) {
  return path.join(service.booksDir, bookId)
}