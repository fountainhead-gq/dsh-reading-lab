/**
 * JSON 导出（owner: export，docs/03-design.md §9.4）。
 *
 * 一份自包含的阅读档案：meta + 章节块索引 + 完整 map.json + 笔记五节（+ 可选线程）。
 * `map` 与 `reading/books/<id>/map.json` 的 `root/layout/stats` 逐字段一致（FR-13）。
 *
 * 引用有两层（QA-17-04）：
 *   - 机器层：节点 `citations[].chunkId`、每节 `citationIds[]`（chunkId 数组）；
 *   - 人读层：文档级 `citations[]`（章节 · 页码 · 片段）与 `citationCount`。
 * 契约见 `schema/export-v1.schema.json`。
 */
import { PACKAGE_NAME } from '../limits.js'
import { PLUGIN_VERSION } from '../respond.js'
import {
  buildCitationIndex,
  citationIdsIn,
  citationIdsOf,
  resolveCitationIds,
} from './citations.js'

export const EXPORT_SCHEMA_VERSION = 1

/** notes.md 的 sections（title/body）→ 契约里的 heading/markdown + 引用统计。 */
export function notesSections(notes) {
  const sections = Array.isArray(notes?.sections) ? notes.sections : []
  return sections.map((section) => {
    const markdown = String(section?.body ?? section?.markdown ?? '')
    const citationIds = citationIdsIn(markdown)
    return {
      heading: String(section?.title ?? section?.heading ?? ''),
      markdown,
      citationIds,
      citationCount: citationIds.length,
    }
  })
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

/** 收集导图节点的引用 id（保持首次出现顺序）。 */
function mapCitationIds(node, into) {
  if (!node || typeof node !== 'object') return into
  citationIdsOf(node.citations, into)
  for (const child of Array.isArray(node.children) ? node.children : []) {
    mapCitationIds(child, into)
  }
  return into
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
  const sections = notesSections(input.notes)

  const ids = []
  mapCitationIds(input.map?.root, ids)
  for (const section of sections) {
    for (const id of section.citationIds) if (!ids.includes(id)) ids.push(id)
  }
  const citations = resolveCitationIds(ids, buildCitationIndex(input.chunks))

  const doc = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: exportedAt.toISOString(),
    generator: { plugin: PACKAGE_NAME, version: PLUGIN_VERSION },
    book: {
      meta: input.meta ?? {},
      chunksIndex: chunksIndex(input.chunks),
    },
    map: input.map ?? null,
    notes: { sections },
    citations: citations.map((entry) => ({
      id: entry.id,
      chapterTitle: entry.chapterTitle,
      page: entry.page,
      snippet: entry.snippet,
      ...(entry.missing ? { missing: true } : {}),
    })),
    citationCount: citations.length,
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