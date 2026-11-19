/**
 * EPUB 解析（03 §6.3）。
 *
 * 流程：ZIP → `META-INF/container.xml` → OPF → metadata / manifest / spine →
 * TOC（EPUB3 nav → EPUB2 NCX → spine 回退）→ 每个 spine 文档抽文本。
 *
 * 返回的章节顺序永远等于 spine 顺序（阅读顺序），TOC 只提供标题与层级。
 * 单个 XHTML 失败只记 warning 并跳过；缺失超过 20% 或总字符过少才整体失败。
 */

import path from 'node:path'
import { ReadingError } from '../errors.js'
import { ZipArchive } from '../zip.js'
import { descendantChildren, findChild, findChildren, getAttr, parseXml, textOf } from '../xml.js'
import { extractText } from './text.js'

const HTML_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/xml', 'text/xml'])

/** @param {string} href */
function stripFragment(href) {
  const at = href.indexOf('#')
  return at < 0 ? href : href.slice(0, at)
}

/** @param {string} baseDir @param {string} href */
function resolveHref(baseDir, href) {
  const clean = decodeURIComponent(stripFragment(String(href ?? '').trim()))
  if (clean === '') return ''
  return path.posix.normalize(path.posix.join(baseDir, clean))
}

/**
 * 魔数判定（04 §4.3：格式由内容决定，`name` 只用于展示）。
 * @param {Buffer} buffer
 * @returns {'epub' | 'pdf' | null}
 */
export function detectFormat(buffer) {
  if (!Buffer.isBuffer(buffer)) return null
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    if (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) return 'epub'
    return null
  }
  if (buffer.length >= 5 && buffer.toString('latin1', 0, 5) === '%PDF-') return 'pdf'
  return null
}

/**
 * 容器级校验（03 §6.2、§6.3 第 1 步）：ZIP 结构、mimetype、DRM。
 *
 * 这一步必须在落盘之前调用——容器级问题属于「坏文件」而不是「解析失败的书」，
 * 应当在导入请求上直接返回 415/413/422，而不是留下一个 failed 的书。
 *
 * @param {Buffer} buffer
 * @param {{ limits?: Record<string, number> }} [options]
 * @returns {{ zip: ZipArchive }}
 */
export function validateEpubContainer(buffer, options = {}) {
  const limits = options.limits ?? {}
  const zip = new ZipArchive(buffer, limits)

  const mimetype = zip.has('mimetype') ? zip.readText('mimetype').trim() : ''
  if (mimetype !== 'application/epub+zip') {
    throw new ReadingError('E_FORMAT', { reason: 'not-epub', hint: 'mimetype' })
  }

  if (zip.has('META-INF/encryption.xml')) {
    const encryption = zip.readText('META-INF/encryption.xml')
    if (/<(?:[A-Za-z0-9]+:)?EncryptedData[\s>]/.test(encryption)) {
      throw new ReadingError('E_ENCRYPTED', { reason: 'drm' })
    }
  }

  if (!zip.has('META-INF/container.xml')) {
    throw new ReadingError('E_FORMAT', { reason: 'no-container' })
  }

  return { zip }
}

/**
 * @param {Buffer} buffer
 * @param {{ limits?: Record<string, number> }} [options]
 * @returns {{ title: string, author: string | null, language: string | null, format: 'epub', chapters: Array<any>, warnings: Array<any> }}
 */
export function parseEpub(buffer, options = {}) {
  const limits = options.limits ?? {}
  const { zip } = validateEpubContainer(buffer, { limits })

  const opfPath = resolveOpfPath(zip)
  const opf = parseXml(zip.readText(opfPath))
  const opfDir = path.posix.dirname(opfPath) === '.' ? '' : path.posix.dirname(opfPath)

  const metadata = readMetadata(opf)
  const manifest = readManifest(opf, opfDir)
  const spine = readSpine(opf, manifest)
  if (spine.length === 0) throw new ReadingError('E_PARSE', { reason: 'empty-spine' })

  const tocEntries = readToc(zip, opf, manifest, opfDir)

  const warnings = []
  const documents = []
  let missing = 0
  for (const item of spine) {
    try {
      const source = zip.readText(item.path)
      const extracted = extractText(source)
      documents.push({ item, blocks: extracted.blocks, heading: extracted.title })
    } catch (error) {
      missing += 1
      warnings.push({
        path: item.path,
        code: error instanceof ReadingError ? error.code : 'E_PARSE',
      })
    }
  }

  const totalSpine = spine.length
  if (totalSpine === 0 || missing / totalSpine > 0.2) {
    throw new ReadingError('E_PARSE', { reason: 'too-many-documents-failed', missing, total: totalSpine })
  }

  const chapters = buildChapters(documents, tocEntries)
  const chars = chapters.reduce((sum, chapter) => sum + chapter.blocks.join('\n').length, 0)
  const minimum = limits.minDocumentChars ?? 100
  if (chars < minimum) throw new ReadingError('E_PARSE', { reason: 'too-few-chars', chars, minimum })

  return {
    title: metadata.title || chapters.find((chapter) => chapter.title)?.title || '未命名书籍',
    author: metadata.creator,
    language: metadata.language,
    format: 'epub',
    chapters,
    warnings,
  }
}

/** @param {ZipArchive} zip */
function resolveOpfPath(zip) {
  if (!zip.has('META-INF/container.xml')) {
    throw new ReadingError('E_FORMAT', { reason: 'no-container' })
  }
  const container = parseXml(zip.readText('META-INF/container.xml'))
  const rootfiles = descendantChildren(container, 'rootfile')
  const fullPath = rootfiles.length > 0 ? getAttr(rootfiles[0], 'full-path') : null
  if (!fullPath) throw new ReadingError('E_FORMAT', { reason: 'no-rootfile' })
  const resolved = path.posix.normalize(decodeURIComponent(String(fullPath)))
  if (!zip.has(resolved)) throw new ReadingError('E_FORMAT', { reason: 'missing-opf', path: resolved })
  return resolved
}

/** @param {any} opf */
function readMetadata(opf) {
  const metadata = findChild(opf, 'metadata')
  const read = (name) => {
    if (!metadata) return null
    const nodes = descendantChildren(metadata, name)
    if (nodes.length === 0) return null
    const value = collapseText(textOf(nodes[0]))
    return value === '' ? null : value
  }
  return { title: read('title'), creator: read('creator'), language: read('language') }
}

// 本地别名：避免与 xml.js 的导出名冲突，同时保持调用点简洁。
function collapseText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

/** @param {any} opf @param {string} opfDir */
function readManifest(opf, opfDir) {
  const manifest = findChild(opf, 'manifest')
  const items = new Map()
  if (!manifest) return items
  for (const node of findChildren(manifest, 'item')) {
    const id = getAttr(node, 'id')
    const href = getAttr(node, 'href')
    if (!id || !href) continue
    items.set(id, {
      id,
      path: resolveHref(opfDir, href),
      mediaType: String(getAttr(node, 'media-type') ?? '').toLowerCase(),
      properties: String(getAttr(node, 'properties') ?? ''),
    })
  }
  return items
}

/** @param {any} opf @param {Map<string, any>} manifest */
function readSpine(opf, manifest) {
  const spine = findChild(opf, 'spine')
  if (!spine) return []
  const ordered = []
  for (const itemref of findChildren(spine, 'itemref')) {
    if (String(getAttr(itemref, 'linear') ?? '').toLowerCase() === 'no') continue
    const idref = getAttr(itemref, 'idref')
    const item = idref ? manifest.get(idref) : null
    if (!item) continue
    if (item.mediaType && !HTML_TYPES.has(item.mediaType)) continue
    ordered.push(item)
  }
  return ordered
}

/**
 * TOC 解析：EPUB3 nav 优先，其次 NCX，最后空数组（调用方回退 spine）。
 * @returns {Array<{title: string, path: string, level: number}>}
 */
function readToc(zip, opf, manifest, opfDir) {
  const items = [...manifest.values()]
  const navItem = items.find((item) => item.properties.split(/\s+/).includes('nav'))
  if (navItem && zip.has(navItem.path)) {
    try {
      const entries = parseNavToc(zip, navItem, opfDir)
      if (entries.length > 0) return entries
    } catch {
      // 坏的 nav 不该毁掉整本书：退回 NCX / spine。
    }
  }

  const spine = findChild(opf, 'spine')
  const tocId = spine ? getAttr(spine, 'toc') : null
  const ncxItem =
    (tocId && manifest.get(tocId)) ||
    items.find((item) => item.mediaType === 'application/x-dtbncx+xml')
  if (ncxItem && zip.has(ncxItem.path)) {
    try {
      const entries = parseNcxToc(zip, ncxItem, opfDir)
      if (entries.length > 0) return entries
    } catch {
      // 同上。
    }
  }
  return []
}

function parseNavToc(zip, navItem, opfDir) {
  const document = parseXml(zip.readText(navItem.path))
  const navs = descendantChildren(document, 'nav')
  const nav =
    navs.find((node) => String(getAttr(node, 'type') ?? '').toLowerCase() === 'toc') ?? navs[0]
  if (!nav) return []
  const list = findChild(nav, 'ol') ?? findChild(nav, 'ul')
  const entries = []
  walkNavList(list, 1, opfDir, entries)
  return entries
}

function walkNavList(list, level, opfDir, entries) {
  if (!list) return
  for (const li of findChildren(list, 'li')) {
    const anchor = findChild(li, 'a') ?? findChild(li, 'span')
    const title = anchor ? collapseText(textOf(anchor)) : ''
    const href = anchor ? getAttr(anchor, 'href') : null
    const resolved = href ? resolveHref(opfDir, href) : ''
    if (title !== '' || resolved !== '') {
      entries.push({ title: title || resolved, path: resolved, level })
    }
    const nested = findChild(li, 'ol') ?? findChild(li, 'ul')
    if (nested) walkNavList(nested, level + 1, opfDir, entries)
  }
}

function parseNcxToc(zip, ncxItem, opfDir) {
  const document = parseXml(zip.readText(ncxItem.path))
  const navMap = findChild(document, 'navMap') ?? descendantChildren(document, 'navMap')[0]
  const entries = []
  walkNavPoints(navMap, 1, opfDir, entries)
  return entries
}

function walkNavPoints(map, level, opfDir, entries) {
  if (!map) return
  for (const point of findChildren(map, 'navPoint')) {
    const label = findChild(point, 'navLabel')
    const textNode = label ? findChild(label, 'text') : null
    const title = textNode ? collapseText(textOf(textNode)) : ''
    const content = findChild(point, 'content')
    const src = content ? getAttr(content, 'src') : null
    const resolved = src ? resolveHref(opfDir, src) : ''
    entries.push({ title: title || resolved, path: resolved, level })
    walkNavPoints(point, level + 1, opfDir, entries)
  }
}

/**
 * 把 spine 文档按 TOC 合并成章节。
 * @param {Array<{item: any, blocks: string[], heading: string | null}>} documents
 * @param {Array<{title: string, path: string, level: number}>} tocEntries
 */
function buildChapters(documents, tocEntries) {
  /** @type {Map<string, {title: string, level: number, ancestors: string[]}>} */
  const byPath = new Map()
  const stack = []
  for (const entry of tocEntries) {
    if (!entry.path) continue
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) stack.pop()
    const ancestors = stack.map((item) => item.title).filter(Boolean)
    if (!byPath.has(entry.path)) {
      byPath.set(entry.path, { title: entry.title, level: entry.level, ancestors })
    }
    stack.push({ level: entry.level, title: entry.title })
  }

  const chapters = []
  documents.forEach((document, index) => {
    const mapped = byPath.get(document.item.path)
    const title = mapped?.title || document.heading || `第 ${index + 1} 章`
    const ancestors = mapped?.ancestors ?? []
    const chapterPath = [...ancestors.filter((name) => name !== title), title]
    chapters.push({
      id: `ch-${String(index + 1).padStart(3, '0')}`,
      title,
      level: mapped?.level ?? 1,
      path: chapterPath,
      blocks: document.blocks,
    })
  })
  return chapters
}