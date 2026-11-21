/**
 * UT-ASK-WB-01..06（QA-40-01 / 03 §8.3 回写）。
 *
 * 真 fs + 真 BookService + 真 AskService，不启 HTTP。重点验证回写顺序语义：
 * 「认领（不消费）→ 写成功状态 → 释放」，任何异常都必须把线程落到 failed/idle，
 * 不允许永久 `running`。
 */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

import { AskService } from '../../src/host/ask.js'
import { BookService } from '../../src/host/books.js'
import { LIMITS } from '../../src/host/limits.js'
import { appendMessage, createThread, readThreads, setThreadState, stopThread } from '../../src/host/threads.js'

const BOOK_ID = 'b0123456789ab'
const NOW = '2026-03-01T00:00:00.000Z'

async function seedBook(root) {
  const dir = path.join(root, 'reading', 'books', BOOK_ID)
  await mkdir(dir, { recursive: true })
  const meta = {
    schemaVersion: 1,
    id: BOOK_ID,
    title: '回写测试书',
    displayName: '回写测试书',
    author: '作者',
    language: 'zh',
    format: 'epub',
    source: { file: 'source.epub', bytes: 1024, sha256: '0'.repeat(64), importedAt: NOW },
    status: 'ready',
    statusDetail: null,
    progress: { phase: 'done', done: 1, total: 1, updatedAt: NOW },
    stats: { chapters: 1, chunks: 2, chars: 64, pages: null },
    toc: [{ id: 'ch-001', title: '第一章', level: 1, chunkStart: 1, chunkEnd: 2 }],
    createdAt: NOW,
    updatedAt: NOW,
    mapUpdatedAt: null,
    notesUpdatedAt: null,
    threadsUpdatedAt: null,
  }
  await writeFile(path.join(dir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  const chunks = {
    schemaVersion: 1,
    bookId: BOOK_ID,
    chunker: { version: 1, target: 1000, max: 2000, min: 100 },
    chunks: [
      {
        id: 'c-000001',
        seq: 1,
        chapterId: 'ch-001',
        chapterTitle: '第一章',
        chapterPath: ['第一章'],
        page: null,
        text: '记忆不是录像，而是每次重写的现场。',
        chars: 19,
        startOffset: 0,
        endOffset: 19,
      },
      {
        id: 'c-000002',
        seq: 2,
        chapterId: 'ch-001',
        chapterTitle: '第一章',
        chapterPath: ['第一章'],
        page: null,
        text: '灯火照亮的是当下，不是过去。',
        chars: 15,
        startOffset: 19,
        endOffset: 34,
      },
    ],
  }
  await writeFile(path.join(dir, 'chunks.json'), `${JSON.stringify(chunks, null, 2)}\n`, 'utf8')
}

function assistantEvent(messageId, text) {
  return {
    type: 'assistant/message',
    data: { message: { id: messageId, role: 'assistant', content: [{ type: 'text', text }] } },
  }
}

describe('ask 回写（QA-40-01）', () => {
  let root
  /** @type {BookService} */
  let books
  /** @type {AskService} */
  let ask
  let warnings
  let events

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'rl-ask-wb-'))
    await seedBook(root)
  })

  after(async () => {
    await rm(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    warnings = []
    events = []
    books = new BookService({ root, limits: LIMITS, storage: { available: true } })
    books.hub = { publish: (event) => events.push(event) }
    ask = new AskService({
      books,
      hub: books.hub,
      logger: {
        info: () => {},
        warn: (line) => warnings.push(String(line)),
      },
    })
  })

  /** 造一个 running 线程 + 一条 pending 用户消息，并在 AskService 里登记待回写。 */
  async function startPending(agentId = 'agent-1') {
    const thread = await createThread(books, BOOK_ID, { kind: 'book' })
    const appended = await appendMessage(books, BOOK_ID, thread.id, {
      role: 'user',
      text: '记忆是怎么被保存的？',
      status: 'pending',
    })
    await setThreadState(books, BOOK_ID, thread.id, 'running')
    const record = ask.track({
      agentId,
      bookId: BOOK_ID,
      threadId: thread.id,
      messageId: appended.message.id,
    })
    return { thread, message: appended.message, record }
  }

  async function threadOf(threadId) {
    const file = await readThreads(books, BOOK_ID)
    return file.threads.find((item) => item.id === threadId) ?? null
  }

  it('UT-ASK-WB-01 回写成功：追加 assistant 消息、线程 idle、待回写表清空', async () => {
    const { thread, message } = await startPending()
    await ask.handleSessionEvent('session-1', assistantEvent('msg-1', '记忆是每次重写的现场 [c-000001]。'))

    const after1 = await threadOf(thread.id)
    assert.equal(after1.state, 'idle')
    assert.equal(after1.messages.length, 2)
    const answer = after1.messages[1]
    assert.equal(answer.role, 'assistant')
    assert.equal(answer.status, 'done')
    assert.equal(answer.messageId, 'msg-1')
    assert.deepEqual(answer.citations, [{ chunkId: 'c-000001' }])
    assert.equal(ask.pending.size, 0)
    assert.equal(message.status, 'pending')
  })

  it('UT-ASK-WB-02 回写抛错：线程落到 failed + idle，error 可见，不留 running（故障注入）', async () => {
    const { thread, message } = await startPending()
    // 注入真实的写入期故障：读 chunks 抛错（磁盘不可读 / 文件损坏的等价物）。
    // 必须打在同一个 BookService 实例上——readThreads 的「每本书只降级一次」是
    // 按实例记录的，换一个实例会让正在 running 的线程被误降级成 stopped。
    const original = books.readChunks.bind(books)
    books.readChunks = async () => {
      throw new Error('injected: chunks unreadable')
    }
    try {
      await ask.handleSessionEvent('session-1', assistantEvent('msg-2', '答案 [c-000001]'))
    } finally {
      books.readChunks = original
    }

    const after1 = await threadOf(thread.id)
    assert.equal(after1.state, 'idle', '线程必须回到 idle，不能永久 running')
    const failed = after1.messages.find((item) => item.id === message.id)
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error, 'E_AGENT')
    // 没有追加不完整的回答
    assert.equal(after1.messages.length, 1)
    assert.equal(ask.pending.size, 0, '失败也要释放待回写记录')
    assert.ok(
      warnings.some((line) => line.includes('ask writeback failed')),
      `应有 warn 日志，实际：${JSON.stringify(warnings)}`,
    )
    const published = events.filter((event) => event.type === 'thread' && event.failed)
    assert.equal(published.length, 1)
    assert.equal(published[0].reason, 'writeback')
    assert.match(published[0].message, /回答写入失败/)
  })

  it('UT-ASK-WB-03 同一 messageId 的并发事件只写一条回答（幂等）', async () => {
    const { thread } = await startPending()
    const event = assistantEvent('msg-3', '只应出现一次 [c-000002]')
    await Promise.all([ask.handleSessionEvent('session-1', event), ask.handleSessionEvent('session-1', event)])

    const after1 = await threadOf(thread.id)
    assert.equal(after1.state, 'idle')
    const answers = after1.messages.filter((item) => item.role === 'assistant')
    assert.equal(answers.length, 1, '并发回写不能互相覆盖或重复追加')
    assert.equal(answers[0].messageId, 'msg-3')
    assert.equal(ask.pending.size, 0)
  })

  it('UT-ASK-WB-04 claimPending 只标记不消费；已认领记录仍能被超时看门狗收尾', async () => {
    ask.timeoutMs = 60
    const { thread, message } = await startPending()
    const claimed = ask.claimPending('agent-1')
    assert.ok(claimed, '应能认领到记录')
    assert.equal(claimed.inFlight, true)
    assert.equal(ask.pending.size, 1, '认领后记录仍在表里')
    assert.equal(ask.claimPending('agent-1'), null, 'in-flight 记录不会被重复认领')

    // 模拟回写卡死（不 release），等看门狗自己收尾。
    const record = ask.pending.get('agent-1')[0]
    await ask.failPending(record, 'timeout')

    const after1 = await threadOf(thread.id)
    assert.equal(after1.state, 'idle')
    const failed = after1.messages.find((item) => item.id === message.id)
    assert.equal(failed.status, 'failed')
    assert.equal(ask.pending.size, 0)
  })

  it('UT-ASK-WB-05 stop 之后到达的回答被忽略，线程保持 idle 且不追加消息', async () => {
    const { thread } = await startPending()
    await stopThread(books, BOOK_ID, thread.id)
    await ask.handleSessionEvent('session-1', assistantEvent('msg-4', '迟到的回答 [c-000001]'))

    const after1 = await threadOf(thread.id)
    assert.equal(after1.state, 'idle')
    assert.equal(after1.messages.length, 1, '停止后不应再写入回答')
    assert.equal(ask.pending.size, 0)
  })

  it('UT-ASK-WB-06 问题消息丢失时也把线程放回 idle，不留 running', async () => {
    const thread = await createThread(books, BOOK_ID, { kind: 'book' })
    await setThreadState(books, BOOK_ID, thread.id, 'running')
    // 记录指向一个不存在的消息 id：极端情况（文件被手改/回滚）。
    ask.track({ agentId: 'agent-1', bookId: BOOK_ID, threadId: thread.id, messageId: 'm-99' })

    await ask.handleSessionEvent('session-1', assistantEvent('msg-5', '孤儿回答 [c-000001]'))

    const after1 = await threadOf(thread.id)
    assert.equal(after1.state, 'idle')
    assert.equal(after1.messages.length, 0)
    assert.equal(ask.pending.size, 0)
  })
})