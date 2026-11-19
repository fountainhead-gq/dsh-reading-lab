/**
 * 线程存储（owner: ask，03 §5.6 / 04 §3.4）。
 *
 * `threads.json` 是每本书问答线程的唯一事实来源：
 *
 * ```
 * reading/books/<bookId>/threads.json
 * { schemaVersion: 1, bookId, updatedAt, threads: [{ id, scope, state, messages: [...] }] }
 * ```
 *
 * 约束（与文档逐条对应）：
 * - 线程 id `t-01` 递增、删除不回收；消息 id `m-01` 同理。
 * - 每本书最多一个 `running` 线程；进程重启时 `running → idle`，未完成消息
 *   `pending|streaming → stopped`，不自动重发（§5.6）。
 * - `qa-threads.json` 是早期别名，**禁止**读写（D-03-03）。
 * - 引用只保留 `{ chunkId }`；写入时可选传入合法 id 集合做净化。
 *
 * 所有「读-改-写」都在 `books.enqueue` 内串行，避免并发请求互相覆盖。
 */
import * as path from 'node:path'

import { ReadingError } from './errors.js'
import { isMessageId, isThreadId, messageIdAt, threadIdAt } from './ids.js'
import { readJson, SCHEMA_VERSION, writeJsonAtomic } from './json-file.js'

export const THREADS_SCHEMA_VERSION = SCHEMA_VERSION.threads
export const MAX_QUESTION_CHARS = 2000
export const MAX_ANSWER_CHARS = 20_000
export const MAX_MESSAGES_PER_THREAD = 200
export const THREAD_STATES = Object.freeze(['idle', 'running'])
export const MESSAGE_STATUSES = Object.freeze(['pending', 'streaming', 'done', 'stopped', 'failed'])
export const FEEDBACK_VALUES = Object.freeze(['up', 'down'])
export const FEEDBACK_FIELD = 'feedback'

/** 线程文件路径；文件名固定，**不允许**出现 `qa-threads.json`。 */
export function threadsFile(service, bookId) {
  return path.join(service.bookDir(bookId), 'threads.json')
}

/** 空线程文件（不落盘）。 */
export function emptyThreads(bookId) {
  return { schemaVersion: THREADS_SCHEMA_VERSION, bookId, updatedAt: null, threads: [] }
}

function nowIso() {
  return new Date().toISOString()
}

function charCount(value) {
  return Array.from(String(value ?? '')).length
}

function assertState(state) {
  if (!THREAD_STATES.includes(state)) {
    throw new ReadingError('E_BAD_REQUEST', { field: 'state', allowed: [...THREAD_STATES] })
  }
}

function assertStatus(status) {
  if (!MESSAGE_STATUSES.includes(status)) {
    throw new ReadingError('E_BAD_REQUEST', { field: 'status', allowed: [...MESSAGE_STATUSES] })
  }
}

/** 读取时把上次进程留下的中间态降级；返回新对象与是否变化。 */
export function downgradeThreads(file) {
  let changed = false
  const threads = (Array.isArray(file.threads) ? file.threads : []).map((thread) => {
    const state = thread.state === 'running' ? 'idle' : THREAD_STATES.includes(thread.state) ? thread.state : 'idle'
    if (state !== thread.state) changed = true
    const messages = (Array.isArray(thread.messages) ? thread.messages : []).map((message) => {
      if (message.status === 'pending' || message.status === 'streaming') {
        changed = true
        return { ...message, status: 'stopped' }
      }
      return message
    })
    return { ...thread, state, messages }
  })
  return { file: { ...file, threads }, changed }
}

/** 校验线程文件形状；损坏时抛 `E_SCHEMA`（不静默）。 */
function assertFileShape(file, bookId) {
  if (!Array.isArray(file.threads)) {
    throw new ReadingError('E_SCHEMA', { reason: 'threads-invalid', bookId })
  }
  if (file.bookId !== bookId) {
    throw new ReadingError('E_SCHEMA', { reason: 'threads-book-mismatch', expected: bookId, actual: file.bookId ?? null })
  }
  return file
}

/**
 * 每个 BookService 进程内只对一本书做一次「重启降级」。
 * 不能用「每次读都降级」：运行中的线程在后续读写里会被误判成 idle（UT-THREAD-07）。
 */
const downgradedBooks = new WeakMap()

async function readFileFor(service, bookId) {
  await service.get(bookId)
  const value = await readJson(threadsFile(service, bookId), { schemaVersion: THREADS_SCHEMA_VERSION })
  if (!value) return emptyThreads(bookId)
  const checked = assertFileShape(value, bookId)
  let seen = downgradedBooks.get(service)
  if (!seen) {
    seen = new Set()
    downgradedBooks.set(service, seen)
  }
  if (seen.has(bookId)) return checked
  seen.add(bookId)
  const { file, changed } = downgradeThreads(checked)
  if (!changed) return file
  // 把降级结果写回：下次进程启动不该再看到上一次留下的 pending/running。
  const next = { ...file, bookId, updatedAt: nowIso() }
  try {
    await writeJsonAtomic(threadsFile(service, bookId), next, { schemaVersion: THREADS_SCHEMA_VERSION })
  } catch {
    // 只读文件系统：内存里降级即可，不阻断读取
  }
  return next
}

/** 原子写 + 刷新 `meta.threadsUpdatedAt` + 推 SSE。调用方负责包在 enqueue 里。 */
async function persist(service, bookId, file, event = {}) {
  const at = nowIso()
  const next = { ...file, bookId, updatedAt: at }
  await writeJsonAtomic(threadsFile(service, bookId), next, { schemaVersion: THREADS_SCHEMA_VERSION })
  const meta = await service.get(bookId)
  const updated = await service.writeMeta({ ...meta, threadsUpdatedAt: at })
  await service.upsertSummary(updated)
  try {
    service.hub?.publish?.({ type: 'thread', bookId, updatedAt: at, ...event })
  } catch {
    // 节流器已关闭（卸载中）
  }
  return next
}

/** 读线程文件（含重启降级）；不存在时返回空结构而不是 404。 */
export async function readThreads(service, bookId) {
  return readFileFor(service, bookId)
}

function findThread(file, threadId) {
  const thread = (file.threads ?? []).find((item) => item && item.id === threadId)
  if (!thread) throw new ReadingError('E_NOT_FOUND', { reason: 'thread', threadId })
  return thread
}

function findMessage(thread, messageId) {
  const message = (thread.messages ?? []).find((item) => item && item.id === messageId)
  if (!message) throw new ReadingError('E_NOT_FOUND', { reason: 'message', messageId, threadId: thread.id })
  return message
}

function nextThreadId(file) {
  let max = 0
  for (const thread of file.threads ?? []) {
    const match = /^t-(\d+)$/.exec(String(thread?.id ?? ''))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return threadIdAt(max + 1)
}

function nextMessageId(thread) {
  let max = 0
  for (const message of thread.messages ?? []) {
    const match = /^m-(\d+)$/.exec(String(message?.id ?? ''))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return messageIdAt(max + 1)
}

/** 引用净化：只保留 `{ chunkId }` 形状；给了合法集合就丢弃未知 id。 */
export function sanitizeCitations(citations, allowedChunkIds) {
  const output = []
  const seen = new Set()
  for (const item of Array.isArray(citations) ? citations : []) {
    const chunkId = typeof item === 'string' ? item : item && typeof item.chunkId === 'string' ? item.chunkId : null
    if (!chunkId || seen.has(chunkId)) continue
    if (allowedChunkIds && !allowedChunkIds.has(chunkId)) continue
    seen.add(chunkId)
    output.push({ chunkId })
  }
  return output
}

/** 从回答文本里抽 `[c-000123]` 引用；未知 chunk 丢弃（§8.3）。 */
export function citationsFromText(text, allowedChunkIds) {
  const found = []
  const source = String(text ?? '')
  for (const match of source.matchAll(/\[c-(\d{6})\]/g)) {
    found.push({ chunkId: `c-${match[1]}` })
  }
  return sanitizeCitations(found, allowedChunkIds)
}

/**
 * 建线程。`scope` 已在路由层解析（nodeTitle 由 map 补齐）。
 * @param {import('./books.js').BookService} service
 * @param {string} bookId
 * @param {{ kind: 'node'|'book', nodeId?: string, nodeTitle?: string }} scope
 */
export async function createThread(service, bookId, scope) {
  const kind = scope?.kind === 'node' ? 'node' : 'book'
  const normalized =
    kind === 'node'
      ? { kind: 'node', nodeId: String(scope.nodeId), nodeTitle: String(scope.nodeTitle ?? '') }
      : { kind: 'book' }
  return service.enqueue(async () => {
    const file = await readFileFor(service, bookId)
    if (file.threads.length >= 200) {
      throw new ReadingError('E_TOO_LARGE', { reason: 'threads', limit: 200 })
    }
    const at = nowIso()
    const thread = {
      id: nextThreadId(file),
      scope: normalized,
      createdAt: at,
      updatedAt: at,
      state: 'idle',
      messages: [],
    }
    file.threads.push(thread)
    await persist(service, bookId, file, { threadId: thread.id })
    return thread
  })
}

/** 找某节点最近的一条线程（用于 `POST /ask` 省略 threadId 时复用）。 */
export function findThreadByNode(file, nodeId) {
  const matches = (file.threads ?? []).filter(
    (thread) => thread && thread.scope && thread.scope.kind === 'node' && thread.scope.nodeId === nodeId,
  )
  return matches.length > 0 ? matches[matches.length - 1] : null
}

/**
 * 追加一条消息。
 * @param {import('./books.js').BookService} service
 * @param {string} bookId
 * @param {string} threadId
 * @param {{ id?: string, role: 'user'|'assistant', text: string, citations?: Array<{chunkId: string}|string>, status?: string, messageId?: string|null }} input
 * @param {{ allowedChunkIds?: Set<string> }} [options]
 */
export async function appendMessage(service, bookId, threadId, input, options = {}) {
  if (!isThreadId(threadId)) throw new ReadingError('E_BAD_REQUEST', { field: 'threadId' })
  const role = input?.role === 'assistant' ? 'assistant' : input?.role === 'user' ? 'user' : null
  if (!role) throw new ReadingError('E_BAD_REQUEST', { field: 'role' })
  const text = String(input?.text ?? '')
  const limit = role === 'assistant' ? MAX_ANSWER_CHARS : MAX_QUESTION_CHARS
  if (text.trim() === '' || charCount(text) > limit) {
    throw new ReadingError('E_BAD_REQUEST', { field: 'text', reason: 'length', limit })
  }
  const status = input?.status ?? (role === 'user' ? 'pending' : 'done')
  assertStatus(status)

  return service.enqueue(async () => {
    const file = await readFileFor(service, bookId)
    const thread = findThread(file, threadId)
    if ((thread.messages ?? []).length >= MAX_MESSAGES_PER_THREAD) {
      throw new ReadingError('E_TOO_LARGE', { reason: 'messages', limit: MAX_MESSAGES_PER_THREAD })
    }
    const at = nowIso()
    const message = {
      id: typeof input.id === 'string' && isMessageId(input.id) ? input.id : nextMessageId(thread),
      role,
      text,
      citations: sanitizeCitations(input.citations, options.allowedChunkIds),
      createdAt: at,
      status,
      messageId: typeof input.messageId === 'string' ? input.messageId : null,
      feedback: null,
    }
    thread.messages.push(message)
    thread.updatedAt = at
    await persist(service, bookId, file, { threadId, messageId: message.id })
    return { thread, message }
  })
}

/**
 * 更新消息（回写、停止、反馈都走这里；只允许白名单字段）。
 * @param {import('./books.js').BookService} service
 */
export async function updateMessage(service, bookId, threadId, messageId, patch, options = {}) {
  if (!isThreadId(threadId)) throw new ReadingError('E_BAD_REQUEST', { field: 'threadId' })
  if (!isMessageId(messageId)) throw new ReadingError('E_BAD_REQUEST', { field: 'messageId' })
  const allowed = ['text', 'status', 'citations', 'messageId', FEEDBACK_FIELD, 'error']
  const keys = Object.keys(patch ?? {})
  const unknown = keys.filter((key) => !allowed.includes(key))
  if (unknown.length > 0) throw new ReadingError('E_BAD_REQUEST', { field: 'patch', unknown })

  return service.enqueue(async () => {
    const file = await readFileFor(service, bookId)
    const thread = findThread(file, threadId)
    const message = findMessage(thread, messageId)
    const at = nowIso()
    if (typeof patch.text === 'string') {
      const limit = message.role === 'assistant' ? MAX_ANSWER_CHARS : MAX_QUESTION_CHARS
      if (charCount(patch.text) > limit) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'text', reason: 'length', limit })
      }
      message.text = patch.text
    }
    if (typeof patch.status === 'string') {
      assertStatus(patch.status)
      message.status = patch.status
    }
    if (patch.citations !== undefined) {
      message.citations = sanitizeCitations(patch.citations, options.allowedChunkIds)
    }
    if (patch.messageId !== undefined) {
      message.messageId = typeof patch.messageId === 'string' ? patch.messageId : null
    }
    if (patch[FEEDBACK_FIELD] !== undefined) {
      const value = patch[FEEDBACK_FIELD]
      if (value !== null && !FEEDBACK_VALUES.includes(value)) {
        throw new ReadingError('E_BAD_REQUEST', { field: FEEDBACK_FIELD, allowed: [...FEEDBACK_VALUES, null] })
      }
      message[FEEDBACK_FIELD] = value
    }
    if (patch.error !== undefined) {
      message.error = typeof patch.error === 'string' ? patch.error : null
    }
    message.updatedAt = at
    thread.updatedAt = at
    await persist(service, bookId, file, { threadId, messageId })
    return { thread, message }
  })
}

/** 改线程状态（`running` 由 ask 在注入前设置、回写/停止时归零）。 */
export async function setThreadState(service, bookId, threadId, state) {
  assertState(state)
  return service.enqueue(async () => {
    const file = await readFileFor(service, bookId)
    const thread = findThread(file, threadId)
    thread.state = state
    thread.updatedAt = nowIso()
    await persist(service, bookId, file, { threadId })
    return thread
  })
}

/** 停止：线程置 idle，未完成消息标 stopped；已 idle 幂等返回。 */
export async function stopThread(service, bookId, threadId) {
  return service.enqueue(async () => {
    const file = await readFileFor(service, bookId)
    const thread = findThread(file, threadId)
    const at = nowIso()
    for (const message of thread.messages ?? []) {
      if (message.status === 'pending' || message.status === 'streaming') message.status = 'stopped'
    }
    thread.state = 'idle'
    thread.updatedAt = at
    await persist(service, bookId, file, { threadId })
    return thread
  })
}

/** 反馈：`up` / `down` / `null`（再点一次取消）。 */
export async function setFeedback(service, bookId, threadId, messageId, feedback) {
  return updateMessage(service, bookId, threadId, messageId, { [FEEDBACK_FIELD]: feedback })
}

/** 删除线程：运行中 409；删除不回收 id。 */
export async function removeThread(service, bookId, threadId) {
  return service.enqueue(async () => {
    const file = await readFileFor(service, bookId)
    const thread = findThread(file, threadId)
    if (thread.state === 'running') {
      throw new ReadingError('E_BUSY', { reason: 'running', threadId })
    }
    file.threads = file.threads.filter((item) => item.id !== threadId)
    await persist(service, bookId, file, { threadId, deleted: true })
    return { deleted: true }
  })
}