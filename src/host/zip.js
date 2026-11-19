/**
 * 零依赖 ZIP 读取（03 §6.3 第 1 步）。
 *
 * 只做 M2 需要的部分：读中央目录、按名取条目、method 0（store）与 method 8
 * （deflate，用 `node:zlib`）。不写 ZIP、不读加密条目、不支持 zip64。
 *
 * 解压前就拒绝（不进内存）：
 * - 条目数 / 单条解压体积 / 总量 / 压缩比 → `E_TOO_LARGE`
 * - 条目名越界（`..`、绝对路径、反斜杠、盘符）→ `E_FORMAT`
 *
 * 条目名按 ZIP 规范用 UTF-8 解码；EPUB 里不区分大小写是阅读器的自由，
 * 这里保持严格匹配（OPF 里的 href 必须与条目名逐字节一致）。
 */

import { inflateRawSync } from 'node:zlib'
import { ReadingError } from './errors.js'

const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50
const MAX_COMMENT = 0xffff
/** 小于这个字节数的条目不做压缩比检查（避免把正常小文件误判成炸弹）。 */
const RATIO_MIN_BYTES = 1024

function formatError(reason, details) {
  return new ReadingError('E_FORMAT', { reason, ...details })
}

function tooLarge(reason, details) {
  return new ReadingError('E_TOO_LARGE', { reason, ...details })
}

function findEndOfCentralDirectory(buffer) {
  const lowest = Math.max(0, buffer.length - (MAX_COMMENT + 22))
  for (let at = buffer.length - 22; at >= lowest; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIG) return at
  }
  return -1
}

/**
 * 条目名安全检查。返回 `null` 表示安全，否则返回可以进 `details.reason` 的短标签。
 * @param {string} name
 */
export function entryNameProblem(name) {
  if (name === '' || name.includes('\0')) return 'entry-empty'
  if (name.includes('\\')) return 'entry-backslash'
  if (name.startsWith('/')) return 'entry-absolute'
  if (/^[A-Za-z]:/.test(name)) return 'entry-drive'
  const segments = name.split('/')
  for (const segment of segments) {
    if (segment === '..') return 'entry-traversal'
    if (segment === '.') return 'entry-dot'
  }
  return null
}

export class ZipArchive {
  /**
   * @param {Buffer} buffer
   * @param {Record<string, number>} [limits]
   */
  constructor(buffer, limits = {}) {
    this.buffer = buffer
    this.limits = limits
    /** @type {Map<string, {name: string, method: number, compressedSize: number, size: number, localOffset: number}>} */
    this.entries = new Map()
    this._parse()
  }

  _parse() {
    const buffer = this.buffer
    if (!Buffer.isBuffer(buffer)) throw formatError('not-a-buffer')
    if (buffer.length < 22) throw formatError('not-zip')

    const eocd = findEndOfCentralDirectory(buffer)
    if (eocd < 0) throw formatError('not-zip')

    const total = buffer.readUInt16LE(eocd + 10)
    const directorySize = buffer.readUInt32LE(eocd + 12)
    const directoryOffset = buffer.readUInt32LE(eocd + 16)
    if (total === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw formatError('zip64-unsupported')
    }
    if (directoryOffset + directorySize > buffer.length) throw formatError('truncated-directory')

    const maxEntries = this.limits.maxZipEntries ?? Number.POSITIVE_INFINITY
    if (total > maxEntries) throw tooLarge('zip-entries', { entries: total, limit: maxEntries })

    const maxEntryBytes = this.limits.maxZipEntryBytes ?? Number.POSITIVE_INFINITY
    const maxTotalBytes = this.limits.maxZipTotalBytes ?? Number.POSITIVE_INFINITY
    const maxRatio = this.limits.maxZipRatio ?? Number.POSITIVE_INFINITY

    let cursor = directoryOffset
    let declaredTotal = 0
    for (let index = 0; index < total; index += 1) {
      if (cursor + 46 > buffer.length) throw formatError('truncated-entry')
      if (buffer.readUInt32LE(cursor) !== CENTRAL_SIG) throw formatError('bad-central-directory')

      const method = buffer.readUInt16LE(cursor + 10)
      const compressedSize = buffer.readUInt32LE(cursor + 20)
      const size = buffer.readUInt32LE(cursor + 24)
      const nameLength = buffer.readUInt16LE(cursor + 28)
      const extraLength = buffer.readUInt16LE(cursor + 30)
      const commentLength = buffer.readUInt16LE(cursor + 32)
      const localOffset = buffer.readUInt32LE(cursor + 42)

      if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
        throw formatError('zip64-unsupported')
      }
      if (cursor + 46 + nameLength > buffer.length) throw formatError('truncated-entry')
      const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength)
      cursor += 46 + nameLength + extraLength + commentLength

      const problem = entryNameProblem(name)
      if (problem) throw formatError(problem, { name })

      // 目录条目（以 / 结尾）不读内容，但仍做名字检查。
      if (name.endsWith('/')) continue
      if (this.entries.has(name)) throw formatError('duplicate-entry', { name })

      if (size > maxEntryBytes) throw tooLarge('zip-entry', { name, bytes: size, limit: maxEntryBytes })
      declaredTotal += size
      if (declaredTotal > maxTotalBytes) {
        throw tooLarge('zip-total', { bytes: declaredTotal, limit: maxTotalBytes })
      }
      if (size >= RATIO_MIN_BYTES && compressedSize > 0 && size / compressedSize > maxRatio) {
        throw tooLarge('zip-ratio', { name, ratio: Math.round(size / compressedSize), limit: maxRatio })
      }
      if (size > 0 && compressedSize === 0) throw formatError('empty-compressed-entry', { name })

      this.entries.set(name, { name, method, compressedSize, size, localOffset })
    }
  }

  /** @param {string} name */
  has(name) {
    return this.entries.has(name)
  }

  names() {
    return [...this.entries.keys()]
  }

  size(name) {
    const entry = this.entries.get(name)
    return entry ? entry.size : 0
  }

  /**
   * 按名读取并解压一个条目。
   * @param {string} name
   * @returns {Buffer}
   */
  read(name) {
    const entry = this.entries.get(name)
    if (!entry) throw new ReadingError('E_NOT_FOUND', { reason: 'zip-entry', name })

    const buffer = this.buffer
    const offset = entry.localOffset
    if (offset + 30 > buffer.length) throw formatError('bad-local-header', { name })
    if (buffer.readUInt32LE(offset) !== LOCAL_SIG) throw formatError('bad-local-header', { name })
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const start = offset + 30 + nameLength + extraLength
    const end = start + entry.compressedSize
    if (end > buffer.length) throw formatError('truncated-entry', { name })
    const raw = buffer.subarray(start, end)

    if (entry.method === 0) {
      const output = Buffer.from(raw)
      if (output.length !== entry.size) throw formatError('size-mismatch', { name })
      return output
    }
    if (entry.method === 8) {
      let output
      try {
        output = inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) })
      } catch (error) {
        throw new ReadingError('E_FORMAT', { reason: 'inflate-failed', name }, { cause: error })
      }
      if (output.length !== entry.size) throw formatError('size-mismatch', { name })
      return output
    }
    throw formatError('unsupported-compression', { name, method: entry.method })
  }

  /** @param {string} name */
  readText(name) {
    return this.read(name).toString('utf8').replace(/^\uFEFF/, '')
  }
}