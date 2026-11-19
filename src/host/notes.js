/**
 * 研究笔记（owner: notes，03 §5.5）。
 *
 * `notes.md` 是「人可读、机器可校验」的单一事实来源：
 *
 * ```
 * <!-- reading-lab:notes {"schemaVersion":1,"bookId":"b…","generatedAt":"…"} -->
 * # 书名 · 研究笔记
 *
 * ## 主题脉络
 * 正文（引用写作 [[c:000012]]）
 * …
 * ```
 *
 * 五个二级标题固定且有序；空节写「本书未形成该部分」。解析失败一律视为「被手改过」：
 * 仍然可读（返回原文 + `parseError`），但**不可覆盖**——避免把用户的修改冲掉。
 * 引用语法用 `[[c:NNNNNN]]`（6 位序号），写入前逐个核对 chunk 是否真实存在（03 §5.5、§10）。
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError } from './errors.js'

export const NOTES_SCHEMA_VERSION = 1
export const SECTION_TITLES = ['主题脉络', '核心论点', '术语表', '阅读建议', '开放问题']
export const EMPTY_SECTION_TEXT = '本书未形成该部分'
export const NOTES_MAX_BYTES = 200 * 1024
export const CITATION_PATTERN = /\[\[c:(\d{6})\]\]/g
export const CITATION_EXAMPLE = '[[c:000003]]'
export const CONTEXT_MAX_CHARS = 12_000
export const CONTEXT_CHUNKS_PER_CHAPTER = 3

const META_PREFIX = '<!-- reading-lab:notes '
const META_SUFFIX = ' -->'

/** 引用语法 `[[c:000012]]` → chunkId `c-000012`。 */
export function citationToChunkId(citation) {
  return String(citation).replace(/^\[\[c:/, 'c-').replace(/\]\]$/, '')
}

/** chunkId → 引用语法。 */
export function chunkIdToCitation(chunkId) {
  return `[[${String(chunkId).replace(/^c-/, 'c:')}]]`
}

/**
 * 渲染 `notes.md`。`sections` 是 `{ title, body }[]`，顺序固定。
 * @param {{ bookId: string, title: string, generatedAt?: string, sections: Array<{title: string, body: string}> }} input
 */
export function renderNotesMarkdown(input) {
  const generatedAt = input.generatedAt ?? new Date().toISOString()
  const header = JSON.stringify({
    schemaVersion: NOTES_SCHEMA_VERSION,
    bookId: input.bookId,
    generatedAt,
  })
  const lines = [`${META_PREFIX}${header}${META_SUFFIX}`, `# ${input.title} · 研究笔记`, '']
  for (const title of SECTION_TITLES) {
    const section = (input.sections ?? []).find((item) => item.title === title)
    const body = (section?.body ?? '').trim()
    lines.push(`## ${title}`, '', body === '' ? EMPTY_SECTION_TEXT : body, '')
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * 解析 `notes.md`。结构不符时抛 `ReadingError`，调用方按「手改文件」处理。
 * @param {string} markdown
 * @returns {{ meta: any, title: string, sections: Array<{title: string, body: string}> }}
 */
export function parseNotesMarkdown(markdown) {
  if (typeof markdown !== 'string' || markdown.trim() === '') {
    throw new ReadingError('E_SCHEMA', { reason: 'notes-empty' })
  }
  const lines = markdown.split('\n')
  if (!lines[0].startsWith(META_PREFIX) || !lines[0].endsWith(META_SUFFIX)) {
    throw new ReadingError('E_SCHEMA', { reason: 'notes-meta-missing' })
  }
  const metaText = lines[0].slice(META_PREFIX.length, lines[0].length - META_SUFFIX.length)
  let meta
  try {
    meta = JSON.parse(metaText)
  } catch {
    throw new ReadingError('E_SCHEMA', { reason: 'notes-meta-invalid' })
  }
  if (meta?.schemaVersion !== NOTES_SCHEMA_VERSION) {
    throw new ReadingError('E_SCHEMA', { reason: 'notes-schema-version', actual: meta?.schemaVersion ?? null })
  }
  const titleLine = lines.find((line) => line.startsWith('# '))
  if (!titleLine) throw new ReadingError('E_SCHEMA', { reason: 'notes-title-missing' })

  const sections = []
  for (const title of SECTION_TITLES) {
    const heading = `## ${title}`
    const start = lines.findIndex((line) => line.trim() === heading)
    if (start === -1) throw new ReadingError('E_SCHEMA', { reason: 'notes-section-missing', section: title })
    const body = []
    for (let index = start + 1; index < lines.length; index += 1) {
      const line = lines[index]
      if (line.startsWith('## ') || line.startsWith('# ')) break
      body.push(line)
    }
    sections.push({ title, body: body.join('\n').trim() })
  }
  return { meta, title: titleLine.slice(2).replace(/\s*·\s*研究笔记\s*$/, '').trim(), sections }
}

/**
 * 校验一份待写入的 markdown：五节齐全、引用真实存在、有内容的节至少一条引用。
 * @param {string} markdown
 * @param {{ bookId: string, chunkIds: Iterable<string> }} options
 */
export function validateNotes(markdown, options) {
  const bytes = Buffer.byteLength(markdown, 'utf8')
  if (bytes > NOTES_MAX_BYTES) {
    throw new ReadingError('E_TOO_LARGE', { reason: 'notes', bytes, limit: NOTES_MAX_BYTES })
  }
  const parsed = parseNotesMarkdown(markdown)
  if (options.bookId && parsed.meta.bookId !== options.bookId) {
    throw new ReadingError('E_SCHEMA', { reason: 'notes-book-mismatch', expected: options.bookId, actual: parsed.meta.bookId ?? null })
  }
  const available = new Set(options.chunkIds ?? [])
  const citations = []
  for (const section of parsed.sections) {
    const body = section.body.trim()
    if (body === '' || body === EMPTY_SECTION_TEXT) continue
    const found = [...body.matchAll(CITATION_PATTERN)].map((match) => `c-${match[1]}`)
    if (found.length === 0) {
      throw new ReadingError('E_CITATION', { reason: 'section-without-citation', section: section.title })
    }
    for (const chunkId of found) {
      if (!available.has(chunkId)) {
        throw new ReadingError('E_CITATION', { reason: 'unknown-chunk', chunkId, section: section.title })
      }
      citations.push(chunkId)
    }
  }
  const filled = parsed.sections.filter((section) => section.body.trim() !== EMPTY_SECTION_TEXT).length
  if (filled === 0) throw new ReadingError('E_SCHEMA', { reason: 'notes-all-empty' })
  return {
    sections: parsed.sections,
    citations: [...new Set(citations)],
    filled,
    title: parsed.title,
    generatedAt: parsed.meta.generatedAt ?? null,
  }
}

/** @param {import('./books.js').BookService} service */
export function notesFile(service, bookId) {
  return path.join(service.bookDir(bookId), 'notes.md')
}

/**
 * 读取笔记：**永远不抛**（除书不存在）。手改/损坏的文件返回原文与 `parseError`。
 * @param {import('./books.js').BookService} service
 * @param {string} bookId
 */
export async function readNotes(service, bookId) {
  await service.get(bookId)
  const file = notesFile(service, bookId)
  let markdown
  try {
    markdown = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { updatedAt: null, markdown: '', sections: [] }
    }
    throw new ReadingError('E_IO', { op: 'read', file: 'notes.md' }, { cause: error })
  }
  const updatedAt = await statUpdatedAt(file)
  try {
    const parsed = parseNotesMarkdown(markdown)
    return {
      updatedAt,
      markdown,
      sections: parsed.sections,
      citationFormat: CITATION_EXAMPLE,
    }
  } catch {
    return { updatedAt, markdown, sections: [], parseError: true }
  }
}

/** @param {string} file */
async function statUpdatedAt(file) {
  try {
    const stat = await fs.stat(file)
    return stat.mtime.toISOString()
  } catch {
    return null
  }
}

/**
 * 写笔记：先校验、再原子写、最后更新 `meta.notesUpdatedAt`。
 * 校验失败抛错且不落盘（工具的 `rejected` 分支依赖这一点）。
 * @param {import('./books.js').BookService} service
 * @param {string} bookId
 * @param {string} markdown
 */
export async function writeNotes(service, bookId, markdown) {
  const meta = await service.get(bookId)
  const chunked = await service.readChunks(bookId)
  const checked = validateNotes(markdown, {
    bookId,
    chunkIds: chunked.chunks.map((chunk) => chunk.id),
  })
  const file = notesFile(service, bookId)
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, markdown, 'utf8')
  await fs.rename(temp, file)
  const at = new Date().toISOString()
  const updated = await service.writeMeta({ ...meta, notesUpdatedAt: at, updatedAt: at })
  await service.upsertSummary(updated)
  service.hub?.publish?.({ type: 'notes', bookId, updatedAt: at })
  return {
    path: path.relative(service.root, file).split(path.sep).join('/'),
    sections: checked.sections.length,
    citations: checked.citations.length,
    notesUpdatedAt: at,
  }
}

/**
 * 给 Agent 的写作素材：每章最多 3 块、总量 ≤12000 字。
 * 只给 id + 摘要，正文由 Agent 按需用 `reading` 工具取——避免把整本书塞进上下文。
 * @param {import('./books.js').BookService} service
 * @param {string} bookId
 */
export async function notesContext(service, bookId) {
  const meta = await service.get(bookId)
  const chunked = await service.readChunks(bookId)
  const byChapter = new Map()
  for (const chunk of chunked.chunks) {
    const list = byChapter.get(chunk.chapterId) ?? []
    if (list.length < CONTEXT_CHUNKS_PER_CHAPTER) list.push(chunk)
    byChapter.set(chunk.chapterId, list)
  }
  let budget = CONTEXT_MAX_CHARS
  const chapters = []
  for (const [chapterId, chunks] of byChapter) {
    const first = chunks[0]
    const samples = []
    for (const chunk of chunks) {
      if (budget <= 0) break
      const preview = chunk.text.slice(0, Math.min(400, Math.max(0, budget)))
      budget -= preview.length
      samples.push({ id: chunk.id, preview })
    }
    chapters.push({ chapterId, title: first.chapterTitle, chunks: samples })
  }
  return {
    bookId,
    title: meta.displayName ?? meta.title,
    chars: chunked.chunks.reduce((sum, chunk) => sum + chunk.chars, 0),
    chapters,
    citationFormat: CITATION_EXAMPLE,
    sectionTitles: SECTION_TITLES,
    emptySectionText: EMPTY_SECTION_TEXT,
    notesPath: `reading/books/${bookId}/notes.md`,
  }
}

/** 书名（用户改名优先），工具与路由共用。 */
export function displayTitle(meta) {
  return meta?.displayName ?? meta?.title ?? '未命名书籍'
}