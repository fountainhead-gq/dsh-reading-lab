/**
 * 导入管道（03 §5.3、§6.2、§6.7）。
 *
 * 顺序：校验（空/体积/魔数） → sha256 与 bookId → 落盘 `source.epub` →
 * `meta.json`(parsing) → 索引 → 解析 → 分块 → `chunks.json` → `meta.json`(ready)。
 *
 * 失败分两层：
 * - 写入前的问题（空文件、未知格式、超大、PDF 尚未支持）直接抛给路由；
 * - 解析阶段的问题落成 `status: 'failed' | 'unsupported'` 的书并带可读
 *   `statusDetail.message`，保留 source 以便 `retry`。这样坏文件不会让书库出现
 *   一本「永远解析中」的书。
 */

import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError, asReadingError, messageFor } from './errors.js'
import { chunkDocument } from './chunk.js'
import { bookIdFromBytes } from './ids.js'
import { SCHEMA_VERSION, writeJsonAtomic } from './json-file.js'
import { detectFormat, parseEpub, validateEpubContainer } from './parse/epub.js'
import { parsePdf, validatePdfContainer } from './parse/pdf.js'

const UNSUPPORTED_CODES = new Set(['E_ENCRYPTED', 'E_SCANNED', 'E_UNSUPPORTED'])

/** @param {string} bookId */
function nowIso() {
  return new Date().toISOString()
}

/**
 * @param {import('./books.js').BookService} service
 * @param {Buffer} bytes
 * @param {{ name?: string, existing?: any }} [options]
 */
export async function importBytes(service, bytes, options = {}) {
  const limits = service.limits ?? {}
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new ReadingError('E_FORMAT', { reason: 'empty-file' })
  }
  if (bytes.length > (limits.maxUploadBytes ?? Number.POSITIVE_INFINITY)) {
    throw new ReadingError('E_TOO_LARGE', { reason: 'upload', bytes: bytes.length })
  }

  const format = detectFormat(bytes)
  if (!format) throw new ReadingError('E_FORMAT', { reason: 'unknown-magic' })

  // 容器级校验先跑：坏 ZIP/PDF、压缩炸弹、DRM 属于「坏文件」，直接在导入请求上报错，
  // 不落成一本 failed 的书（03 §6.2）。PDF 的「扫描版」不算坏文件，留给 runParse 判 unsupported。
  if (format === 'epub') validateEpubContainer(bytes, { limits })
  else validatePdfContainer(bytes)

  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const bookId = bookIdFromBytes(bytes)

  if (!options.existing) {
    const existing = await service.get(bookId).catch(() => null)
    if (existing) {
      return { book: existing, duplicate: true, rerun: async () => existing }
    }
  }

  const dir = service.bookDir(bookId)
  await fs.mkdir(dir, { recursive: true })
  await fs.mkdir(service.inboxDir, { recursive: true })

  const sourceFile = `source.${format}`
  const tempFile = path.join(service.inboxDir, `${bookId}.${process.pid}.part`)
  await fs.writeFile(tempFile, bytes)
  await fs.rename(tempFile, path.join(dir, sourceFile))

  const timestamp = nowIso()
  const base = options.existing ?? {
    schemaVersion: SCHEMA_VERSION.meta,
    id: bookId,
    title: titleFromName(options.name),
    displayName: null,
    author: null,
    language: null,
    format,
    source: { file: sourceFile, bytes: bytes.length, sha256, importedAt: timestamp },
    status: 'parsing',
    statusDetail: null,
    progress: { phase: 'reading', done: 0, total: 1, updatedAt: timestamp },
    stats: { chapters: 0, chunks: 0, chars: 0, pages: null },
    toc: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    mapUpdatedAt: null,
    notesUpdatedAt: null,
    threadsUpdatedAt: null,
  }

  const pending = {
    ...base,
    format,
    source: { file: sourceFile, bytes: bytes.length, sha256, importedAt: base.source?.importedAt ?? timestamp },
    status: 'parsing',
    statusDetail: null,
    progress: { phase: 'reading', done: 0, total: 1, updatedAt: timestamp },
  }
  const written = await service.writeMeta(pending)
  await service.upsertSummary(written)
  service.hub?.publish?.({ type: 'book', bookId })

  const rerun = () => runParse(service, written)
  const book = await rerun()
  return { book, duplicate: false, rerun }
}

/**
 * 解析 + 分块 + 落盘。
 * @param {import('./books.js').BookService} service
 * @param {any} meta
 */
export async function runParse(service, meta) {
  const limits = service.limits ?? {}
  const bookLog = (record) => appendLog(service, meta.id, record)

  try {
    const sourceFile = path.join(service.bookDir(meta.id), meta.source?.file ?? `source.${meta.format}`)
    const bytes = await fs.readFile(sourceFile)

    service.hub?.publish?.({ type: 'progress', bookId: meta.id, phase: 'extracting' })
    await bookLog({ phase: 'extracting', bytes: bytes.length, format: meta.format })
    const parsed = meta.format === 'pdf' ? parsePdf(bytes, { limits }) : parseEpub(bytes, { limits })

    service.hub?.publish?.({ type: 'progress', bookId: meta.id, phase: 'chunking' })
    await bookLog({ phase: 'chunking', chapters: parsed.chapters.length })
    const chunked = chunkDocument(parsed, limits)

    const generatedAt = nowIso()
    await writeJsonAtomic(
      service.chunksFile(meta.id),
      {
        schemaVersion: SCHEMA_VERSION.chunks,
        bookId: meta.id,
        generatedAt,
        chunker: chunked.chunker,
        chunks: chunked.chunks,
      },
      { schemaVersion: SCHEMA_VERSION.chunks },
    )

    const ready = await service.writeMeta({
      ...meta,
      title: meta.displayName ? meta.title : parsed.title || meta.title,
      author: parsed.author,
      language: parsed.language,
      status: 'ready',
      statusDetail: null,
      progress: { phase: 'done', done: 1, total: 1, updatedAt: generatedAt },
      stats: chunked.stats,
      toc: chunked.toc,
      updatedAt: generatedAt,
    })
    await service.upsertSummary(ready)
    await bookLog({ phase: 'done', chapters: chunked.stats.chapters, chunks: chunked.stats.chunks, chars: chunked.stats.chars })
    service.hub?.publish?.({ type: 'book', bookId: meta.id })
    if (parsed.warnings?.length > 0) {
      await bookLog({ phase: 'warn', warnings: parsed.warnings.slice(0, 20) })
    }
    return ready
  } catch (error) {
    const normalized = asReadingError(error)
    const at = nowIso()
    const status = UNSUPPORTED_CODES.has(normalized.code) ? 'unsupported' : 'failed'
    const failed = await service.writeMeta({
      ...meta,
      status,
      statusDetail: {
        code: normalized.code,
        message: messageFor(normalized.code, 'zh'),
        at,
      },
      progress: { ...(meta.progress ?? {}), phase: 'done', updatedAt: at },
      updatedAt: at,
    })
    await service.upsertSummary(failed)
    await bookLog({
      phase: 'failed',
      code: normalized.code,
      detail: normalized.details ?? null,
      stack: error instanceof Error ? String(error.stack ?? '').split('\n')[0] : null,
    })
    service.hub?.publish?.({ type: 'book', bookId: meta.id })
    return failed
  }
}

/** 追加一行 NDJSON 到 `reading/books/<id>/import.log`。日志失败不该影响导入。 */
export async function appendLog(service, bookId, record) {
  const file = path.join(service.bookDir(bookId), 'import.log')
  const line = `${JSON.stringify({ at: nowIso(), ...record })}\n`
  try {
    await fs.appendFile(file, line, 'utf8')
  } catch {
    // 日志是诊断信息，写不进去就放弃。
  }
}

/** 用文件名兜底标题：去扩展名、下划线转空格、截断 120 字。 */
export function titleFromName(name) {
  if (typeof name !== 'string') return '未命名书籍'
  const base = name.split(/[\\/]/).pop() ?? ''
  const withoutExtension = base.replace(/\.(epub|pdf)$/i, '')
  const cleaned = withoutExtension.replace(/[_]+/g, ' ').trim()
  return cleaned === '' ? '未命名书籍' : cleaned.slice(0, 120)
}