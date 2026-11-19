/**
 * UT-EXP-08..11（t32 / QA-17-04、QA-17-05）。
 *
 * 三件事：
 *   1. 引用转可读形态（md 表格 / opml `_note` / json 的 id 数组 + 人读表）；
 *   2. `schema/export-v1.schema.json` 真的能校验产物，且能抓住错误产物；
 *   3. 引用缺失时降级而不是抛错。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'node:test'

import {
  buildCitationIndex,
  citationIdsIn,
  citationIdsOf,
  citationLine,
  citationLocation,
  normalizeChunkId,
  readableCitations,
  resolveCitationIds,
  snippetOf,
} from '../../src/host/export/citations.js'
import { renderJson } from '../../src/host/export/json.js'
import { renderMarkdown } from '../../src/host/export/markdown.js'
import { renderOpml } from '../../src/host/export/opml.js'
import { findChild, findChildren, parseXml } from '../../src/host/xml.js'
import { validate } from '../helpers/json-schema-lite.js'

const BOOK_ID = 'b0123456789ab'

function chunk(seq, chapterTitle, text, page = null) {
  return {
    id: `c-${String(seq).padStart(6, '0')}`,
    seq,
    chapterId: 'ch-001',
    chapterTitle,
    chapterPath: chapterTitle,
    page,
    text,
    chars: Array.from(text).length,
    startOffset: 0,
    endOffset: Array.from(text).length,
  }
}

const CHUNKS = {
  schemaVersion: 1,
  bookId: BOOK_ID,
  chunks: [
    chunk(1, '第一章', '核心概念的定义是这样的。', null),
    chunk(2, '第一章', '作者给出了边界条件。', null),
    chunk(3, '第二章', '反例说明定义过宽。', 12),
  ],
}

const NOTES_MD = [
  '<!-- reading-lab:notes {"schemaVersion":1} -->',
  '# 测试书 · 研究笔记',
  '',
  '## 主题脉络',
  '作者先给定义，再用反例收窄边界。[[c:000001]]',
  '',
  '## 核心论点',
  '定义必须带边界条件，否则反例成立。[[c:000003]]',
  '',
  '## 术语表',
  '本书未形成该部分',
  '',
  '## 阅读建议',
  '先读第一章再读第二章。[[c:000002]]',
  '',
  '## 开放问题',
  '本书未形成该部分',
  '',
].join('\n')

function mapDoc() {
  return {
    schemaVersion: 1,
    bookId: BOOK_ID,
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: { kind: 'agent' },
    root: {
      title: '测试书',
      summary: '一本用来测试导出的小书。',
      children: [
        {
          title: '第一章',
          summary: '定义与边界。',
          kind: 'chapter',
          citations: [{ chunkId: 'c-000001' }, { chunkId: 'c-000002', quote: '边界条件' }],
        },
        {
          title: '第二章',
          summary: '反例。',
          kind: 'chapter',
          citations: [{ chunkId: 'c-000003' }],
        },
      ],
    },
    layout: { width: 800, height: 600 },
    stats: { nodes: 3, depth: 2, citations: 3 },
  }
}

const NOTES_PARSED = {
  updatedAt: '2026-01-01T00:00:00.000Z',
  sections: [
    { title: '主题脉络', body: '作者先给定义，再用反例收窄边界。[[c:000001]]' },
    { title: '核心论点', body: '定义必须带边界条件，否则反例成立。[[c:000003]]' },
    { title: '术语表', body: '本书未形成该部分' },
    { title: '阅读建议', body: '先读第一章再读第二章。[[c:000002]]' },
    { title: '开放问题', body: '本书未形成该部分' },
  ],
  markdown: NOTES_MD,
}

const THREADS = {
  threads: [
    {
      id: 't-01',
      scope: { kind: 'node', nodeId: 'n-00000001', nodeTitle: '定义' },
      messages: [
        { role: 'user', text: '这个定义成立吗？' },
        { role: 'assistant', text: '在给定边界内成立。[c-000001] 超出边界就有反例。[[c:000003]]' },
      ],
    },
  ],
}

function markdownOf() {
  return renderMarkdown({
    meta: { id: BOOK_ID, title: '测试书', displayName: '测试书', author: '作者', format: 'pdf' },
    map: mapDoc(),
    notes: NOTES_PARSED,
    chunks: CHUNKS,
    threads: THREADS,
    includeThreads: true,
    exportedAt: new Date('2026-11-19T09:30:00Z'),
  })
}

describe('export/citations（UT-EXP-08）', () => {
  it('normalizeChunkId 认三种写法，拒绝非法值', () => {
    assert.equal(normalizeChunkId('c-000003'), 'c-000003')
    assert.equal(normalizeChunkId('[[c:000003]]'), 'c-000003')
    assert.equal(normalizeChunkId('[c-000003]'), 'c-000003')
    for (const bad of [null, undefined, 3, '', 'c-3', 'c-0000003', 'c-abcdef', '../c-000003']) {
      assert.equal(normalizeChunkId(bad), null, String(bad))
    }
  })

  it('readableCitations 只把 [[c:]] 改成 [c-]，不动普通文本', () => {
    assert.equal(readableCitations('见 [[c:000003]] 与 [c-000009]。'), '见 [c-000003] 与 [c-000009]。')
    assert.equal(readableCitations('没有引用'), '没有引用')
    assert.equal(readableCitations(null), '')
  })

  it('citationIdsIn / citationIdsOf 去重且保持首次出现顺序', () => {
    const ids = citationIdsIn('[[c:000002]] 然后 [c-000001] 再 [[c:000002]]')
    assert.deepEqual(ids, ['c-000002', 'c-000001'])
    assert.deepEqual(citationIdsOf(['c-000003', { chunkId: 'c-000001' }, { chunkId: 'bad' }]), [
      'c-000003',
      'c-000001',
    ])
  })

  it('snippetOf 压平空白并按码点截断', () => {
    assert.equal(snippetOf('  第一段\n\n第二段\t第三段 '), '第一段 第二段 第三段')
    const long = '甲'.repeat(100)
    const cut = snippetOf(long, 10)
    assert.equal(Array.from(cut).length, 10)
    assert.ok(cut.endsWith('…'))
  })

  it('resolveCitationIds 对缺失块给出 missing，citationLine 降级为「引用已失效」', () => {
    const index = buildCitationIndex(CHUNKS)
    const resolved = resolveCitationIds(['c-000003', 'c-999999'], index)
    assert.equal(resolved.length, 2)
    assert.equal(resolved[0].page, 12)
    assert.equal(resolved[0].snippet, '反例说明定义过宽。')
    assert.equal(resolved[1].missing, true)
    assert.equal(citationLocation(resolved[0]), '第二章 · 第 12 页')
    assert.equal(citationLocation(resolved[1]), '—')
    assert.equal(citationLine(resolved[0]), '[c-000003] 第二章 · 第 12 页 · 「反例说明定义过宽。」')
    assert.equal(citationLine(resolved[1]), '[c-999999] （引用已失效）')
  })
})

describe('三种格式的引用呈现（UT-EXP-09）', () => {
  it('Markdown：正文无 [[c:]]，文末「引用」表给章节/页码/片段，缺失引用有提示', () => {
    const text = markdownOf()
    assert.ok(!text.includes('[[c:'), '笔记与问答里的 [[c:]] 必须被改写')
    assert.match(text, /^## 引用$/m)
    assert.match(text, /^- \[c-000001\] 第一章 · — · 「核心概念的定义是这样的。」$/m)
    assert.match(text, /^- \[c-000003\] 第二章 · 第 12 页 · 「反例说明定义过宽。」$/m)
    assert.match(text, /^- \[c-000002\] 第一章 · — · 「作者给出了边界条件。」$/m)
    assert.ok(text.includes('**答**：在给定边界内成立。[c-000001] 超出边界就有反例。[c-000003]'))
    // 引用表按「导图 DFS → 笔记 → 问答」首次出现顺序
    const order = ['c-000001', 'c-000002', 'c-000003'].map((id) => text.indexOf(`- [${id}]`))
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
  })

  it('OPML：_note 带摘要与「引用」原文，_citation 保留逗号分隔 id', () => {
    const text = renderOpml({
      meta: { title: '测试书' },
      map: mapDoc(),
      chunks: CHUNKS,
      exportedAt: new Date('2026-11-19T09:30:00Z'),
    })
    const doc = parseXml(text)
    const body = findChild(doc, 'body')
    const root = findChildren(body, 'outline')[0]
    const chapter = findChildren(root, 'outline')[0]
    assert.equal(chapter.attrs.text, '第一章')
    assert.equal(chapter.attrs._citation, 'c-000001,c-000002')
    assert.ok(chapter.attrs._note.includes('定义与边界。'))
    assert.ok(chapter.attrs._note.includes('引用：'))
    assert.ok(chapter.attrs._note.includes('[c-000001] 第一章 · — · 「核心概念的定义是这样的。」'))
    // 转义后仍能被 XML 解析，且不出现未转义实体
    assert.ok(!text.includes('&amp;amp;'))
  })

  it('JSON：每节 citationIds/citationCount + 文档级 citations 表', () => {
    const doc = JSON.parse(
      renderJson({
        meta: { id: BOOK_ID, title: '测试书' },
        map: mapDoc(),
        notes: NOTES_PARSED,
        chunks: CHUNKS,
        exportedAt: new Date('2026-11-19T09:30:00Z'),
      }),
    )
    assert.deepEqual(doc.citations.map((entry) => entry.id), ['c-000001', 'c-000002', 'c-000003'])
    assert.equal(doc.citationCount, 3)
    assert.deepEqual(doc.citations[2], {
      id: 'c-000003',
      chapterTitle: '第二章',
      page: 12,
      snippet: '反例说明定义过宽。',
    })
    const sections = new Map(doc.notes.sections.map((section) => [section.heading, section]))
    assert.deepEqual(sections.get('主题脉络').citationIds, ['c-000001'])
    assert.equal(sections.get('主题脉络').citationCount, 1)
    assert.deepEqual(sections.get('术语表').citationIds, [])
    assert.equal(sections.get('术语表').citationCount, 0)
    // 机器层仍保留 chunkId（map 节点原样）
    assert.equal(doc.map.root.children[0].citations[0].chunkId, 'c-000001')
  })
})

describe('export-v1 schema 校验（UT-EXP-10）', () => {
  const schema = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, '../../schema/export-v1.schema.json'), 'utf8'),
  )
  const validDoc = JSON.parse(
    renderJson({
      meta: { id: BOOK_ID, title: '测试书' },
      map: mapDoc(),
      notes: NOTES_PARSED,
      chunks: CHUNKS,
      threads: THREADS,
      includeThreads: true,
      exportedAt: new Date('2026-11-19T09:30:00Z'),
    }),
  )

  it('真实产物通过校验', () => {
    const result = validate(schema, validDoc)
    assert.deepEqual(result.errors, [])
  })

  it('抓得住三类错误：缺必填、类型错、id 模式错', () => {
    const missing = structuredClone(validDoc)
    delete missing.citationCount
    assert.match(validate(schema, missing).errors.join('\n'), /missing required citationCount/)

    const wrongType = structuredClone(validDoc)
    wrongType.notes.sections[0].citationCount = '1'
    assert.match(validate(schema, wrongType).errors.join('\n'), /citationCount: expected integer/)

    const badId = structuredClone(validDoc)
    badId.citations[0].id = 'c-3'
    assert.match(validate(schema, badId).errors.join('\n'), /does not match/)

    const extra = structuredClone(validDoc)
    extra.notes.sections[0].unexpected = true
    assert.match(validate(schema, extra).errors.join('\n'), /unexpected property unexpected/)
  })

  it('map 为 null 时也合法（没有导图的书也能导出）', () => {
    const doc = JSON.parse(
      renderJson({
        meta: { id: BOOK_ID, title: '测试书' },
        map: null,
        notes: null,
        chunks: CHUNKS,
        exportedAt: new Date('2026-11-19T09:30:00Z'),
      }),
    )
    assert.deepEqual(validate(schema, doc).errors, [])
    assert.equal(doc.citationCount, 0)
  })
})