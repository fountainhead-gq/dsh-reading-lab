/**
 * Agent 工具注册（docs/04-api.md §5、D-03-02）。
 *
 * `reading_map` 已实现四动作（M3）；其余五个仍是占位，`execute` 抛 `E_NOT_IMPLEMENTED`，
 * 参数表已按 04 §5 定型（后续里程碑改实现不改 schema）。
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

/**
 * 六个工具的静态定义（除 `reading_map` 外 `execute` 为桩）。
 * @param {{ map?: import('./map.js').MapService }} [services]
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
    reading_notes: stubDefinition(
      'reading_notes',
      'Read or write the research note of a book (five fixed sections). Every factual sentence must cite chunk ids.',
      {
        type: 'object',
        properties: {
          bookId: BOOK_ID_SCHEMA,
          action: { type: 'string', enum: ['read', 'write'], description: 'Defaults to read.' },
          markdown: { type: 'string', description: 'Note body for action=write.' },
        },
        required: ['bookId'],
        additionalProperties: false,
      },
    ),
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
    reading_export: stubDefinition(
      'reading_export',
      'Export the map and notes of one book to md/opml/json/html under reading/exports and return the file path.',
      {
        type: 'object',
        properties: {
          bookId: BOOK_ID_SCHEMA,
          format: { type: 'string', enum: ['md', 'opml', 'json', 'html'], description: 'Defaults to md.' },
          includeNotes: { type: 'boolean', description: 'Defaults to true.' },
        },
        required: ['bookId'],
        additionalProperties: false,
      },
    ),
    reading_tutor: stubDefinition(
      'reading_tutor',
      'Plan a study path for a book and check the learner understanding (v0.3; schema reserved).',
      {
        type: 'object',
        properties: {
          bookId: BOOK_ID_SCHEMA,
          goal: { type: 'string', description: 'What the learner wants to get out of the book.' },
        },
        required: ['bookId'],
        additionalProperties: false,
      },
    ),
  }
}

/**
 * 注册全部工具，返回 dispose。
 *
 * @param {any} ctx Cordis 上下文（需要 `ctx.tools`）
 * @param {{ limits?: Record<string, unknown>, map?: import('./map.js').MapService }} [services]
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