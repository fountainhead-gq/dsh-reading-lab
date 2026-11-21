/**
 * PDF 解析（owner: parse，03 §6.4 / §6.6）。
 *
 * 与 `zip.js` / `xml.js` 同一取舍：**零依赖**。设计稿原本计划 `pdfjs-dist`，但本仓
 * `dependencies` 必须为空（包契约测试断言），且发布环境离线；PDF 的文本路径其实只需要
 * 对象解析 + FlateDecode + 内容流文本算子 + ToUnicode CMap，故在此自实现。
 * 覆盖范围：xref 损坏也能读（按 `N G obj` 扫描）、对象流（/ObjStm）、FlateDecode、
 * Type0/Identity-H 的 ToUnicode、简单字体；不渲染、不解码图片、不做版面重排。
 *
 * 输出与 EPub 解析器同构：`{title, author, language, format:'pdf', pages, chapters, warnings}`，
 * 章节块是 `{ text, page }`，`page` 从 1 开始，供分块器写 `chunk.page`（FR-05 页码引用）。
 *
 * 错误：非 PDF → `E_FORMAT{reason:'not-pdf'}`；结构损坏 → `E_PARSE{reason:…}`；
 * 加密 → `E_ENCRYPTED`；采样页几乎没有有效字符 → `E_SCANNED`（03 §6.6）。
 */

import { inflateSync } from 'node:zlib'

import { ReadingError } from '../errors.js'
import { normalizeText } from './text.js'

const PDF_MAGIC = '%PDF-'
const DEFAULT_SCAN_SAMPLE = 3
const DEFAULT_SCAN_MIN_CHARS = 20
const DEFAULT_MAX_PAGES = 2_000
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/

// ------------------------------------------------------------------ 对象解析

/**
 * 极简 PDF 对象读取器：只认字典/数组/数字/名字/字符串/引用/布尔/null。
 * 位置在 latin1 字符串上推进，二进制流单独按字节切片。
 */
class ObjectReader {
  /** @param {string} text */
  constructor(text, start = 0) {
    this.text = text
    this.pos = start
  }

  /** @param {number} [limit] */
  skipSpace(limit = this.text.length) {
    while (this.pos < limit) {
      const code = this.text.charCodeAt(this.pos)
      if (code === 0x25) {
        // % 注释到行尾
        const end = this.text.indexOf('\n', this.pos)
        this.pos = end === -1 ? limit : end + 1
        continue
      }
      if (code <= 0x20) {
        this.pos += 1
        continue
      }
      break
    }
  }

  /** @returns {{ kind: string, value?: any }} */
  parseValue() {
    this.skipSpace()
    const ch = this.text[this.pos]
    if (ch === undefined) return { kind: 'eof' }
    if (ch === '<' && this.text[this.pos + 1] === '<') return { kind: 'dict', value: this.parseDict() }
    if (ch === '<') return { kind: 'string', value: this.parseHexString() }
    if (ch === '[') return { kind: 'array', value: this.parseArray() }
    if (ch === '(') return { kind: 'string', value: this.parseLiteralString() }
    if (ch === '/') return { kind: 'name', value: this.parseName() }
    if (ch === '+' || ch === '-' || ch === '.' || (ch >= '0' && ch <= '9')) return this.parseNumberOrRef()
    const word = this.parseKeyword()
    if (word === 'true') return { kind: 'boolean', value: true }
    if (word === 'false') return { kind: 'boolean', value: false }
    if (word === 'null') return { kind: 'null', value: null }
    return { kind: 'keyword', value: word }
  }

  parseDict() {
    const dict = Object.create(null)
    this.pos += 2 // <<
    for (;;) {
      this.skipSpace()
      if (this.pos >= this.text.length) break
      if (this.text[this.pos] === '>' && this.text[this.pos + 1] === '>') {
        this.pos += 2
        break
      }
      const key = this.parseValue()
      if (key.kind !== 'name') {
        // 非法字典：跳过这个 token，避免死循环。
        if (key.kind === 'keyword' || key.kind === 'eof') break
        continue
      }
      const value = this.parseValue()
      dict[key.value] = value.value
      dict[`@${key.value}`] = value
    }
    return dict
  }

  parseArray() {
    const items = []
    this.pos += 1
    for (;;) {
      this.skipSpace()
      if (this.pos >= this.text.length) break
      if (this.text[this.pos] === ']') {
        this.pos += 1
        break
      }
      const item = this.parseValue()
      if (item.kind === 'eof') break
      items.push(item.value)
    }
    return items
  }

  parseName() {
    this.pos += 1
    let name = ''
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos]
      if (/[\s/<>[\](){}%]/.test(ch)) break
      if (ch === '#' && /^[0-9a-fA-F]{2}$/.test(this.text.slice(this.pos + 1, this.pos + 3))) {
        name += String.fromCharCode(Number.parseInt(this.text.slice(this.pos + 1, this.pos + 3), 16))
        this.pos += 3
        continue
      }
      name += ch
      this.pos += 1
    }
    return name
  }

  parseLiteralString() {
    const start = this.pos + 1
    let depth = 1
    let index = start
    while (index < this.text.length && depth > 0) {
      const ch = this.text[index]
      if (ch === '\\') {
        index += 2
        continue
      }
      if (ch === '(') depth += 1
      if (ch === ')') depth -= 1
      index += 1
    }
    const body = this.text.slice(start, index - 1)
    this.pos = index
    return decodeLiteralString(body)
  }

  parseHexString() {
    const end = this.text.indexOf('>', this.pos + 1)
    const body = end === -1 ? '' : this.text.slice(this.pos + 1, end)
    this.pos = end === -1 ? this.text.length : end + 1
    const hex = body.replace(/[^0-9a-fA-F]/g, '')
    const padded = hex.length % 2 === 0 ? hex : `${hex}0`
    let out = ''
    for (let offset = 0; offset < padded.length; offset += 2) {
      out += String.fromCharCode(Number.parseInt(padded.slice(offset, offset + 2), 16))
    }
    return out
  }

  parseNumberOrRef() {
    const match = /^[+-]?(?:\d+\.\d*|\.\d+|\d+)/.exec(this.text.slice(this.pos, this.pos + 32))
    if (!match) {
      this.pos += 1
      return { kind: 'number', value: 0 }
    }
    const value = Number(match[0])
    this.pos += match[0].length
    // 引用：`<num> <gen> R`
    if (Number.isInteger(value)) {
      const saved = this.pos
      this.skipSpace()
      const gen = /^(\d+)\s+R\b/.exec(this.text.slice(this.pos, this.pos + 24))
      if (gen) {
        this.pos += gen[0].length
        return { kind: 'ref', value: { num: value, gen: Number(gen[1]) } }
      }
      this.pos = saved
    }
    return { kind: 'number', value }
  }

  parseKeyword() {
    const match = /^[A-Za-z*'"]+/.exec(this.text.slice(this.pos, this.pos + 16))
    if (!match) {
      this.pos += 1
      return ''
    }
    this.pos += match[0].length
    return match[0]
  }
}

/** PDF 字面串的转义（`\n`、`\ddd`、续行等）。 */
function decodeLiteralString(body) {
  let out = ''
  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index]
    if (ch !== '\\') {
      out += ch
      continue
    }
    const next = body[index + 1]
    index += 1
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case '(':
      case ')':
      case '\\':
        out += next
        break
      case '\n':
        break
      case '\r':
        if (body[index + 1] === '\n') index += 1
        break
      default:
        if (/[0-7]/.test(next ?? '')) {
          const octal = /^[0-7]{1,3}/.exec(body.slice(index))
          out += String.fromCharCode(Number.parseInt(octal[0], 8))
          index += octal[0].length - 1
        } else if (next !== undefined) {
          out += next
        }
    }
  }
  return out
}

/** `/Title` 之类的文本串：UTF-16BE（有 BOM）或 PDFDocEncoding（按 latin1 兜底）。 */
export function decodePdfText(value) {
  if (typeof value !== 'string') return ''
  if (value.charCodeAt(0) === 0xfe && value.charCodeAt(1) === 0xff) {
    let out = ''
    for (let index = 2; index + 1 < value.length; index += 2) {
      out += String.fromCharCode((value.charCodeAt(index) << 8) | value.charCodeAt(index + 1))
    }
    return out
  }
  return value
}

/**
 * 扫描全部 `N G obj … endobj`，得到对象表。xref 被忽略（真实 PDF 里损坏的不少）。
 * @param {string} raw latin1 视图
 */
function collectObjects(raw) {
  const objects = new Map()
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g
  let match
  while ((match = pattern.exec(raw)) !== null) {
    const num = Number(match[1])
    const bodyStart = match.index + match[0].length
    const reader = new ObjectReader(raw, bodyStart)
    const parsed = reader.parseValue()
    let stream = null
    const afterValue = reader.pos
    reader.skipSpace()
    if (raw.startsWith('stream', reader.pos)) {
      let dataStart = reader.pos + 'stream'.length
      if (raw[dataStart] === '\r') dataStart += 1
      if (raw[dataStart] === '\n') dataStart += 1
      let length = Number(parsed.value?.Length)
      if (!Number.isFinite(length) || length < 0) length = -1
      if (length >= 0 && raw.slice(dataStart + length, dataStart + length + 20).includes('endstream')) {
        stream = raw.slice(dataStart, dataStart + length)
      } else {
        const end = raw.indexOf('endstream', dataStart)
        stream = raw.slice(dataStart, end === -1 ? raw.length : end)
      }
      reader.pos = dataStart + (stream ? stream.length : 0)
    }
    objects.set(num, { value: parsed.value, stream, generation: Number(match[2]) })
    // 跳过 endobj，避免把流内部的 "N 0 obj" 当对象。
    const endobj = raw.indexOf('endobj', Math.max(reader.pos, afterValue))
    pattern.lastIndex = endobj === -1 ? bodyStart + 1 : endobj + 'endobj'.length
  }
  return objects
}

/** 解引用（`{num,gen}` → 对象）。 */
function makeResolver(objects) {
  return function resolve(value, depth = 0) {
    if (!value || typeof value !== 'object' || typeof value.num !== 'number' || depth > 8) return value
    const entry = objects.get(value.num)
    if (!entry) return undefined
    return entry.value
  }
}

/** 取流字节：FlateDecode → zlib；未知过滤器按原文返回（尽力而为）。 */
function decodeStream(entry, objects) {
  if (!entry?.stream) return ''
  const resolve = makeResolver(objects)
  const filter = resolve(entry.value?.Filter)
  const filters = Array.isArray(filter) ? filter : filter ? [filter] : []
  let data = entry.stream
  for (const name of filters) {
    if (name === 'FlateDecode' || name === 'Fl') {
      try {
        data = inflateSync(Buffer.from(data, 'latin1')).toString('latin1')
      } catch {
        return ''
      }
    } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
      const hex = data.replace(/[^0-9a-fA-F]/g, '')
      const padded = hex.length % 2 === 0 ? hex : `${hex}0`
      let out = ''
      for (let index = 0; index < padded.length; index += 2) {
        out += String.fromCharCode(Number.parseInt(padded.slice(index, index + 2), 16))
      }
      data = out
    } else {
      // 图片/字体专用滤镜对文本抽取没有帮助。
      return ''
    }
  }
  return data
}

/** 对象流（/Type /ObjStm）：把内部对象解开，供后续按号查找。 */
function expandObjectStreams(objects) {
  const resolve = makeResolver(objects)
  for (const entry of [...objects.values()]) {
    const type = resolve(entry.value?.Type)
    if (type !== 'ObjStm') continue
    const count = Number(resolve(entry.value?.N))
    const first = Number(resolve(entry.value?.First))
    if (!Number.isFinite(count) || !Number.isFinite(first)) continue
    const body = decodeStream(entry, objects)
    if (!body) continue
    const header = body.slice(0, first).trim().split(/\s+/).map(Number)
    const pairs = []
    for (let index = 0; index + 1 < header.length && pairs.length < count; index += 2) {
      pairs.push([header[index], header[index + 1]])
    }
    for (const [num, offset] of pairs) {
      if (objects.has(num)) continue
      const reader = new ObjectReader(body, first + offset)
      const parsed = reader.parseValue()
      objects.set(num, { value: parsed.value, stream: null, generation: 0 })
    }
  }
}

/** 找到文档目录（/Type /Catalog）。 */
function findCatalog(objects) {
  const resolve = makeResolver(objects)
  for (const entry of objects.values()) {
    if (resolve(entry.value?.Type) === 'Catalog') return entry.value
  }
  return null
}

/** 页树 → 页面对象数组（深度优先，保持 Kids 顺序）。 */
function collectPages(objects, catalog, maxPages) {
  const resolve = makeResolver(objects)
  const pages = []
  const seen = new Set()
  const walk = (node, depth) => {
    const value = resolve(node)
    if (!value || typeof value !== 'object' || depth > 32) return
    const type = resolve(value.Type)
    if (type === 'Page' || (!type && value.Contents)) {
      pages.push(value)
      return
    }
    const kids = resolve(value.Kids)
    if (!Array.isArray(kids)) return
    for (const kid of kids) {
      if (pages.length >= maxPages) return
      const key = kid && typeof kid.num === 'number' ? kid.num : null
      if (key !== null && seen.has(key)) continue
      if (key !== null) seen.add(key)
      walk(kid, depth + 1)
    }
  }
  walk(catalog?.Pages, 0)
  return pages
}

// ------------------------------------------------------------------ 字体与文本

/** 解析 ToUnicode CMap：bfchar / bfrange。 */
export function parseToUnicode(text) {
  const map = new Map()
  if (typeof text !== 'string' || text.length === 0) return map
  const hexToUnicode = (hex) => {
    const padded = hex.length % 4 === 0 ? hex : hex.padStart(Math.ceil(hex.length / 4) * 4, '0')
    let out = ''
    for (let index = 0; index < padded.length; index += 4) {
      out += String.fromCharCode(Number.parseInt(padded.slice(index, index + 4), 16))
    }
    return out
  }
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      map.set(pair[1].toUpperCase().padStart(4, '0'), hexToUnicode(pair[2]))
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = block[1]
    for (const row of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const low = Number.parseInt(row[1], 16)
      const high = Number.parseInt(row[2], 16)
      if (high < low || high - low > 0xffff) continue
      const dest = row[3]
      if (dest.startsWith('[')) {
        const items = [...dest.matchAll(/<([0-9a-fA-F]+)>/g)].map((item) => item[1])
        for (let code = low; code <= high && code - low < items.length; code += 1) {
          map.set(code.toString(16).toUpperCase().padStart(4, '0'), hexToUnicode(items[code - low]))
        }
      } else {
        const base = dest.slice(1, -1)
        const baseValue = Number.parseInt(base, 16)
        const width = Math.max(4, base.length)
        for (let code = low; code <= high; code += 1) {
          const offset = code - low
          const unicode = Number.isFinite(baseValue) ? baseValue + offset : code
          map.set(code.toString(16).toUpperCase().padStart(4, '0'), hexToUnicode(unicode.toString(16).padStart(width, '0')))
        }
      }
    }
  }
  return map
}

/** 建页面字体表：name → { twoByte, map }。 */
function buildFonts(objects, page) {
  const resolve = makeResolver(objects)
  const fonts = new Map()
  const resources = resolve(page.Resources)
  const fontDict = resolve(resources?.Font)
  if (!fontDict || typeof fontDict !== 'object') return fonts
  for (const [name, ref] of Object.entries(fontDict)) {
    if (name.startsWith('@')) continue
    const font = resolve(ref)
    if (!font || typeof font !== 'object') continue
    const subtype = resolve(font.Subtype)
    const twoByte = subtype === 'Type0'
    const toUnicodeRef = font.ToUnicode
    let map = new Map()
    if (toUnicodeRef && typeof toUnicodeRef === 'object') {
      const entry = objects.get(toUnicodeRef.num)
      if (entry?.stream) map = parseToUnicode(decodeStream(entry, objects))
    }
    fonts.set(name, { twoByte, map })
  }
  return fonts
}

/** 简单字体（无 ToUnicode）的字节 → 文本：WinAnsi 近似 latin1，CJK 交给上层判定。 */
function decodeSimple(bytes) {
  return bytes
}

/** 用字体表把一个 PDF 字符串解码成 Unicode。 */
export function decodeWithFont(raw, font) {
  if (!raw) return ''
  if (!font) return decodeSimple(raw)
  if (font.twoByte) {
    let out = ''
    for (let index = 0; index + 1 < raw.length; index += 2) {
      const code = ((raw.charCodeAt(index) << 8) | raw.charCodeAt(index + 1)).toString(16).toUpperCase().padStart(4, '0')
      const mapped = font.map.get(code)
      out += mapped ?? '\uFFFD'
    }
    return out
  }
  if (font.map.size === 0) return raw
  let out = ''
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0')
    out += font.map.get(code) ?? raw[index]
  }
  return out
}

/**
 * 从内容流里抽取文本项：`{text, x, y, size}`。
 * 只实现文本定位与显示算子；渲染/图形算子直接跳过。
 */
export function extractTextItems(content, fonts) {
  const items = []
  const stack = []
  let font = null
  let size = 12
  let leading = 0
  let x = 0
  let y = 0
  let sawText = false

  const show = (raw) => {
    const text = decodeWithFont(raw, font)
    if (text === '') return
    const chars = [...text]
    const width = chars.reduce((sum, ch) => sum + (CJK.test(ch) ? size : size * 0.5), 0)
    items.push({ text, x, y, size, width })
    x += width
    sawText = true
  }

  const tokenPattern = /\s*(?:(\d*\.\d+|\d+)|\[|\]|<([0-9a-fA-F\s]*)>|\((?:\\.|[^\\()])*\)|\/([A-Za-z0-9#_.+-]+)|([A-Za-z*'"]+))/g
  // 单独解析字面串：上面的正则只用于判断类型，真正取串用 index。
  let match
  while ((match = tokenPattern.exec(content)) !== null) {
    const token = match[0].trim()
    if (token === '') continue
    if (match[1] !== undefined) {
      stack.push(Number(match[1]))
      continue
    }
    if (token === '[') {
      stack.push('[')
      continue
    }
    if (token === ']') {
      // TJ 数组：把字符串片段与字距调整一起消费。
      const parts = []
      while (stack.length > 0 && stack[stack.length - 1] !== '[') parts.unshift(stack.pop())
      if (stack[stack.length - 1] === '[') stack.pop()
      // 数组内容在下面由 TJ 处理，这里只把数组压栈。
      stack.push({ array: parts })
      continue
    }
    if (match[2] !== undefined) {
      // 十六进制串
      const hex = match[2].replace(/\s+/g, '')
      const padded = hex.length % 2 === 0 ? hex : `${hex}0`
      let raw = ''
      for (let offset = 0; offset < padded.length; offset += 2) {
        raw += String.fromCharCode(Number.parseInt(padded.slice(offset, offset + 2), 16))
      }
      stack.push({ string: raw })
      continue
    }
    if (token.startsWith('(')) {
      stack.push({ string: decodeLiteralString(token.slice(1, -1)) })
      continue
    }
    if (match[3] !== undefined) {
      stack.push({ name: match[3] })
      continue
    }

    const operator = match[4]
    if (!operator) continue
    switch (operator) {
      case 'BT':
        x = 0
        y = 0
        break
      case 'ET':
        break
      case 'Tf': {
        const name = stack.find((item) => item && item.name)
        if (name) font = fonts.get(name.name) ?? null
        const last = stack[stack.length - 1]
        if (typeof last === 'number') size = Math.abs(last) || size
        break
      }
      case 'TL': {
        const last = stack[stack.length - 1]
        if (typeof last === 'number') leading = last
        break
      }
      case 'Td': {
        const ty = stack[stack.length - 1]
        const tx = stack[stack.length - 2]
        if (typeof tx === 'number') x += tx
        if (typeof ty === 'number') y += ty
        break
      }
      case 'TD': {
        const ty = stack[stack.length - 1]
        const tx = stack[stack.length - 2]
        if (typeof tx === 'number') x += tx
        if (typeof ty === 'number') {
          y += ty
          leading = -ty
        }
        break
      }
      case 'Tm': {
        const values = stack.filter((item) => typeof item === 'number').slice(-6)
        if (values.length === 6) {
          x = values[4]
          y = values[5]
        }
        break
      }
      case 'T*':
        x = 0
        y -= leading
        break
      case 'Tj': {
        const last = [...stack].reverse().find((item) => item && item.string !== undefined)
        if (last) show(last.string)
        break
      }
      case "'": {
        x = 0
        y -= leading
        const last = [...stack].reverse().find((item) => item && item.string !== undefined)
        if (last) show(last.string)
        break
      }
      case '"': {
        x = 0
        y -= leading
        const last = [...stack].reverse().find((item) => item && item.string !== undefined)
        if (last) show(last.string)
        break
      }
      case 'TJ': {
        const array = [...stack].reverse().find((item) => item && item.array)
        if (array) {
          for (const part of array.array) {
            if (typeof part === 'number') {
              // 负的字距调整通常表示词间空格。
              if (part <= -180) x += size * 0.5
              else x -= (part / 1000) * size
            } else if (part && part.string !== undefined) {
              show(part.string)
            }
          }
        }
        break
      }
      default:
        break
    }
    stack.length = 0
    void sawText
  }
  return items
}

// ------------------------------------------------------------------ 页面 → 行/段

/** 按 y 聚类成行，行内按 x 排序；行间空隙给出段落边界。 */
export function groupItemsIntoLines(items) {
  if (items.length === 0) return []
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x)
  const lines = []
  for (const item of sorted) {
    const line = lines[lines.length - 1]
    const tolerance = Math.max(2, item.size * 0.5)
    if (line && Math.abs(line.y - item.y) <= tolerance) {
      line.items.push(item)
      continue
    }
    lines.push({ y: item.y, size: item.size, items: [item] })
  }
  return lines.map((line) => {
    const ordered = [...line.items].sort((a, b) => a.x - b.x)
    let text = ''
    let cursor = null
    for (const item of ordered) {
      const gap = cursor === null ? 0 : item.x - cursor
      if (text !== '' && gap > item.size * 0.25 && !CJK.test(text[text.length - 1]) && !CJK.test(item.text[0] ?? '')) {
        text += ' '
      }
      text += item.text
      cursor = item.x + item.width
    }
    return { text: normalizeText(text), y: line.y, size: line.size }
  })
}

/** 行 → 段落：纵向间距超过 1.8 倍中位行距即断开；处理行尾连字符。 */
export function linesToParagraphs(lines) {
  if (lines.length === 0) return []
  const gaps = []
  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index - 1].y - lines[index].y
    if (gap > 0.5) gaps.push(gap)
  }
  const sortedGaps = [...gaps].sort((a, b) => a - b)
  const median = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0
  const paragraphs = []
  let buffer = []
  const flush = () => {
    if (buffer.length > 0) {
      const text = buffer.join(' ').replace(/([A-Za-z])-\s+([a-z])/g, '$1$2')
      paragraphs.push(normalizeText(text))
    }
    buffer = []
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.text === '') continue
    if (index > 0) {
      const gap = lines[index - 1].y - line.y
      if (median > 0 && gap > median * 1.8) flush()
    }
    buffer.push(line.text)
  }
  flush()
  return paragraphs.filter((paragraph) => paragraph !== '')
}

// ------------------------------------------------------------------ 章节

/** 解析 outline 书签：`[{title, page, level}]`（页码从 1 起，解析不到的跳过）。 */
function readOutline(objects, pageRefToIndex) {
  const resolve = makeResolver(objects)
  const catalog = findCatalog(objects)
  const root = resolve(catalog?.Outlines)
  if (!root || typeof root !== 'object') return []
  const entries = []
  let node = resolve(root.First)
  let guard = 0
  while (node && typeof node === 'object' && guard < 1_000) {
    guard += 1
    const title = decodePdfText(resolve(node.Title) ?? '')
    const dest = resolve(node.Dest) ?? resolve(resolve(node.A)?.D)
    let page = 0
    if (Array.isArray(dest) && dest[0] && typeof dest[0].num === 'number') {
      page = pageRefToIndex.get(dest[0].num) ?? 0
    }
    if (page > 0) {
      entries.push({ title: title || `第 ${page} 页`, page })
      // 一级子项也当作章节（保留层级信息）。
      let child = resolve(node.First)
      let childGuard = 0
      while (child && typeof child === 'object' && childGuard < 200) {
        childGuard += 1
        const childTitle = decodePdfText(resolve(child.Title) ?? '')
        const childDest = resolve(child.Dest) ?? resolve(resolve(child.A)?.D)
        if (Array.isArray(childDest) && childDest[0] && typeof childDest[0].num === 'number') {
          const childPage = pageRefToIndex.get(childDest[0].num) ?? 0
          if (childPage > 0) entries.push({ title: childTitle || `第 ${childPage} 页`, page: childPage, level: 2 })
        }
        child = resolve(child.Next)
      }
    }
    node = resolve(node.Next)
  }
  return entries
}

/** 每 20 页一节：标题「第 X–Y 页」（单页只写「第 X 页」）。 */
function fallbackChapters(pageCount) {
  const chapters = []
  for (let start = 1; start <= pageCount; start += 20) {
    const end = Math.min(pageCount, start + 19)
    chapters.push({
      title: start === end ? `第 ${start} 页` : `第 ${start}–${end} 页`,
      pageStart: start,
      pageEnd: end,
      level: 1,
    })
  }
  return chapters
}

// ------------------------------------------------------------------ 公共入口

/** 有效字符：去掉空白与纯标点后的码点数（03 §6.6 的扫描版判定口径）。 */
export function effectiveChars(text) {
  return [...String(text ?? '').replace(/[\s\p{P}\p{S}]/gu, '')].length
}

/**
 * 容器级校验：在落盘前判定「这是不是一个我们读得懂的 PDF」。
 * 与 EPUB 的 `validateEpubContainer` 对称——坏文件在请求阶段报错，
 * 只有文档级问题（如扫描版）才留下 `status='unsupported'` 的书。
 * @param {Uint8Array|Buffer} bytes
 */
export function validatePdfContainer(bytes) {
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(8, bytes.length)).toString('latin1')
  if (!head.startsWith(PDF_MAGIC)) throw new ReadingError('E_FORMAT', { reason: 'not-pdf' })
  const raw = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString('latin1')
  const objects = collectObjects(raw)
  expandObjectStreams(objects)
  if (objects.size === 0) throw new ReadingError('E_PARSE', { reason: 'no-objects' })
  const resolve = makeResolver(objects)
  for (const entry of objects.values()) {
    if (resolve(entry.value?.Type) === 'XRef' && entry.value?.Encrypt) {
      throw new ReadingError('E_ENCRYPTED', { reason: 'pdf-encrypted' })
    }
  }
  for (const match of raw.matchAll(/\/Encrypt\s+(\d+\s+\d+\s+R)/g)) {
    if (match) throw new ReadingError('E_ENCRYPTED', { reason: 'pdf-encrypted' })
  }
  const catalog = findCatalog(objects)
  if (!catalog) throw new ReadingError('E_PARSE', { reason: 'no-catalog' })
  if (!catalog.Pages) throw new ReadingError('E_PARSE', { reason: 'no-pages' })
  // 悬空引用（`/Pages 99 0 R` 但对象 99 不存在）属于坏文件：必须在导入阶段报错，
  // 不能落成一本 failed 的书（06-test MAN-05 用 corrupt.pdf 断言这一点）。
  const pagesRoot = resolve(catalog.Pages)
  if (!pagesRoot || typeof pagesRoot !== 'object') throw new ReadingError('E_PARSE', { reason: 'dangling-pages' })
  return { objects, catalog }
}

/**
 * 解析 PDF：分页 → 行 → 段 → 章节。
 * @param {Uint8Array|Buffer} bytes
 * @param {{ limits?: Record<string, number> }} [options]
 */
export function parsePdf(bytes, options = {}) {
  const limits = options.limits ?? {}
  const maxPages = limits.maxPdfPages ?? DEFAULT_MAX_PAGES
  const { objects, catalog } = validatePdfContainer(bytes)
  const resolve = makeResolver(objects)

  const info = findInfo(objects)
  const title = decodePdfText(resolve(info?.Title) ?? '').trim()
  const author = decodePdfText(resolve(info?.Author) ?? '').trim()
  const language = decodePdfText(resolve(info?.Lang) ?? '').trim() || null

  const pages = collectPages(objects, catalog, maxPages)
  if (pages.length === 0) throw new ReadingError('E_PARSE', { reason: 'no-pages' })
  if (pages.length > maxPages) {
    throw new ReadingError('E_TOO_LARGE', { reason: 'pages', pages: pages.length, limit: maxPages })
  }

  const pageRefToIndex = new Map()
  const kids = resolve(resolve(catalog.Pages)?.Kids)
  if (Array.isArray(kids)) {
    kids.forEach((ref, index) => {
      if (ref && typeof ref.num === 'number') pageRefToIndex.set(ref.num, index + 1)
    })
  }

  const warnings = []
  const pageTexts = []
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]
    // 注意：这里**不能**先解引用——`decodeStream` 需要对象表里的条目（含 .stream），
    // 解引用后只剩字典，流就丢了。
    const rawContents = page.Contents
    const streams = Array.isArray(rawContents) ? rawContents : [rawContents]
    let content = ''
    for (const streamRef of streams) {
      const entry = streamRef && typeof streamRef === 'object' && typeof streamRef.num === 'number' ? objects.get(streamRef.num) : null
      content += decodeStream(entry, objects)
      content += '\n'
    }
    const fonts = buildFonts(objects, page)
    let items = []
    try {
      items = extractTextItems(content, fonts)
    } catch (error) {
      warnings.push(`page ${index + 1}: text extraction failed`)
    }
    const lines = groupItemsIntoLines(items)
    pageTexts.push({ page: index + 1, lines, text: lines.map((line) => line.text).join('\n') })
  }

  // 页眉页脚：同一行文本在 >60% 页面出现且 <80 字 → 全部移除（只删完全匹配）。
  const repeated = findRepeatedFurniture(pageTexts)
  if (repeated.size > 0) {
    for (const pageText of pageTexts) {
      pageText.lines = pageText.lines.filter((line) => !repeated.has(line.text))
      pageText.text = pageText.lines.map((line) => line.text).join('\n')
    }
  }

  // 扫描版判定（03 §6.6）：采样首页/中间页/末页。
  const sampleIndexes = samplePageIndexes(pages.length)
  const sampled = sampleIndexes.map((page) => effectiveChars(pageTexts[page - 1]?.text ?? ''))
  const average = sampled.reduce((sum, chars) => sum + chars, 0) / Math.max(1, sampled.length)
  const scanMin = limits.scanMinChars ?? DEFAULT_SCAN_MIN_CHARS
  if (average < scanMin) {
    throw new ReadingError('E_SCANNED', { pages: pages.length, sampled: sampleIndexes, chars: Math.round(average) })
  }

  // 分段：章节按 outline，缺失则每 20 页。
  const outline = readOutline(objects, pageRefToIndex).filter((entry) => entry.page <= pages.length)
  const chapterRanges = []
  if (outline.length > 0) {
    outline.sort((a, b) => a.page - b.page)
    for (let index = 0; index < outline.length; index += 1) {
      const current = outline[index]
      const next = outline[index + 1]
      chapterRanges.push({
        title: current.title,
        level: current.level ?? 1,
        pageStart: current.page,
        pageEnd: next ? next.page - 1 : pages.length,
      })
    }
  } else {
    chapterRanges.push(...fallbackChapters(pages.length))
  }

  const chapters = []
  let chapterNumber = 0
  for (const range of chapterRanges) {
    chapterNumber += 1
    const blocks = []
    for (let page = range.pageStart; page <= range.pageEnd; page += 1) {
      const lines = pageTexts[page - 1]?.lines ?? []
      for (const paragraph of linesToParagraphs(lines)) {
        blocks.push({ text: paragraph, page })
      }
    }
    if (blocks.length === 0) continue
    chapters.push({
      id: `ch-${String(chapterNumber).padStart(3, '0')}`,
      title: normalizeText(range.title) || `第 ${range.pageStart} 页`,
      level: range.level ?? 1,
      path: [normalizeText(range.title) || `第 ${range.pageStart} 页`],
      pageStart: range.pageStart,
      pageEnd: range.pageEnd,
      blocks,
    })
  }
  if (chapters.length === 0) throw new ReadingError('E_PARSE', { reason: 'no-text' })

  return {
    title: title || '',
    author: author || null,
    language,
    format: 'pdf',
    pages: pages.length,
    chapters,
    warnings,
  }
}

/** 采样页号（1 起）：首页、中间页、末页。 */
export function samplePageIndexes(pageCount) {
  if (pageCount <= DEFAULT_SCAN_SAMPLE) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const middle = Math.floor(pageCount / 2) || 1
  return [...new Set([1, middle, pageCount])].sort((a, b) => a - b)
}

/** 每页首/末行里重复出现的短文本（页眉页脚）。 */
function findRepeatedFurniture(pageTexts) {
  const counts = new Map()
  for (const pageText of pageTexts) {
    const candidates = [pageText.lines[0], pageText.lines[pageText.lines.length - 1]].filter(Boolean)
    const seen = new Set()
    for (const line of candidates) {
      const text = line.text.trim()
      if (text === '' || text.length >= 80 || seen.has(text)) continue
      seen.add(text)
      counts.set(text, (counts.get(text) ?? 0) + 1)
    }
  }
  const repeated = new Set()
  const total = Math.max(1, pageTexts.length)
  for (const [text, count] of counts) {
    if (count / total > 0.6) repeated.add(text)
  }
  return repeated
}

/** 文档信息字典：trailer 的 /Info 或任何 /Type 缺省的 Info 对象。 */
function findInfo(objects) {
  const resolve = makeResolver(objects)
  for (const entry of objects.values()) {
    const value = entry.value
    if (value && typeof value === 'object' && (value.Title || value.Author) && !value.Type) return value
  }
  return null
}