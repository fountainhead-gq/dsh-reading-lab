/**
 * 导出格式的公共小工具（owner: export，docs/03-design.md §9）。
 *
 * 纯函数，没有 I/O：转义、文件名清洗、时间戳。三种格式共用，
 * 测试可以单独覆盖（UT-EXP-01）。
 */

/** 本版本真正能生成的格式（03 §9.1：html/png 属 v0.3）。 */
export const IMPLEMENTED_FORMATS = Object.freeze(['md', 'opml', 'json'])

/** 扩展名（与 04 §4.2 #24 的 Content-Type 表对应）。 */
export const FORMAT_EXT = Object.freeze({ md: 'md', opml: 'opml', json: 'json', html: 'html' })

/** 同名冲突时的后缀上限（03 §9.1：最多 99）。 */
export const MAX_DUPLICATE_SUFFIX = 99

const MARKDOWN_SPECIALS = /[\\*_[\]`#>]/g

/**
 * Markdown 正文转义（03 §9.2）：`\ * _ [ ] ` # >`。
 * 行首的 `-`/`+`/数字句点也转义，避免变成列表。
 */
export function escapeMarkdown(text) {
  const source = String(text ?? '')
  return source
    .replace(MARKDOWN_SPECIALS, (char) => `\\${char}`)
    .replace(/^(\s*)([-+])(\s)/gm, '$1\\$2$3')
    .replace(/^(\s*)(\d+)(\.)(\s)/gm, '$1$2\\$3$4')
}

/**
 * 回答正文：保留 `[c-000123]` 引用原样（否则面板/阅读器里搜不到），其余转义。
 * 03 §9.2 要求「所有文本转义」，引用是模板的一部分，单独豁免。
 */
export function escapeMarkdownKeepingCitations(text) {
  const source = String(text ?? '')
  const parts = source.split(/(\[c-\d{6}\])/g)
  return parts
    .map((part) => (/^\[c-\d{6}\]$/.test(part) ? part : escapeMarkdown(part)))
    .join('')
}

/** XML/OPML 转义：`& < > " '`（03 §9.3）。 */
export function escapeXml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * 文件名清洗：去掉路径分隔符、Windows 保留字符与控制字符，
 * 空白折叠成 `-`，去掉首尾的点与空格，最长 60 码点。
 */
export function sanitizeFileName(name, fallback = 'book') {
  const raw = String(name ?? '').trim()
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
  const points = Array.from(cleaned).slice(0, 60).join('')
  return points === '' ? fallback : points
}

function pad(value) {
  return String(value).padStart(2, '0')
}

/** `yyyyMMdd-HHmmss`（本地时区，文件名用）。 */
export function fileStamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

/** `yyyy-MM-dd HH:mm`（人读的导出时间）。 */
export function humanStamp(date = new Date()) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/** OPML 的 `dateCreated`：RFC 822（`Thu, 19 Nov 2026 09:30:00 GMT`）。 */
export function rfc822(date = new Date()) {
  return date.toUTCString()
}

/**
 * 在已存在的文件名集合里挑一个不冲突的名字：`name.ext`、`name-2.ext` … `name-99.ext`。
 * @param {string} base 不含扩展名的基名（已清洗）
 * @param {string} ext 不带点的扩展名
 * @param {(candidate: string) => boolean} exists
 */
export function uniqueName(base, ext, exists) {
  const first = `${base}.${ext}`
  if (!exists(first)) return first
  for (let index = 2; index <= MAX_DUPLICATE_SUFFIX; index += 1) {
    const candidate = `${base}-${index}.${ext}`
    if (!exists(candidate)) return candidate
  }
  return null
}