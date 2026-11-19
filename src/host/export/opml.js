/**
 * OPML 导出（owner: export，docs/03-design.md §9.3）。
 *
 * 目标：XMind / 幕布能原样导入层级。摘要进 `_note`，引用逗号分隔进 `_citation`；
 * 未知属性会被忽略但不丢层级。不输出 DTD/外部实体。
 */
import { displayTitle } from '../notes.js'
import { escapeXml, rfc822 } from './format.js'

function citationList(citations) {
  const ids = []
  for (const item of Array.isArray(citations) ? citations : []) {
    const chunkId = typeof item === 'string' ? item : item?.chunkId
    if (typeof chunkId === 'string' && !ids.includes(chunkId)) ids.push(chunkId)
  }
  return ids.join(',')
}

function outlineAttrs(node) {
  const attrs = [`text="${escapeXml(node?.title ?? '')}"`]
  const summary = typeof node?.summary === 'string' ? node.summary.trim() : ''
  if (summary !== '') attrs.push(`_note="${escapeXml(summary)}"`)
  const citations = citationList(node?.citations)
  if (citations !== '') attrs.push(`_citation="${escapeXml(citations)}"`)
  return attrs.join(' ')
}

function renderNode(node, depth, lines) {
  if (!node || typeof node !== 'object') return
  const pad = '  '.repeat(depth)
  const children = Array.isArray(node.children) ? node.children.filter(Boolean) : []
  if (children.length === 0) {
    lines.push(`${pad}<outline ${outlineAttrs(node)}/>`)
    return
  }
  lines.push(`${pad}<outline ${outlineAttrs(node)}>`)
  for (const child of children) renderNode(child, depth + 1, lines)
  lines.push(`${pad}</outline>`)
}

/**
 * @param {{ meta: any, map: any, exportedAt?: Date }} input
 * @returns {string}
 */
export function renderOpml(input) {
  const meta = input.meta ?? {}
  const exportedAt = input.exportedAt instanceof Date ? input.exportedAt : new Date()
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
    renderNode(root, 2, lines)
  } else {
    // 没有导图时至少保留书名，保证文件是合法 OPML（导入工具不会报空文档）。
    lines.push(`    <outline text="${escapeXml(displayTitle(meta))}"/>`)
  }

  lines.push('  </body>', '</opml>')
  return `${lines.join('\n')}\n`
}