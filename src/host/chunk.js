/**
 * 章节分块（03 §6.5）。
 *
 * 纯函数：同样的输入永远得到同样的块序与块边界（测试与导图都依赖这一点）。
 * 规则：
 * - 丢弃空段落；段落间用 `\n` 连接，不跨章节
 * - 超过硬上限的段落先按句末标点切，仍超长再按码点硬切
 * - 以目标长度累积，达到目标就收束；收束后的块不小于下限，
 *   章节尾部不足下限的块并入上一块（合并后仍不超硬上限）
 * - 块数 / 总字符超限抛 `E_TOO_LARGE`，不静默截断
 */

import { ReadingError } from './errors.js'
import { chunkIdAt } from './ids.js'

const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '；', ';'])
/** 与 03 §5.3 的 chunker.target 一致；其余阈值来自 limits.js。 */
const DEFAULT_TARGET = 1_000

/** @param {string} value */
function codePoints(value) {
  return Array.from(value)
}

/** @param {string} value */
export function charCount(value) {
  return codePoints(value).length
}

/**
 * 把超长段落切成不超过 `hardMax` 码点的片段（优先句末）。
 * @param {string} text
 * @param {number} hardMax
 * @returns {string[]}
 */
export function splitLongParagraph(text, hardMax) {
  const points = codePoints(text)
  if (points.length <= hardMax) return [text]

  const sentences = []
  let start = 0
  for (let index = 0; index < points.length; index += 1) {
    const ch = points[index]
    const isEnd =
      SENTENCE_END.has(ch) ||
      (ch === '.' && (index + 1 >= points.length || /\s/.test(points[index + 1] ?? '')))
    if (isEnd) {
      sentences.push(points.slice(start, index + 1).join(''))
      start = index + 1
    }
  }
  if (start < points.length) sentences.push(points.slice(start).join(''))

  const pieces = []
  let current = []
  let currentLength = 0
  const flush = () => {
    if (current.length > 0) pieces.push(current.join(''))
    current = []
    currentLength = 0
  }
  for (const sentence of sentences) {
    const sentencePoints = codePoints(sentence)
    if (sentencePoints.length > hardMax) {
      flush()
      for (let offset = 0; offset < sentencePoints.length; offset += hardMax) {
        pieces.push(sentencePoints.slice(offset, offset + hardMax).join(''))
      }
      continue
    }
    if (currentLength > 0 && currentLength + sentencePoints.length > hardMax) flush()
    current.push(sentence)
    currentLength += sentencePoints.length
  }
  flush()
  return pieces.filter((piece) => piece.trim() !== '')
}

/**
 * 段落记录：`start`/`end` 是章节文本内的码点偏移。
 * `page` 只在 PDF 章节里有值（EPUB 为 null），用于 FR-05 的页码引用。
 * @param {Array<string | { text: string, page?: number | null }>} blocks
 * @param {number} hardMax
 */
function buildParagraphs(blocks, hardMax) {
  const paragraphs = []
  let offset = 0
  for (const block of blocks) {
    const raw = block && typeof block === 'object' ? block.text : block
    const page = block && typeof block === 'object' && Number.isInteger(block.page) ? block.page : null
    const text = String(raw ?? '').trim()
    if (text === '') continue
    for (const piece of splitLongParagraph(text, hardMax)) {
      const chars = charCount(piece)
      paragraphs.push({ text: piece, chars, page, start: offset, end: offset + chars })
      // 章节文本用 '\n' 连接段落，所以偏移要跨过这个分隔符。
      offset += chars + 1
    }
  }
  return paragraphs
}

/**
 * @param {{
 *   pages?: number,
 *   chapters: Array<{
 *     id: string,
 *     title: string,
 *     level?: number,
 *     path?: string[],
 *     blocks: Array<string | { text: string, page?: number | null }>,
 *   }>,
 * }} document
 * @param {Record<string, number>} [limits]
 */
export function chunkDocument(document, limits = {}) {
  const hardMax = limits.chunkHardMax ?? 2_000
  const minChars = limits.chunkMinChars ?? 100
  const target = Math.max(limits.chunkTargetMin ?? 800, Math.min(limits.chunkTargetMax ?? 1_500, DEFAULT_TARGET))
  const maxChunks = limits.maxChunks ?? Number.POSITIVE_INFINITY
  const maxChars = limits.maxEpubChars ?? Number.POSITIVE_INFINITY

  /** @type {Array<any>} */
  const chunks = []

  for (const chapter of document.chapters ?? []) {
    const chapterPath = Array.isArray(chapter.path) && chapter.path.length > 0 ? [...chapter.path] : [chapter.title]
    const paragraphs = buildParagraphs(chapter.blocks ?? [], hardMax)
    const firstChunkOfChapter = chunks.length

    let buffer = []
    let bufferChars = 0
    const flush = () => {
      if (buffer.length === 0) return
      const text = buffer.map((paragraph) => paragraph.text).join('\n')
      const page = buffer.find((paragraph) => Number.isInteger(paragraph.page))?.page ?? null
      chunks.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterPath,
        page,
        text,
        chars: charCount(text),
        startOffset: buffer[0].start,
        endOffset: buffer[buffer.length - 1].end,
      })
      buffer = []
      bufferChars = 0
    }

    for (const paragraph of paragraphs) {
      if (bufferChars > 0 && bufferChars + 1 + paragraph.chars > hardMax) flush()
      buffer.push(paragraph)
      bufferChars += paragraph.chars + (buffer.length > 1 ? 1 : 0)
      if (bufferChars >= target) flush()
    }
    flush()

    // 章节尾部不足下限：并入同章节的上一块（合并后仍不超硬上限）。
    const lastIndex = chunks.length - 1
    if (lastIndex > firstChunkOfChapter) {
      const last = chunks[lastIndex]
      const previous = chunks[lastIndex - 1]
      if (last.chapterId === previous.chapterId && last.chars < minChars && previous.chars + 1 + last.chars <= hardMax) {
        previous.text = `${previous.text}\n${last.text}`
        previous.chars = charCount(previous.text)
        previous.endOffset = last.endOffset
        chunks.pop()
      }
    }
  }

  if (chunks.length > maxChunks) {
    throw new ReadingError('E_TOO_LARGE', { reason: 'chunks', chunks: chunks.length, limit: maxChunks })
  }
  const totalChars = chunks.reduce((sum, chunk) => sum + chunk.chars, 0)
  if (totalChars > maxChars) {
    throw new ReadingError('E_TOO_LARGE', { reason: 'chars', chars: totalChars, limit: maxChars })
  }

  const withIds = chunks.map((chunk, index) => ({
    id: chunkIdAt(index + 1),
    seq: index + 1,
    chapterId: chunk.chapterId,
    chapterTitle: chunk.chapterTitle,
    chapterPath: chunk.chapterPath,
    page: chunk.page,
    text: chunk.text,
    chars: chunk.chars,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
  }))

  const toc = []
  for (const chapter of document.chapters ?? []) {
    const own = withIds.filter((chunk) => chunk.chapterId === chapter.id)
    if (own.length === 0) continue
    toc.push({
      id: chapter.id,
      title: chapter.title,
      level: chapter.level ?? 1,
      chunkStart: own[0].id,
      chunkEnd: own[own.length - 1].id,
    })
  }

  return {
    chunks: withIds,
    toc,
    stats: {
      chapters: (document.chapters ?? []).length,
      chunks: withIds.length,
      chars: totalChars,
      pages: Number.isInteger(document.pages) ? document.pages : null,
    },
    chunker: { version: 1, target: DEFAULT_TARGET, max: hardMax, min: minChars },
  }
}