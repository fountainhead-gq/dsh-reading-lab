/**
 * 错误类型与 wire 信封（docs/04-api.md §1.2、§7）。
 *
 * 约定：
 * - 内部一律抛 `ReadingError`（带 `code`），由 `routes.js` 统一转成 HTTP 信封；
 * - `message` 从 `locale/*.json` 的 `error.<CODE>` 取，**不在这里写第二份文案**；
 * - 未知异常映射为 `E_IO`，只进日志，不带堆栈到 wire。
 */
import { readFileSync } from 'node:fs'

/** code → HTTP 状态码（04 §7）。 */
export const ERROR_HTTP = Object.freeze({
  E_BAD_REQUEST: 400,
  E_PATH: 400,
  E_NOT_FOUND: 404,
  E_BUSY: 409,
  E_TOO_LARGE: 413,
  E_FORMAT: 415,
  E_ENCRYPTED: 422,
  E_SCANNED: 422,
  E_PARSE: 422,
  E_CITATION: 422,
  E_AGENT: 502,
  E_IO: 500,
  E_SCHEMA: 500,
  E_UNSUPPORTED: 501,
  E_NOT_IMPLEMENTED: 501,
})

/** 可重试语义（Client 用来决定是否给「重试」按钮）。 */
export const ERROR_RETRYABLE = Object.freeze({
  E_BAD_REQUEST: false,
  E_PATH: false,
  E_NOT_FOUND: false,
  E_BUSY: true,
  E_TOO_LARGE: false,
  E_FORMAT: false,
  E_ENCRYPTED: false,
  E_SCANNED: false,
  E_PARSE: true,
  E_CITATION: true,
  E_AGENT: true,
  E_IO: true,
  E_SCHEMA: false,
  E_UNSUPPORTED: false,
  E_NOT_IMPLEMENTED: false,
})

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_HTTP))

export const DEFAULT_ERROR_CODE = 'E_IO'

/** 带 code 的错误。`details` 只放机器可读字段（limit/actual/field/format/...）。 */
export class ReadingError extends Error {
  /**
   * @param {string} code
   * @param {Record<string, unknown>} [details]
   * @param {{ cause?: unknown, message?: string }} [options] `message` 只用于进程内/工具面，
   *   HTTP wire 文案永远由 `error.<CODE>` 渲染。
   */
  constructor(code, details, options) {
    super(options?.message ?? code, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ReadingError'
    this.code = ERROR_HTTP[code] === undefined ? DEFAULT_ERROR_CODE : code
    this.details = details && typeof details === 'object' ? details : undefined
  }
}

/** 断言式包装：非 ReadingError 转成 E_IO（保留 cause 便于日志）。 */
export function asReadingError(error) {
  if (error instanceof ReadingError) return error
  return new ReadingError(DEFAULT_ERROR_CODE, undefined, { cause: error })
}

/** 便捷构造：`fail('E_NOT_FOUND', { resource: 'book' })`。 */
export function fail(code, details) {
  return new ReadingError(code, details)
}

/** `E_NOT_IMPLEMENTED`：M1 的桩统一走这里，细节带模块名。 */
export function notImplemented(module, hint) {
  const where = typeof module === 'string' ? module : 'unknown'
  return new ReadingError('E_NOT_IMPLEMENTED', { module: where }, {
    message: `${where} is not implemented yet (E_NOT_IMPLEMENTED)${hint ? `: ${hint}` : ''}`,
  })
}

// ---------------------------------------------------------------------------
// 文案：单一来源是 locale/*.json 的 `error` 段
// ---------------------------------------------------------------------------

const LOCALE_FILES = Object.freeze({
  zh: new URL('../../locale/zh.json', import.meta.url),
  en: new URL('../../locale/en.json', import.meta.url),
})

/** @type {Map<string, Record<string, string>>} */
const messageCache = new Map()

function loadErrorMessages(lang) {
  const key = lang === 'en' ? 'en' : 'zh'
  const cached = messageCache.get(key)
  if (cached) return cached
  let table = Object.create(null)
  try {
    const raw = JSON.parse(readFileSync(LOCALE_FILES[key], 'utf8'))
    if (raw && typeof raw.error === 'object' && raw.error !== null) table = raw.error
  } catch {
    // locale 缺失时退化成 code 本身，不影响路由可用性。
  }
  messageCache.set(key, table)
  return table
}

/** 从 `Accept-Language` 里挑一个受支持的语言（缺省 zh）。 */
export function pickLanguage(header) {
  const value = typeof header === 'string' ? header.toLowerCase() : ''
  if (!value) return 'zh'
  return value.startsWith('en') || value.includes(',en') ? 'en' : 'zh'
}

/** `error.<CODE>` 的本地化文案；缺失时返回 code 本身。 */
export function messageFor(code, lang = 'zh') {
  const table = loadErrorMessages(lang)
  const text = table[code]
  return typeof text === 'string' && text.length > 0 ? text : code
}

let requestCounter = 0

/** 请求标识：写进 import.log 与响应头，便于对账（04 §1.2）。 */
export function newRequestId() {
  requestCounter = (requestCounter + 1) % 0xffff
  const stamp = Date.now().toString(36).slice(-6)
  return `req-${stamp}${requestCounter.toString(36).padStart(3, '0')}`
}

/**
 * 把任意异常转成 wire 信封体。
 * @param {unknown} error
 * @param {{ requestId: string, lang?: string }} options
 */
export function toWireError(error, options) {
  const reading = asReadingError(error)
  const lang = options?.lang ?? 'zh'
  /** @type {{ code: string, message: string, details?: Record<string, unknown>, requestId: string }} */
  const body = {
    code: reading.code,
    // 显式 message（构造时传了 options.message）优先，用于「本版本不提供，v0.2 再来」这类
    // 需要说人话的场景；未传时走 `error.<CODE>` 的本地化文案，保持契约稳定。
    message:
      typeof reading.message === 'string' && reading.message.length > 0 && reading.message !== reading.code
        ? reading.message
        : messageFor(reading.code, lang),
    requestId: options?.requestId ?? newRequestId(),
  }
  if (reading.details !== undefined) body.details = reading.details
  return { ok: false, error: body }
}

/** code 对应的 HTTP 状态码（未知 code 按 500）。 */
export function httpStatusOf(code) {
  return ERROR_HTTP[code] ?? 500
}