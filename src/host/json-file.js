/**
 * JSON 文件读写（docs/03-design.md §5.9「原子写」）。
 *
 * 规则：
 * - 写入走 `<file>.tmp` + `rename`，同目录内原子替换；崩溃时最多留下 `.tmp`；
 * - 每个 JSON 文件都带 `schemaVersion`，读时校验，不匹配抛 `E_SCHEMA`；
 * - 读取不存在返回 `null`（由调用方决定是空态还是 404），解析失败抛 `E_IO`。
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError } from './errors.js'

/** 各文件当前 schema 版本（03 §5.9）。 */
export const SCHEMA_VERSION = Object.freeze({
  index: 1,
  meta: 1,
  chunks: 1,
  map: 1,
  threads: 1,
  export: 1,
})

function tmpName(file) {
  const suffix = randomBytes(6).toString('hex')
  return path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${suffix}.tmp`)
}

/**
 * 读 JSON。不存在返回 `null`。
 *
 * @param {string} file
 * @param {{ schemaVersion?: number }} [options]
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readJson(file, options) {
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw new ReadingError('E_IO', { op: 'read' }, { cause: error })
  }

  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new ReadingError('E_IO', { op: 'read', reason: 'invalid-json' }, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReadingError('E_SCHEMA', { expected: 'object', actual: Array.isArray(value) ? 'array' : typeof value })
  }

  const expected = options?.schemaVersion
  if (typeof expected === 'number') {
    const actual = value.schemaVersion
    if (actual !== expected) {
      throw new ReadingError('E_SCHEMA', { expected, actual: typeof actual === 'number' ? actual : null })
    }
  }
  return value
}

/**
 * 原子写 JSON（自动补 `schemaVersion`，格式化 2 空格 + 末尾换行，便于 git diff）。
 *
 * @param {string} file
 * @param {Record<string, unknown>} value
 * @param {{ schemaVersion?: number }} [options]
 */
export async function writeJsonAtomic(file, value, options) {
  const payload = { ...value }
  if (typeof options?.schemaVersion === 'number') payload.schemaVersion = options.schemaVersion
  const text = `${JSON.stringify(payload, null, 2)}\n`
  const tmp = tmpName(file)
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw new ReadingError('E_IO', { op: 'write' }, { cause: error })
  }
}

/** 文本原子写（notes.md 等），同样 tmp + rename。 */
export async function writeTextAtomic(file, text) {
  const tmp = tmpName(file)
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(tmp, text, 'utf8')
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw new ReadingError('E_IO', { op: 'write' }, { cause: error })
  }
}