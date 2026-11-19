/**
 * 宽容 XML 解析（只够 EPUB 用，03 §6.3 第 6 步要求「用 XML 解析而不是正则」）。
 *
 * 支持：元素、属性、自闭合、文本、CDATA、注释、处理指令、DOCTYPE（含内部子集）。
 * 不校验 DTD、不做命名空间解析——`dc:title` 这类名字原样保留，由 `localName()` 取局部名。
 *
 * 节点形状：`{ name: string, attrs: Record<string, string>, children: Array<Node|string> }`。
 * 文本子节点就是字符串（实体已解码）。
 */

const ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
})

/** @param {string} value */
export function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = hex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      return String.fromCodePoint(code)
    }
    const key = body.toLowerCase()
    return Object.prototype.hasOwnProperty.call(ENTITIES, key) ? ENTITIES[key] : match
  })
}

/** @param {string} name */
export function localName(name) {
  const at = name.indexOf(':')
  return at < 0 ? name : name.slice(at + 1)
}

function readAttributes(source, start) {
  const attrs = {}
  let cursor = start
  while (cursor < source.length) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
    if (cursor >= source.length) break
    if (source[cursor] === '>' || source[cursor] === '/') break
    const nameStart = cursor
    while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor += 1
    const name = source.slice(nameStart, cursor)
    if (!name) break
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
    if (source[cursor] !== '=') {
      attrs[name] = ''
      continue
    }
    cursor += 1
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1
    const quote = source[cursor]
    let value = ''
    if (quote === '"' || quote === "'") {
      const valueStart = cursor + 1
      let valueEnd = source.indexOf(quote, valueStart)
      if (valueEnd < 0) valueEnd = source.length
      value = source.slice(valueStart, valueEnd)
      cursor = valueEnd + 1
    } else {
      const valueStart = cursor
      while (cursor < source.length && !/[\s>]/.test(source[cursor])) cursor += 1
      value = source.slice(valueStart, cursor)
    }
    attrs[name] = decodeEntities(value)
  }
  return attrs
}

/**
 * @param {string} source
 * @returns {{ name: string, attrs: Record<string, string>, children: Array<any> }}
 */
export function parseXml(source) {
  const text = String(source ?? '')
  const root = { name: '#document', attrs: {}, children: [] }
  /** @type {Array<any>} */
  const stack = [root]

  let cursor = 0
  while (cursor < text.length) {
    const lt = text.indexOf('<', cursor)
    if (lt < 0) {
      pushText(stack, text.slice(cursor))
      break
    }
    if (lt > cursor) pushText(stack, text.slice(cursor, lt))

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4)
      cursor = end < 0 ? text.length : end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9)
      const value = text.slice(lt + 9, end < 0 ? text.length : end)
      if (value) stack[stack.length - 1].children.push(value)
      cursor = end < 0 ? text.length : end + 3
      continue
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2)
      cursor = end < 0 ? text.length : end + 2
      continue
    }
    if (text.startsWith('<!', lt)) {
      // DOCTYPE：跳过，内部子集用 [ ] 记深度。
      let depth = 0
      let end = lt + 2
      while (end < text.length) {
        const ch = text[end]
        if (ch === '[') depth += 1
        else if (ch === ']') depth -= 1
        else if (ch === '>' && depth <= 0) break
        end += 1
      }
      cursor = end < text.length ? end + 1 : text.length
      continue
    }
    if (text.startsWith('</', lt)) {
      const end = text.indexOf('>', lt + 2)
      const name = text.slice(lt + 2, end < 0 ? text.length : end).trim()
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].name === name) {
          stack.length = index
          break
        }
      }
      cursor = end < 0 ? text.length : end + 1
      continue
    }

    const nameEnd = findTagNameEnd(text, lt + 1)
    if (nameEnd < 0) {
      pushText(stack, text.slice(lt))
      break
    }
    const name = text.slice(lt + 1, nameEnd)
    const attrs = readAttributes(text, nameEnd)
    const node = { name, attrs, children: [] }
    stack[stack.length - 1].children.push(node)

    const tagEnd = findTagEnd(text, nameEnd)
    if (tagEnd < 0) break
    const selfClosing = text[tagEnd - 1] === '/'
    if (!selfClosing) stack.push(node)
    cursor = tagEnd + 1
  }

  const firstElement = root.children.find((child) => typeof child !== 'string')
  return firstElement ?? root
}

function findTagNameEnd(text, from) {
  let cursor = from
  while (cursor < text.length && !/[\s/>]/.test(text[cursor])) cursor += 1
  return cursor > from ? cursor : -1
}

function findTagEnd(text, from) {
  let cursor = from
  let quote = ''
  while (cursor < text.length) {
    const ch = text[cursor]
    if (quote) {
      if (ch === quote) quote = ''
    } else if (ch === '"' || ch === "'") {
      quote = ch
    } else if (ch === '>') {
      return cursor
    }
    cursor += 1
  }
  return -1
}

function pushText(stack, raw) {
  if (!raw) return
  const value = decodeEntities(raw)
  if (value.trim() === '') {
    // 纯空白保留一个空格：段落之间需要它，避免 "foo</b><i>bar" 粘成 "foobar"。
    if (value) stack[stack.length - 1].children.push(' ')
    return
  }
  stack[stack.length - 1].children.push(value)
}

function matches(node, name) {
  if (node.name === name) return true
  return localName(node.name).toLowerCase() === String(name).toLowerCase()
}

/** @param {any} node @param {string} name */
export function findChild(node, name) {
  if (!node || !Array.isArray(node.children)) return null
  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (matches(child, name)) return child
  }
  return null
}

/** @param {any} node @param {string} name */
export function findChildren(node, name) {
  const out = []
  if (!node || !Array.isArray(node.children)) return out
  for (const child of node.children) {
    if (typeof child === 'string') continue
    if (matches(child, name)) out.push(child)
  }
  return out
}

/** @param {any} node @param {string} name */
export function descendantChildren(node, name) {
  const out = []
  const visit = (current) => {
    if (!current || !Array.isArray(current.children)) return
    for (const child of current.children) {
      if (typeof child === 'string') continue
      if (matches(child, name)) out.push(child)
      visit(child)
    }
  }
  visit(node)
  return out
}

/** 属性取值：先精确匹配，再按局部名匹配（大小写不敏感）。 */
export function getAttr(node, name) {
  if (!node || !node.attrs) return undefined
  if (Object.prototype.hasOwnProperty.call(node.attrs, name)) return node.attrs[name]
  const wanted = String(name).toLowerCase()
  for (const key of Object.keys(node.attrs)) {
    if (localName(key).toLowerCase() === wanted) return node.attrs[key]
  }
  return undefined
}

/** 节点内所有文本（跳过 script/style/head）。 */
export function textOf(node) {
  if (typeof node === 'string') return node
  if (!node || !Array.isArray(node.children)) return ''
  const name = localName(node.name).toLowerCase()
  if (name === 'script' || name === 'style' || name === 'head') return ''
  let out = ''
  for (const child of node.children) out += textOf(child)
  return out
}