/**
 * UT-TUTOR-01..08（06 §2；07 §2 / M5-07，t20）。
 *
 * 只碰 host 层：真 fs（临时目录）+ 真 BookService / MapService，ask 用桩替身记录调用，
 * 不起 HTTP。覆盖：路径生成顺序与兜底问法、首次自动建路径、重启递增 pathId 并清空掌握、
 * 标记校验与游标、导图重生成后迁移掌握状态、提问委托 ask 并回写步骤。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { BookService } from '../../src/host/books.js'
import { LIMITS } from '../../src/host/limits.js'
import { MapService, writeMap } from '../../src/host/map.js'
import {
  MAX_STEPS,
  TUTOR_STEP_STATES,
  TutorService,
  buildSteps,
  emptyTutor,
  mergeSteps,
  readTutor,
  tutorFile,
} from '../../src/host/tutor.js'

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
    chars: Array.from(text).length,
    startOffset: 0,
    endOffset: Array.from(text).length,
  }
}

const CHUNKS = [
  textChunk(1, 'ch-001', '第一章', '第一章正文第一段。这里讨论核心概念。'),
  textChunk(2, 'ch-001', '第一章', '第一章正文第二段。核心概念的定义是这样的。'),
  textChunk(3, 'ch-002', '第二章', '第二章正文第一段。作者给出了反例。'),
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
  return dir
}

/** 三层树：书 → 两章（第一章带一个论点）。 */
function validTree(overrides = {}) {
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
        ...(overrides.first ?? {}),
      },
      {
        title: '第二章',
        summary: SUMMARY,
        citations: [{ chunkId: 'c-000003', quote: '第二章正文第一段' }],
        questions: ['第二章讲了什么？'],
        ...(overrides.second ?? {}),
      },
    ],
  }
}

function makeAskStub() {
  const calls = []
  return {
    calls,
    async ask(input) {
      calls.push(input)
      return {
        threadId: input.threadId ?? 't-01',
        messageId: `m-${String(calls.length).padStart(2, '0')}`,
        agentId: input.agentId ?? 'agent-stub',
        contextChars: 100,
        truncated: false,
      }
    },
  }
}

describe('tutor service', () => {
  /** @type {string} */
  let root
  /** @type {string} */
  let dir
  /** @type {BookService} */
  let books
  /** @type {MapService} */
  let map
  /** @type {ReturnType<typeof makeAskStub>} */
  let ask
  /** @type {TutorService} */
  let tutor

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'rl-tutor-'))
    dir = await seedBook(root)
    books = new BookService({ root, limits: LIMITS, storage: { available: true } })
    map = new MapService({ books, hub: null, limits: LIMITS })
    ask = makeAskStub()
    tutor = new TutorService({ books, map, ask, hub: null, limits: LIMITS })
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('UT-TUTOR-01 buildSteps 先序、跳过根卡、优先节点自带追问', () => {
    const rootNode = {
      id: 'n-root',
      kind: 'book',
      title: '测试书',
      summary: SUMMARY,
      citations: [],
      questions: ['整本书讲什么？'],
      children: [
        {
          id: 'n-ch1',
          title: '第一章',
          summary: SUMMARY,
          citations: [{ chunkId: 'c-000001' }],
          questions: ['第一章讲了什么？'],
          children: [
            { id: 'n-ch1-p1', title: '核心概念', summary: SUMMARY, citations: [{ chunkId: 'c-000002' }] },
          ],
        },
        { id: 'n-ch2', title: '第二章', summary: SUMMARY, citations: ['c-000003'] },
      ],
    }
    const steps = buildSteps(rootNode, { goal: 'quiz' })
    assert.deepEqual(
      steps.map((step) => step.title),
      ['第一章', '核心概念', '第二章'],
    )
    assert.deepEqual(
      steps.map((step) => step.id),
      ['s-01', 's-02', 's-03'],
    )
    assert.equal(steps[0].question, '第一章讲了什么？')
    // 节点没有 questions 时按 goal 生成兜底问法
    assert.equal(steps[1].question, '不看原文，回答：这一节「核心概念」讲了什么？')
    assert.deepEqual(steps[2].citations, ['c-000003'])
    assert.equal(steps[0].depth, 1)
    assert.equal(steps[1].depth, 2)
    assert.equal(steps[0].hint, SUMMARY)
  })

  it('UT-TUTOR-02 buildSteps 遵守 maxSteps 与三种 goal 的兜底问法', () => {
    const leaf = (index) => ({
      id: `n-${index}`,
      title: `节点 ${index}`,
      summary: SUMMARY,
      citations: [{ chunkId: 'c-000001' }],
    })
    const rootNode = {
      id: 'n-root',
      title: '书',
      summary: SUMMARY,
      citations: [],
      children: Array.from({ length: 5 }, (_, index) => leaf(index + 1)),
    }
    assert.equal(buildSteps(rootNode).length, 5)
    assert.equal(buildSteps(rootNode, { maxSteps: 2 }).length, 2)
    assert.equal(buildSteps(rootNode, { maxSteps: 999 }).length, Math.min(5, MAX_STEPS))
    assert.match(buildSteps(rootNode, { goal: 'explain' })[0].question, /^请用自己的话解释/)
    assert.match(buildSteps(rootNode, { goal: 'socratic' })[0].question, /可能会怎么说/)
  })

  it('UT-TUTOR-03 mergeSteps 按 nodeId 迁移，restart 时清空', () => {
    const steps = [
      { id: 's-01', nodeId: 'n-1', title: 'A', question: 'q', citations: [] },
      { id: 's-02', nodeId: 'n-2', title: 'B', question: 'q', citations: [] },
    ]
    const previous = {
      ...emptyTutor(BOOK_ID),
      steps: [
        { ...steps[0], state: 'mastered', attempts: 2, threadId: 't-01', messageId: 'm-01' },
        { ...steps[1], state: 'skipped' },
      ],
    }
    const merged = mergeSteps(previous, steps, {})
    assert.equal(merged[0].state, 'mastered')
    assert.equal(merged[0].attempts, 2)
    assert.equal(merged[0].threadId, 't-01')
    assert.equal(merged[1].state, 'skipped')
    const fresh = mergeSteps(previous, steps, { restart: true })
    assert.equal(fresh[0].state, 'pending')
    assert.equal(fresh[0].attempts, 0)
    assert.equal(fresh[0].threadId, null)
  })

  it('UT-TUTOR-04 首次 get 自动建路径并落盘', async () => {
    assert.equal(await readTutor(books, BOOK_ID), null)
    await writeMap(books, BOOK_ID, validTree(), { agentId: 'a1', sessionId: 's1' })
    const first = await tutor.get(BOOK_ID)
    assert.equal(first.rebuilt, true)
    assert.equal(first.pathId, 'p-01')
    assert.equal(first.goal, 'explain')
    assert.equal(first.steps.length, 3)
    assert.equal(first.progress.total, 3)
    assert.equal(first.currentStepId, 's-01')
    assert.deepEqual(
      first.steps.map((step) => step.state),
      ['pending', 'pending', 'pending'],
    )
    const stored = await readTutor(books, BOOK_ID)
    assert.equal(stored.pathId, 'p-01')
    assert.equal(stored.mapUpdatedAt, (await map.get(BOOK_ID)).map.generatedAt)
    const raw = JSON.parse(await readFile(tutorFile(books, BOOK_ID), 'utf8'))
    assert.equal(raw.schemaVersion, 1)
    assert.equal(raw.bookId, BOOK_ID)

    const second = await tutor.get(BOOK_ID)
    assert.equal(second.rebuilt, false)
    assert.equal(second.pathId, 'p-01')
  })

  it('UT-TUTOR-05 mark 推进游标、校验状态与未知步骤', async () => {
    const marked = await tutor.mark(BOOK_ID, 's-01', 'mastered')
    assert.equal(marked.step.state, 'mastered')
    assert.equal(marked.cursor, 1)
    assert.equal(marked.progress.mastered, 1)
    assert.equal(marked.progress.percent, 33)

    await tutor.mark(BOOK_ID, 's-02', 'skipped')
    const skipped = await tutor.mark(BOOK_ID, 's-03', 'pending')
    assert.equal(skipped.cursor, 2)
    assert.equal(skipped.progress.done, 2)

    await assert.rejects(
      () => tutor.mark(BOOK_ID, 's-01', 'unknown'),
      (error) => {
        assert.equal(error.code, 'E_BAD_REQUEST')
        assert.deepEqual(error.details.allowed, [...TUTOR_STEP_STATES])
        return true
      },
    )
    await assert.rejects(
      () => tutor.mark(BOOK_ID, 's-99', 'mastered'),
      (error) => {
        assert.equal(error.code, 'E_NOT_FOUND')
        assert.equal(error.details.reason, 'step')
        return true
      },
    )
  })

  it('UT-TUTOR-06 restart 递增 pathId、清空掌握状态并可换 goal', async () => {
    const restarted = await tutor.restart(BOOK_ID, { goal: 'quiz' })
    assert.equal(restarted.pathId, 'p-02')
    assert.equal(restarted.goal, 'quiz')
    assert.equal(restarted.cursor, 0)
    assert.deepEqual(
      restarted.steps.map((step) => step.state),
      ['pending', 'pending', 'pending'],
    )
    assert.match(restarted.steps[0].question, /第一章讲了什么/)
    // 节点自带追问优先于 goal 兜底问法；没有 questions 的节点才用兜底
    assert.equal(restarted.steps.every((step) => step.question.length > 0), true)
    await assert.rejects(
      () => tutor.restart(BOOK_ID, { goal: 'coach' }),
      (error) => {
        assert.equal(error.code, 'E_BAD_REQUEST')
        return true
      },
    )
  })

  it('UT-TUTOR-07 导图重生成后重建路径并迁移掌握状态', async () => {
    await tutor.mark(BOOK_ID, 's-03', 'mastered')
    const before = await tutor.get(BOOK_ID)
    const masteredNodeId = before.steps[2].nodeId
    // 同一棵树重新 commit：nodeId 稳定，但 generatedAt 变化
    await writeMap(books, BOOK_ID, validTree(), { agentId: 'a2', sessionId: 's2' })
    const after = await tutor.get(BOOK_ID)
    assert.equal(after.rebuilt, true)
    assert.ok(Number(after.pathId.slice(2)) > Number(before.pathId.slice(2)))
    const migrated = after.steps.find((step) => step.nodeId === masteredNodeId)
    assert.equal(migrated.state, 'mastered')
    // 标题变化 → 新 nodeId → 状态不迁移，回到 pending
    const renamed = validTree({ second: { title: '第二章（改写）' } })
    await writeMap(books, BOOK_ID, renamed, { agentId: 'a3', sessionId: 's3' })
    const renamedPath = await tutor.get(BOOK_ID)
    const lastStep = renamedPath.steps[2]
    assert.equal(lastStep.title, '第二章（改写）')
    assert.equal(lastStep.state, 'pending')
  })

  it('UT-TUTOR-08 answer 委托 ask，首次带 nodeId，之后复用线程并记录次数', async () => {
    const file = await readTutor(books, BOOK_ID)
    const step = file.steps[0]
    const first = await tutor.answer(BOOK_ID, {
      stepId: 's-01',
      question: '为什么核心概念重要？',
      agentId: 'agent-1',
      idempotencyKey: 'k-1',
    })
    assert.equal(ask.calls.length, 1)
    assert.equal(ask.calls[0].nodeId, step.nodeId)
    assert.equal(ask.calls[0].threadId, null)
    assert.equal(ask.calls[0].agentId, 'agent-1')
    assert.equal(first.threadId, 't-01')
    assert.equal(first.step.attempts, 1)
    assert.equal(first.step.state, 'answered')
    assert.equal(first.step.threadId, 't-01')

    const second = await tutor.answer(BOOK_ID, { stepId: 's-01', question: '再问一次' })
    assert.equal(ask.calls.length, 2)
    assert.equal(ask.calls[1].threadId, 't-01')
    assert.equal(ask.calls[1].nodeId, null)
    assert.equal(second.step.attempts, 2)

    await assert.rejects(
      () => tutor.answer(BOOK_ID, { stepId: 's-01', question: '   ' }),
      (error) => {
        assert.equal(error.code, 'E_BAD_REQUEST')
        assert.equal(error.details.field, 'question')
        return true
      },
    )
    await assert.rejects(
      () => tutor.answer(BOOK_ID, { stepId: 's-98', question: '问题' }),
      (error) => {
        assert.equal(error.code, 'E_NOT_FOUND')
        assert.equal(error.details.reason, 'step')
        return true
      },
    )
  })

  it('UT-TUTOR-09 无导图时报 no-map；无路径文件时 mark 报 no-path', async () => {
    const emptyRoot = await mkdtemp(path.join(tmpdir(), 'rl-tutor-empty-'))
    try {
      const emptyBooks = new BookService({
        root: emptyRoot,
        limits: LIMITS,
        storage: { available: true },
      })
      const emptyMap = new MapService({ books: emptyBooks, hub: null, limits: LIMITS })
      const service = new TutorService({ books: emptyBooks, map: emptyMap, ask })
      await assert.rejects(
        () => service.get(BOOK_ID),
        (error) => {
          assert.equal(error.code, 'E_NOT_FOUND')
          return true
        },
      )
    } finally {
      await rm(emptyRoot, { recursive: true, force: true })
    }

    // 有导图但没有 tutor.json → mark 报 no-path
    await unlink(tutorFile(books, BOOK_ID)).catch(() => {})
    await assert.rejects(
      () => tutor.mark(BOOK_ID, 's-01', 'mastered'),
      (error) => {
        assert.equal(error.code, 'E_NOT_FOUND')
        assert.equal(error.details.reason, 'no-path')
        return true
      },
    )
  })
})