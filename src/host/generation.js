/**
 * 生成请求的状态机与看门狗（t29 / QA-11-07，docs/04-api.md §4.2 #9）。
 *
 * 为什么需要它：`POST /actions/generate-map` 只是把一条 `reading-lab` 通知塞进
 * Agent 的 inbox（`agent.followup` 是 fire-and-forget，返回 void），HTTP 层
 * 202 之后没有任何东西能知道那条消息后来发生了什么。真实宿主上已经有三种
 * 静默失败：
 *
 *   1. 会话没有可用的 model/provider → `preStep` 抛错，driver 记录
 *      `turn/end{reason:{kind:'error'}}` 并 `throwError`，`kick()` 把异常
 *      吞掉；插件侧完全无感；
 *   2. 消息投递后从未被认领（agent 忙、会话被关、进程重启）；
 *   3. 回合跑完了，但模型没有调用 `reading_map commit`。
 *
 * 这里把「一次生成请求」变成有状态、可查询、会超时的记录：
 *
 *   pending ──(inbox/claimed)──> running ──(commit)──> done
 *      │                            │
 *      ├──(inbox/discarded)─────────┤
 *      ├──(agent/error)─────────────┤──> failed{reason,message}
 *      ├──(status 非 running)───────┤
 *      └──(watchdog 超时)───────────┘
 *
 * 终态会留在内存里（`recordTtlMs`）供 `GET .../actions/generate-map` 查询，
 * 这样面板即使错过 SSE 也能拿到失败原因。
 */
import { ReadingError } from './errors.js'

/** 终态与中间态（对外字段用字符串，方便日志与面板直接展示）。 */
export const GENERATION_STATES = Object.freeze(['pending', 'running', 'done', 'failed'])

/** 失败原因码（写进 `progress` 事件的 `reason` 与状态查询响应）。 */
export const GENERATION_FAILURES = Object.freeze({
  TIMEOUT: 'timeout',
  AGENT_ERROR: 'agent-error',
  TURN_ENDED: 'turn-ended',
  INBOX_DISCARDED: 'inbox-discarded',
  AGENT_DISPOSED: 'agent-disposed',
  AGENT_MISSING: 'agent-missing',
})

/** DSH 侧会发的事件名（dsh-agent / agent-loop）。 */
export const AGENT_EVENTS = Object.freeze([
  'agent/error',
  'agent/inbox/claimed',
  'agent/inbox/discarded',
  'agent/status',
  'agent/disposed',
])

const agentIdOf = (agent) => {
  if (!agent) return null
  if (typeof agent === 'string') return agent
  return typeof agent.id === 'string' ? agent.id : null
}

/** t34：三段预算默认值（排队 / 认领后空闲 / 绝对上限）。 */
export const DEFAULT_QUEUE_TIMEOUT_MS = 60_000
export const DEFAULT_IDLE_TIMEOUT_MS = 180_000
export const DEFAULT_MAX_DURATION_MS = 30 * 60_000

const pickTimeout = (value, legacy, fallback) => {
  if (Number.isFinite(value) && value > 0) return Math.floor(value)
  if (legacy !== null) return legacy
  return fallback
}

const messageIdOf = (message) => (message && typeof message.id === 'string' ? message.id : null)

function describeError(error) {
  if (typeof error === 'string') return error
  if (error && typeof error.message === 'string' && error.message !== '') return error.message
  if (error && typeof error.code === 'string') return error.code
  try {
    return JSON.stringify(error).slice(0, 300)
  } catch {
    return String(error)
  }
}

export class GenerationTracker {
  /**
   * @param {{
   *   publish?: (event: any) => void,
   *   log?: { warn?: Function, info?: Function, error?: Function } | null,
   *   queueTimeoutMs?: number,
   *   idleTimeoutMs?: number,
   *   maxDurationMs?: number,
   *   timeoutMs?: number,
   *   recordTtlMs?: number,
   *   now?: () => number,
   * }} [options]
   */
  constructor(options = {}) {
    this.publish = typeof options.publish === 'function' ? options.publish : () => {}
    this.log = options.log ?? null
    // 旧选项 `timeoutMs` 视为「排队预算 = 空闲预算」，t34 起拆成两段。
    const legacy = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Math.floor(options.timeoutMs) : null
    this.queueTimeoutMs = pickTimeout(options.queueTimeoutMs, legacy, DEFAULT_QUEUE_TIMEOUT_MS)
    this.idleTimeoutMs = pickTimeout(options.idleTimeoutMs, legacy, DEFAULT_IDLE_TIMEOUT_MS)
    this.maxDurationMs = Math.max(
      pickTimeout(options.maxDurationMs, null, DEFAULT_MAX_DURATION_MS),
      this.queueTimeoutMs,
      this.idleTimeoutMs,
    )
    this.recordTtlMs = Number.isFinite(options.recordTtlMs) && options.recordTtlMs > 0 ? Math.floor(options.recordTtlMs) : 900_000
    this.now = typeof options.now === 'function' ? options.now : Date.now
    /** @type {Map<string, any>} bookId → 记录 */
    this.records = new Map()
    /** @type {Map<string, any>} bookId → 看门狗定时器 */
    this.timers = new Map()
  }

  /**
   * 登记一次生成请求。已有未完成的请求时抛 `E_BUSY`（04 §4.2 #9）。
   * @param {string} bookId
   * @param {{ agentId?: string | null, promptId?: string | null, queueTimeoutMs?: number, idleTimeoutMs?: number, maxDurationMs?: number }} [info]
   * @returns {any} 记录快照
   */
  begin(bookId, info = {}) {
    const active = this.active(bookId)
    if (active) {
      throw new ReadingError('E_BUSY', {
        reason: 'mapping',
        bookId,
        state: active.state,
        agentId: active.agentId,
        startedAt: active.startedAt,
      })
    }

    const startedAt = this.now()
    const queueTimeoutMs = pickTimeout(info.queueTimeoutMs, null, this.queueTimeoutMs)
    const idleTimeoutMs = pickTimeout(info.idleTimeoutMs, null, this.idleTimeoutMs)
    const maxDurationMs = Math.max(pickTimeout(info.maxDurationMs, null, this.maxDurationMs), queueTimeoutMs, idleTimeoutMs)
    const record = {
      bookId,
      state: 'pending',
      agentId: info.agentId ?? null,
      promptId: info.promptId ?? null,
      startedAt,
      updatedAt: startedAt,
      claimedAt: null,
      claimEvidence: null,
      lastActivityAt: startedAt,
      lastActivityKind: 'begin',
      finishedAt: null,
      reason: null,
      message: null,
      queueTimeoutMs,
      idleTimeoutMs,
      maxDurationMs,
    }
    this.records.set(bookId, record)
    this.armWatchdog(bookId)
    this.emitProgress(bookId, 'mapping', 0, 0, { state: record.state })
    return this.snapshot(bookId)
  }

  /**
   * 注入成功后再补上 promptId：链路是「先占位 → 注入 → 拿 message.id」，
   * 认领事件只能按 message.id 对齐。
   * @param {string} bookId
   * @param {{ agentId?: string | null, promptId?: string | null }} info
   */
  attachPrompt(bookId, info = {}) {
    const record = this.records.get(bookId)
    if (!record) return null
    if (info.agentId) record.agentId = info.agentId
    if (info.promptId) record.promptId = info.promptId
    record.updatedAt = this.now()
    return this.snapshot(bookId)
  }

  /** 未完成（pending/running）的记录；过期记录顺手清掉。 */
  active(bookId) {
    const record = this.records.get(bookId)
    if (!record) return null
    if (record.state === 'pending' || record.state === 'running') return record
    if (this.now() - (record.finishedAt ?? record.updatedAt) > this.recordTtlMs) this.records.delete(bookId)
    return null
  }

  /** @param {string} bookId */
  isGenerating(bookId) {
    return this.active(bookId) !== null
  }

  /** 只读快照（HTTP 响应体，字段名与文档一致）。 */
  snapshot(bookId) {
    const record = this.records.get(bookId)
    const budget = {
      queueTimeoutMs: this.queueTimeoutMs,
      idleTimeoutMs: this.idleTimeoutMs,
      maxDurationMs: this.maxDurationMs,
    }
    if (!record) {
      return {
        bookId,
        state: 'idle',
        agentId: null,
        promptId: null,
        startedAt: null,
        updatedAt: null,
        claimedAt: null,
        claimEvidence: null,
        lastActivityAt: null,
        lastActivityKind: null,
        finishedAt: null,
        reason: null,
        message: null,
        timeoutMs: this.queueTimeoutMs,
        idleMs: 0,
        elapsedMs: 0,
        budget,
      }
    }
    const finished = record.state === 'done' || record.state === 'failed'
    const now = finished ? record.finishedAt : this.now()
    return {
      bookId: record.bookId,
      state: record.state,
      agentId: record.agentId,
      promptId: record.promptId,
      startedAt: new Date(record.startedAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString(),
      claimedAt: record.claimedAt === null ? null : new Date(record.claimedAt).toISOString(),
      claimEvidence: record.claimEvidence ?? null,
      lastActivityAt: record.lastActivityAt === null ? null : new Date(record.lastActivityAt).toISOString(),
      lastActivityKind: record.lastActivityKind ?? null,
      finishedAt: record.finishedAt === null ? null : new Date(record.finishedAt).toISOString(),
      reason: record.reason,
      message: record.message,
      // 兼容旧客户端：timeoutMs = 当前阶段的预算（排队期→排队预算，认领后→空闲预算）。
      timeoutMs: record.state === 'pending' ? record.queueTimeoutMs : record.idleTimeoutMs,
      idleMs: record.lastActivityAt === null ? 0 : Math.max(0, now - record.lastActivityAt),
      elapsedMs: Math.max(0, now - record.startedAt),
      budget: {
        queueTimeoutMs: record.queueTimeoutMs,
        idleTimeoutMs: record.idleTimeoutMs,
        maxDurationMs: record.maxDurationMs,
      },
    }
  }

  /**
   * 记录一次「agent 还在干活」的证据：重置空闲计时。
   *
   * 看门狗只在「180 秒没有任何活动」时才会判定超时，所以每次 `reading_map`
   * 工具调用、认领事件、`agent/status` 进入 running 都要打点（t34）。
   *
   * @param {string} bookId
   * @param {string} [kind] 活动来源，写进快照与日志，便于排查
   */
  noteActivity(bookId, kind = 'activity') {
    const record = this.records.get(bookId)
    if (!record) return null
    if (record.state !== 'pending' && record.state !== 'running') return this.snapshot(bookId)
    const at = this.now()
    record.lastActivityAt = at
    record.lastActivityKind = kind
    record.updatedAt = at
    // 工具调用只能证明「agent 在处理这本」，不能证明它认领了哪条消息：
    // 状态推进到 running，但 claimedAt 保持 null（不伪造）。
    if (record.state === 'pending') {
      record.state = 'running'
      record.claimEvidence = record.claimEvidence ?? 'tool-activity'
      this.emitProgress(bookId, 'mapping', 0, 0, { state: 'running' })
    }
    this.armWatchdog(bookId)
    return this.snapshot(bookId)
  }

  /** 成功终点：`reading_map commit` 已经在 `writeMap` 里落盘。 */
  complete(bookId) {
    const record = this.records.get(bookId)
    if (!record) return null
    if (record.state === 'done' || record.state === 'failed') return this.snapshot(bookId)
    this.settle(record, 'done', null, null)
    return this.snapshot(bookId)
  }

  /**
   * 失败终点：把原因同时送到日志、SSE 和状态查询三处（t29 要求「至少一处可见」，
   * 这里给三处：即使面板没订阅 SSE、日志被清空，`GET` 仍能看到 reason）。
   * @param {string} bookId
   * @param {string} reason
   * @param {string | null} [message]
   */
  fail(bookId, reason, message = null) {
    const record = this.records.get(bookId)
    if (!record) return null
    if (record.state === 'done' || record.state === 'failed') return this.snapshot(bookId)
    this.settle(record, 'failed', reason, message)
    return this.snapshot(bookId)
  }

  /**
   * 订阅入口：`index.js` 把 DSH 的 agent 事件转发到这里；测试也可以直接调用，
   * 不必伪造 Cordis 总线。
   * @param {string} name
   * @param {any} payload
   * @returns {any[]} 受影响的快照
   */
  handle(name, payload) {
    switch (name) {
      case 'agent/inbox/claimed':
        return this.onClaimed(payload)
      case 'agent/inbox/discarded':
        return this.onDiscarded(payload)
      case 'agent/error':
        return this.onAgentError(payload)
      case 'agent/status':
        return this.onStatus(payload)
      case 'agent/disposed':
        return this.onDisposed(payload)
      default:
        return []
    }
  }

  /** 认领：消息 id 与 promptId 对齐后进入 running，并记下真实的 claimedAt。 */
  onClaimed(payload) {
    const messageId = messageIdOf(payload?.message)
    if (!messageId) return []
    const claimedBy = agentIdOf(payload?.agent)
    const affected = []
    for (const record of this.records.values()) {
      if (record.promptId !== messageId) continue
      if (record.state !== 'pending') continue
      const at = this.now()
      record.state = 'running'
      if (record.claimedAt === null) record.claimedAt = at
      record.claimEvidence = record.claimEvidence ?? 'inbox-claimed'
      record.lastActivityAt = at
      record.lastActivityKind = 'inbox-claimed'
      record.updatedAt = at
      if (!record.agentId && claimedBy) record.agentId = claimedBy
      this.armWatchdog(record.bookId)
      affected.push(this.snapshot(record.bookId))
      this.emitProgress(record.bookId, 'mapping', 0, 0, { state: 'running' })
    }
    return affected
  }

  /** 消息被丢弃（回合取消、会话关闭）：直接失败。 */
  onDiscarded(payload) {
    const messageId = messageIdOf(payload?.message)
    if (!messageId) return []
    const affected = []
    for (const record of this.records.values()) {
      if (record.promptId !== messageId) continue
      const reason = typeof payload?.reason === 'string' ? payload.reason : null
      this.fail(record.bookId, GENERATION_FAILURES.INBOX_DISCARDED, reason ?? '注入的消息被会话丢弃')
      affected.push(this.snapshot(record.bookId))
    }
    return affected
  }

  /**
   * 回合/步骤报错：DSH 会把 `agent "<id>" has no provider/model: ...` 这类
   * preStep 失败发到这里，但**不会**通知注入方；这是 qa-v01 上最常见的断点。
   */
  onAgentError(payload) {
    const agentId = agentIdOf(payload?.agent)
    const message = describeError(payload?.error) || 'agent 回合报错'
    const affected = []
    for (const record of this.records.values()) {
      if (record.state !== 'pending' && record.state !== 'running') continue
      if (agentId && record.agentId && agentId !== record.agentId) continue
      this.fail(record.bookId, GENERATION_FAILURES.AGENT_ERROR, message)
      affected.push(this.snapshot(record.bookId))
    }
    return affected
  }

  /**
   * 回合结束（非 running）：消息被认领过但模型没提交导图。
   * 只处理已认领的记录，避免把「agent 正在跑别的回合」误判成我们的失败。
   */
  onStatus(payload) {
    const status = payload?.status ?? payload?.state
    if (typeof status !== 'string') return []
    const agentId = agentIdOf(payload?.agent)
    if (status === 'running') {
      // 「agent 进入 running」也是认领证据（t34）：认领事件可能缺失，
      // 但状态流转能证明它开始处理这条消息了。
      const affected = []
      for (const record of this.records.values()) {
        if (record.state !== 'pending' && record.state !== 'running') continue
        if (agentId && record.agentId && agentId !== record.agentId) continue
        const at = this.now()
        if (record.state === 'pending') {
          record.state = 'running'
          if (record.claimedAt === null) record.claimedAt = at
          record.claimEvidence = record.claimEvidence ?? 'agent-status'
        }
        record.lastActivityAt = at
        record.lastActivityKind = 'agent-status'
        record.updatedAt = at
        this.armWatchdog(record.bookId)
        affected.push(this.snapshot(record.bookId))
      }
      return affected
    }
    const affected = []
    for (const record of this.records.values()) {
      if (record.state !== 'running') continue
      if (agentId && record.agentId && agentId !== record.agentId) continue
      this.fail(record.bookId, GENERATION_FAILURES.TURN_ENDED, 'agent 回合结束但未提交导图')
      affected.push(this.snapshot(record.bookId))
    }
    return affected
  }

  /** agent 被销毁（会话关闭 / 插件卸载）。 */
  onDisposed(payload) {
    const agentId = agentIdOf(payload?.agent)
    const affected = []
    for (const record of this.records.values()) {
      if (record.state !== 'pending' && record.state !== 'running') continue
      if (agentId && record.agentId && agentId !== record.agentId) continue
      this.fail(record.bookId, GENERATION_FAILURES.AGENT_DISPOSED, '目标 agent 已关闭')
      affected.push(this.snapshot(record.bookId))
    }
    return affected
  }

  /** 插件卸载：清定时器，未完成的请求标记失败（否则重启前永远 409）。 */
  close() {
    for (const [bookId, timer] of this.timers) {
      clearTimeout(timer)
      this.timers.delete(bookId)
    }
    for (const record of this.records.values()) {
      if (record.state === 'pending' || record.state === 'running') {
        record.state = 'failed'
        record.reason = GENERATION_FAILURES.AGENT_DISPOSED
        record.message = '插件已卸载，生成请求中断'
        record.finishedAt = this.now()
        record.updatedAt = record.finishedAt
      }
    }
  }

  // -------------------------------------------------------------------------

  armWatchdog(bookId) {
    const record = this.records.get(bookId)
    if (!record) return
    const existing = this.timers.get(bookId)
    if (existing) {
      clearTimeout(existing)
      this.timers.delete(bookId)
    }
    const maxDeadline = record.startedAt + record.maxDurationMs
    const phaseDeadline =
      record.state === 'pending'
        ? record.startedAt + record.queueTimeoutMs
        : (record.lastActivityAt ?? record.claimedAt ?? record.startedAt) + record.idleTimeoutMs
    const deadline = Math.min(phaseDeadline, maxDeadline)
    const delay = Math.max(0, deadline - this.now())
    const timer = setTimeout(() => {
      this.timers.delete(bookId)
      this.checkBudget(bookId)
    }, delay)
    timer.unref?.()
    this.timers.set(bookId, timer)
  }

  /**
   * 预算判定：先看绝对上限，再看当前阶段（排队 / 空闲）。
   * 三项共用 `reason='timeout'`，用 message 区分——面板只展示 message。
   */
  checkBudget(bookId) {
    const current = this.records.get(bookId)
    if (!current || (current.state !== 'pending' && current.state !== 'running')) return
    const now = this.now()
    const maxDeadline = current.startedAt + current.maxDurationMs
    if (now >= maxDeadline) {
      const elapsed = Math.round((now - current.startedAt) / 1000)
      this.fail(
        bookId,
        GENERATION_FAILURES.TIMEOUT,
        `生成已持续 ${elapsed}s，超过绝对上限 ${Math.round(current.maxDurationMs / 1000)}s，判定超时`,
      )
      return
    }
    if (current.state === 'pending') {
      const waited = Math.round((now - current.startedAt) / 1000)
      this.fail(
        bookId,
        GENERATION_FAILURES.TIMEOUT,
        `注入的消息 ${waited}s 内没有被 agent 认领（排队预算 ${Math.round(current.queueTimeoutMs / 1000)}s；会话可能没有可用模型，或 agent 未在运行）`,
      )
      return
    }
    const idle = Math.round((now - (current.lastActivityAt ?? now)) / 1000)
    this.fail(
      bookId,
      GENERATION_FAILURES.TIMEOUT,
      `agent 已开始处理，但已 ${idle}s 没有新的活动（空闲预算 ${Math.round(current.idleTimeoutMs / 1000)}s；最近活动：${current.lastActivityKind ?? 'unknown'}）`,
    )
  }

  settle(record, state, reason, message) {
    const timer = this.timers.get(record.bookId)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(record.bookId)
    }
    record.state = state
    record.reason = reason
    record.message = message
    record.finishedAt = this.now()
    record.updatedAt = record.finishedAt
    if (state === 'failed') {
      const line = `[reading-lab] 导图生成失败 book=${record.bookId} reason=${reason ?? 'unknown'} message=${message ?? ''}`
      try {
        this.log?.warn?.(line)
      } catch {
        // 日志不可用不能影响状态流转。
      }
      this.emitProgress(record.bookId, 'failed', 0, 0, { reason: reason ?? null, message: message ?? null, agentId: record.agentId })
    } else {
      this.emitProgress(record.bookId, 'done', 0, 0, { agentId: record.agentId })
    }
  }

  emitProgress(bookId, phase, done, total, extra = {}) {
    try {
      this.publish({ type: 'progress', bookId, phase, done, total, updatedAt: new Date(this.now()).toISOString(), ...extra })
    } catch {
      // SSE 尽力而为。
    }
  }
}