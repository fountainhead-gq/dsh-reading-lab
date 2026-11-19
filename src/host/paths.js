/**
 * 工作区内的路径安全（docs/03-design.md §10.2、docs/04-api.md §1.3）。
 *
 * 两条规则：
 * 1. 一切落盘路径都必须相对 `reading/`，禁止 `..`、绝对路径、盘符、UNC；
 * 2. 已存在的祖先目录要 realpath 校验，防止 symlink 把写入带出工作区。
 *
 * `assertSafeRelative()` 是纯函数（无 fs）；`resolveInReading()` 会碰 fs（realpath），
 * 因此只允许 Host 侧调用，Client 不打包。
 */
import { realpath } from 'node:fs/promises'
import * as path from 'node:path'

import { ReadingError } from './errors.js'
import { READING_DIR } from './limits.js'

/** Windows 设备保留名（不区分大小写，带不带扩展名都不行）。 */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
])

function pathError(reason, extra) {
  return new ReadingError('E_PATH', { reason, ...(extra ?? {}) })
}

/**
 * 校验并规范化一个相对路径。
 *
 * @param {unknown} input
 * @returns {string} 用 `/` 分隔的规范化相对路径（无前导 `./`）
 * @throws {ReadingError} `E_PATH`，`details.reason` 说明原因
 */
export function assertSafeRelative(input) {
  if (typeof input !== 'string') throw pathError('not-a-string')
  const raw = input.trim()
  if (raw === '') throw pathError('empty')
  if (raw.includes('\0')) throw pathError('nul-byte')
  if (raw.length > 1024) throw pathError('too-long')

  // 绝对路径：POSIX `/`、Windows 盘符 `C:`、UNC `\\`、以及 `\\?\` 形式。
  if (raw.startsWith('/') || raw.startsWith('\\')) throw pathError('absolute')
  if (/^[A-Za-z]:/.test(raw)) throw pathError('drive-letter')
  if (raw.includes('\\')) throw pathError('backslash')

  const segments = raw.split('/')
  /** @type {string[]} */
  const kept = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') throw pathError('dot-dot')
    // Windows：段尾的 `.`/空格会被系统静默裁掉，等同路径逃逸的另一种写法。
    if (/[. ]$/.test(segment)) throw pathError('trailing-dot-or-space', { segment })
    const stem = segment.split('.')[0].toLowerCase()
    if (RESERVED_NAMES.has(stem)) throw pathError('reserved-name', { segment })
    if (/[<>:"|?*]/.test(segment)) throw pathError('illegal-character', { segment })
    kept.push(segment)
  }
  if (kept.length === 0) throw pathError('empty')
  return kept.join('/')
}

/** `child` 是否在 `parent` 内（含相等）。纯字符串判断，用于错误信息与日志。 */
export function isInsideOrEqual(parent, child) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

async function realpathOrNull(target) {
  try {
    return await realpath(target)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * 把相对路径解析到 `<root>/reading/` 之下，并做 symlink 逃逸校验。
 *
 * @param {string} root 工作区根（绝对路径）
 * @param {string} relative 相对路径（可含子目录）
 * @returns {Promise<string>} 绝对路径
 */
export async function resolveInReading(root, relative) {
  const safe = assertSafeRelative(relative)
  const rootReal = (await realpathOrNull(path.resolve(root))) ?? path.resolve(root)
  const base = path.join(rootReal, READING_DIR)

  // reading/ 自身也不能被 symlink 指到工作区外。
  const baseReal = await realpathOrNull(base)
  if (baseReal !== null && !isInsideOrEqual(rootReal, baseReal)) {
    throw pathError('outside-workspace', { segment: READING_DIR })
  }

  const target = path.resolve(base, safe)
  if (!isInsideOrEqual(base, target)) throw pathError('outside-workspace')

  // 逐级向上找第一个存在的祖先，确认它 realpath 之后仍在 reading/ 内。
  let cursor = target
  while (isInsideOrEqual(base, cursor)) {
    const real = await realpathOrNull(cursor)
    if (real !== null) {
      if (!isInsideOrEqual(baseReal ?? base, real)) throw pathError('symlink-escape')
      break
    }
    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  return target
}

/** 供日志/错误信息使用：把绝对路径缩成 `reading/...`（不泄露工作区绝对路径）。 */
export function displayPath(root, absolute) {
  const base = path.resolve(root)
  const rel = path.relative(base, absolute)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return path.basename(absolute)
  return rel.split(path.sep).join('/')
}