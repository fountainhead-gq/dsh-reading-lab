/**
 * 询问 AI（owner: ask，03 §8 / 04 §3.4、§4.2 #20）。
 *
 * 两条事实来源：
 * - 上下文由 `buildAskContext` 从 `meta.json` + `map.json` + `chunks.json` 现场拼；
 *   面板只传 `bookId` / `nodeId` / `question`，不把正文塞进 HTTP body（避免伪造引用）。
 * - 回答由 Host 监听 `session/event` 的 `assistant/message` 回写 `threads.json`；
 *   `agent.followup()` 是 fire-and-forget，注入成功≠回答会来，所以还有 5 分钟看门狗
 *   （03 §8.4）：超时把消息标 `failed` 并发 SSE，面板不会静默悬挂。
 *
 * 关联方式：注入时把 `(agentId → 线程消息)` 放进内存表；同 session 的下一条
 * `assistant/message` 就是它的回答。DSH 重启后该表丢失，此时 `threads.json` 里的
 * `pending` 会在读取时降级为 `stopped`（§5.6），不会错配到别的问题上。
 */
import { ReadingError } from './errors.js'
import { resolveAgent } from './agent-bridge.js'
import { injectAgentRequest } from './agent-bridge.js'
import { readMap } from './map.js'
import {
  appendMessage,
  citationsFromText,
  createThread,
  findThreadByNode,
  readThreads,
  removeThread,
  setFeedback,
  setThreadState,
  stopThread,
  updateMessage,
} from './threads.js'

/** 上下文总长上限（按码点，03 §8.1）。 */
export const ASK_CONTEXT_MAX_CHARS = 6000
/** 选中节点至少带几条原文（不足按同章邻近块补）。 */
export const ASK_MIN_CITATIONS = 3
/** 最多带几条原文。 */
export const ASK_MAX_CITATIONS = 5
/** 无选中节点时，全书概览最多列几章。 */
export const ASK_OVERVIEW_CHAPTERS = 12
/** 概览里每章首块预览长度。 */
export const ASK_OVERVIEW_PREVIEW = 80
/** 单块塞进上下文的原文上限（保证 3 条原文都能出现）。 */
export const ASK_CHUNK_PREVIEW = 800
/** 回答关联窗口。 */
export const ASK_PENDING_TTL_MS = 10 * 60_000
/** 无回答时的失败阈值（03 §8.4 的 5 分钟）。 */
export const ASK_TIMEOUT_MS = 5 * 60_000
/** 幂等键窗口。 */
export const ASK_IDEMPOTENCY_TTL_MS = 10 * 60_000

const TRUNCATED_MARK = '…（已截断）'

function codePoints(value) {
  return Array.from(String(value ?? '')).length
}

function byCodepoints(value, limit) {
  const chars = Array.from(String(value ?? ''))
  return chars.length > limit ? chars.slice(0, limit).join('') : chars.join('')
}

/** 深度优先找节点；返回节点与从根到它的标题链。 */
export function findNodeWithPath(root, nodeId) {
  if (!root) return null
  const stack = [{ node: root, path: [root.title] }]
  while (stack.length > 0) {
    const current = stack.pop()
    if (current.node.id === nodeId) return current
    const children = Array.isArray(current.node.children) ? current.node.children : []
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], path: [...current.path, children[index].title] })
    }
  }
  return null
}

/** 按章节顺序把块分组；用于「无选中 → 全书概览」。 */
function groupByChapter(chunks) {
  const groups = []
  const index = new Map()
  for (const chunk of chunks) {
    let group = index.get(chunk.chapterId)
    if (!group) {
      group = { chapterId: chunk.chapterId, title: chunk.chapterTitle ?? '', chunks: [] }
      index.set(chunk.chapterId, group)
      groups.push(group)
    }
    group.chunks.push(chunk)
  }
  return groups
}

/**
 * 选中节点的原文集合：先取其 citations，再用同章邻近块补到 3 条，最多 5 条。
 * 只返回真实存在的块（失效引用直接跳过）。
 */
export function selectAskChunks(node, chunks) {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const picked = []
  const seen = new Set()
  for (const citation of Array.isArray(node?.citations) ? node.citations : []) {
    const chunk = byId.get(citation?.chunkId)
    if (chunk && !seen.has(chunk.id)) {
      seen.add(chunk.id)
      picked.push(chunk)
    }
  }
  if (picked.length === 0) return []
  const anchor = picked[0]
  if (picked.length < ASK_MIN_CITATIONS) {
    const candidates = chunks
      .filter((chunk) => !seen.has(chunk.id))
      .map((chunk) => ({
        chunk,
        distance: Math.abs((chunk.seq ?? 0) - (anchor.seq ?? 0)),
        sameChapter: chunk.chapterId === anchor.chapterId ? 0 : 1,
      }))
      .sort((left, right) => left.sameChapter - right.sameChapter || left.distance - right.distance)
    for (const candidate of candidates) {
      if (picked.length >= ASK_MIN_CITATIONS) break
      seen.add(candidate.chunk.id)
      picked.push(candidate.chunk)
    }
  }
  return picked.slice(0, ASK_MAX_CITATIONS)
}

function joinBlocks(blocks, budget) {
  const lines = []
  let used = 0
  let truncated = false
  for (const block of blocks) {
    const text = byCodepoints(block.text, Math.min(ASK_CHUNK_PREVIEW, Math.max(0, budget - used)))
    if (text.length === 0) {
      truncated = true
      break
    }
    if (codePoints(block.text) > codePoints(text)) truncated = true
    lines.push(`[${block.id}] ${text}`)
    used += codePoints(text) + block.id.length + 4
    if (used >= budget) {
      truncated = true
      break
    }
  }
  return { lines, truncated }
}

/**
 * 拼注入上下文（纯函数部分已拆出，便于单测）。
 *
 * @param {{ meta: any, map: any, chunks: any[], nodeId?: string|null, question: string }} input
 */
export function composeAskContext(input) {
  const { meta, map, chunks, nodeId } = input
  const title = meta?.displayName ?? meta?.title ?? '未命名书籍'
  const author = meta?.author ?? ''
  const header = [`书名《${title}》${author ? ` 作者：${author}` : ''}`]

  let located = null
  if (nodeId) {
    located = findNodeWithPath(map?.root ?? null, nodeId)
    if (!located) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'nodeId', reason: 'unknown-node', nodeId })
    }
  }

  if (located) {
    const pathTitles = located.path.slice(1)
    if (pathTitles.length > 0) header.push(`章节路径：${pathTitles.join(' > ')}`)
    header.push(`选中节点摘要：${byCodepoints(located.node.summary ?? '', 120)}`)
    const selected = selectAskChunks(located.node, chunks)
    if (selected.length === 0) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'nodeId', reason: 'no-citation', nodeId })
    }
    const blocks = selected.map((chunk) => ({ id: chunk.id, text: chunk.text ?? '' }))
    const headerText = header.join('\n')
    const budget = ASK_CONTEXT_MAX_CHARS - codePoints(headerText) - 80
    const joined = joinBlocks(blocks, budget)
    const lines = [...header, '', '相关原文：', ...joined.lines]
    if (joined.truncated) lines.push(TRUNCATED_MARK)
    const body = lines.join('\n')
    return {
      context: body,
      contextChars: codePoints(body),
      truncated: joined.truncated,
      citations: selected.map((chunk) => chunk.id),
      nodeTitle: located.node.title ?? '',
      pathTitles,
    }
  }

  // 无选中：全书概览（根摘要 + 每章标题与首块前 80 字）。
  const rootSummary = byCodepoints(map?.root?.summary ?? '', 200)
  const groups = groupByChapter(chunks).slice(0, ASK_OVERVIEW_CHAPTERS)
  const overview = groups.map((group) => {
    const first = group.chunks[0]
    return `${group.title || group.chapterId}：${byCodepoints(first?.text ?? '', ASK_OVERVIEW_PREVIEW)}`
  })
  const lines = [...header]
  if (rootSummary) lines.push(`全书概览：${rootSummary}`)
  if (overview.length > 0) lines.push('', '章节速览：', ...overview)
  if (groupByChapter(chunks).length > ASK_OVERVIEW_CHAPTERS) lines.push(TRUNCATED_MARK)
  const body = lines.join('\n')
  return {
    context: body,
    contextChars: codePoints(body),
    truncated: body.includes(TRUNCATED_MARK),
    citations: [],
    nodeTitle: '',
    pathTitles: [],
  }
}

/** 注入文本：隐藏关联标记 + 上下文 + 问题 + 固定回答要求（03 §8.1/§8.2）。 */
export function buildAskPrompt(input) {
  const marker = `<!-- reading-lab thread=${input.threadId} message=${input.messageId} -->`
  return [
    marker,
    `以下是我在《${input.title}》里选中内容的上下文，请只基于这些内容回答。`,
    '',
    input.context,
    '',
    `我的问题：${input.question}`,
    '',
    '回答要求：用中文；引用原文时写成 [c-000123]（只能引用上面给出的块）；',
    '如果上下文不足以回答，直接说明还缺什么，不要猜。回答会保存在这本书的问答线程里。',
  ].join('\n')
}

/** 从 session 事件里取会话 id（兼容 `session` 对象/字符串与 payload 字段）。 */
function sessionIdOf(session, event) {
  if (typeof session === 'string') return session
  if (session && typeof session.id === 'string') return session.id
  const payload = event?.data ?? event?.payload ?? {}
  return payload.agentId ?? payload.sessionId ?? event?.agentId ?? null
}

/** 从 `assistant/message` 事件里取文本与 DSH 消息 id。 */
export function readAssistantMessage(event) {
  const data = event?.data ?? event?.payload ?? {}
  const message = data.message ?? data
  const content = Array.isArray(message?.content) ? message.content : []
  const text = content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
  return {
    text,
    messageId: typeof message?.id === 'string' ? message.id : typeof data.messageId === 'string' ? data.messageId : null,
  }
}

/**
 * 页面级 ask 服务：线程 CRUD + 注入 + 回答回写 + 看门狗。
 */
export class AskService {
  /**
   * @param {{ ctx: any, books: import('./books.js').BookService, hub: any, map: import('./map.js').MapService, limits?: any, logger?: any }} options
   */
  constructor(options) {
    this.ctx = options.ctx
    this.books = options.books
    this.hub = options.hub
    this.map = options.map
    this.limits = options.limits ?? null
    this.logger = options.logger ?? options.ctx?.logger ?? null
    this.timeoutMs = options.timeoutMs ?? ASK_TIMEOUT_MS
    this.pending = new Map()
    this.idempotency = new Map()
    this.closed = false
  }

  /** 线程列表；`scope.kind==='node'` 且节点已不在导图里 → 读取时标 `orphaned`（不落盘）。 */
  async list(bookId) {
    const file = await readThreads(this.books, bookId)
    let map = null
    try {
      map = await readMap(this.books, bookId)
    } catch {
      map = null
    }
    const threads = (file.threads ?? []).map((thread) => {
      if (!thread.scope || thread.scope.kind !== 'node') return thread
      const found = findNodeWithPath(map?.root ?? null, thread.scope.nodeId)
      return found ? thread : { ...thread, orphaned: true }
    })
    return { ...file, threads }
  }

  /** 建线程时由 Host 从 map.json 补 nodeTitle；节点不存在 → 400（04 §4.2 #18）。 */
  async create(bookId, scope) {
    await this.books.get(bookId)
    if (scope?.kind !== 'node') {
      return createThread(this.books, bookId, { kind: 'book' })
    }
    const nodeId = typeof scope.nodeId === 'string' ? scope.nodeId : ''
    if (!/^n-[0-9a-f]{8}(-\d+)?$/.test(nodeId)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'scope.nodeId' })
    }
    const doc = await readMap(this.books, bookId)
    const located = findNodeWithPath(doc?.root ?? null, nodeId)
    if (!located) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'scope.nodeId', reason: 'unknown-node', nodeId })
    }
    return createThread(this.books, bookId, { kind: 'node', nodeId, nodeTitle: located.node.title ?? '' })
  }

  async remove(bookId, threadId) {
    return removeThread(this.books, bookId, threadId)
  }

  /** 找到可用 agent；无则 422 E_AGENT（面板据此禁用输入）。 */
  resolveAgent(agentId) {
    const agent = resolveAgent(this.ctx, agentId)
    if (!agent) {
      throw new ReadingError('E_AGENT', {
        reason: agentId ? 'agent-not-found' : 'no-agent',
        ...(agentId ? { agentId } : {}),
      })
    }
    return agent
  }

  /**
   * 提问：建/取线程 → 追加 pending 用户消息 → 拼上下文 → 注入 agent → 返回 202 结果。
   *
   * @param {{ bookId: string, threadId?: string|null, nodeId?: string|null, question: string, agentId?: string|null, idempotencyKey?: string|null }} input
   */
  async ask(input) {
    const { bookId } = input
    const question = String(input.question ?? '').trim()
    if (question.length === 0 || codePoints(question) > 2000) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'question', reason: 'length', limit: 2000 })
    }
    const key = input.idempotencyKey ? `${bookId}:${input.idempotencyKey}` : null
    if (key) {
      const cached = this.idempotency.get(key)
      if (cached && Date.now() - cached.at < ASK_IDEMPOTENCY_TTL_MS) return cached.result
      if (cached) this.idempotency.delete(key)
    }

    const book = await this.books.get(bookId)
    if (book.status !== 'ready') {
      throw new ReadingError('E_BUSY', { reason: 'not-ready', status: book.status })
    }
    const agent = this.resolveAgent(input.agentId ?? null)

    const file = await this.list(bookId)
    let thread = null
    if (typeof input.threadId === 'string' && input.threadId.length > 0) {
      thread = file.threads.find((item) => item.id === input.threadId) ?? null
      if (!thread) throw new ReadingError('E_NOT_FOUND', { reason: 'thread', threadId: input.threadId })
    } else if (typeof input.nodeId === 'string' && input.nodeId.length > 0) {
      thread = findThreadByNode(file, input.nodeId)
    }
    if (!thread && typeof input.nodeId === 'string' && input.nodeId.length > 0) {
      thread = await this.create(bookId, { kind: 'node', nodeId: input.nodeId })
    }
    if (!thread) thread = await this.create(bookId, { kind: 'book' })
    if (thread.state === 'running') {
      throw new ReadingError('E_BUSY', { reason: 'running', threadId: thread.id })
    }

    const chunked = await this.books.readChunks(bookId)
    let doc = null
    try {
      doc = await readMap(this.books, bookId)
    } catch {
      doc = null
    }
    const composed = composeAskContext({
      meta: { ...book, displayName: book.displayName ?? book.title },
      map: doc,
      chunks: chunked.chunks,
      nodeId: thread.scope?.kind === 'node' ? thread.scope.nodeId : null,
      question,
    })

    const appended = await appendMessage(this.books, bookId, thread.id, { role: 'user', text: question, status: 'pending' })
    const message = appended.message
    try {
      const injected = injectAgentRequest({
        ctx: this.ctx,
        agentId: agent.id,
        text: buildAskPrompt({
          threadId: thread.id,
          messageId: message.id,
          title: book.displayName ?? book.title,
          context: composed.context,
          question,
        }),
        summary: question.slice(0, 80),
        bookId,
        action: 'ask',
        form: 'ask',
        threadId: thread.id,
        messageId: message.id,
      })
      await updateMessage(this.books, bookId, thread.id, message.id, { messageId: injected.promptId })
      await setThreadState(this.books, bookId, thread.id, 'running')
      this.track({
        agentId: injected.agentId,
        bookId,
        threadId: thread.id,
        messageId: message.id,
        question,
      })
      const result = {
        threadId: thread.id,
        messageId: message.id,
        agentId: injected.agentId,
        contextChars: composed.contextChars,
        truncated: composed.truncated,
      }
      if (key) this.idempotency.set(key, { at: Date.now(), result })
      return result
    } catch (error) {
      // 注入失败也要留痕：消息 failed + 线程回到 idle，面板能看到原因（03 §8.4）。
      await updateMessage(this.books, bookId, thread.id, message.id, {
        status: 'failed',
        error: error?.code ?? 'E_AGENT',
      }).catch(() => {})
      await setThreadState(this.books, bookId, thread.id, 'idle').catch(() => {})
      throw error instanceof ReadingError ? error : new ReadingError('E_AGENT', { reason: 'inject-failed' }, { cause: error })
    }
  }

  /** 记录一条待回写；同 agent 下按时间排队。 */
  track(entry) {
    const list = this.pending.get(entry.agentId) ?? []
    const timer = setTimeout(() => {
      this.failPending(entry, 'timeout')
    }, this.timeoutMs)
    timer.unref?.()
    const record = { ...entry, at: Date.now(), timer, done: false }
    list.push(record)
    this.pending.set(entry.agentId, list)
    return record
  }

  /**
   * 取走一条待回写。
   *
   * `session/event` 的第一个参数是 Session（id 是 sessionId），而注入时我们只知道
   * agentId；两者在 DSH 里不是同一个值。所以先按 agentId 精确匹配，匹配不到时
   * 退回「全局最早的一条未消费记录」——插件通常只有一个活跃 agent，
   * 多 agent 场景下仍靠 createdAt 顺序与 messageId 去重（03 §8.3）。
   */
  takePending(agentId) {
    const now = Date.now()
    const fresh = (item) => !item.done && now - item.at <= ASK_PENDING_TTL_MS
    const list = this.pending.get(agentId) ?? []
    let record = list.find(fresh)
    if (!record) {
      let earliest = null
      for (const bucket of this.pending.values()) {
        for (const item of bucket) {
          if (!fresh(item)) continue
          if (!earliest || item.at < earliest.at) earliest = item
        }
      }
      record = earliest
    }
    if (!record) return null
    record.done = true
    if (record.timer) clearTimeout(record.timer)
    const bucket = this.pending.get(record.agentId) ?? []
    const kept = bucket.filter((item) => item !== record)
    if (kept.length > 0) this.pending.set(record.agentId, kept)
    else this.pending.delete(record.agentId)
    return record
  }

  async failPending(entry, reason) {
    const record = (this.pending.get(entry.agentId) ?? []).find(
      (item) => !item.done && item.threadId === entry.threadId && item.messageId === entry.messageId,
    )
    if (!record) return
    record.done = true
    this.pending.set(
      entry.agentId,
      (this.pending.get(entry.agentId) ?? []).filter((item) => item !== record),
    )
    const message =
      reason === 'timeout'
        ? `${Math.round(this.timeoutMs / 1000)} 秒内没有收到回答（会话可能没有可用模型，或 agent 未在运行）`
        : '注入失败'
    try {
      await updateMessage(this.books, entry.bookId, entry.threadId, entry.messageId, {
        status: 'failed',
        error: 'E_AGENT',
      })
      await setThreadState(this.books, entry.bookId, entry.threadId, 'idle')
      const file = await readThreads(this.books, entry.bookId)
      const thread = (file.threads ?? []).find((item) => item.id === entry.threadId)
      this.logger?.warn?.(`[reading-lab] ask 失败 book=${entry.bookId} thread=${entry.threadId} reason=${reason}`)
      try {
        this.hub?.publish?.({
          type: 'thread',
          bookId: entry.bookId,
          threadId: entry.threadId,
          messageId: entry.messageId,
          state: thread?.state ?? 'idle',
          failed: true,
          reason,
          message,
        })
      } catch {
        // hub 已关闭
      }
    } catch (error) {
      this.logger?.warn?.(`[reading-lab] ask failure writeback failed: ${error?.message ?? error}`)
    }
  }

  /**
   * 回写：`session/event` → `assistant/message`。
   * 只认「同 agent 最近一条未消费」的 pending 记录；线程已 stopped 则忽略内容。
   */
  async handleSessionEvent(session, event) {
    if (!event || event.type !== 'assistant/message') return
    const agentId = sessionIdOf(session, event)
    if (!agentId) return
    const record = this.takePending(agentId)
    if (!record) return
    const { text, messageId } = readAssistantMessage(event)
    if (text.length === 0) return
    try {
      const file = await readThreads(this.books, record.bookId)
      const thread = (file.threads ?? []).find((item) => item.id === record.threadId)
      const question = (thread?.messages ?? []).find((item) => item.id === record.messageId)
      if (!thread || !question) return
      if (thread.state !== 'running' || question.status === 'stopped') {
        this.logger?.info?.(
          `[reading-lab] ask answer ignored (thread stopped) book=${record.bookId} thread=${record.threadId}`,
        )
        return
      }
      const chunked = await this.books.readChunks(record.bookId)
      const allowed = new Set(chunked.chunks.map((chunk) => chunk.id))
      const citations = citationsFromText(text, allowed)
      const appended = await appendMessage(
        this.books,
        record.bookId,
        record.threadId,
        {
          role: 'assistant',
          text,
          citations,
          status: 'done',
          messageId,
        },
        { allowedChunkIds: allowed },
      )
      await setThreadState(this.books, record.bookId, record.threadId, 'idle')
      this.logger?.info?.(
        `[reading-lab] ask answered book=${record.bookId} thread=${appended.thread.id} citations=${citations.length}`,
      )
    } catch (error) {
      this.logger?.warn?.(`[reading-lab] ask writeback failed: ${error?.message ?? error}`)
      await this.failPending(record, 'writeback')
    }
  }

  async stop(bookId, threadId) {
    const thread = await stopThread(this.books, bookId, threadId)
    // 丢弃该线程的待回写记录；之后即便 agent 继续输出也不会写进来（03 §8.2）。
    for (const [agentId, list] of this.pending) {
      const kept = list.filter((item) => !(item.bookId === bookId && item.threadId === threadId))
      for (const item of list) {
        if (!kept.includes(item)) {
          item.done = true
          if (item.timer) clearTimeout(item.timer)
        }
      }
      if (kept.length > 0) this.pending.set(agentId, kept)
      else this.pending.delete(agentId)
    }
    return thread
  }

  async feedback(bookId, threadId, messageId, feedback) {
    const result = await setFeedback(this.books, bookId, threadId, messageId, feedback)
    try {
      this.hub?.publish?.({
        type: 'thread',
        bookId,
        threadId,
        messageId,
        feedback,
        updatedAt: new Date().toISOString(),
      })
    } catch {
      // hub 已关闭
    }
    return result
  }

  /** 卸载：清掉所有定时器与内存表（不写文件——pending 会在下次读取时降级）。 */
  close() {
    this.closed = true
    for (const list of this.pending.values()) {
      for (const item of list) {
        if (item.timer) clearTimeout(item.timer)
        item.done = true
      }
    }
    this.pending.clear()
    this.idempotency.clear()
  }
}

/** 便于测试与工具复用。 */
export { codePoints as askCharCount }