/**
 * UT-EXP-01..06（06-test.md §2、07 §3 M4-16..18；03 §9）。
 *
 * 只跑 host 层：真 fs（临时目录） + 真 BookService，不起 HTTP。
 * 覆盖三种格式的结构/转义、JSON 与 map.json 逐字段一致、文件名去重、
 * 失败清理与 E_UNSUPPORTED、工具信封。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { BookService } from '../../src/host/books.js'
import { ExportService } from '../../src/host/export/index.js'
import { escapeMarkdown, escapeXml, sanitizeFileName, uniqueName } from '../../src/host/export/format.js'
import { notesBody, renderMarkdown } from '../../src/host/export/markdown.js'
import { renderOpml } from '../../src/host/export/opml.js'
import { LIMITS } from '../../src/host/limits.js'
import { writeMap } from '../../src/host/map.js'
import { writeNotes } from '../../src/host/notes.js'
import { appendMessage, createThread } from '../../src/host/threads.js'
import { findChild, findChildren, parseXml } from '../../src/host/xml.js'
import { checkExportArguments, executeExportAction, renderExportResult } from '../../src/host/tools.js'

const BOOK_ID = 'b0123456789ab'
const SUMMARY = '这一章讨论核心概念与它的边界，并给出一个可检验的例子，作者还说明了它在实践中的适用范围与反例。'

function textChunk(seq, chapterId, chapterTitle, text) {
  return {
    id: `c-${String(seq).padStart(6, '0')}`,
    seq,
    chapterId,
    chapterTitle,
    chapterPath: chapterTitle,
    page: null,
    text,
    chars: Array.from(text).length,
    startOffset: 0,
    endOffset: Array.from(text).length,
  }
}

const CHUNKS = [
  textChunk(1, 'ch-001', '第一章', '第一章正文第一段。核心概念的定义是这样的。'),
  textChunk(2, 'ch-001', '第一章', '第一章正文第二段。作者给出了边界条件。'),
  textChunk(3, 'ch-002', '第二章', '第二章正文第一段。反例说明定义过宽。'),
]

const NOTES_MD = [
  `<!-- reading-lab:notes {"schemaVersion":1,"bookId":"${BOOK_ID}"} -->`,
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

function tree() {
  return {
    title: '测试书',
    summary: SUMMARY,
    questions: ['这本书的核心主张是什么？'],
    children: [
      {
        title: '第一章',
        summary: SUMMARY,
        kind: 'chapter',
        citations: [{ chunkId: 'c-000001', quote: '核心概念的定义' }],
        questions: ['定义是什么？'],
        children: [
          {
            title: '定义',
            summary: SUMMARY,
            kind: 'point',
            citations: [{ chunkId: 'c-000001' }],
            questions: ['有没有更短的写法？'],
          },
        ],
      },
      {
        title: '第二章',
        summary: SUMMARY,
        kind: 'chapter',
        citations: [{ chunkId: 'c-000003' }],
        questions: ['反例成立吗？'],
      },
    ],
  }
}

async function seedBook(root, options = {}) {
  const dir = path.join(root, 'reading', 'books', BOOK_ID)
  await mkdir(dir, { recursive: true })
  const now = '2026-01-01T00:00:00.000Z'
  const chars = CHUNKS.reduce((sum, chunk) => sum + chunk.chars, 0)
  const meta = {
    schemaVersion: 1,
    id: BOOK_ID,
    title: '测试书',
    displayName: options.displayName ?? '测试书',
    author: '作者 & 编者',
    language: 'zh',
    format: 'epub',
    source: { file: 'source.epub', bytes: 1024, sha256: '0'.repeat(64), importedAt: now },
    status: 'ready',
    statusDetail: null,
    progress: { phase: 'done', done: 1, total: 1, updatedAt: now },
    stats: { chapters: 2, chunks: CHUNKS.length, chars, pages: null },
    toc: [
      { id: 'ch-001', title: '第一章', level: 1, chunkStart: 1, chunkEnd: 2 },
      { id: 'ch-002', title: '第二章', level: 1, chunkStart: 3, chunkEnd: 3 },
    ],
    createdAt: now,
    updatedAt: now,
    mapUpdatedAt: null,
    notesUpdatedAt: null,
    threadsUpdatedAt: null,
  }
  await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await writeFile(
    path.join(dir, 'chunks.json'),
    `${JSON.stringify({ schemaVersion: 1, bookId: BOOK_ID, chunks: CHUNKS }, null, 2)}\n`,
    'utf8',
  )
}

function hashOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

describe('export/*（UT-EXP）', () => {
  /** @type {string} */
  let root
  /** @type {BookService} */
  let books
  /** @type {ExportService} */
  let exporter

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'rl-export-'))
    await seedBook(root)
    books = new BookService({ root, limits: LIMITS, storage: { available: true } })
    books.hub = { publish() {} }
    await writeMap(books, BOOK_ID, tree(), { kind: 'agent', agentId: 'agent-1' })
    await writeNotes(books, BOOK_ID, NOTES_MD)
    const thread = await createThread(books, BOOK_ID, { kind: 'node', nodeId: 'n-00000000' })
    await appendMessage(books, BOOK_ID, thread.id, { role: 'user', text: '这个定义成立吗？' })
    await appendMessage(books, BOOK_ID, thread.id, {
      role: 'assistant',
      text: '在给定边界内成立。[c-000001] 但越过边界就有反例。[c-999999]',
    })
    exporter = new ExportService({ books, hub: { publish() {} }, limits: LIMITS, logger: null })
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('UT-EXP-01 Markdown：元信息 + 大纲 + 笔记正文（去掉元数据行）+ 问答精选', async () => {
    const result = await exporter.create({ bookId: BOOK_ID, format: 'md', includeThreads: true, now: new Date('2026-11-19T09:30:00') })
    const text = await readFile(path.join(root, result.path), 'utf8')

    assert.match(text, /^# 测试书\n/)
    assert.match(text, /^> 作者：作者 & 编者 ｜ 格式：EPUB ｜ 导出：2026-11-19 09:30$/m)
    assert.match(text, /^## 导图大纲$/m)
    assert.match(text, /^- 测试书$/m)
    assert.match(text, /^  - 第一章$/m)
    assert.match(text, /^    - 定义$/m)
    assert.ok(text.includes('- 引用：[c-000001]'))
    assert.ok(!text.includes('reading://'), '不再输出 reading:// 伪链接（QA-17-04）')
    // 摘要进引用块，并做 Markdown 转义（本节摘要无特殊字符，走原文）
    assert.ok(text.includes(`  > ${SUMMARY}`))
    // 笔记：首行元数据被剥掉，五节正文保留
    assert.ok(!text.includes('<!-- reading-lab:notes'))
    assert.match(text, /^## 研究笔记$/m)
    assert.ok(text.includes('作者先给定义，再用反例收窄边界。'))
    // 问答精选
    assert.match(text, /^## 问答精选$/m)
    assert.ok(text.includes('**问**：这个定义成立吗？'))
    assert.ok(text.includes('**答**：在给定边界内成立。[c-000001] 但越过边界就有反例。[c-999999]'))
    // 引用表：笔记里的 [[c:000001]] 已转成 [c-000001]，文末给出章节/页码/原文
    assert.match(text, /^## 引用$/m)
    assert.ok(!text.includes('[[c:'))
    assert.match(text, /^- \[c-000001\] 第一章 · — · 「第一章正文第一段。核心概念的定义是这样的。」$/m)
    assert.match(text, /^- \[c-999999\] （引用已失效）$/m)
    // 不输出原始 HTML
    assert.ok(!/<(div|span|script|p)\b/.test(text))
  })

  it('UT-EXP-02 Markdown：includeThreads=false 省略问答节；无图/无笔记有占位', async () => {
    const result = await exporter.create({
      bookId: BOOK_ID,
      format: 'md',
      includeThreads: false,
      now: new Date('2026-11-19T09:30:00'),
    })
    const text = await readFile(path.join(root, result.path), 'utf8')
    assert.ok(!text.includes('## 问答精选'))
    assert.ok(text.includes('## 研究笔记'))
    assert.ok(!text.includes('**问**：'))

    const empty = renderMarkdown({
      meta: { id: BOOK_ID, title: '空书', displayName: '空书', author: null, format: 'epub' },
      map: null,
      notes: null,
      threads: null,
      includeThreads: true,
      exportedAt: new Date('2026-11-19T09:30:00'),
    })
    assert.ok(empty.includes('（还没有导图）'))
    assert.ok(empty.includes('（还没有研究笔记）'))
    assert.ok(empty.includes('（还没有问答）'))
    assert.match(empty, /^# 空书$/m)
    assert.match(empty, /^> 作者：未标注 ｜ 格式：EPUB ｜ 导出：2026-11-19 09:30$/m)
  })

  it('UT-EXP-03 OPML：层级、_note/_citation、XML 转义且可被解析', async () => {
    const at = new Date('2026-11-19T09:30:00')
    const result = await exporter.create({ bookId: BOOK_ID, format: 'opml', now: at })
    const text = await readFile(path.join(root, result.path), 'utf8')
    assert.match(text, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<opml version="2\.0">/)
    assert.ok(text.includes(`<dateCreated>${at.toUTCString()}</dateCreated>`))
    assert.ok(text.includes('<outline text="测试书" _note='))
    assert.ok(text.includes('_citation="c-000001"'))

    const doc = parseXml(text)
    const body = doc.children.find((child) => child.name === 'body')
    assert.ok(body)
    const rootOutline = body.children.find((child) => child.name === 'outline')
    assert.equal(rootOutline.attrs.text, '测试书')
    const chapters = findChildren(rootOutline, 'outline')
    assert.deepEqual(chapters.map((node) => node.attrs.text), ['第一章', '第二章'])
    assert.equal(findChildren(chapters[0], 'outline')[0].attrs.text, '定义')
    assert.equal(findChild(findChild(doc, 'head'), 'title').children.join(''), '测试书')
  })

  it('UT-EXP-04 JSON：map 与 map.json 逐字段一致、chunksIndex 不含正文、threads 可选', async () => {
    const at = new Date('2026-11-19T09:30:00')
    const before = await readFile(path.join(root, 'reading', 'books', BOOK_ID, 'map.json'))
    const result = await exporter.create({ bookId: BOOK_ID, format: 'json', includeThreads: true, now: at })
    const exported = JSON.parse(await readFile(path.join(root, result.path), 'utf8'))
    const mapDoc = JSON.parse(before.toString('utf8'))

    assert.equal(exported.schemaVersion, 1)
    assert.equal(exported.exportedAt, at.toISOString())
    assert.equal(exported.generator.plugin, 'dsh-reading-lab')
    assert.deepEqual(exported.map.root, mapDoc.root)
    assert.deepEqual(exported.map.layout, mapDoc.layout)
    assert.deepEqual(exported.map.stats, mapDoc.stats)
    assert.equal(exported.book.meta.id, BOOK_ID)
    assert.ok(exported.book.chunksIndex.length === CHUNKS.length)
    assert.ok(!('text' in exported.book.chunksIndex[0]))
    assert.equal(exported.notes.sections.length, 5)
    assert.equal(exported.notes.sections[0].heading, '主题脉络')
    assert.ok(Array.isArray(exported.threads) && exported.threads.length === 1)

    const plain = await exporter.create({ bookId: BOOK_ID, format: 'json', now: new Date('2026-11-19T09:31:00') })
    const withoutThreads = JSON.parse(await readFile(path.join(root, plain.path), 'utf8'))
    assert.equal('threads' in withoutThreads, false)
  })

  it('UT-EXP-05 命名：同名自动 -2、清洗非法字符、只读源文件（哈希不变）', async () => {
    const metaFile = path.join(root, 'reading', 'books', BOOK_ID, 'map.json')
    const notesFile = path.join(root, 'reading', 'books', BOOK_ID, 'notes.md')
    const before = [hashOf(await readFile(metaFile)), hashOf(await readFile(notesFile))]

    const at = new Date('2026-11-19T10:15:00')
    const first = await exporter.create({ bookId: BOOK_ID, format: 'md', now: at })
    const second = await exporter.create({ bookId: BOOK_ID, format: 'md', now: at })
    assert.equal(first.name, '测试书-20261119-101500.md')
    assert.equal(second.name, '测试书-20261119-101500-2.md')
    assert.equal(first.path, `reading/exports/${first.name}`)

    const after = [hashOf(await readFile(metaFile)), hashOf(await readFile(notesFile))]
    assert.deepEqual(after, before)

    assert.equal(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j')
    assert.equal(sanitizeFileName('   '), 'book')
    assert.equal(uniqueName('x', 'md', (name) => name === 'x.md'), 'x-2.md')
    assert.equal(uniqueName('x', 'md', () => true), null)
    assert.equal(uniqueName('x', 'md', () => false), 'x.md')
  })

  it('UT-EXP-06 失败路径：html 501、png 400、目录不可写 → E_IO 且不留 .part', async () => {
    await assert.rejects(
      () => exporter.create({ bookId: BOOK_ID, format: 'html' }),
      (error) => error.code === 'E_UNSUPPORTED' && error.details.availableIn === '0.3.0',
    )
    await assert.rejects(
      () => exporter.create({ bookId: BOOK_ID, format: 'png' }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.hint.includes('png'),
    )

    const brokenRoot = await mkdtemp(path.join(tmpdir(), 'rl-export-broken-'))
    try {
      await seedBook(brokenRoot)
      const brokenBooks = new BookService({ root: brokenRoot, limits: LIMITS, storage: { available: true } })
      brokenBooks.hub = { publish() {} }
      // 用普通文件占住 exports 路径：mkdir 必然失败。
      await mkdir(path.join(brokenRoot, 'reading'), { recursive: true })
      await writeFile(path.join(brokenRoot, 'reading', 'exports'), 'not a directory', 'utf8')
      const broken = new ExportService({ books: brokenBooks, limits: LIMITS })
      await assert.rejects(
        () => broken.create({ bookId: BOOK_ID, format: 'md' }),
        (error) => error.code === 'E_IO' && error.details.stage === 'mkdir',
      )
    } finally {
      await rm(brokenRoot, { recursive: true, force: true })
    }

    const dir = path.join(root, 'reading', 'exports')
    const parts = (await readdir(dir)).filter((name) => name.endsWith('.part'))
    assert.deepEqual(parts, [])
  })

  it('UT-EXP-07 工具信封：参数自校验、成功摘要两行、未知字段被拒', async () => {
    assert.equal(checkExportArguments({ bookId: BOOK_ID, format: 'md' }), null)
    assert.match(checkExportArguments({ bookId: 'nope' }), /bookId/)
    assert.match(checkExportArguments({ bookId: BOOK_ID, format: 'docx' }), /format/)
    assert.match(checkExportArguments({ bookId: BOOK_ID, includeNotes: true }), /unknown field/)

    const services = { exports: exporter }
    const ok = await executeExportAction({ bookId: BOOK_ID, format: 'opml' }, {}, services)
    assert.equal(ok.ok, true)
    assert.equal(ok.data.format, 'opml')
    const lines = renderExportResult({ format: 'opml' }, ok)[0].text.split('\n')
    assert.equal(lines.length, 2)
    assert.match(lines[0], /^导出完成：reading\/exports\//)
    assert.match(lines[1], /^opml ｜ \d/)

    const bad = await executeExportAction({ bookId: BOOK_ID, format: 'html' }, {}, services)
    assert.equal(bad.ok, false)
    assert.equal(bad.code, 'E_UNSUPPORTED')
    assert.match(renderExportResult({ format: 'html' }, bad)[0].text, /^reading_export html 失败：E_UNSUPPORTED/)

    const noService = await executeExportAction({ bookId: BOOK_ID }, {}, {})
    assert.equal(noService.ok, false)
    assert.equal(noService.code, 'E_IO')
  })
})

describe('export 转义纯函数', () => {
  it('Markdown/XML 转义覆盖 03 §9.2–9.3 的字符集', () => {
    assert.equal(escapeMarkdown('a*b_c[d]`e#f>g\\h'), 'a\\*b\\_c\\[d\\]\\`e\\#f\\>g\\\\h')
    assert.equal(escapeMarkdown('- item'), '\\- item')
    assert.equal(escapeMarkdown('1. item'), '1\\. item')
    assert.equal(escapeXml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;')
    assert.equal(notesBody('<!-- reading-lab:notes {"schemaVersion":1} -->\n# T\n'), '# T\n')
    const doc = parseXml(renderOpml({ meta: { title: 'A & B' }, map: null }))
    const head = findChild(doc, 'head')
    assert.equal(findChild(head, 'title').children.join(''), 'A & B')
    assert.equal(findChildren(findChild(doc, 'body'), 'outline')[0].attrs.text, 'A & B')
  })
})