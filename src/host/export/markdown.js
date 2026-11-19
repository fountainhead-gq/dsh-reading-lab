/**
 * Markdown 导出（owner: export，docs/03-design.md §9.2）。
 *
 * 结构固定四块：标题元信息、导图大纲、研究笔记、问答精选。
 * 只读输入（meta/map/notes/threads），不碰磁盘；由 `export/index.js` 负责落盘。
 */
import { displayTitle } from '../notes.js'
import {
  escapeMarkdown,
  escapeMarkdownKeepingCitations,
  humanStamp,
} from './format.js'

const FORMAT_LABEL = Object.freeze({ epub: 'EPUB', pdf: 'PDF' })

function authorOf(meta) {
  const author = typeof meta?.author === 'string' ? meta.author.trim() : ''
  return author === '' ? '未标注' : author
}

function formatOf(meta) {
  const format = typeof meta?.format === 'string' ? meta.format.toLowerCase() : ''
  return FORMAT_LABEL[format] ?? (format ? format.toUpperCase() : '未知')
}

function indentOf(depth) {
  return '  '.repeat(depth)
}

function citationLinks(bookId, citations) {
  const seen = new Set()
  const lines = []
  for (const item of Array.isArray(citations) ? citations : []) {
    const chunkId = typeof item === 'string' ? item : item?.chunkId
    if (typeof chunkId !== 'string' || seen.has(chunkId)) continue
    seen.add(chunkId)
    lines.push(`${'  '.repeat(0)}- 引用：[${chunkId}](reading://${bookId}/${chunkId})`)
  }
  return lines
}

/**
 * 递归渲染大纲。每个节点：
 *   - `- 标题`
 *     > 摘要
 *     - 引用：…
 *     - 子节点…
 */
function renderOutline(node, bookId, depth, lines) {
  if (!node || typeof node !== 'object') return
  const pad = indentOf(depth)
  lines.push(`${pad}- ${escapeMarkdown(node.title)}`)
  if (typeof node.summary === 'string' && node.summary.trim() !== '') {
    lines.push(`${pad}  > ${escapeMarkdown(node.summary)}`)
  }
  const citations = citationLinks(bookId, node.citations)
  for (const line of citations) {
    lines.push(`${pad}  ${line}`)
  }
  for (const child of Array.isArray(node.children) ? node.children : []) {
    renderOutline(child, bookId, depth + 1, lines)
  }
}

/** 去掉 notes.md 首行的 `<!-- reading-lab:notes … -->` 元数据（03 §9.2）。 */
export function notesBody(markdown) {
  const text = typeof markdown === 'string' ? markdown : ''
  if (text === '') return ''
  const lines = text.split(/\r?\n/)
  if (/^<!--\s*reading-lab:notes\b/.test(lines[0] ?? '')) {
    return lines.slice(1).join('\n').replace(/^\s*\n/, '')
  }
  return text
}

function oneLine(text, max) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  const points = Array.from(flat)
  return points.length <= max ? flat : `${points.slice(0, max).join('')}…`
}

function renderThread(thread, lines) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : []
  const label = thread?.scope?.kind === 'node'
    ? (thread.scope.nodeTitle || thread.scope.nodeId || '节点')
    : '全书'
  let firstQuestion = null
  for (const message of messages) {
    if (message?.role === 'user' && typeof message.text === 'string') {
      firstQuestion = message.text
      break
    }
  }
  if (firstQuestion === null) return
  lines.push(`### ${escapeMarkdown(label)} · ${escapeMarkdown(oneLine(firstQuestion, 40))}`)
  let answered = false
  for (const message of messages) {
    if (message?.role === 'user') {
      lines.push('')
      lines.push(`**问**：${escapeMarkdownKeepingCitations(oneLine(message.text, 2000))}`)
      answered = false
      continue
    }
    if (message?.role !== 'assistant') continue
    const text = typeof message.text === 'string' ? message.text.trim() : ''
    if (text === '') continue
    lines.push(`**答**：${escapeMarkdownKeepingCitations(text)}`)
    answered = true
  }
  if (!answered) lines.push('**答**：（还没有回答）')
}

/**
 * @param {{
 *   meta: any,
 *   map: any,
 *   notes: any,
 *   threads?: any,
 *   includeThreads?: boolean,
 *   exportedAt?: Date,
 * }} input
 * @returns {string}
 */
export function renderMarkdown(input) {
  const meta = input.meta ?? {}
  const bookId = meta.id ?? ''
  const exportedAt = input.exportedAt instanceof Date ? input.exportedAt : new Date()
  const lines = [
    `# ${escapeMarkdown(displayTitle(meta))}`,
    '',
    `> 作者：${escapeMarkdown(authorOf(meta))} ｜ 格式：${formatOf(meta)} ｜ 导出：${humanStamp(exportedAt)}`,
    '',
    '## 导图大纲',
    '',
  ]

  const root = input.map?.root ?? null
  if (root) {
    renderOutline(root, bookId, 0, lines)
  } else {
    lines.push('（还没有导图）')
  }

  lines.push('', '## 研究笔记', '')
  const body = notesBody(input.notes?.markdown)
  lines.push(body.trim() === '' ? '（还没有研究笔记）' : body.trimEnd())

  if (input.includeThreads) {
    lines.push('', '## 问答精选', '')
    const threads = Array.isArray(input.threads?.threads) ? input.threads.threads : []
    const usable = threads.filter((thread) => Array.isArray(thread?.messages) && thread.messages.length > 0)
    if (usable.length === 0) {
      lines.push('（还没有问答）')
    } else {
      usable.forEach((thread, index) => {
        if (index > 0) lines.push('')
        renderThread(thread, lines)
      })
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}