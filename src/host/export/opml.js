/**
 * OPML 导出（owner: export，docs/03-design.md §9.3）。
 *
 * 目标：XMind / 幕布能原样导入层级。摘要与引用原文都进 `_note`（导入工具把 `_note`
 * 当节点备注展示），chunkId 仍以逗号分隔放在 `_citation` 供机器再处理（QA-17-04）。
 * 未知属性会被忽略但不丢层级。不输出 DTD/外部实体。
 */
import { displayTitle } from '../notes.js'
import {
  buildCitationIndex,
  citationLine,
  citationIdsOf,
  resolveCitationIds,
} from './citations.js'
import { escapeXml, rfc822 } from './format.js'

function citationList(citations) {
  return citationIdsOf(citations).join(',')
}

/** `_note` = 摘要 + 空行 + 「引用」小节（章节 · 页码 · 原文片段）。 */
function noteOf(node, index) {
  const parts = []
  const summary = typeof node?.summary === 'string' ? node.summary.trim() : ''
  if (summary !== '') parts.push(summary)
  const resolved = resolveCitationIds(citationIdsOf(node?.citations), index)
  if (resolved.length > 0) {
    parts.push(['引用：', ...resolved.map((entry) => `- ${citationLine(entry)}`)].join('\n'))
  }
  return parts.join('\n\n')
}

function outlineAttrs(node, index) {
  const attrs = [`text="${escapeXml(node?.title ?? '')}"`]
  const note = noteOf(node, index)
  if (note !== '') attrs.push(`_note="${escapeXml(note)}"`)
  const citations = citationList(node?.citations)
  if (citations !== '') attrs.push(`_citation="${escapeXml(citations)}"`)
  return attrs.join(' ')
}

function renderNode(node, depth, lines, index) {
  if (!node || typeof node !== 'object') return
  const pad = '  '.repeat(depth)
  const children = Array.isArray(node.children) ? node.children.filter(Boolean) : []
  if (children.length === 0) {
    lines.push(`${pad}<outline ${outlineAttrs(node, index)}/>`)
    return
  }
  lines.push(`${pad}<outline ${outlineAttrs(node, index)}>`)
  for (const child of children) renderNode(child, depth + 1, lines, index)
  lines.push(`${pad}</outline>`)
}

/**
 * @param {{ meta: any, map: any, chunks?: any, exportedAt?: Date }} input
 * @returns {string}
 */
export function renderOpml(input) {
  const meta = input.meta ?? {}
  const exportedAt = input.exportedAt instanceof Date ? input.exportedAt : new Date()
  const index = buildCitationIndex(input.chunks)
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    `    <title>${escapeXml(displayTitle(meta))}</title>`,
    `    <dateCreated>${escapeXml(rfc822(exportedAt))}</dateCreated>`,
    '  </head>',
    '  <body>',
  ]

  const root = input.map?.root ?? null
  if (root) {
    renderNode(root, 2, lines, index)
  } else {
    // 没有导图时至少保留书名，保证文件是合法 OPML（导入工具不会报空文档）。
    lines.push(`    <outline text="${escapeXml(displayTitle(meta))}"/>`)
  }

  lines.push('  </body>', '</opml>')
  return `${lines.join('\n')}\n`
}