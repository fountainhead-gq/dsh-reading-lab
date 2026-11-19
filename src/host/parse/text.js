/**
 * XHTML → 纯文本块（03 §6.3 第 6 步）。
 *
 * 规则（与设计文档逐条对应）：
 * - 块级元素前后补换行，`br` 直接换行
 * - `img` 变成 `[图：alt]`，alt 为空则 `[图]`
 * - 跳过 `script` / `style` / `head`（`textOf` 也做同样处理）
 * - `&nbsp;` 与其它实体由 `xml.js` 解码
 * - 连续空白折叠成单个空格，段间最多保留两个换行
 * - NFKC 归一化，剔除控制字符（保留 `\n` 与 `\t`）
 *
 * 输出 `blocks` 是段落数组；`chunk.js` 负责再切分。
 */

import { findChild, localName, parseXml, textOf, getAttr } from '../xml.js'

const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'aside', 'header', 'footer', 'main',
  'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote', 'pre',
  'td', 'th', 'tr', 'table', 'caption', 'figure', 'figcaption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
])

const SKIP_TAGS = new Set(['script', 'style', 'head'])

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeText(raw) {
  let value = String(raw ?? '').replace(/\r\n?/g, '\n')
  value = value.normalize('NFKC')
  value = value.replace(/\u00a0/g, ' ')
  value = value.replace(CONTROL_CHARS, '')
  value = value.replace(/[ \t\f\v]+/g, ' ')
  value = value.replace(/ *\n */g, '\n')
  value = value.replace(/\n{3,}/g, '\n\n')
  return value.trim()
}

/** @param {any} node @param {string[]} parts */
function walk(node, parts) {
  if (typeof node === 'string') {
    parts.push(node)
    return
  }
  if (!node || !Array.isArray(node.children)) return
  const name = localName(node.name).toLowerCase()
  if (SKIP_TAGS.has(name)) return
  if (name === 'br') {
    parts.push('\n')
    return
  }
  if (name === 'img') {
    const alt = String(getAttr(node, 'alt') ?? '').trim()
    parts.push(alt ? `[图：${alt}]` : '[图]')
    return
  }
  const block = BLOCK_TAGS.has(name)
  if (block) parts.push('\n')
  for (const child of node.children) walk(child, parts)
  if (block) parts.push('\n')
}

/**
 * 抽取一个章节文档的文本与标题。
 * @param {string} source XHTML 源文本
 * @returns {{ title: string | null, blocks: string[] }}
 */
export function extractText(source) {
  const document = parseXml(source)
  const body = findChild(document, 'body') ?? document

  const heading = findFirstHeading(body)
  const parts = []
  walk(body, parts)

  const text = normalizeText(parts.join(''))
    // NFKC 会把设计文档要求的全角冒号折成半角，这里还原 `[图：alt]` 的写法。
    .replace(/\[图:/g, '[图：')
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== '')

  return { title: heading, blocks }
}

function findFirstHeading(node) {
  const visited = []
  const visit = (current) => {
    if (!current || !Array.isArray(current.children)) return
    for (const child of current.children) {
      if (typeof child === 'string') continue
      const name = localName(child.name).toLowerCase()
      if (name === 'h1' || name === 'h2' || name === 'h3') {
        const text = normalizeText(textOf(child))
        if (text) {
          visited.push(text)
          return
        }
      }
      visit(child)
      if (visited.length > 0) return
    }
  }
  visit(node)
  return visited[0] ?? null
}

/** 供测试与调试：把节点渲染成唯一串（不做折叠）。 */
export function rawText(source) {
  return textOf(parseXml(source))
}