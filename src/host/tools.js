/**
 * Agent 工具注册（docs/04-api.md §5、D-03-02）。
 *
 * M1 只做到「注册成功、schema 合法、调用返回 E_NOT_IMPLEMENTED」：
 * 参数表已按 04 §5 定型（M2 改实现不改 schema），`execute` 一律抛桩错误。
 *
 * 注意：注册名不能带点（DeepSeek function-name 契约），产品名 `reading.import`
 * 只用于文档、事件与日志。
 */
import { notImplemented } from './errors.js'
import { LIMITS } from './limits.js'

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

/** 工具输出 schema（占位；M2 起换成各工具的真实结构）。 */
const OUTPUT_SCHEMA = { type: 'json' }

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

/**
 * 六个工具的静态定义（`execute` 为桩）。
 * @returns {Record<string, object>}
 */
export function makeToolDefinitions() {
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
    reading_map: stubDefinition(
      'reading_map',
      'Build, extend, or commit the mind map of a book. mode=outline returns the chapter/chunk outline to reason over; mode=commit writes nodes that cite chunk ids.',
      {
        type: 'object',
        properties: {
          bookId: BOOK_ID_SCHEMA,
          mode: { type: 'string', enum: ['outline', 'chunks', 'commit'], description: 'Defaults to outline.' },
          chunkIds: { type: 'array', items: { type: 'string' }, description: 'Chunks to read for mode=chunks.' },
          nodes: {
            type: 'array',
            description: 'Nodes for mode=commit.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                summary: { type: 'string' },
                chunkIds: { type: 'array', items: { type: 'string' } },
                children: { type: 'array', items: { type: 'object' } },
              },
              required: ['title', 'chunkIds'],
            },
          },
        },
        required: ['bookId'],
        additionalProperties: false,
      },
    ),
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
 * @param {{ limits?: Record<string, unknown> }} [services]
 * @returns {() => void}
 */
export function registerTools(ctx, services) {
  const tools = ctx?.tools
  if (!tools || typeof tools.register !== 'function') {
    return () => {}
  }
  const definitions = makeToolDefinitions()
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
export const TOOL_TIMEOUT_ASK_MAX_MS = LIMITS.askTimeoutMs + 30_000