/**
 * UT-MAP-01..12 / UT-LAYOUT-01..05（06-test.md §2，07 §2.3 M3-01..M3-08）。
 *
 * 这里只碰 host 层：真 fs（临时目录）+ 真 BookService，不起 HTTP。
 * 覆盖：五级校验、拒绝项、原子写与备份、失败保留旧图、nodeId 稳定、
 * 单节点/子树重生成、工具信封、布局确定性与无重叠。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { BookService } from '../../src/host/books.js'
import { LIMITS } from '../../src/host/limits.js'
import { GAP_Y, PADDING, countNodes, layoutTree, treeDepth } from '../../src/host/layout.js'
import { MAP_LIMITS, MapService, charCount, readMap, validateMap, writeMap } from '../../src/host/map.js'
import {
  TOOL_NAMES,
  checkMapArguments,
  executeMapAction,
  makeToolDefinitions,
  renderMapResult,
} from '../../src/host/tools.js'

const BOOK_ID = 'b0123456789ab'
const SUMMARY = '导图节点摘要'.repeat(10).slice(0, 60)

function textChunk(seq, chapterId, chapterTitle, text) {
  return {
    id: `c-${String(seq).padStart(6, '0')}`,
    seq,
    chapterId,
    chapterTitle,
    chapterPath: chapterTitle,
    page: null,
    text,
    chars: charCount(text),
    startOffset: 0,
    endOffset: charCount(text),
  }
}

const CHUNKS = [
  textChunk(1, 'ch-001', '第一章', '第一章正文第一段。这里讨论核心概念。'),
  textChunk(2, 'ch-001', '第一章', '第一章正文第二段。核心概念的定义是这样的。'),
  textChunk(3, 'ch-002', '第二章', '第二章正文第一段。作者给出了反例。'),
  textChunk(4, 'ch-002', '第二章', '第二章正文第二段。结论回到开头的假设。'),
]

async function seedBook(root) {
  const dir = path.join(root, 'reading', 'books', BOOK_ID)
  await mkdir(dir, { recursive: true })
  const now = '2026-01-01T00:00:00.000Z'
  const chars = CHUNKS.reduce((sum, chunk) => sum + chunk.chars, 0)
  const meta = {
    schemaVersion: 1,
    id: BOOK_ID,
    title: '测试书',
    displayName: '测试书',
    author: '作者',
    language: 'zh',
    format: 'epub',
    source: { file: 'source.epub', bytes: 1024, sha256: '0'.repeat(64), importedAt: now },
    status: 'ready',
    statusDetail: null,
    progress: { phase: 'done', done: 1, total: 1, updatedAt: now },
    stats: { chapters: 2, chunks: CHUNKS.length, chars, pages: null },
    toc: [
      { id: 'ch-001', title: '第一章', level: 1, chunkStart: 1, chunkEnd: 2 },
      { id: 'ch-002', title: '第二章', level: 1, chunkStart: 3, chunkEnd: 4 },
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

/** 合法的三层树：书 → 2 章 → 1 论点。 */
function validTree() {
  return {
    title: '测试书',
    summary: SUMMARY,
    questions: ['这本书的核心论点是什么？'],
    children: [
      {
        title: '第一章',
        summary: SUMMARY,
        citations: [{ chunkId: 'c-000001', quote: '第一章正文第一段' }],
        questions: ['第一章讲了什么？'],
        children: [
          {
            title: '核心概念',
            summary: SUMMARY,
            citations: [{ chunkId: 'c-000002', quote: '核心概念的定义' }],
            questions: ['这个概念为什么重要？'],
          },
        ],
      },
      {
        title: '第二章',
        summary: SUMMARY,
        citations: [{ chunkId: 'c-000003', quote: '第二章正文第一段' }],
        questions: ['第二章讲了什么？'],
      },
    ],
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function hashOf(file) {
  try {
    return createHash('sha256').update(await readFile(file)).digest('hex')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

describe('map service', () => {
  /** @type {string} */
  let root
  /** @type {BookService} */
  let books
  /** @type {MapService} */
  let map
  let dir

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'rl-map-'))
    await seedBook(root)
    books = new BookService({ root, limits: LIMITS, storage: { available: true } })
    map = new MapService({ books, hub: null, limits: LIMITS })
    dir = path.join(root, 'reading', 'books', BOOK_ID)
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('UT-MAP-01 未知 chunkId 被拒（E_CITATION），map.json 不产生', async () => {
    const tree = validTree()
    tree.children[1].citations = [{ chunkId: 'c-999999' }]
    const before = await hashOf(path.join(dir, 'map.json'))
    await assert.rejects(
      () => writeMap(books, BOOK_ID, tree, { agentId: 'a1' }),
      (error) => {
        assert.equal(error.code, 'E_CITATION')
        assert.ok(error.details.rejected.some((item) => item.code === 'E_CITATION' && /c-999999/.test(item.message)))
        return true
      },
    )
    assert.equal(await hashOf(path.join(dir, 'map.json')), before)
  })

  it('UT-MAP-02 非根节点缺引用被拒；根允许 0 引用', () => {
    const chunksById = new Map(CHUNKS.map((chunk) => [chunk.id, chunk]))
    const tree = validTree()
    delete tree.children[0].citations
    const verdict = validateMap(tree, chunksById)
    assert.equal(verdict.ok, false)
    assert.ok(verdict.rejected.some((item) => item.code === 'E_CITATION' && item.path === 'root.children[0].citations'))

    const ok = validateMap(validTree(), chunksById)
    assert.equal(ok.ok, true)
    assert.equal(ok.root.citations.length, 0)
  })

  it('UT-MAP-03 摘要长度、标题长度、追问数量越界被拒', () => {
    const chunksById = new Map(CHUNKS.map((chunk) => [chunk.id, chunk]))
    const short = validTree()
    short.summary = '太短'
    let verdict = validateMap(short, chunksById)
    assert.equal(verdict.ok, false)
    assert.ok(verdict.rejected.some((item) => item.path === 'root.summary'))

    const longTitle = validTree()
    longTitle.children[0].title = '标'.repeat(61)
    verdict = validateMap(longTitle, chunksById)
    assert.ok(verdict.rejected.some((item) => item.path === 'root.children[0].title'))

    const noQuestions = validTree()
    noQuestions.children[0].questions = []
    verdict = validateMap(noQuestions, chunksById)
    assert.ok(verdict.rejected.some((item) => item.path === 'root.children[0].questions'))
  })

  it('UT-MAP-04 层数必须在 2–4；超过 300 节点被拒', () => {
    const chunksById = new Map(CHUNKS.map((chunk) => [chunk.id, chunk]))
    const flat = { ...validTree(), children: [] }
    let verdict = validateMap(flat, chunksById)
    assert.equal(verdict.ok, false)
    assert.ok(verdict.rejected.some((item) => /levels/.test(item.message)))

    let deep = { title: 'L4', summary: SUMMARY, citations: [{ chunkId: 'c-000001' }], questions: ['q?'] }
    for (let level = 3; level >= 0; level -= 1) {
      deep = {
        title: `L${level}`,
        summary: SUMMARY,
        ...(level === 0 ? {} : { citations: [{ chunkId: 'c-000001' }] }),
        questions: ['q?'],
        children: [deep],
      }
    }
    verdict = validateMap(deep, chunksById)
    assert.equal(verdict.ok, false)
    assert.ok(verdict.rejected.some((item) => /levels/.test(item.message)))

    const wide = validTree()
    wide.children = Array.from({ length: MAP_LIMITS.maxNodes }, (_, index) => ({
      title: `章 ${index}`,
      summary: SUMMARY,
      citations: [{ chunkId: 'c-000001' }],
      questions: ['q?'],
    }))
    verdict = validateMap(wide, chunksById)
    assert.equal(verdict.ok, false)
    assert.ok(verdict.rejected.some((item) => /too many nodes/.test(item.message)))
  })

  it('UT-MAP-05 同级标题按 NFKC/空白/大小写归一后不得重复', () => {
    const tree = validTree()
    tree.children[1].title = '  第一章  '
    const verdict = validateMap(tree, new Map(CHUNKS.map((chunk) => [chunk.id, chunk])))
    assert.equal(verdict.ok, false)
    assert.ok(verdict.rejected.some((item) => /duplicate sibling title/.test(item.message)))
  })

  it('UT-MAP-06 首次 commit 落盘 map.json + meta.mapUpdatedAt，不产生备份', async () => {
    const tree = validTree()
    const { doc, replaced } = await writeMap(books, BOOK_ID, tree, { agentId: 'agent-1', sessionId: 's-1' })
    assert.equal(replaced, false)
    assert.equal(doc.root.kind, 'book')
    assert.equal(doc.schemaVersion, 1)
    assert.deepEqual(doc.stats, { nodes: 4, depth: 3, citations: 3 })
    assert.equal(Object.keys(doc.layout.nodes).length, 4)
    assert.equal(doc.layout.edges.length, 3)
    assert.equal(doc.generator.agentId, 'agent-1')
    assert.equal(await hashOf(path.join(dir, 'map.bak.json')), null)

    const meta = await books.get(BOOK_ID)
    assert.equal(meta.mapUpdatedAt, doc.generatedAt)
    const index = await books.loadIndex()
    assert.equal(index.books.find((book) => book.id === BOOK_ID).hasMap, true)
  })

  it('UT-MAP-07 二次 commit 备份旧图；nodeId 稳定；引用可回溯到块原文', async () => {
    const previous = await readMap(books, BOOK_ID)
    const tree = validTree()
    const { doc, replaced } = await writeMap(books, BOOK_ID, tree, { agentId: 'agent-2' })
    assert.equal(replaced, true)
    const backup = JSON.parse(await readFile(path.join(dir, 'map.bak.json'), 'utf8'))
    assert.equal(backup.generatedAt, previous.generatedAt)
    assert.equal(backup.stats.nodes, previous.stats.nodes)

    const chapter = doc.root.children[0]
    assert.equal(chapter.id, previous.root.children[0].id, '未变节点的 id 必须稳定')

    // 每个引用都能在 chunks.json 找到，且 quote 是块内子串。
    const all = JSON.parse(await readFile(path.join(dir, 'chunks.json'), 'utf8')).chunks
    const byId = new Map(all.map((chunk) => [chunk.id, chunk]))
    const visit = (node) => {
      for (const citation of node.citations) {
        const chunk = byId.get(citation.chunkId)
        assert.ok(chunk, `未知名 ${citation.chunkId}`)
        if (citation.quote) assert.ok(chunk.text.includes(citation.quote))
      }
      node.children.forEach(visit)
    }
    visit(doc.root)
  })

  it('UT-MAP-08 单节点/子树重生成只替换目标子树', async () => {
    const before = await readMap(books, BOOK_ID)
    const target = before.root.children[0]
    const replacement = {
      title: '第一章（重写）',
      summary: SUMMARY,
      citations: [{ chunkId: 'c-000004', quote: '结论回到开头的假设' }],
      questions: ['改写后第一章讲了什么？'],
      children: [
        {
          title: '新的论点',
          summary: SUMMARY,
          citations: [{ chunkId: 'c-000002', quote: '核心概念的定义' }],
          questions: ['新论点成立吗？'],
        },
      ],
    }
    const { doc } = await writeMap(books, BOOK_ID, replacement, { agentId: 'agent-3' }, { targetNodeId: target.id })
    assert.equal(doc.stats.nodes, 4)
    assert.equal(doc.root.children[0].title, '第一章（重写）')
    assert.notEqual(doc.root.children[0].id, target.id)
    assert.equal(doc.root.children[1].id, before.root.children[1].id, '其它子树必须原样保留')

    await assert.rejects(
      () => writeMap(books, BOOK_ID, replacement, {}, { targetNodeId: 'n-deadbeef' }),
      (error) => error.code === 'E_NOT_FOUND' && error.details.reason === 'no-node',
    )
  })

  it('UT-MAP-09 失败 commit 不改变旧图与 backup（IT-C05 的服务层）', async () => {
    const mapFile = path.join(dir, 'map.json')
    const backupFile = path.join(dir, 'map.bak.json')
    const beforeMap = await hashOf(mapFile)
    const beforeBackup = await hashOf(backupFile)
    const tree = validTree()
    tree.children[0].citations = [{ chunkId: 'c-999999' }]
    await assert.rejects(() => map.commit(BOOK_ID, tree, { agentId: 'agent-x' }), (error) => error.code === 'E_CITATION')
    assert.equal(await hashOf(mapFile), beforeMap)
    assert.equal(await hashOf(backupFile), beforeBackup)
  })

  it('UT-MAP-10 工具信封：outline / chunks / get / commit 与失败重试信息', async () => {
    const services = { map }
    const outline = await executeMapAction({ action: 'outline', bookId: BOOK_ID }, {}, services)
    assert.equal(outline.ok, true)
    assert.equal(outline.data.totalChunks, 4)
    assert.equal(outline.data.chapters.length, 2)
    assert.match(outline.data.chapters[0].chunks[0].preview, /第一章正文/)

    const chunks = await executeMapAction({ action: 'chunks', bookId: BOOK_ID, ids: ['c-000001', 'c-000002'] }, {}, services)
    assert.equal(chunks.ok, true)
    assert.equal(chunks.data.chunks.length, 2)
    assert.ok(chunks.data.chars > 0)

    const got = await executeMapAction({ action: 'get', bookId: BOOK_ID }, {}, services)
    assert.equal(got.ok, true)
    assert.equal(got.data.map.bookId, BOOK_ID)

    const tree = validTree()
    const committed = await executeMapAction(
      { action: 'commit', bookId: BOOK_ID, root: tree },
      { agent: { id: 'agent-9', sessionId: 'sess-9' } },
      services,
    )
    assert.equal(committed.ok, true)
    assert.equal(committed.data.stats.nodes, 4)
    assert.equal(committed.data.replaced, true)

    const bad = deepClone(tree)
    bad.children[0].citations = [{ chunkId: 'c-999999' }]
    const rejected = await executeMapAction({ action: 'commit', bookId: BOOK_ID, root: bad }, {}, services)
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'E_CITATION')
    assert.ok(rejected.rejected.length > 0)

    const lines = renderMapResult({ action: 'commit' }, rejected)
    assert.equal(lines.length, 1)
    assert.ok(lines[0].text.split('\n').length <= 6)
  })

  it('UT-MAP-11 在未生成图的书上 get 返回 E_NOT_FOUND 信封', async () => {
    const otherId = 'bffffffffffff'
    const otherDir = path.join(root, 'reading', 'books', otherId)
    await mkdir(otherDir, { recursive: true })
    const meta = await books.get(BOOK_ID)
    await writeFile(
      path.join(otherDir, 'meta.json'),
      `${JSON.stringify({ ...meta, id: otherId, mapUpdatedAt: null }, null, 2)}\n`,
      'utf8',
    )
    await writeFile(
      path.join(otherDir, 'chunks.json'),
      `${JSON.stringify({ schemaVersion: 1, bookId: otherId, chunks: CHUNKS }, null, 2)}\n`,
      'utf8',
    )
    const result = await executeMapAction({ action: 'get', bookId: otherId }, {}, { map })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'E_NOT_FOUND')
  })

  it('UT-MAP-12 工具入参自校验（框架不替我们校验原始 JSON Schema）', () => {
    assert.equal(checkMapArguments({ action: 'commit', bookId: BOOK_ID, root: {} }), null)
    assert.match(checkMapArguments({ action: 'nope', bookId: BOOK_ID }), /action/)
    assert.match(checkMapArguments({ action: 'get', bookId: 'x' }), /bookId/)
    assert.match(checkMapArguments({ action: 'outline', bookId: BOOK_ID, ids: ['c-000001'] }), /only apply/)
    assert.match(checkMapArguments({ action: 'chunks', bookId: BOOK_ID, ids: ['c-000001'], from: 1 }), /not both/)
    assert.match(checkMapArguments({ action: 'chunks', bookId: BOOK_ID, ids: Array(21).fill('c-000001') }), /max 20/)
    assert.match(checkMapArguments({ action: 'commit', bookId: BOOK_ID, maxNodes: 301 }), /maxNodes/)
    assert.match(checkMapArguments({ action: 'get', bookId: BOOK_ID, extra: 1 }), /unknown field/)
    assert.match(checkMapArguments({ action: 'commit', bookId: BOOK_ID, root: {}, targetNodeId: 'nope' }), /targetNodeId/)

    const args = { action: 'get', bookId: BOOK_ID }
    const definitions = makeToolDefinitions({ map })
    assert.deepEqual(Object.keys(definitions).sort(), [...TOOL_NAMES].sort())
    assert.equal(definitions.reading_map.isConcurrencySafe(args), true)
    assert.equal(definitions.reading_map.isConcurrencySafe({ action: 'commit' }), false)
  })
})

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

function makeTree(count) {
  const root = { id: 'n-root0000', kind: 'book', title: '书', summary: SUMMARY, children: [] }
  let index = 0
  while (countNodes(root) < count) {
    const chapter = {
      id: `n-ch${String(index).padStart(4, '0')}`,
      kind: 'chapter',
      title: `章 ${index}`,
      summary: SUMMARY,
      children: [],
    }
    root.children.push(chapter)
    index += 1
    for (let point = 0; point < 4 && countNodes(root) < count; point += 1) {
      chapter.children.push({
        id: `n-pt${String(index).padStart(4, '0')}${point}`,
        kind: 'point',
        title: `论点 ${index}-${point}`,
        summary: SUMMARY,
      })
    }
  }
  return root
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('layout', () => {
  it('UT-LAYOUT-01 10/50/300 节点都能布局，节点与边齐全', () => {
    for (const count of [10, 50, 300]) {
      const tree = makeTree(count)
      const layout = layoutTree(tree)
      assert.equal(Object.keys(layout.nodes).length, countNodes(tree))
      assert.equal(layout.edges.length, countNodes(tree) - 1)
      assert.ok(layout.width > 0 && layout.height > 0)
    }
  })

  it('UT-LAYOUT-02 确定性：同输入两次结果一致，且不改入参', () => {
    const tree = makeTree(50)
    const snapshot = JSON.stringify(tree)
    const first = layoutTree(tree)
    const second = layoutTree(tree)
    assert.deepEqual(first, second)
    assert.equal(JSON.stringify(tree), snapshot)
  })

  it('UT-LAYOUT-03 一级子节点左右交替，根居中', () => {
    const tree = makeTree(10)
    const layout = layoutTree(tree)
    const rootBox = layout.nodes[tree.id]
    tree.children.forEach((chapter, index) => {
      const box = layout.nodes[chapter.id]
      assert.equal(box.side, index % 2 === 0 ? 'right' : 'left')
      assert.equal(box.depth, 1)
      if (box.side === 'right') assert.ok(box.x >= rootBox.x + rootBox.w)
      else assert.ok(box.x + box.w <= rootBox.x)
    })
  })

  it('UT-LAYOUT-04 任意两节点矩形不重叠，且全部落在画布内', () => {
    for (const count of [10, 50, 300]) {
      const tree = makeTree(count)
      const layout = layoutTree(tree)
      const boxes = Object.entries(layout.nodes)
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          assert.equal(
            overlaps(boxes[i][1], boxes[j][1]),
            false,
            `${boxes[i][0]} 与 ${boxes[j][0]} 重叠（${count} 节点）`,
          )
        }
      }
      for (const [, box] of boxes) {
        assert.ok(box.x >= 0 && box.y >= 0)
        assert.ok(box.x + box.w <= layout.width && box.y + box.h <= layout.height)
      }
    }
  })

  it('UT-LAYOUT-05 垂直间距与内边距符合 03 §7.4；300 节点布局 < 500 ms', () => {
    const tree = makeTree(10)
    const layout = layoutTree(tree)
    assert.equal(treeDepth(tree), 2)
    assert.ok(layout.nodes[tree.id].y >= PADDING)

    // 同一侧的一级节点纵向顺序排布，相邻两块之间至少留 GAP_Y。
    for (const side of ['left', 'right']) {
      const chapters = tree.children
        .filter((chapter) => layout.nodes[chapter.id].side === side)
        .map((chapter) => layout.nodes[chapter.id])
        .sort((a, b) => a.y - b.y)
      for (let index = 1; index < chapters.length; index += 1) {
        assert.ok(chapters[index].y - (chapters[index - 1].y + chapters[index - 1].h) >= GAP_Y)
      }
    }

    const big = makeTree(300)
    const started = Date.now()
    layoutTree(big)
    assert.ok(Date.now() - started < 500)
  })
})