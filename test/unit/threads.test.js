/**
 * UT-THREAD-01..08（06-test.md §2 FR-11；03 §5.6 threads.json 契约）。
 *
 * 真 fs（临时目录）+ 真 BookService，不启 HTTP：只验证落盘形状、id 规则、
 * 状态机、反馈与重启降级。注入与回写走 ask.test.js / 集成测试。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { BookService } from '../../src/host/books.js'
import { LIMITS } from '../../src/host/limits.js'
import {
  FEEDBACK_VALUES,
  appendMessage,
  citationsFromText,
  createThread,
  downgradeThreads,
  findThreadByNode,
  readThreads,
  removeThread,
  sanitizeCitations,
  setFeedback,
  setThreadState,
  stopThread,
  threadsFile,
  updateMessage,
} from '../../src/host/threads.js'

const BOOK_ID = 'b0123456789ab'
const NODE_ID = 'n-1a2b3c4d'

async function seedBook(root) {
  const dir = path.join(root, 'reading', 'books', BOOK_ID)
  await mkdir(dir, { recursive: true })
  const now = '2026-01-01T00:00:00.000Z'
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
    stats: { chapters: 1, chunks: 2, chars: 40, pages: null },
    toc: [{ id: 'ch-001', title: '第一章', level: 1, chunkStart: 1, chunkEnd: 2 }],
    createdAt: now,
    updatedAt: now,
    mapUpdatedAt: null,
    notesUpdatedAt: null,
    threadsUpdatedAt: null,
  }
  await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

describe('threads.json 存储（UT-THREAD）', () => {
  let root
  /** @type {BookService} */
  let books
  let events
  let dir

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'rl-threads-'))
    await seedBook(root)
    events = []
    books = new BookService({ root, limits: LIMITS, storage: { available: true } })
    books.hub = {
      publish(event) {
        events.push(event)
      },
    }
    dir = path.join(root, 'reading', 'books', BOOK_ID)
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('UT-THREAD-01 空书返回空结构，不是 404；线程 id 从 t-01 递增', async () => {
    const empty = await readThreads(books, BOOK_ID)
    assert.equal(empty.schemaVersion, 1)
    assert.equal(empty.bookId, BOOK_ID)
    assert.deepEqual(empty.threads, [])

    const first = await createThread(books, BOOK_ID, { kind: 'node', nodeId: NODE_ID, nodeTitle: '核心概念' })
    const second = await createThread(books, BOOK_ID, { kind: 'book' })
    assert.equal(first.id, 't-01')
    assert.equal(first.scope.kind, 'node')
    assert.equal(first.scope.nodeTitle, '核心概念')
    assert.equal(second.id, 't-02')
    assert.deepEqual(second.scope, { kind: 'book' })

    const file = await readThreads(books, BOOK_ID)
    assert.equal(file.threads.length, 2)
    assert.equal(findThreadByNode(file, NODE_ID).id, 't-01')
    assert.equal(findThreadByNode(file, 'n-ffffffff'), null)
  })

  it('UT-THREAD-02 消息 id 递增，user 默认 pending、assistant 默认 done，feedback 为 null', async () => {
    const file = await readThreads(books, BOOK_ID)
    const threadId = findThreadByNode(file, NODE_ID).id
    const user = await appendMessage(books, BOOK_ID, threadId, { role: 'user', text: '这张卡片在说什么？' })
    assert.equal(user.message.id, 'm-01')
    assert.equal(user.message.status, 'pending')
    assert.equal(user.message.feedback, null)
    assert.deepEqual(user.message.citations, [])

    const assistant = await appendMessage(books, BOOK_ID, threadId, {
      role: 'assistant',
      text: '它在讲核心概念。见 [c-000001]。',
      citations: [{ chunkId: 'c-000001' }, { chunkId: 'c-000001' }],
    })
    assert.equal(assistant.message.id, 'm-02')
    assert.equal(assistant.message.status, 'done')
    assert.deepEqual(assistant.message.citations, [{ chunkId: 'c-000001' }])

    // 落盘顺序与字段齐全（03 §5.6）
    const raw = JSON.parse(await readFile(threadsFile(books, BOOK_ID), 'utf8'))
    const thread = raw.threads.find((item) => item.id === threadId)
    assert.ok(thread)
    for (const key of ['id', 'scope', 'createdAt', 'updatedAt', 'state', 'messages']) {
      assert.ok(key in thread, `thread 缺字段 ${key}`)
    }
    assert.equal(raw.schemaVersion, 1)
    assert.ok(raw.updatedAt)
    assert.ok(events.some((event) => event.type === 'thread' && event.threadId === threadId))
  })

  it('UT-THREAD-03 长度与角色校验：空问题、超 2000 字、未知角色都报 E_BAD_REQUEST', async () => {
    const file = await readThreads(books, BOOK_ID)
    const threadId = file.threads[0].id
    await assert.rejects(
      () => appendMessage(books, BOOK_ID, threadId, { role: 'user', text: '   ' }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.field === 'text',
    )
    await assert.rejects(
      () => appendMessage(books, BOOK_ID, threadId, { role: 'user', text: 'x'.repeat(2001) }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.reason === 'length',
    )
    await assert.rejects(
      () => appendMessage(books, BOOK_ID, threadId, { role: 'system', text: 'hello' }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.field === 'role',
    )
  })

  it('UT-THREAD-04 updateMessage 白名单：未知状态被拒，合法 patch 生效', async () => {
    const file = await readThreads(books, BOOK_ID)
    const threadId = file.threads[0].id
    const message = file.threads[0].messages[0]
    await assert.rejects(
      () => updateMessage(books, BOOK_ID, threadId, message.id, { status: 'streaming-ish' }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.field === 'status',
    )
    const updated = await updateMessage(books, BOOK_ID, threadId, message.id, {
      status: 'streaming',
      messageId: 'msg-abc',
    })
    assert.equal(updated.message.status, 'streaming')
    assert.equal(updated.message.messageId, 'msg-abc')
  })

  it('UT-THREAD-05 stopThread 把未完成消息标 stopped、线程回 idle，重复调用幂等', async () => {
    const file = await readThreads(books, BOOK_ID)
    const threadId = file.threads[0].id
    await setThreadState(books, BOOK_ID, threadId, 'running')
    const stopped = await stopThread(books, BOOK_ID, threadId)
    assert.equal(stopped.state, 'idle')
    assert.ok(stopped.messages.every((message) => message.status !== 'streaming' && message.status !== 'pending'))
    const again = await stopThread(books, BOOK_ID, threadId)
    assert.equal(again.state, 'idle')
  })

  it('UT-THREAD-06 反馈 up/down/null 往返；非法值被拒', async () => {
    const file = await readThreads(books, BOOK_ID)
    const threadId = file.threads[0].id
    const assistant = file.threads[0].messages.find((message) => message.role === 'assistant')
    assert.deepEqual(FEEDBACK_VALUES, ['up', 'down'])

    const up = await setFeedback(books, BOOK_ID, threadId, assistant.id, 'up')
    assert.equal(up.message.feedback, 'up')
    const down = await setFeedback(books, BOOK_ID, threadId, assistant.id, 'down')
    assert.equal(down.message.feedback, 'down')
    const cleared = await setFeedback(books, BOOK_ID, threadId, assistant.id, null)
    assert.equal(cleared.message.feedback, null)

    await assert.rejects(
      () => setFeedback(books, BOOK_ID, threadId, assistant.id, 'meh'),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.field === 'feedback',
    )
    // 消息不存在 → 404（不静默成功）
    await assert.rejects(
      () => setFeedback(books, BOOK_ID, threadId, 'm-99', 'up'),
      (error) => error.code === 'E_NOT_FOUND' && error.details.reason === 'message',
    )
  })

  it('UT-THREAD-07 运行中的线程不能删除；删除后 id 不回收', async () => {
    const file = await readThreads(books, BOOK_ID)
    const threadId = file.threads[0].id
    await setThreadState(books, BOOK_ID, threadId, 'running')
    await assert.rejects(
      () => removeThread(books, BOOK_ID, threadId),
      (error) => error.code === 'E_BUSY' && error.details.threadId === threadId,
    )
    await setThreadState(books, BOOK_ID, threadId, 'idle')
    assert.deepEqual(await removeThread(books, BOOK_ID, threadId), { deleted: true })

    const next = await createThread(books, BOOK_ID, { kind: 'book' })
    assert.equal(next.id, 't-03')
    const after = await readThreads(books, BOOK_ID)
    assert.ok(!after.threads.some((item) => item.id === threadId))
  })

  it('UT-THREAD-08 重启降级：running→idle，pending/streaming→stopped，文件不改以外的字段', () => {
    const file = {
      schemaVersion: 1,
      bookId: BOOK_ID,
      updatedAt: '2026-01-01T00:00:00.000Z',
      threads: [
        {
          id: 't-09',
          scope: { kind: 'book' },
          state: 'running',
          messages: [
            { id: 'm-01', role: 'user', text: 'q', status: 'pending' },
            { id: 'm-02', role: 'assistant', text: 'a', status: 'streaming' },
            { id: 'm-03', role: 'assistant', text: 'b', status: 'done' },
          ],
        },
      ],
    }
    const { file: next, changed } = downgradeThreads(file)
    assert.equal(changed, true)
    assert.equal(next.threads[0].state, 'idle')
    assert.deepEqual(
      next.threads[0].messages.map((message) => message.status),
      ['stopped', 'stopped', 'done'],
    )
    // 二次降级是幂等的（不再 changed）
    assert.equal(downgradeThreads(next).changed, false)
  })

  it('UT-THREAD-09 引用净化：只留合法 chunkId，回答文本里的未知引用被丢弃', async () => {
    const allowed = new Set(['c-000001', 'c-000002'])
    assert.deepEqual(
      sanitizeCitations([{ chunkId: 'c-000001' }, { chunkId: 'c-999999' }, { chunkId: 'c-000001' }], allowed),
      [{ chunkId: 'c-000001' }],
    )
    assert.deepEqual(
      citationsFromText('见 [c-000001] 与 [c-000002]，还有 [c-777777]。', allowed),
      [{ chunkId: 'c-000001' }, { chunkId: 'c-000002' }],
    )
    // 没有合法集合时保留全部（写入方负责给 allowed）
    assert.equal(citationsFromText('[c-000123]').length, 1)
  })
})