/**
 * 标识符格式（docs/04-api.md §1.1）。
 *
 * `bookId ^b[0-9a-f]{12}$`、`chunkId ^c-\d{6}$`、`threadId ^t-\d{2,}$`、
 * `nodeId ^n-[0-9a-f]{8}(-\d+)?$`。生成用内容哈希 / 序号，保证重复导入得到同一 id。
 */
import { createHash } from 'node:crypto'

export const BOOK_ID_PATTERN = /^b[0-9a-f]{12}$/
export const CHUNK_ID_PATTERN = /^c-\d{6}$/
export const THREAD_ID_PATTERN = /^t-\d{2,}$/
export const MESSAGE_ID_PATTERN = /^m-\d{2,}$/
export const NODE_ID_PATTERN = /^n-[0-9a-f]{8}(-\d+)?$/

export function isBookId(value) {
  return typeof value === 'string' && BOOK_ID_PATTERN.test(value)
}

export function isChunkId(value) {
  return typeof value === 'string' && CHUNK_ID_PATTERN.test(value)
}

export function isThreadId(value) {
  return typeof value === 'string' && THREAD_ID_PATTERN.test(value)
}

/** 线程内消息 id（`m-01`）；与 DSH 会话消息 id 无关，后者记在 `messageId` 字段。 */
export function isMessageId(value) {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value)
}

/** 线程序号 → messageId。 */
export function messageIdAt(index) {
  return `m-${String(index).padStart(2, '0')}`
}

/** 由文件字节算 bookId：同一份文件重复导入得到同一个 id（重复导入去重的基础）。 */
export function bookIdFromBytes(bytes) {
  const digest = createHash('sha256').update(bytes).digest('hex')
  return `b${digest.slice(0, 12)}`
}

/** 块序号 → chunkId（从 0 开始，与 chunks.json 数组下标一致）。 */
export function chunkIdAt(index) {
  return `c-${String(index).padStart(6, '0')}`
}

/** 线程序号 → threadId。 */
export function threadIdAt(index) {
  return `t-${String(index).padStart(2, '0')}`
}

/** 导图节点 id：由章节路径或块首哈希派生，同一输入稳定。 */
export function nodeIdFrom(seed, salt) {
  const digest = createHash('sha1').update(String(seed)).digest('hex')
  const base = `n-${digest.slice(0, 8)}`
  return typeof salt === 'number' && salt > 0 ? `${base}-${salt}` : base
}