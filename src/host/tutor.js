/**
 * 引导式学习（`reading.tutor`，04 §5.7，v0.3）。
 *
 * 设计要点：
 * - 学习路径由 `map.json` 派生：按树的先序（章 → 节 → 论点）逐卡推进，跳过根卡；
 * - 每一步带一个检查点问题、一句提示（节点摘要）与该节点的引用，问题优先用节点自带的
 *   `questions[0]`，没有时按 `goal` 生成兜底问法；
 * - 进度落在 `reading/books/<bookId>/tutor.json`：路径 id、游标、每步状态与关联线程；
 * - 导图重生成后 `mapUpdatedAt` 变化：路径重建，但按 `nodeId` 把「已掌握 / 已跳过」迁移过去，
 *   用户不必从头再来；
 * - 提问复用 `AskService`（同一条 `threads.json` 线程），回答由 `session/event` 回写，
 *   满足「与 qa-threads 打通」。
 */
import path from 'node:path'
import { readJson, writeJsonAtomic } from './json-file.js'
import { readMap } from './map.js'
import { ReadingError } from './errors.js'

export const TUTOR_SCHEMA_VERSION = 1
export const TUTOR_STEP_STATES = Object.freeze(['pending', 'answered', 'mastered', 'skipped'])
export const TUTOR_GOALS = Object.freeze(['explain', 'quiz', 'socratic'])
export const MAX_STEPS = 60
export const MAX_QUESTION_CHARS = 2000
export const MAX_TITLE_CHARS = 60
export const MAX_HINT_CHARS = 120

const QUESTION_BY_GOAL = Object.freeze({
  explain: (title) => `请用自己的话解释「${title}」。`,
  quiz: (title) => `不看原文，回答：这一节「${title}」讲了什么？`,
  socratic: (title) => `如果作者要反驳「${title}」这个说法，可能会怎么说？`,
})

/** 学习进度文件（与 meta.json / map.json 同目录）。 */
export function tutorFile(service, bookId) {
  return path.join(service.bookDir(bookId), 'tutor.json')
}

function codePoints(value) {
  return Array.from(String(value ?? '')).length
}

function clampText(value, max) {
  const chars = Array.from(String(value ?? '').trim())
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

function stepIdAt(index) {
  return `s-${String(index + 1).padStart(2, '0')}`
}

function citationIds(node) {
  const list = Array.isArray(node?.citations) ? node.citations : []
  const seen = new Set()
  const ids = []
  for (const citation of list) {
    const chunkId = typeof citation === 'string' ? citation : citation?.chunkId
    if (typeof chunkId === 'string' && chunkId.length > 0 && !seen.has(chunkId)) {
      seen.add(chunkId)
      ids.push(chunkId)
    }
  }
  return ids
}

/**
 * 按导图生成学习路径（纯函数，确定性）。
 *
 * @param {any} root `map.json` 的 `root`
 * @param {{ goal?: string, maxSteps?: number }} [options]
 * @returns {Array<{ id: string, nodeId: string, title: string, summary: string, depth: number, kind: string, question: string, hint: string, citations: string[] }>}
 */
export function buildSteps(root, options = {}) {
  const goal = TUTOR_GOALS.includes(options.goal) ? options.goal : 'explain'
  const maxSteps = Number.isInteger(options.maxSteps) ? Math.max(1, options.maxSteps) : MAX_STEPS
  const steps = []

  const walk = (node, depth) => {
    if (!node || steps.length >= maxSteps) return
    if (depth > 0) {
      const title = clampText(node.title, MAX_TITLE_CHARS) || '未命名节点'
      const summary = clampText(node.summary, MAX_HINT_CHARS)
      const own = Array.isArray(node.questions)
        ? node.questions.find((question) => typeof question === 'string' && question.trim())
        : null
      steps.push({
        id: stepIdAt(steps.length),
        nodeId: String(node.id ?? ''),
        title,
        summary,
        depth,
        kind: typeof node.kind === 'string' ? node.kind : 'point',
        question: own ? clampText(own, 200) : QUESTION_BY_GOAL[goal](title),
        hint: summary,
        citations: citationIds(node),
      })
    }
    const children = Array.isArray(node.children) ? node.children : []
    for (const child of children) {
      if (steps.length >= maxSteps) break
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return steps
}

/** 空进度文件。 */
export function emptyTutor(bookId) {
  return {
    schemaVersion: TUTOR_SCHEMA_VERSION,
    bookId,
    updatedAt: null,
    pathId: null,
    mapUpdatedAt: null,
    goal: 'explain',
    cursor: 0,
    pathSeq: 0,
    steps: [],
  }
}

/**
 * 读进度；没有文件返回 null（首次打开时由 `get` 建路径）。
 *
 * @param {import('./books.js').BookService} books
 * @param {string} bookId
 */
export async function readTutor(books, bookId) {
  const file = await readJson(tutorFile(books, bookId), { schemaVersion: TUTOR_SCHEMA_VERSION })
  if (!file) return null
  if (!Array.isArray(file.steps)) {
    throw new ReadingError('E_SCHEMA', { reason: 'tutor-invalid', file: 'tutor.json' })
  }
  if (file.bookId !== bookId) {
    throw new ReadingError('E_SCHEMA', { reason: 'tutor-book-mismatch', file: 'tutor.json' })
  }
  return { ...emptyTutor(bookId), ...file }
}

/**
 * 用新路径替换步骤，但按 `nodeId` 迁移旧状态（导图重生成后不丢学习进度）。
 *
 * @param {any} previous 旧进度（可为 null）
 * @param {Array<any>} steps 新步骤
 * @param {{ goal?: string, restart?: boolean }} [options]
 */
export function mergeSteps(previous, steps, options = {}) {
  const keep = options.restart
    ? new Map()
    : new Map((previous?.steps ?? []).map((step) => [step.nodeId, step]))
  const merged = steps.map((step) => {
    const old = keep.get(step.nodeId)
    const state = TUTOR_STEP_STATES.includes(old?.state) ? old.state : 'pending'
    return {
      ...step,
      state,
      attempts: Number.isInteger(old?.attempts) ? old.attempts : 0,
      threadId: typeof old?.threadId === 'string' ? old.threadId : null,
      messageId: typeof old?.messageId === 'string' ? old.messageId : null,
      updatedAt: typeof old?.updatedAt === 'string' ? old.updatedAt : null,
    }
  })
  return merged
}

function progressOf(steps, cursor) {
  let answered = 0
  let mastered = 0
  let skipped = 0
  for (const step of steps) {
    if (step.state === 'answered') answered += 1
    else if (step.state === 'mastered') mastered += 1
    else if (step.state === 'skipped') skipped += 1
  }
  const total = steps.length
  const done = mastered + skipped
  return {
    total,
    answered,
    mastered,
    skipped,
    done,
    cursor,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

function view(file) {
  const steps = Array.isArray(file.steps) ? file.steps : []
  const cursor = Math.min(Math.max(0, file.cursor ?? 0), Math.max(0, steps.length - 1))
  const current = steps[cursor] ?? null
  return {
    bookId: file.bookId,
    pathId: file.pathId,
    goal: file.goal,
    mapUpdatedAt: file.mapUpdatedAt ?? null,
    updatedAt: file.updatedAt ?? null,
    cursor,
    currentStepId: current?.id ?? null,
    steps,
    progress: progressOf(steps, cursor),
  }
}

/** 引导式学习服务（装配在 `index.js`，依赖 map/ask/books/hub）。 */
export class TutorService {
  /**
   * @param {{
   *   books: import('./books.js').BookService,
   *   map: import('./map.js').MapService,
   *   ask: import('./ask.js').AskService,
   *   hub?: { publish: (event: any) => any },
   *   logger?: any,
   *   limits?: any,
   * }} options
   */
  constructor(options) {
    this.books = options.books
    this.map = options.map
    this.ask = options.ask
    this.hub = options.hub ?? null
    this.logger = options.logger ?? null
  }

  async loadMap(bookId) {
    let doc = null
    try {
      doc = await readMap(this.books, bookId)
    } catch (error) {
      if (error?.code === 'E_NOT_FOUND') doc = null
      else throw error
    }
    if (!doc?.root) {
      throw new ReadingError('E_NOT_FOUND', { reason: 'no-map', bookId })
    }
    return doc
  }

  publish(bookId, updatedAt) {
    try {
      this.hub?.publish?.({ type: 'tutor', bookId, updatedAt })
    } catch (error) {
      this.logger?.warn?.(
        `[reading-lab] tutor event failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async persist(bookId, file) {
    file.updatedAt = new Date().toISOString()
    await writeJsonAtomic(tutorFile(this.books, bookId), file, { schemaVersion: TUTOR_SCHEMA_VERSION })
    this.publish(bookId, file.updatedAt)
    return file
  }

  /** 新建路径文件；`restart` 时清空掌握状态并递增路径 id。 */
  createFile(bookId, doc, previous, options = {}) {
    const goal = TUTOR_GOALS.includes(options.goal) ? options.goal : previous?.goal ?? 'explain'
    const base = { ...emptyTutor(bookId), ...(previous ?? {}) }
    const seq = Number.isInteger(base.pathSeq) ? base.pathSeq + 1 : 1
    const steps = mergeSteps(previous, buildSteps(doc.root, { goal }), {
      restart: Boolean(options.restart),
    })
    return {
      ...base,
      schemaVersion: TUTOR_SCHEMA_VERSION,
      bookId,
      pathId: `p-${String(seq).padStart(2, '0')}`,
      pathSeq: seq,
      goal,
      mapUpdatedAt: doc.generatedAt ?? null,
      cursor: options.restart ? 0 : Math.min(base.cursor ?? 0, Math.max(0, steps.length - 1)),
      steps,
      updatedAt: base.updatedAt ?? null,
    }
  }

  /**
   * 读学习路径；首次打开自动创建，导图更新后自动重建并迁移掌握状态。
   *
   * @param {string} bookId
   */
  async get(bookId) {
    const doc = await this.loadMap(bookId)
    const previous = await readTutor(this.books, bookId)
    const stale =
      !previous || previous.mapUpdatedAt !== (doc.generatedAt ?? null) || previous.steps.length === 0
    if (!stale) return { ...view(previous), rebuilt: false }
    const next = this.createFile(bookId, doc, previous, {})
    await this.persist(bookId, next)
    return { ...view(next), rebuilt: true }
  }

  /**
   * 重新开始一条路径（可换 goal）。掌握状态清空，路径 id 递增。
   *
   * @param {string} bookId
   * @param {{ goal?: string }} [options]
   */
  async restart(bookId, options = {}) {
    if (options.goal !== undefined && !TUTOR_GOALS.includes(options.goal)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'goal', allowed: [...TUTOR_GOALS] })
    }
    const doc = await this.loadMap(bookId)
    const previous = await readTutor(this.books, bookId)
    const next = this.createFile(bookId, doc, previous, { goal: options.goal, restart: true })
    await this.persist(bookId, next)
    return view(next)
  }

  /**
   * 标记一步的状态（学会 / 跳过 / 回到未完成）。
   *
   * @param {string} bookId
   * @param {string} stepId
   * @param {'pending'|'answered'|'mastered'|'skipped'} state
   */
  async mark(bookId, stepId, state) {
    if (!TUTOR_STEP_STATES.includes(state)) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'state', allowed: [...TUTOR_STEP_STATES] })
    }
    const doc = await this.loadMap(bookId)
    const file = await readTutor(this.books, bookId)
    if (!file) throw new ReadingError('E_NOT_FOUND', { reason: 'no-path', bookId })
    if (file.mapUpdatedAt !== (doc.generatedAt ?? null)) {
      // 导图已更新：先按新图重建再标记，避免标记落在上一版路径上。
      const rebuilt = this.createFile(bookId, doc, file, {})
      await this.persist(bookId, rebuilt)
      return this.mark(bookId, stepId, state)
    }
    const index = file.steps.findIndex((step) => step.id === stepId)
    if (index < 0) throw new ReadingError('E_NOT_FOUND', { reason: 'step', stepId })
    const step = file.steps[index]
    step.state = state
    step.updatedAt = new Date().toISOString()
    if (state === 'mastered' || state === 'skipped') {
      file.cursor = Math.min(index + 1, Math.max(0, file.steps.length - 1))
    } else {
      file.cursor = index
    }
    await this.persist(bookId, file)
    return { ...view(file), step }
  }

  /**
   * 就某一步向 Agent 提问；复用该节点的线程，回答经 `session/event` 回写。
   *
   * @param {string} bookId
   * @param {{ stepId?: string | null, question: string, agentId?: string | null, idempotencyKey?: string | null }} input
   */
  async answer(bookId, input) {
    const question = String(input?.question ?? '').trim()
    if (question.length === 0 || codePoints(question) > MAX_QUESTION_CHARS) {
      throw new ReadingError('E_BAD_REQUEST', {
        field: 'question',
        reason: 'length',
        limit: MAX_QUESTION_CHARS,
      })
    }
    const file = await readTutor(this.books, bookId)
    if (!file) throw new ReadingError('E_NOT_FOUND', { reason: 'no-path', bookId })
    const stepId = typeof input?.stepId === 'string' && input.stepId ? input.stepId : file.steps[file.cursor]?.id
    const index = file.steps.findIndex((step) => step.id === stepId)
    if (index < 0) throw new ReadingError('E_NOT_FOUND', { reason: 'step', stepId: stepId ?? null })
    const step = file.steps[index]

    const result = await this.ask.ask({
      bookId,
      threadId: step.threadId ?? null,
      nodeId: step.threadId ? null : step.nodeId,
      question,
      agentId: input?.agentId ?? null,
      idempotencyKey: input?.idempotencyKey ?? null,
    })

    step.threadId = result.threadId ?? step.threadId ?? null
    step.messageId = result.messageId ?? step.messageId ?? null
    step.attempts = (Number.isInteger(step.attempts) ? step.attempts : 0) + 1
    if (step.state === 'pending') step.state = 'answered'
    step.updatedAt = new Date().toISOString()
    file.cursor = index
    await this.persist(bookId, file)
    return {
      step,
      threadId: result.threadId,
      messageId: result.messageId,
      agentId: result.agentId,
      cursor: index,
    }
  }
}

/** 供工具 render 用的单步摘要。 */
export function summarizeStep(step) {
  if (!step) return ''
  const cites =
    Array.isArray(step.citations) && step.citations.length > 0
      ? ` ${step.citations.map((id) => `[${id}]`).join('')}`
      : ''
  return `${step.id} ${step.title}：${step.question}${cites}`
}