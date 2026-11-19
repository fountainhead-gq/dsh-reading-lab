/**
 * JSON 导出（owner: export，docs/03-design.md §9.4）。
 *
 * 一份自包含的阅读档案：meta + 章节块索引 + 完整 map.json + 笔记五节（+ 可选线程）。
 * `map` 与 `reading/books/<id>/map.json` 的 `root/layout/stats` 逐字段一致（FR-13）。
 */
import { PACKAGE_NAME } from '../limits.js'
import { PLUGIN_VERSION } from '../respond.js'

export const EXPORT_SCHEMA_VERSION = 1

/** notes.md 的 sections（title/body）→ 契约里的 heading/markdown。 */
export function notesSections(notes) {
  const sections = Array.isArray(notes?.sections) ? notes.sections : []
  return sections.map((section) => ({
    heading: String(section?.title ?? section?.heading ?? ''),
    markdown: String(section?.body ?? section?.markdown ?? ''),
  }))
}

function chunksIndex(chunksFile) {
  const chunks = Array.isArray(chunksFile?.chunks) ? chunksFile.chunks : []
  return chunks.map((chunk) => ({
    id: chunk.id,
    chapterId: chunk.chapterId ?? null,
    seq: chunk.seq ?? null,
    chars: chunk.chars ?? 0,
  }))
}

/**
 * @param {{
 *   meta: any,
 *   map: any,
 *   notes: any,
 *   chunks?: any,
 *   threads?: any,
 *   includeThreads?: boolean,
 *   exportedAt?: Date,
 * }} input
 */
export function buildExportJson(input) {
  const exportedAt = input.exportedAt instanceof Date ? input.exportedAt : new Date()
  const doc = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    generator: { plugin: PACKAGE_NAME, version: PLUGIN_VERSION },
    book: {
      meta: input.meta ?? {},
      chunksIndex: chunksIndex(input.chunks),
    },
    map: input.map ?? null,
    notes: { sections: notesSections(input.notes) },
  }
  if (input.includeThreads) {
    doc.threads = Array.isArray(input.threads?.threads) ? input.threads.threads : []
  }
  return doc
}

/** @param {Parameters<typeof buildExportJson>[0]} input */
export function renderJson(input) {
  return `${JSON.stringify(buildExportJson(input), null, 2)}\n`
}