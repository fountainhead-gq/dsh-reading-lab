/**
 * 导图服务（owner: map，docs/03-design.md §5.4 / §7、docs/04-api.md §3.3 / §5.3）。
 *
 * 三段式（03 §7.1）：
 *   outline  只读书卡与章节骨架（块级预览，不含全文）
 *   chunks   按需取 1–20 块原文，供模型提炼摘要与引用
 *   commit   提交整棵树：五级校验 → 分配 nodeId → 布局 → 备份旧图 → 原子写
 *
 * 校验不通过时**不写任何文件**（04 §3.3），把 `rejected` 原样交给模型重试；
 * 只有通过之后才碰 `map.json`，因此「非法输出被拦截」不会破坏旧图。
 */
import * as path from 'node:path'

import { ReadingError } from './errors.js'
import { GenerationTracker } from './generation.js'
import { nodeIdFrom } from './ids.js'
import { SCHEMA_VERSION, readJson, writeJsonAtomic } from './json-file.js'
import { countNodes, layoutTree, treeDepth } from './layout.js'
import { PLUGIN_VERSION } from './respond.js'

/** 导图的硬限制（04 §5.3）。 */
export const MAP_LIMITS = Object.freeze({
  maxNodes: 300,
  /** 根 depth 0；总层数 2–4，即最大 depth 索引 1–3。 */
  minLevels: 2,
  maxLevels: 4,
  titleMax: 60,
  summaryMin: 40,
  summaryMax: 120,
  citationsMin: 1,
  citationsMax: 3,
  quoteMax: 80,
  questionsMin: 1,
  questionsMax: 3,
  questionMax: 80,
  /** 一次 `chunks` 的块数与字符上限。 */
  chunksMax: 20,
  chunksCharsMax: 20_000,
  /** `outline` 的预览条数与响应体上限。 */
  outlinePreviewsMax: 200,
  outlinePreviewChars: 120,
  outlineBytesMax: 200 * 1024,
  /** 一次 commit 最多回报多少条拒绝原因。 */
  rejectedMax: 20,
  /** 生成请求的占位有效期：超过就视为上一次生成已中断（重启/模型放弃）。 */
  generationTtlMs: 15 * 60_000,
})

const ALLOWED_NODE_KEYS = new Set(['title', 'summary', 'kind', 'citations', 'questions', 'children'])
const NODE_KINDS = new Set(['chapter', 'section', 'point'])

const charCount = (value) => Array.from(typeof value === 'string' ? value : '').length
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** 同级标题比较：NFKC + 去首尾空白 + 折叠内部空白 + 小写。 */
export function normalizeTitle(title) {
  return String(title ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase()
}

/** `books/<id>/map.json` 与备份文件路径。 */
export function mapFiles(books, bookId) {
  const dir = books.bookDir(bookId)
  return { file: path.join(dir, 'map.json'), backup: path.join(dir, 'map.bak.json') }
}

// ---------------------------------------------------------------------------
// 校验（纯函数）
// ---------------------------------------------------------------------------

/**
 * 五级校验：结构 → 字段 → 引用 → 同级标题 → 根类型（03 §7.3）。
 *
 * @param {unknown} rootInput 模型提交的 `root`（MapNodeInput）
 * @param {Map<string, {id: string, text: string}>} chunksById 本书全部块
 * @param {typeof MAP_LIMITS} [limits]
 * @returns {{ ok: true, root: any, stats: { nodes: number, depth: number, citations: number } } | { ok: false, rejected: Array<{path: string, code: string, message: string}> }}
 */
export function validateMap(rootInput, chunksById, limits = MAP_LIMITS) {
  /** @type {Array<{path: string, code: string, message: string}>} */
  const rejected = []
  const reject = (at, code, message) => {
    if (rejected.length < limits.rejectedMax) rejected.push({ path: at, code, message })
  }

  if (!isPlainObject(rootInput)) {
    return { ok: false, rejected: [{ path: 'root', code: 'E_BAD_REQUEST', message: 'root must be an object' }] }
  }

  let nodeCount = 0
  let citationCount = 0
  let truncated = false

  /**
   * @param {any} input
   * @param {string} at JSON 路径，如 `root.children[2]`
   * @param {number} depth
   * @param {boolean} isRoot
   */
  function walk(input, at, depth, isRoot) {
    if (truncated) return null
    nodeCount += 1
    if (nodeCount > limits.maxNodes) {
      truncated = true
      reject(at, 'E_BAD_REQUEST', `too many nodes (max ${limits.maxNodes})`)
      return null
    }
    if (!isPlainObject(input)) {
      reject(at, 'E_BAD_REQUEST', 'node must be an object')
      return null
    }

    for (const key of Object.keys(input)) {
      if (!ALLOWED_NODE_KEYS.has(key)) {
        reject(`${at}.${key}`, 'E_BAD_REQUEST', `unknown field "${key}"; id/generator are assigned by the server`)
      }
    }

    // 字段：标题
    if (typeof input.title !== 'string' || charCount(input.title) === 0) {
      reject(`${at}.title`, 'E_BAD_REQUEST', 'title must be a non-empty string')
    } else if (charCount(input.title) > limits.titleMax) {
      reject(`${at}.title`, 'E_BAD_REQUEST', `title is ${charCount(input.title)} chars, max ${limits.titleMax}`)
    }

    // 字段：摘要（根也一样）
    if (typeof input.summary !== 'string') {
      reject(`${at}.summary`, 'E_BAD_REQUEST', 'summary must be a string')
    } else {
      const length = charCount(input.summary)
      if (length < limits.summaryMin || length > limits.summaryMax) {
        reject(`${at}.summary`, 'E_BAD_REQUEST', `summary is ${length} chars, needs ${limits.summaryMin}-${limits.summaryMax}`)
      }
    }

    // 字段：kind（根由服务端置 book）
    let kind
    if (isRoot) {
      kind = 'book'
      if (input.kind !== undefined && input.kind !== 'book') {
        reject(`${at}.kind`, 'E_BAD_REQUEST', 'root.kind is always "book"')
      }
    } else if (input.kind === undefined) {
      kind = depth === 1 ? 'chapter' : 'point'
    } else if (typeof input.kind !== 'string' || !NODE_KINDS.has(input.kind)) {
      reject(`${at}.kind`, 'E_BAD_REQUEST', 'kind must be chapter|section|point')
      kind = depth === 1 ? 'chapter' : 'point'
    } else {
      kind = input.kind
    }

    // 字段：追问
    const questions = []
    if (!Array.isArray(input.questions)) {
      reject(`${at}.questions`, 'E_BAD_REQUEST', `questions must be an array of ${limits.questionsMin}-${limits.questionsMax} strings`)
    } else if (input.questions.length < limits.questionsMin || input.questions.length > limits.questionsMax) {
      reject(`${at}.questions`, 'E_BAD_REQUEST', `questions has ${input.questions.length} items, needs ${limits.questionsMin}-${limits.questionsMax}`)
    }
    if (Array.isArray(input.questions)) {
      input.questions.slice(0, limits.questionsMax).forEach((question, index) => {
        if (typeof question !== 'string' || charCount(question) === 0) {
          reject(`${at}.questions[${index}]`, 'E_BAD_REQUEST', 'question must be a non-empty string')
          return
        }
        if (charCount(question) > limits.questionMax) {
          reject(`${at}.questions[${index}]`, 'E_BAD_REQUEST', `question is ${charCount(question)} chars, max ${limits.questionMax}`)
        }
        questions.push(question)
      })
    }

    // 引用
    const citations = []
    const rawCitations = input.citations
    if (rawCitations !== undefined && !Array.isArray(rawCitations)) {
      reject(`${at}.citations`, 'E_BAD_REQUEST', 'citations must be an array')
    } else if (Array.isArray(rawCitations)) {
      const min = isRoot ? 0 : limits.citationsMin
      if (rawCitations.length < min || rawCitations.length > limits.citationsMax) {
        reject(`${at}.citations`, 'E_CITATION', `citations has ${rawCitations.length} items, needs ${min}-${limits.citationsMax}`)
      }
      rawCitations.slice(0, limits.citationsMax).forEach((citation, index) => {
        const where = `${at}.citations[${index}]`
        if (!isPlainObject(citation)) {
          reject(where, 'E_CITATION', 'citation must be an object {chunkId, quote?}')
          return
        }
        for (const key of Object.keys(citation)) {
          if (key !== 'chunkId' && key !== 'quote') {
            reject(`${where}.${key}`, 'E_CITATION', `unknown field "${key}"`)
          }
        }
        const chunk = typeof citation.chunkId === 'string' ? chunksById.get(citation.chunkId) : undefined
        if (!chunk) {
          reject(`${where}.chunkId`, 'E_CITATION', `unknown chunkId ${String(citation.chunkId)}`)
        }
        if (citation.quote !== undefined) {
          if (typeof citation.quote !== 'string') {
            reject(`${where}.quote`, 'E_CITATION', 'quote must be a string')
          } else if (charCount(citation.quote) > limits.quoteMax) {
            reject(`${where}.quote`, 'E_CITATION', `quote is ${charCount(citation.quote)} chars, max ${limits.quoteMax}`)
          } else if (chunk && !chunk.text.includes(citation.quote)) {
            reject(`${where}.quote`, 'E_CITATION', 'quote is not a substring of the cited chunk')
          }
        }
        citations.push({
          chunkId: typeof citation.chunkId === 'string' ? citation.chunkId : '',
          ...(typeof citation.quote === 'string' ? { quote: citation.quote } : {}),
        })
        citationCount += 1
      })
    } else if (!isRoot) {
      reject(`${at}.citations`, 'E_CITATION', `every non-root node needs ${limits.citationsMin}-${limits.citationsMax} citations`)
    }

    // 子节点
    const children = []
    if (input.children !== undefined && !Array.isArray(input.children)) {
      reject(`${at}.children`, 'E_BAD_REQUEST', 'children must be an array')
    } else if (Array.isArray(input.children)) {
      const seenTitles = new Set()
      input.children.forEach((child, index) => {
        const childAt = `${at}.children[${index}]`
        if (isPlainObject(child)) {
          const key = normalizeTitle(child.title)
          if (key.length > 0) {
            if (seenTitles.has(key)) {
              reject(`${childAt}.title`, 'E_BAD_REQUEST', `duplicate sibling title "${String(child.title)}"`)
            }
            seenTitles.add(key)
          }
        }
        const normalized = walk(child, childAt, depth + 1, false)
        if (normalized) children.push(normalized)
      })
    }

    return {
      kind,
      title: typeof input.title === 'string' ? input.title : '',
      summary: typeof input.summary === 'string' ? input.summary : '',
      citations,
      questions,
      children,
    }
  }

  const root = walk(rootInput, 'root', 0, true)
  if (!root) return { ok: false, rejected }

  // 结构：层数 2–4（maxDepth 索引 1–3）。
  const maxDepth = treeDepth(root)
  if (maxDepth + 1 < limits.minLevels) {
    reject('root.children', 'E_BAD_REQUEST', `map needs ${limits.minLevels}-${limits.maxLevels} levels, got ${maxDepth + 1}`)
  } else if (maxDepth + 1 > limits.maxLevels) {
    reject('root', 'E_BAD_REQUEST', `map needs ${limits.minLevels}-${limits.maxLevels} levels, got ${maxDepth + 1}`)
  }

  if (rejected.length > 0) return { ok: false, rejected }

  return {
    ok: true,
    root,
    stats: { nodes: countNodes(root), depth: maxDepth + 1, citations: citationCount },
  }
}

// ---------------------------------------------------------------------------
// 读 / 写
// ---------------------------------------------------------------------------

/**
 * 读取 `map.json`；没有就返回 `null`（路由映射 404，工具映射 E_NOT_FOUND）。
 * @param {import('./books.js').BookService} books
 * @param {string} bookId
 * @returns {Promise<Record<string, any> | null>}
 */
export async function readMap(books, bookId) {
  const { file } = mapFiles(books, bookId)
  return readJson(file, { schemaVersion: SCHEMA_VERSION.map })
}

/** 给节点分配确定性 id：`sha1(根→叶标题)`，冲突时加盐（D-03-06 / M3-05）。 */
function assignNodeIds(root, used = new Set()) {
  function visit(node, parentPath) {
    const chapterPath = [...parentPath, node.title]
    const seed = chapterPath.join('\u0000')
    let salt = 0
    let id = nodeIdFrom(seed, salt)
    while (used.has(id)) {
      salt += 1
      id = nodeIdFrom(seed, salt)
    }
    used.add(id)
    return { ...node, id, chapterPath, children: node.children.map((child) => visit(child, chapterPath)) }
  }
  return visit(root, [])
}

/**
 * 校验 → 分配 id → 布局 → 备份旧图 → 原子写 → 更新 meta / index。
 *
 * 校验失败抛 `E_CITATION`/`E_BAD_REQUEST`（`details.rejected` 带逐条原因），
 * **不写任何文件**，旧图与 `meta.mapUpdatedAt` 保持不变（03 §7.5）。
 *
 * @param {import('./books.js').BookService} books
 * @param {string} bookId
 * @param {unknown} rootInput
 * @param {{ kind?: string, agentId?: string | null, sessionId?: string | null }} [generator]
 * @param {{ maxNodes?: number, targetNodeId?: string | null }} [options] `targetNodeId` 把 `rootInput`
 *   当作该节点（含其子树）的**替换内容**，其余节点原样保留（M3 单节点/子树重生成）。
 */
export async function writeMap(books, bookId, rootInput, generator = {}, options = {}) {
  const book = await books.get(bookId)
  if (book.status !== 'ready') {
    throw new ReadingError('E_BUSY', { reason: 'not-ready', status: book.status })
  }
  const limits = { ...MAP_LIMITS, ...(options.maxNodes ? { maxNodes: options.maxNodes } : {}) }
  const chunksFile = await books.readChunks(bookId)
  const chunks = Array.isArray(chunksFile.chunks) ? chunksFile.chunks : []
  const chunksById = new Map(chunks.map((chunk) => [chunk.id, chunk]))
  const targetNodeId = options.targetNodeId ?? null
  const { file, backup } = mapFiles(books, bookId)

  // 读旧图、合并、校验、写盘都串在一本书的队列里，避免两次 commit 互相覆盖。
  return books.enqueue(async () => {
    const previous = await readMap(books, bookId)
    let candidate = rootInput
    /** 被替换节点的 JSON 路径，用于把拒绝项改写成相对路径。 */
    let remapPrefix = null

    if (targetNodeId) {
      if (!previous) throw new ReadingError('E_NOT_FOUND', { reason: 'no-map', bookId })
      const located = locateNode(previous.root, targetNodeId)
      if (!located) throw new ReadingError('E_NOT_FOUND', { reason: 'no-node', bookId, nodeId: targetNodeId })
      candidate = replaceSubtree(toInput(previous.root), located.indexes, rootInput)
      remapPrefix = located.path
    }

    const verdict = validateMap(candidate, chunksById, limits)
    if (!verdict.ok) {
      const rejected = remapPrefix
        ? verdict.rejected.map((item) => ({
            ...item,
            path: item.path.startsWith(remapPrefix) ? `root${item.path.slice(remapPrefix.length)}` : item.path,
          }))
        : verdict.rejected
      const code = rejected.some((item) => item.code === 'E_CITATION') ? 'E_CITATION' : 'E_BAD_REQUEST'
      throw new ReadingError(code, { bookId, rejected })
    }

    const root = assignNodeIds(verdict.root)
    const layout = layoutTree(root)
    const generatedAt = new Date().toISOString()
    /** @type {Record<string, any>} */
    const doc = {
      schemaVersion: SCHEMA_VERSION.map,
      bookId,
      generatedAt,
      generator: {
        kind: generator.kind ?? 'agent',
        agentId: generator.agentId ?? null,
        sessionId: generator.sessionId ?? null,
        pluginVersion: PLUGIN_VERSION,
      },
      root,
      layout,
      stats: verdict.stats,
    }

    if (previous) {
      await writeJsonAtomic(backup, previous, { schemaVersion: SCHEMA_VERSION.map })
    }
    await writeJsonAtomic(file, doc, { schemaVersion: SCHEMA_VERSION.map })

    const meta = await books.get(bookId)
    const nextMeta = { ...meta, mapUpdatedAt: generatedAt }
    await books.writeMeta(nextMeta)
    await books.upsertSummary(nextMeta)

    return { doc, replaced: Boolean(previous) }
  })
}

/** 已存节点 → MapNodeInput（去掉服务端字段 id / chapterPath）。 */
function toInput(node) {
  /** @type {Record<string, any>} */
  const input = {
    title: node.title,
    summary: node.summary,
    citations: Array.isArray(node.citations) ? node.citations.map((citation) => ({ ...citation })) : [],
    questions: Array.isArray(node.questions) ? [...node.questions] : [],
    children: Array.isArray(node.children) ? node.children.map(toInput) : [],
  }
  if (typeof node.kind === 'string' && node.kind !== 'book') input.kind = node.kind
  return input
}

/** 按 id 定位节点：返回下标链与 `root.children[2]…` 形式的路径。 */
function locateNode(node, id, path = 'root', indexes = []) {
  if (node?.id === id) return { indexes, path }
  const children = Array.isArray(node?.children) ? node.children : []
  for (let index = 0; index < children.length; index += 1) {
    const found = locateNode(children[index], id, `${path}.children[${index}]`, [...indexes, index])
    if (found) return found
  }
  return null
}

/** 用 `replacement` 替换 `indexes` 指向的子树（返回新对象，不改入参）。 */
function replaceSubtree(input, indexes, replacement) {
  if (indexes.length === 0) return replacement
  const [head, ...rest] = indexes
  const children = Array.isArray(input.children) ? [...input.children] : []
  children[head] = replaceSubtree(children[head], rest, replacement)
  return { ...input, children }
}

// ---------------------------------------------------------------------------
// MapService：路由与工具的业务入口
// ---------------------------------------------------------------------------

export class MapService {
  /**
   * @param {{
   *   books: import('./books.js').BookService,
   *   hub?: { publish: (event: any) => void } | null,
   *   limits?: Record<string, any>,
   *   generation?: import('./generation.js').GenerationTracker,
   * }} options
   */
  constructor(options) {
    this.books = options.books
    this.hub = options.hub ?? null
    this.limits = options.limits ?? {}
    /**
     * 生成请求的状态机（t29）。没有显式传入时自己建一个，保证单测/工具层
     * 单独实例化也能得到「有状态、会超时」的行为。
     */
    this.generation = options.generation ?? new GenerationTracker({
      publish: (event) => this.publishEvent(event),
      queueTimeoutMs: options.limits?.mapGenerationQueueTimeoutMs,
      idleTimeoutMs: options.limits?.mapGenerationIdleTimeoutMs,
      maxDurationMs: options.limits?.mapGenerationMaxDurationMs,
    })
  }

  /**
   * 占位「正在生成」：已在生成中抛 `E_BUSY`（04 §4.2 #9）。
   * 记录带状态与看门狗，202 之后不再是黑盒（t29 / QA-11-07）。
   * @param {string} bookId
   * @param {{ agentId?: string | null, timeoutMs?: number }} [info]
   */
  beginGeneration(bookId, info = {}) {
    return this.generation.begin(bookId, info)
  }

  /**
   * 注入成功后把 promptId 补进记录：认领事件按 message.id 对齐。
   * @param {string} bookId
   * @param {{ agentId?: string | null, promptId?: string | null }} info
   */
  attachPrompt(bookId, info) {
    return this.generation.attachPrompt(bookId, info)
  }

  /**
   * 结束生成占位。
   * @param {string} bookId
   * @param {{ state?: 'done' | 'failed', reason?: string | null, message?: string | null }} [outcome]
   */
  endGeneration(bookId, outcome = {}) {
    if (outcome.state === 'failed') return this.generation.fail(bookId, outcome.reason ?? 'unknown', outcome.message ?? null)
    return this.generation.complete(bookId)
  }

  /** @param {string} bookId */
  isGenerating(bookId) {
    return this.generation.isGenerating(bookId)
  }

  /** 状态查询（`GET /books/:id/actions/generate-map`）。 */
  getGeneration(bookId) {
    return this.generation.snapshot(bookId)
  }

  /** @param {string} bookId */
  async read(bookId) {
    await this.books.get(bookId)
    return readMap(this.books, bookId)
  }

  /** `get`：无图抛 `E_NOT_FOUND`（路由 404 / 工具 `{ok:false}`）。 */
  async get(bookId) {
    const book = await this.books.get(bookId)
    const map = await readMap(this.books, bookId)
    if (!map) throw new ReadingError('E_NOT_FOUND', { reason: 'no-map', bookId })
    return { book, map }
  }

  /** `outline`：书卡 + 章节骨架 + 块级预览（≤200 条 / 200 KB）。 */
  async outline(bookId) {
    const book = await this.books.get(bookId)
    const file = await this.books.readChunks(bookId)
    const chunks = Array.isArray(file.chunks) ? file.chunks : []
    const byChapter = new Map()
    for (const chunk of chunks) {
      const key = typeof chunk.chapterId === 'string' ? chunk.chapterId : 'ch-000'
      if (!byChapter.has(key)) byChapter.set(key, [])
      byChapter.get(key).push(chunk)
    }

    const toc = Array.isArray(book.toc) && book.toc.length > 0
      ? book.toc
      : [...byChapter.keys()].map((id, index) => ({ id, title: `章节 ${index + 1}`, level: 1 }))

    const seen = new Set()
    const chapters = []
    let budget = MAP_LIMITS.outlinePreviewsMax
    for (const entry of toc) {
      const chapterId = String(entry?.id ?? '')
      if (!chapterId || seen.has(chapterId)) continue
      seen.add(chapterId)
      const list = byChapter.get(chapterId) ?? []
      const previews = []
      let truncated = false
      for (const chunk of list) {
        if (budget <= 0) {
          truncated = true
          break
        }
        budget -= 1
        previews.push({
          id: chunk.id,
          chars: typeof chunk.chars === 'number' ? chunk.chars : charCount(chunk.text),
          preview: previewText(chunk.text, MAP_LIMITS.outlinePreviewChars),
        })
      }
      chapters.push({
        chapterId,
        title: String(entry?.title ?? ''),
        chunkCount: list.length,
        truncated,
        chunks: previews,
      })
    }
    // toc 未覆盖但 chunks 里存在的章节（解析降级时会出现）。
    for (const [chapterId, list] of byChapter) {
      if (seen.has(chapterId)) continue
      seen.add(chapterId)
      let truncated = false
      const previews = []
      for (const chunk of list) {
        if (budget <= 0) {
          truncated = true
          break
        }
        budget -= 1
        previews.push({
          id: chunk.id,
          chars: typeof chunk.chars === 'number' ? chunk.chars : charCount(chunk.text),
          preview: previewText(chunk.text, MAP_LIMITS.outlinePreviewChars),
        })
      }
      chapters.push({ chapterId, title: String(list[0]?.chapterTitle ?? chapterId), chunkCount: list.length, truncated, chunks: previews })
    }

    const data = {
      bookId,
      title: String(book.displayName ?? book.title ?? ''),
      author: book.author ?? null,
      totalChunks: chunks.length,
      chapters,
    }

    // 响应体上限：从最后一章起丢预览，并标记 truncated。
    let bytes = Buffer.byteLength(JSON.stringify(data), 'utf8')
    while (bytes > MAP_LIMITS.outlineBytesMax) {
      const chapter = [...chapters].reverse().find((item) => item.chunks.length > 0)
      if (!chapter) break
      chapter.chunks.pop()
      chapter.truncated = true
      bytes = Buffer.byteLength(JSON.stringify(data), 'utf8')
    }
    return data
  }

  /** `chunks`：1–20 块或 ≤20000 字，超限 400（04 §5.3）。 */
  async chunks(bookId, options = {}) {
    const file = await this.books.readChunks(bookId)
    const all = Array.isArray(file.chunks) ? file.chunks : []
    const byId = new Map(all.map((chunk) => [chunk.id, chunk]))

    let selected = []
    if (Array.isArray(options.ids) && options.ids.length > 0) {
      if (options.ids.length > MAP_LIMITS.chunksMax) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'ids', reason: 'too-many', limit: MAP_LIMITS.chunksMax })
      }
      const missing = []
      for (const id of options.ids) {
        const chunk = typeof id === 'string' ? byId.get(id) : undefined
        if (!chunk) missing.push(id)
        else selected.push(chunk)
      }
      if (missing.length > 0) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'ids', reason: 'unknown-chunk', missing })
      }
    } else {
      const from = Number.isInteger(options.from) ? options.from : 1
      const to = Number.isInteger(options.to) ? options.to : from + MAP_LIMITS.chunksMax - 1
      if (to < from) throw new ReadingError('E_BAD_REQUEST', { field: 'to', reason: 'range' })
      if (to - from + 1 > MAP_LIMITS.chunksMax) {
        throw new ReadingError('E_BAD_REQUEST', { field: 'to', reason: 'range-too-wide', limit: MAP_LIMITS.chunksMax })
      }
      selected = all.filter((chunk) => chunk.seq >= from && chunk.seq <= to)
    }

    const chars = selected.reduce((sum, chunk) => sum + (typeof chunk.chars === 'number' ? chunk.chars : charCount(chunk.text)), 0)
    if (chars > MAP_LIMITS.chunksCharsMax) {
      throw new ReadingError('E_BAD_REQUEST', { field: 'ids', reason: 'too-long', chars, limit: MAP_LIMITS.chunksCharsMax })
    }
    return {
      bookId,
      chunks: selected.map((chunk) => ({ id: chunk.id, text: chunk.text, chars: chunk.chars ?? charCount(chunk.text) })),
      chars,
    }
  }

  /**
   * `commit`：整图提交（单节点/子树重生成 = 重新提交整图，未变节点因
   * nodeId 稳定而保持 id；FR-07 的重试也只允许改 `rejected` 里的节点）。
   *
   * 注意：commit 失败（例如 E_CITATION）**不**把生成标记为 failed —— 提示词
   * 要求模型只修 `rejected` 里的节点再提交一次（03 §7.3）；真正的失败判定交给
   * 看门狗与 agent 事件（`generation.js`）。
   */
  async commit(bookId, root, generator = {}, options = {}) {
    const { doc, replaced } = await writeMap(this.books, bookId, root, generator, {
      maxNodes: options.maxNodes,
      targetNodeId: options.targetNodeId ?? null,
    })
    this.publishEvent({ type: 'map', bookId, mapUpdatedAt: doc.generatedAt })
    this.generation.complete(bookId)
    return {
      bookId,
      mapUpdatedAt: doc.generatedAt,
      stats: doc.stats,
      replaced,
      map: doc,
    }
  }

  /** 直接发布事件（hub 可能不存在：工具层单测）。 */
  publishEvent(event) {
    try {
      this.hub?.publish?.(event)
    } catch {
      // SSE 是尽力而为。
    }
  }

  publishProgress(bookId, phase, done, total) {
    this.publishEvent({ type: 'progress', bookId, phase, done, total, updatedAt: new Date().toISOString() })
  }
}

function previewText(text, max) {
  const chars = Array.from(typeof text === 'string' ? text : '')
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, max).join('')}…`
}

// 暴露给测试与工具层复用。
export { assignNodeIds, charCount }