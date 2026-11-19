/**
 * 面板 → Agent 的生成请求桥（owner: ask / host-shell 相邻，docs/04-api.md §4.2 #9、§6.3）。
 *
 * 面板点「生成思维导图」时，Host 不自己跑模型，而是往当前会话注入一条 user 消息，
 * 让 Agent 按系统提示里的规则调 `reading_map`。注入用 `agent.inbox.followup()`：
 *
 * - DSH 0.2.x 的 `ctx.agents` 只有 `get(id)` / `list()`，没有 create-message 工厂；
 * - 消息只需 `{ id, role:'user', content, source }`（dsh-llm message.ts 的 MessageBase），
 *   我们自行构造，`source.kind` 用自己的 `reading-lab`（session format V4 已退役
 *   `{kind:'plugin', plugin}` 包装）。
 *
 * 注入失败不能让 HTTP 500：折成 `E_AGENT`，由路由回 422/502 让面板提示。
 */
import { randomUUID } from 'node:crypto'

import { ReadingError } from './errors.js'

export const NOTICE_KIND = 'reading-lab'
export const GENERATE_ACTIONS = Object.freeze({ map: 'generate-map', notes: 'generate-notes' })

/**
 * 生成导图的注入文本（中文，跟随用户界面语言；引用与工具名保持英文标识符）。
 * @param {{ bookId: string, title: string, totalChunks?: number | null, instructions?: string | null }} input
 */
export function buildMapPrompt(input) {
  const title = String(input.title ?? '')
  const lines = [
    `请为《${title}》（bookId: ${input.bookId}）生成思维导图。`,
    '',
    '步骤（必须按顺序，使用 reading_map 工具）：',
    `1. reading_map { action: "outline", bookId: "${input.bookId}" } 先看章节骨架；`,
    `2. reading_map { action: "chunks", bookId: "${input.bookId}", ids: [...] } 按章节取原文，每次不超过 20 块；`,
    `3. reading_map { action: "commit", bookId: "${input.bookId}", root: {...} } 提交整棵树。`,
    '',
    '要求：根节点 kind 为 book；总层数 2–4；每个非根节点 1–3 条引用，chunkId 必须真实存在，',
    '引文原样摘自该块；摘要 40–120 字；每个节点 1–3 条追问。',
    '如果 commit 返回 ok:false，只修改 rejected 里列出的节点，然后再提交一次。',
  ]
  if (typeof input.instructions === 'string' && input.instructions.trim().length > 0) {
    lines.push('', `用户补充要求：${input.instructions.trim().slice(0, 500)}`)
  }
  return lines.join('\n')
}

/**
 * 构造一条可持久化的 user 消息（形状对齐 dsh-llm 的 createUserMessage）。
 * @param {string} text
 * @param {{ summary?: string, bookId?: string, action?: string }} [meta]
 */
export function buildNoticeMessage(text, meta = {}) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: NOTICE_KIND,
      form: 'notice',
      summary: meta.summary ?? text.slice(0, 80),
      ...(meta.bookId ? { bookId: meta.bookId } : {}),
      ...(meta.action ? { action: meta.action } : {}),
    },
  }
}

/**
 * 找一个可以收消息的 agent。
 * @param {any} ctx
 * @param {string | null | undefined} agentId
 */
export function resolveAgent(ctx, agentId) {
  const registry = ctx?.agents
  if (!registry) return null
  if (typeof agentId === 'string' && agentId.length > 0) {
    return typeof registry.get === 'function' ? registry.get(agentId) ?? null : null
  }
  if (typeof registry.list === 'function') {
    const agents = registry.list()
    return Array.isArray(agents) && agents.length > 0 ? agents[agents.length - 1] : null
  }
  return null
}

/**
 * 把一条提示词排进 agent 的下一轮（`followup` 会唤醒它）。
 *
 * @param {{ ctx: any, agentId?: string | null, text: string, summary?: string, bookId?: string, action?: string }} input
 * @returns {{ agentId: string, promptId: string, message: Record<string, unknown> }}
 */
export function injectAgentRequest(input) {
  const agent = resolveAgent(input.ctx, input.agentId)
  if (!agent) {
    throw new ReadingError('E_AGENT', {
      reason: input.agentId ? 'agent-not-found' : 'no-agent',
      ...(input.agentId ? { agentId: input.agentId } : {}),
    })
  }
  const message = buildNoticeMessage(input.text, {
    summary: input.summary,
    bookId: input.bookId,
    action: input.action,
  })
  const inbox = agent.inbox
  try {
    if (inbox && typeof inbox.followup === 'function') {
      inbox.followup(message)
    } else if (typeof agent.followup === 'function') {
      agent.followup(message)
    } else {
      throw new Error('agent has no inbox.followup')
    }
  } catch (error) {
    throw new ReadingError(
      'E_AGENT',
      { reason: 'inject-failed', agentId: agent.id ?? null },
      { cause: error },
    )
  }
  return { agentId: String(agent.id ?? input.agentId ?? ''), promptId: message.id, message }
}