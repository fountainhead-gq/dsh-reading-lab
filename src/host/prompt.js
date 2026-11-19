/**
 * 系统提示片段（docs/04-api.md §5.9）。
 *
 * 只描述「工具怎么用 + 引用格式」，不写产品说明；`order` 取靠后的数值，
 * 保证排在宿主自有工具说明之后。
 */
import { LIMITS } from './limits.js'

export const PROMPT_SECTION_NAME = 'reading-lab'

/** 供测试断言：提示里必须出现的引用格式。 */
export const CITATION_EXAMPLE = '[c-000123]'

/**
 * @param {Record<string, number>} [limits]
 * @returns {{ name: string, order: number, text: string }}
 */
export function promptSection(limits = LIMITS) {
  const maxChunks = limits.maxChunks ?? LIMITS.maxChunks
  const text = [
    '## Reading Lab',
    '',
    'This workspace has a reading lab: books (EPUB/PDF) are stored under `reading/` and are',
    'addressed by stable ids (`bookId` like `b3f9a1c07d2e`, `chunkId` like `c-000007`).',
    'Use the reading tools when the user asks about a book, its map, or its notes:',
    '',
    '- `reading_import` imports a local file path into the library (do not read the raw file yourself).',
    '- `reading_map` builds or commits a mind map over chunks; every node must carry at least one chunkId.',
    '- `reading_notes` writes the research note for one book.',
    '- `reading_ask` asks a question inside the book thread and returns the agent answer.',
    '- `reading_export` writes an export file (md/opml/json) and returns its path.',
    '',
    `Cite evidence with chunk ids in square brackets, exactly like \`${CITATION_EXAMPLE}\`,`,
    'placed at the end of the sentence that uses them. Never invent a chunk id: only ids that',
    'appear in tool results or chunk listings are valid. A book is capped at',
    `${maxChunks} chunks; ask for a narrower chunk range instead of dumping the whole book.`,
    '',
    'The panel UI is the user-facing surface: it is fine to say "open the Reading Lab panel",',
    'but do not describe the JSON you return — the panel already renders it.',
  ].join('\n')

  return { name: PROMPT_SECTION_NAME, order: 900, text }
}