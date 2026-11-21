/**
 * 导出时的引用解析（owner: export，docs/03-design.md §9 / 04 §4“导出中的引用呈现”）。
 *
 * 面板里引用是 `[[c:000003]]`（给模型的语法），导出物是给人看的，因此三种格式都要
 * 把 chunkId 换成可读的「章节 · 页码 · 原文片段」。本模块只做纯计算：
 *
 *   chunks.json ──► index（id → {chapterTitle, page, snippet}）
 *                       │
 *   map/notes/threads ──┴─► resolveCitationIds / resolveCitationRefs
 *
 * 不做 I/O，不认识的文件/缺字段一律降级（空章节、无页码、空片段），不抛错——
 * 导出失败比少一行片段更糟。
 */

/** 片段最长码点数（含省略号）。 */
export const SNIPPET_MAX_CHARS = 60

/** 没有页码时的占位（EPUB 没有页概念）。 */
export const NO_PAGE_LABEL = '—'

const CITATION_MARKER = /\[\[c:(\d{6})\]\]/g
const PLAIN_CITATION = /\[c-(\d{6})\]/g

/** `[[c:000003]]` / `[c-000003]` → `c-000003`；其余返回 null。 */
export function normalizeChunkId(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  let match = /^c-\d{6}$/.exec(text)
  if (match) return text
  match = /^\[\[c:(\d{6})\]\]$/.exec(text)
  if (match) return `c-${match[1]}`
  match = /^\[c-(\d{6})\]$/.exec(text)
  if (match) return `c-${match[1]}`
  return null
}

/** 把任意文本里的 `[[c:000003]]` 改写成人类可读的 `[c-000003]`。 */
export function readableCitations(text) {
  const source = typeof text === 'string' ? text : ''
  return source.replace(CITATION_MARKER, (_all, digits) => `[c-${digits}]`)
}

/** 收集一段文本里出现的 chunkId（两种写法都认），保持首次出现顺序。 */
export function citationIdsIn(text, into = []) {
  const source = typeof text === 'string' ? text : ''
  for (const pattern of [CITATION_MARKER, PLAIN_CITATION]) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      const id = `c-${match[1]}`
      if (!into.includes(id)) into.push(id)
      match = pattern.exec(source)
    }
  }
  return into
}

/** 从节点 citations 里取 id（兼容字符串与 `{chunkId}` 两种形状）。 */
export function citationIdsOf(citations, into = []) {
  for (const item of Array.isArray(citations) ? citations : []) {
    const id = normalizeChunkId(typeof item === 'string' ? item : item?.chunkId)
    if (id !== null && !into.includes(id)) into.push(id)
  }
  return into
}

/** 压平空白并截断，供片段展示。 */
export function snippetOf(text, max = SNIPPET_MAX_CHARS) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const points = Array.from(flat)
  if (points.length <= max) return flat
  return `${points.slice(0, Math.max(0, max - 1)).join('')}…`
}

/**
 * 建引用索引：`chunkId → { id, chapterTitle, page, snippet }`。
 *
 * @param {any} chunksFile chunks.json（`{chunks:[{id,chapterTitle,page,text}]}`）
 * @returns {Map<string, { id: string, chapterTitle: string, page: number|null, snippet: string }>}
 */
export function buildCitationIndex(chunksFile) {
  const index = new Map()
  const chunks = Array.isArray(chunksFile?.chunks) ? chunksFile.chunks : []
  for (const chunk of chunks) {
    const id = normalizeChunkId(chunk?.id)
    if (id === null || index.has(id)) continue
    index.set(id, {
      id,
      chapterTitle: typeof chunk.chapterTitle === 'string' ? chunk.chapterTitle : '',
      page: Number.isInteger(chunk.page) ? chunk.page : null,
      snippet: snippetOf(chunk.text),
    })
  }
  return index
}

/**
 * 按给定顺序把 chunkId 解析成引用项；索引里没有的 id 也保留（标 `missing:true`），
 * 因为「引用失效」本身是需要告诉读者的信息。
 *
 * @param {string[]} ids
 * @param {Map<string, any>} index
 */
export function resolveCitationIds(ids, index) {
  const seen = new Set()
  const out = []
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = normalizeChunkId(raw)
    if (id === null || seen.has(id)) continue
    seen.add(id)
    const hit = index?.get?.(id)
    if (hit) {
      out.push({ ...hit, missing: false })
    } else {
      out.push({ id, chapterTitle: '', page: null, snippet: '', missing: true })
    }
  }
  return out
}

/** `第一章 · 第 12 页`（无章节/页码时优雅降级）。 */
export function citationLocation(entry) {
  const chapter = typeof entry?.chapterTitle === 'string' ? entry.chapterTitle.trim() : ''
  const page = Number.isInteger(entry?.page) ? `第 ${entry.page} 页` : NO_PAGE_LABEL
  if (chapter === '') return page
  return `${chapter} · ${page}`
}

/**
 * 一行可读引用：`[c-000003] 第一章 · 第 12 页 · 「原文片段」`。
 * 缺失的引用输出 `[c-000009] （引用已失效）`。
 */
export function citationLine(entry) {
  const id = normalizeChunkId(entry?.id) ?? 'c-000000'
  if (entry?.missing) return `[${id}] （引用已失效）`
  const location = citationLocation(entry)
  const snippet = typeof entry?.snippet === 'string' ? entry.snippet.trim() : ''
  return snippet === '' ? `[${id}] ${location}` : `[${id}] ${location} · 「${snippet}」`
}