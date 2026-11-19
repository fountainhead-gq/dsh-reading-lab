/**
 * Agent 工具注册（docs/04-api.md §5、D-03-02）。
 *
 * `reading_map`（M3）、`reading_notes`（M4）、`reading_export`（M4/t16）已实现；其余三个仍是占位，
 * `execute` 抛 `E_NOT_IMPLEMENTED`，参数表已按 04 §5 定型（后续里程碑改实现不改 schema）。
 *
 * 注意：
 * - 注册名不能带点（DeepSeek function-name 契约），产品名 `reading.import` 只用于文档/事件/日志。
 * - 注册时传的是**原始 JSON Schema**，框架不会替我们校验入参，因此 `reading_map` 自己校验
 *   （见 `checkMapArguments`）。业务错误一律包成 `{ok:false,code,message,rejected?}` 返回，
 *   让模型能读懂并重试；只有程序 bug 才抛。
 */
import { messageFor, notImplemented, ReadingError } from './errors.js'
import { LIMITS } from './limits.js'
import { MAP_LIMITS } from './map.js'

/** 注册名 → 产品名（文档/事件用）。 */
export const TOOL_NAME_MAP = Object.freeze({
  reading_import: 'reading.import',
  reading_map: 'reading.map',
  reading_notes: 'reading.notes',
  reading_ask: 'reading.ask',
  reading_export: 'reading.export',
  reading_tutor: 'reading.tutor',
})

export const TOOL_NAMES = Object.freeze(Object.keys(TOOL_NAME_MAP))

const BOOK_ID_SCHEMA = { type: 'string', pattern: '^b[0-9a-f]{12}$' }
const CHUNK_ID_SCHEMA = { type: 'string', pattern: '^c-[0-9]{6}$' }

/** 占位工具的输出 schema（M3 起 `reading_map` 换成真实结构）。 */
const OUTPUT_SCHEMA = { type: 'json' }

/** 成功信封（04 §5.1）。`data` 是各 action 自己的结构。 */
const OK_ENVELOPE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', const: true },
    data: { type: 'object', additionalProperties: true },
  },
  required: ['ok', 'data'],
  additionalProperties: false,
}

/** 失败信封（04 §5.1）：`rejected` 只在校验失败时出现。 */
const REJECTION_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    code: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['path', 'code', 'message'],
  additionalProperties: false,
}

const ERROR_ENVELOPE = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', const: false },
    code: { type: 'string' },
    message: { type: 'string' },
    rejected: { type: 'array', items: REJECTION_SCHEMA },
  },
  required: ['ok', 'code', 'message'],
  additionalProperties: false,
}

/**
 * `output.schema`：ValueSchemaSpec 支持 `oneOf`（不支持 `anyOf`，见 tools.zh.md）。
 * 两个分支由 `ok` 的 const 区分，恰好命中一个。
 */
const MAP_OUTPUT_SCHEMA = { oneOf: [OK_ENVELOPE, ERROR_ENVELOPE] }

function renderStub(args, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
  return [{ type: 'text', text: text.slice(0, 64 * 1024) }]
}

function stubDefinition(name, description, parameters) {
  return {
    name,
    description,
    parameters,
    output: { schema: OUTPUT_SCHEMA, render: renderStub },
    timeoutMs: 30_000,
    isConcurrencySafe: () => true,
    async execute() {
      throw notImplemented(name, `planned for M2 (product name ${TOOL_NAME_MAP[name]})`)
    },
  }
}

// ---------------------------------------------------------------------------
// reading_map
// ---------------------------------------------------------------------------

const MAP_ACTIONS = new Set(['outline', 'chunks', 'commit', 'get'])
const READ_ONLY_MAP_ACTIONS = new Set(['outline', 'chunks', 'get'])

const MAP_PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['outline', 'chunks', 'commit', 'get'],
      description: 'outline = chapter skeleton; chunks = read up to 20 chunks; commit = write the whole tree; get = read the current map.',
    },
    bookId: BOOK_ID_SCHEMA,
    ids: {
      type: 'array',
      items: CHUNK_ID_SCHEMA,
      minItems: 1,
      maxItems: MAP_LIMITS.chunksMax,
      description: 'For action=chunks: exact chunk ids (1-20). Mutually exclusive with from/to.',
    },
    from: { type: 'integer', minimum: 1, description: 'For action=chunks: first seq (inclusive).' },
    to: { type: 'integer', minimum: 1, description: 'For action=chunks: last seq (inclusive), span <= 20.' },
    root: {
      type: 'object',
      additionalProperties: true,
      description:
        'For action=commit: MapNodeInput tree {title(1-60), summary(40-120), kind?, citations:[{chunkId,quote?}], questions:[1-3], children}. Root kind is forced to book; ids are assigned by the server.',
    },
    maxNodes: {
      type: 'integer',
      minimum: 1,
      maximum: MAP_LIMITS.maxNodes,
      description: `For action=commit: node cap, default ${MAP_LIMITS.maxNodes}.`,
    },
    targetNodeId: {
      type: 'string',
      pattern: '^n-[0-9a-f]{8}(-\\d+)?$',
      description:
        'For action=commit: regenerate one node/subtree only. root is then the replacement subtree for this node; all other nodes are kept as-is.',
    },
  },
  required: ['action', 'bookId'],
  additionalProperties: false,
}

/**
 * 入参自校验（框架不校验原始 JSON Schema）。
 * @param {unknown} args
 * @returns {string | null} 出错时返回可读原因
 */
export function checkMapArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object'
  const input = /** @type {Record<string, unknown>} */ (args)
  for (const key of Object.keys(input)) {
    if (!(key in MAP_PARAMETERS.properties)) return `unknown field "${key}"`
  }
  if (typeof input.action !== 'string' || !MAP_ACTIONS.has(input.action)) {
    return 'action must be outline|chunks|commit|get'
  }
  if (typeof input.bookId !== 'string' || !/^b[0-9a-f]{12}$/.test(input.bookId)) {
    return 'bookId must look like b3f9a1c07d2e'
  }

  const { action } = input
  if (input.ids !== undefined && !Array.isArray(input.ids)) return 'ids must be an array'
  if (Array.isArray(input.ids)) {
    if (input.ids.length === 0) return 'ids must not be empty'
    if (input.ids.length > MAP_LIMITS.chunksMax) return `ids has ${input.ids.length} items, max ${MAP_LIMITS.chunksMax}`
    if (input.ids.some((id) => typeof id !== 'string' || !/^c-[0-9]{6}$/.test(id))) {
      return 'every id must look like c-000007'
    }
  }
  for (const field of ['from', 'to']) {
    const value = input[field]
    if (value !== undefined && (!Number.isInteger(value) || value < 1)) return `${field} must be a positive integer`
  }
  if (input.maxNodes !== undefined) {
    if (!Number.isInteger(input.maxNodes) || input.maxNodes < 1) return 'maxNodes must be a positive integer'
    if (input.maxNodes > MAP_LIMITS.maxNodes) return `maxNodes must be <= ${MAP_LIMITS.maxNodes}`
  }

  if (action === 'chunks') {
    if (Array.isArray(input.ids) && (input.from !== undefined || input.to !== undefined)) {
      return 'use either ids or from/to, not both'
    }
    if (!Array.isArray(input.ids) && input.from === undefined && input.to === undefined) {
      return 'action=chunks needs ids or from/to'
    }
  } else if (input.ids !== undefined || input.from !== undefined || input.to !== undefined) {
    return 'ids/from/to only apply to action=chunks'
  }

  if (action === 'commit') {
    if (!input.root || typeof input.root !== 'object' || Array.isArray(input.root)) {
      return 'action=commit needs root'
    }
    if (input.targetNodeId !== undefined && (typeof input.targetNodeId !== 'string' || !/^n-[0-9a-f]{8}(-\d+)?$/.test(input.targetNodeId))) {
      return 'targetNodeId must look like n-1a2b3c4d'
    }
  } else {
    if (input.root !== undefined) return 'root only applies to action=commit'
    if (input.targetNodeId !== undefined) return 'targetNodeId only applies to action=commit'
  }

  return null
}

/** 失败信封。 */
function failure(code, message, rejected) {
  return {
    ok: false,
    code,
    message,
    ...(Array.isArray(rejected) && rejected.length > 0 ? { rejected } : {}),
  }
}

/** 把内部异常折成工具面的失败信封（不泄漏栈）。 */
export function failureFromError(error) {
  if (error instanceof ReadingError) {
    const rejected = Array.isArray(error.details?.rejected) ? error.details.rejected : undefined
    return failure(error.code, messageFor(error.code, 'zh'), rejected)
  }
  return failure('E_IO', messageFor('E_IO', 'zh'))
}

/**
 * `reading_map` 的四动作实现。
 * @param {Record<string, any>} input
 * @param {{ agent?: any }} [exec]
 * @param {{ map?: import('./map.js').MapService }} [services]
 */
export async function executeMapAction(input, exec, services) {
  const problem = checkMapArguments(input)
  if (problem) return failure('E_BAD_REQUEST', problem)

  const map = services?.map
  if (!map) return failure('E_IO', 'reading map service is unavailable')

  const agent = exec?.agent
  const generator = {
    kind: 'agent',
    agentId: typeof agent?.id === 'string' ? agent.id : null,
    sessionId: typeof agent?.sessionId === 'string' ? agent.sessionId : typeof agent?.id === 'string' ? agent.id : null,
  }

  try {
    switch (input.action) {
      case 'outline':
        return { ok: true, data: await map.outline(input.bookId) }
      case 'chunks':
        return {
          ok: true,
          data: await map.chunks(input.bookId, { ids: input.ids, from: input.from, to: input.to }),
        }
      case 'get': {
        const { map: doc } = await map.get(input.bookId)
        return { ok: true, data: { map: doc } }
      }
      case 'commit': {
        const result = await map.commit(input.bookId, input.root, generator, {
          maxNodes: input.maxNodes,
          targetNodeId: input.targetNodeId,
        })
        return {
          ok: true,
          data: {
            bookId: result.bookId,
            mapUpdatedAt: result.mapUpdatedAt,
            stats: result.stats,
            replaced: result.replaced,
          },
        }
      }
      default:
        return failure('E_BAD_REQUEST', 'action must be outline|chunks|commit|get')
    }
  } catch (error) {
    return failureFromError(error)
  }
}

/** 会话流里的纯文本摘要（1–6 行，不渲染 Markdown 表格）。 */
export function renderMapResult(args, value) {
  const input = args && typeof args === 'object' ? args : {}
  if (!value || value.ok !== true) {
    const code = value?.code ?? 'E_IO'
    const lines = [`reading_map ${input.action ?? '?'} 失败：${code}`, String(value?.message ?? '')]
    const rejected = Array.isArray(value?.rejected) ? value.rejected : []
    for (const item of rejected.slice(0, 3)) lines.push(`- ${item.path}: ${item.message}`)
    if (rejected.length > 3) lines.push(`- 还有 ${rejected.length - 3} 条，见工具结果`)
    return [{ type: 'text', text: lines.join('\n') }]
  }

  const data = value.data ?? {}
  let text
  if (input.action === 'outline') {
    const chapters = Array.isArray(data.chapters) ? data.chapters : []
    text = [
      `《${data.title ?? ''}》共 ${data.totalChunks ?? 0} 块 / ${chapters.length} 章`,
      ...chapters.slice(0, 4).map((chapter) => `- ${chapter.title || chapter.chapterId}: ${chapter.chunkCount} 块${chapter.truncated ? '（预览截断）' : ''}`),
      chapters.length > 4 ? `- 其余 ${chapters.length - 4} 章省略` : '',
    ].filter(Boolean).join('\n')
  } else if (input.action === 'chunks') {
    const list = Array.isArray(data.chunks) ? data.chunks : []
    text = [`已取 ${list.length} 块 / ${data.chars ?? 0} 字`, ...list.slice(0, 5).map((chunk) => `- ${chunk.id} (${chunk.chars} 字)`)].join('\n')
  } else if (input.action === 'commit') {
    const stats = data.stats ?? {}
    text = [
      `导图已保存：${stats.nodes ?? 0} 节点 / ${stats.depth ?? 0} 层 / ${stats.citations ?? 0} 条引用`,
      input.targetNodeId ? `仅重生成节点 ${input.targetNodeId}，其余节点未改动` : data.replaced ? '已备份并替换上一版导图' : '首次生成，无需备份',
    ].join('\n')
  } else {
    const stats = data.map?.stats ?? {}
    text = `当前导图：${stats.nodes ?? 0} 节点 / ${stats.depth ?? 0} 层 / ${stats.citations ?? 0} 条引用`
  }
  return [{ type: 'text', text: text.slice(0, 64 * 1024) }]
}

// ---------------------------------------------------------------------------
// reading_notes
// ---------------------------------------------------------------------------

const NOTES_ACTIONS = new Set(['context', 'write', 'read'])
const NOTES_READ_ACTIONS = new Set(['context', 'read'])

const NOTES_PARAMETERS = {
  type: 'object',
  properties: {
    bookId: BOOK_ID_SCHEMA,
    action: {
      type: 'string',
      enum: ['context', 'write', 'read'],
      description:
        'context = chapter skeleton with sample chunk ids to write from; write = save the full five-section note; read = read the stored note. Defaults to read.',
    },
    markdown: {
      type: 'string',
      description:
        'Full note for action=write: `<!-- reading-lab:notes {…} -->` header, `# title · 研究笔记`, then exactly five `## ` sections (主题脉络/核心论点/术语表/阅读建议/开放问题). Cite with [[c:000012]]; empty sections say 本书未形成该部分.',
    },
  },
  required: ['bookId'],
  additionalProperties: false,
}

/**
 * 入参自校验（框架不校验原始 JSON Schema）。
 * @param {unknown} args
 * @returns {string | null}
 */
export function checkNotesArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object'
  const input = /** @type {Record<string, unknown>} */ (args)
  for (const key of Object.keys(input)) {
    if (!(key in NOTES_PARAMETERS.properties)) return `unknown field "${key}"`
  }
  if (typeof input.bookId !== 'string' || !/^b[0-9a-f]{12}$/.test(input.bookId)) {
    return 'bookId must look like b3f9a1c07d2e'
  }
  const action = input.action === undefined ? 'read' : input.action
  if (typeof action !== 'string' || !NOTES_ACTIONS.has(action)) return 'action must be context|write|read'
  if (action === 'write') {
    if (typeof input.markdown !== 'string' || input.markdown.trim() === '') return 'action=write needs markdown'
    if (Buffer.byteLength(input.markdown, 'utf8') > 200 * 1024) return 'markdown is larger than 200KB'
  } else if (input.markdown !== undefined) {
    return 'markdown only applies to action=write'
  }
  return null
}

/**
 * `reading_notes` 的三动作实现（M4）。
 * @param {Record<string, any>} input
 * @param {{ agent?: any }} [exec]
 * @param {{ notes?: any }} [services]
 */
export async function executeNotesAction(input, exec, services) {
  const problem = checkNotesArguments(input)
  if (problem) return failure('E_BAD_REQUEST', problem)

  const notes = services?.notes
  if (!notes) return failure('E_IO', 'reading notes service is unavailable')

  const action = input.action ?? 'read'
  try {
    if (action === 'context') {
      return { ok: true, data: await notes.context(input.bookId) }
    }
    if (action === 'write') {
      const result = await notes.write(input.bookId, input.markdown)
      serviceNotesChanged(services, input.bookId)
      return { ok: true, data: result }
    }
    const stored = await notes.read(input.bookId)
    if (!stored.updatedAt) {
      return failure('E_NOT_FOUND', 'this book has no research note yet; call action=context, then action=write')
    }
    return {
      ok: true,
      data: {
        markdown: stored.markdown,
        updatedAt: stored.updatedAt,
        sections: stored.sections,
        ...(stored.parseError ? { parseError: true } : {}),
      },
    }
  } catch (error) {
    if (action === 'write' && error instanceof ReadingError) {
      // 校验失败：明确告诉模型哪一条不合格，且**没有落盘**。
      return failure(error.code, messageFor(error.code, 'zh'), [
        { path: error.details?.section ? `sections.${error.details.section}` : 'markdown', code: error.code, message: readableNoteProblem(error) },
      ])
    }
    return failureFromError(error)
  }
}

/** 把 notes 校验失败翻译成可执行的修法（模型据此改一处再提交）。 */
function readableNoteProblem(error) {
  const details = error.details ?? {}
  switch (details.reason) {
    case 'section-missing':
      return `缺少固定章节「${details.section}」；五节必须齐全且顺序固定`
    case 'section-without-citation':
      return `「${details.section}」有内容但没有引用；至少写一条 [[c:NNNNNN]]`
    case 'unknown-chunk':
      return `引用 ${details.chunkId} 不存在；只能用 action=context 返回的块 id`
    case 'notes-all-empty':
      return '五节全是「本书未形成该部分」；至少一节要有内容与引用'
    case 'notes-meta-missing':
    case 'notes-meta-invalid':
      return '首行必须是 <!-- reading-lab:notes {"schemaVersion":1,…} --> 形式的单行 JSON'
    case 'notes-book-mismatch':
      return `首行 bookId 与请求不一致（期望 ${details.expected}）`
    default:
      return messageFor(error.code, 'zh')
  }
}

/** 写入后通知已订阅的客户端（notes 事件）。 */
function serviceNotesChanged(services, bookId) {
  try {
    services?.onNotesChanged?.(bookId)
  } catch {
    // 事件推送失败不影响写入结果。
  }
}

/** 会话流里的纯文本摘要。 */
export function renderNotesResult(args, value) {
  const input = args && typeof args === 'object' ? args : {}
  const action = input.action ?? 'read'
  if (!value || value.ok !== true) {
    const lines = [`reading_notes ${action} 失败：${value?.code ?? 'E_IO'}`, String(value?.message ?? '')]
    const rejected = Array.isArray(value?.rejected) ? value.rejected : []
    for (const item of rejected.slice(0, 3)) lines.push(`- ${item.path}: ${item.message}`)
    return [{ type: 'text', text: lines.join('\n') }]
  }
  const data = value.data ?? {}
  let text
  if (action === 'context') {
    const chapters = Array.isArray(data.chapters) ? data.chapters : []
    text = [
      `《${data.title ?? ''}》共 ${data.chars ?? 0} 字，素材覆盖 ${chapters.length} 章`,
      ...chapters.slice(0, 4).map((chapter) => `- ${chapter.title}: ${chapter.chunks?.length ?? 0} 个样例块`),
      chapters.length > 4 ? `- 其余 ${chapters.length - 4} 章省略` : '',
      `引用格式 ${data.citationFormat ?? '[[c:000003]]'}，五节：${(data.sectionTitles ?? []).join(' / ')}`,
    ].filter(Boolean).join('\n')
  } else if (action === 'write') {
    text = `笔记已保存：${data.path ?? 'notes.md'}（${data.sections ?? 0} 节 / ${data.citations ?? 0} 条引用）`
  } else {
    const sections = Array.isArray(data.sections) ? data.sections : []
    text = [
      data.parseError ? '笔记被手工修改过，只能读不能覆盖' : `笔记共 ${sections.length} 节`,
      ...sections.slice(0, 5).map((section) => `- ${section.title}: ${section.body === '本书未形成该部分' ? '（空）' : `${section.body.length} 字`}`),
    ].join('\n')
  }
  return [{ type: 'text', text: text.slice(0, 64 * 1024) }]
}

function notesToolDefinition(services) {
  return {
    name: 'reading_notes',
    description:
      'Read or write the research note of one book. Notes have exactly five fixed sections (主题脉络 / 核心论点 / 术语表 / 阅读建议 / 开放问题); every non-empty section must cite real chunk ids in the form [[c:000012]]. Workflow: action=context returns the chapter skeleton with sample chunk ids, then action=write saves the complete markdown. Invalid notes are rejected with `rejected` and nothing is written; fix only the reported problems and submit once more.',
    parameters: NOTES_PARAMETERS,
    output: { schema: MAP_OUTPUT_SCHEMA, render: renderNotesResult },
    timeoutMs: TOOL_TIMEOUT_DEFAULT_MS * 2,
    isConcurrencySafe: (args) => Boolean(args && typeof args === 'object' && NOTES_READ_ACTIONS.has(/** @type {any} */ (args).action ?? 'read')),
    execute: (args, exec) => executeNotesAction(args, exec, services),
  }
}

function mapToolDefinition(services) {
  return {
    name: 'reading_map',
    description:
      'Build, inspect, or commit the mind map of one book. action=outline returns the chapter/chunk skeleton; action=chunks reads up to 20 chunks; action=commit writes the whole tree (root + children with real chunk citations); action=get returns the stored map. To regenerate a single node or subtree, pass action=commit plus targetNodeId and use root as the replacement subtree. Commit failures return {ok:false,rejected} and you should fix only those nodes, then commit once more.',
    parameters: MAP_PARAMETERS,
    output: { schema: MAP_OUTPUT_SCHEMA, render: renderMapResult },
    timeoutMs: 60_000,
    isConcurrencySafe: (args) =>
      Boolean(args && typeof args === 'object' && READ_ONLY_MAP_ACTIONS.has(/** @type {any} */ (args).action)),
    execute: (args, exec) => executeMapAction(args, exec, services),
  }
}

// ---------------------------------------------------------------------------
// reading_export
// ---------------------------------------------------------------------------

const EXPORT_FORMAT_VALUES = new Set(['md', 'opml', 'json', 'html'])

const EXPORT_PARAMETERS = {
  type: 'object',
  properties: {
    bookId: BOOK_ID_SCHEMA,
    format: {
      type: 'string',
      enum: ['md', 'opml', 'json', 'html'],
      description:
        'md = outline + research note + selected Q&A; opml = XMind/Mubu importable tree; json = full archive (map incl. layout). html arrives in v0.3.',
    },
    includeThreads: {
      type: 'boolean',
      description: 'Include the Q&A section (md) or the threads array (json). Defaults to false.',
    },
  },
  required: ['bookId'],
  additionalProperties: false,
}

/**
 * 入参自校验（框架不校验原始 JSON Schema）。
 * @param {unknown} args
 * @returns {string | null}
 */
export function checkExportArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object'
  const input = /** @type {Record<string, unknown>} */ (args)
  for (const key of Object.keys(input)) {
    if (!(key in EXPORT_PARAMETERS.properties)) return `unknown field "${key}"`
  }
  if (typeof input.bookId !== 'string' || !/^b[0-9a-f]{12}$/.test(input.bookId)) {
    return 'bookId must look like b3f9a1c07d2e'
  }
  if (input.format !== undefined) {
    if (typeof input.format !== 'string' || !EXPORT_FORMAT_VALUES.has(input.format)) {
      return 'format must be md|opml|json|html'
    }
  }
  if (input.includeThreads !== undefined && typeof input.includeThreads !== 'boolean') {
    return 'includeThreads must be a boolean'
  }
  return null
}

/**
 * `reading_export` 的实现（M4）。
 * @param {Record<string, any>} input
 * @param {{ agent?: any }} [exec]
 * @param {{ exports?: any }} [services]
 */
export async function executeExportAction(input, exec, services) {
  const problem = checkExportArguments(input)
  if (problem) return failure('E_BAD_REQUEST', problem)
  const exporter = services?.exports
  if (!exporter || typeof exporter.create !== 'function') {
    return failure('E_IO', 'export service is unavailable')
  }
  try {
    const result = await exporter.create({
      bookId: input.bookId,
      format: input.format ?? 'md',
      includeThreads: input.includeThreads === true,
    })
    return { ok: true, data: result }
  } catch (error) {
    return failureFromError(error)
  }
}

function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value < 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

/** 会话流里的纯文本摘要（1–6 行）。 */
export function renderExportResult(args, value) {
  const input = args && typeof args === 'object' ? args : {}
  if (!value || value.ok !== true) {
    const lines = [
      `reading_export ${input.format ?? 'md'} 失败：${value?.code ?? 'E_IO'}`,
      String(value?.message ?? ''),
    ]
    const rejected = Array.isArray(value?.rejected) ? value.rejected : []
    for (const item of rejected.slice(0, 3)) lines.push(`- ${item.path}: ${item.message}`)
    return [{ type: 'text', text: lines.join('\n') }]
  }
  const data = value.data ?? {}
  const lines = [
    `导出完成：${data.path ?? ''}`,
    `${data.format ?? input.format ?? 'md'} ｜ ${formatBytes(data.bytes)}${data.includeThreads ? ' ｜ 含问答' : ''}`,
  ]
  return [{ type: 'text', text: lines.join('\n').slice(0, 64 * 1024) }]
}

function exportToolDefinition(services) {
  return {
    name: 'reading_export',
    description:
      'Export one book to reading/exports/ and return the workspace-relative file path. Formats: md (outline + research note + optional Q&A), opml (XMind/Mubu importable), json (full archive including map.json and its layout). html/png arrive in v0.3 and return E_UNSUPPORTED. The source files are only read, never modified.',
    parameters: EXPORT_PARAMETERS,
    output: { schema: MAP_OUTPUT_SCHEMA, render: renderExportResult },
    timeoutMs: 60_000,
    isConcurrencySafe: () => false,
    execute: (args, exec) => executeExportAction(args, exec, services),
  }
}

// ---------------------------------------------------------------------------
// reading_tutor
// ---------------------------------------------------------------------------

const TUTOR_ACTIONS = new Set(['plan', 'get', 'answer', 'mark'])

const TUTOR_PARAMETERS = {
  type: 'object',
  properties: {
    bookId: BOOK_ID_SCHEMA,
    action: {
      type: 'string',
      enum: ['plan', 'get', 'answer', 'mark'],
      description:
        'plan = build/restart the study path (default); get = read the current path and progress; answer = ask the checkpoint question of one step; mark = record mastered / skipped.',
    },
    goal: {
      type: 'string',
      enum: ['explain', 'quiz', 'socratic'],
      description: 'How checkpoint questions are phrased. Defaults to explain.',
    },
    stepId: { type: 'string', pattern: '^s-\\d{2,}$', description: 'Step id such as s-03; defaults to the cursor step.' },
    question: { type: 'string', maxLength: 2000, description: 'Learner answer or follow-up question (action=answer).' },
    state: {
      type: 'string',
      enum: ['pending', 'answered', 'mastered', 'skipped'],
      description: 'New step state (action=mark).',
    },
  },
  required: ['bookId'],
  additionalProperties: false,
}

/**
 * @param {unknown} args
 * @returns {string | null}
 */
export function checkTutorArguments(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object'
  const input = /** @type {Record<string, unknown>} */ (args)
  for (const key of Object.keys(input)) {
    if (!(key in TUTOR_PARAMETERS.properties)) return `unknown field "${key}"`
  }
  if (typeof input.bookId !== 'string' || !/^b[0-9a-f]{12}$/.test(input.bookId)) {
    return 'bookId must look like b3f9a1c07d2e'
  }
  if (input.action !== undefined && (typeof input.action !== 'string' || !TUTOR_ACTIONS.has(input.action))) {
    return 'action must be plan|get|answer|mark'
  }
  if (input.goal !== undefined && !['explain', 'quiz', 'socratic'].includes(/** @type {string} */ (input.goal))) {
    return 'goal must be explain|quiz|socratic'
  }
  if (input.stepId !== undefined && (typeof input.stepId !== 'string' || !/^s-\d{2,}$/.test(input.stepId))) {
    return 'stepId must look like s-03'
  }
  if (input.state !== undefined && !['pending', 'answered', 'mastered', 'skipped'].includes(/** @type {string} */ (input.state))) {
    return 'state must be pending|answered|mastered|skipped'
  }
  if (input.question !== undefined && typeof input.question !== 'string') {
    return 'question must be a string'
  }
  if (input.action === 'answer' && typeof input.question !== 'string') {
    return 'action=answer needs question'
  }
  if (input.action === 'mark' && typeof input.state !== 'string') {
    return 'action=mark needs state'
  }
  return null
}

/**
 * @param {Record<string, any>} input
 * @param {{ agent?: any }} [exec]
 * @param {{ tutor?: any }} [services]
 */
export async function executeTutorAction(input, exec, services) {
  const problem = checkTutorArguments(input)
  if (problem) return failure('E_BAD_REQUEST', problem)
  const tutor = services?.tutor
  if (!tutor) return failure('E_IO', 'tutor service is unavailable')
  const action = input.action ?? 'plan'
  try {
    if (action === 'plan') {
      const path = input.goal ? await tutor.restart(input.bookId, { goal: input.goal }) : await tutor.get(input.bookId)
      return { ok: true, data: { ...path, action } }
    }
    if (action === 'get') {
      return { ok: true, data: { ...(await tutor.get(input.bookId)), action } }
    }
    if (action === 'mark') {
      return { ok: true, data: { ...(await tutor.mark(input.bookId, input.stepId, input.state)), action } }
    }
    const result = await tutor.answer(input.bookId, {
      stepId: input.stepId ?? null,
      question: String(input.question ?? ''),
      agentId: exec?.agent?.id ?? null,
    })
    return { ok: true, data: { ...result, action } }
  } catch (error) {
    return failureFromError(error)
  }
}

/** 会话流里的纯文本摘要（1–6 行）。 */
export function renderTutorResult(args, value) {
  const input = args && typeof args === 'object' ? args : {}
  if (!value || value.ok !== true) {
    return [
      {
        type: 'text',
        text: `reading_tutor ${input.action ?? 'plan'} 失败：${value?.code ?? 'E_IO'}\n${String(value?.message ?? '')}`.slice(0, 64 * 1024),
      },
    ]
  }
  const data = value.data ?? {}
  if (input.action === 'answer') {
    const step = data.step ?? {}
    const lines = [
      `已就「${step.title ?? ''}」向 Agent 提问，回答会出现在同一条线程里。`,
      `步骤 ${step.id ?? ''} ｜ 线程 ${data.threadId ?? ''} ｜ 已提问 ${step.attempts ?? 1} 次`,
    ]
    return [{ type: 'text', text: lines.join('\n') }]
  }
  const progress = data.progress ?? {}
  const lines = [
    `学习路径 ${data.pathId ?? ''}：${progress.done ?? 0}/${progress.total ?? 0} 步完成（掌握 ${progress.mastered ?? 0}，跳过 ${progress.skipped ?? 0}）。`,
  ]
  const steps = Array.isArray(data.steps) ? data.steps : []
  const current = steps[data.cursor ?? 0]
  if (current) lines.push(`当前：${current.id} ${current.title}｜${current.question}`)
  if (input.action === 'mark') {
    lines.push(`已标记为 ${data.step?.state ?? input.state}`)
  }
  return [{ type: 'text', text: lines.join('\n').slice(0, 64 * 1024) }]
}

function tutorToolDefinition(services) {
  return {
    name: 'reading_tutor',
    description:
      'Guide a learner through one book with a study path derived from its mind map. Each step is one card with a checkpoint question, a hint (the node summary) and its citations. action=plan builds or restarts the path (goal=explain|quiz|socratic), action=get reads progress, action=answer asks a question inside that step thread (the reply arrives asynchronously), action=mark records mastered/skipped. Progress is stored with the book and survives restarts; regenerate the map and progress is remapped by node id.',
    parameters: TUTOR_PARAMETERS,
    output: { schema: MAP_OUTPUT_SCHEMA, render: renderTutorResult },
    timeoutMs: 15_000,
    isConcurrencySafe: (args) => {
      const action = args && typeof args === 'object' ? /** @type {any} */ (args).action ?? 'plan' : 'plan'
      return action === 'get' || action === 'plan'
    },
    execute: (args, exec) => executeTutorAction(args, exec, services),
  }
}

/**
 * 六个工具的静态定义（`reading_map`/`reading_notes`/`reading_export`/`reading_tutor` 已实现）。
 * @param {{
 *   map?: import('./map.js').MapService,
 *   tutor?: import('./tutor.js').TutorService,
 *   notes?: { read: (bookId: string) => Promise<any>, write: (bookId: string, markdown: string) => Promise<any>, context: (bookId: string) => Promise<any> },
 *   exports?: import('./export/index.js').ExportService,
 * }} [services]
 * @returns {Record<string, object>}
 */
export function makeToolDefinitions(services) {
  return {
    reading_import: stubDefinition(
      'reading_import',
      'Import a local EPUB/PDF file into the reading library. Returns the book summary (id, title, format, status). Use a path inside the workspace; do not parse the file yourself.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or workspace-relative path of the EPUB/PDF file.' },
          title: { type: 'string', description: 'Optional title override; defaults to the file metadata.' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    ),
    reading_map: mapToolDefinition(services),
    reading_notes: notesToolDefinition(services),
    reading_ask: stubDefinition(
      'reading_ask',
      'Ask a question about one book inside its thread. Returns the answer plus the chunk ids it cited.',
      {
        type: 'object',
        properties: {
          bookId: BOOK_ID_SCHEMA,
          question: { type: 'string', minLength: 2, maxLength: 2000 },
          threadId: { type: 'string', pattern: '^t-\\d{2,}$', description: 'Optional existing thread.' },
        },
        required: ['bookId', 'question'],
        additionalProperties: false,
      },
    ),
    reading_export: exportToolDefinition(services),
    reading_tutor: tutorToolDefinition(services),
  }
}

/**
 * 注册全部工具，返回 dispose。
 *
 * @param {any} ctx Cordis 上下文（需要 `ctx.tools`）
 * @param {{ limits?: Record<string, unknown>, map?: import('./map.js').MapService, notes?: any, exports?: any }} [services]
 * @returns {() => void}
 */
export function registerTools(ctx, services) {
  const tools = ctx?.tools
  if (!tools || typeof tools.register !== 'function') {
    return () => {}
  }
  const definitions = makeToolDefinitions(services)
  /** @type {Array<() => void>} */
  const disposers = []
  for (const name of TOOL_NAMES) {
    try {
      const dispose = tools.register(definitions[name])
      if (typeof dispose === 'function') disposers.push(dispose)
    } catch (error) {
      // 同名工具被别的插件占了也不能让整包加载失败。
      ctx?.logger?.warn?.(`[reading-lab] tool ${name} not registered: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // 宿主已经回收。
      }
    }
  }
}

/** 供路由/测试使用：这些工具名是否都已注册（E-M1-d 的自检用）。 */
export function expectedToolNames() {
  return [...TOOL_NAMES]
}

/** 工具默认超时（04 §5.1）。 */
export const TOOL_TIMEOUT_DEFAULT_MS = 30_000
export const TOOL_TIMEOUT_MAP_MS = 60_000
export const TOOL_TIMEOUT_ASK_MAX_MS = LIMITS.askTimeoutMs + 30_000