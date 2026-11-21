/**
 * UT-ASK-01..08（06-test.md §2 FR-11；03 §8.1 上下文规则）。
 *
 * 纯函数：上下文拼装、引用补足、6000 字截断、隐藏标记与回答解析。
 * 注入/回写的时序在 test/integration/ask-route.test.js。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ASK_CONTEXT_MAX_CHARS,
  ASK_MIN_CITATIONS,
  ASK_OVERVIEW_CHAPTERS,
  buildAskPrompt,
  composeAskContext,
  findNodeWithPath,
  readAssistantMessage,
  selectAskChunks,
} from '../../src/host/ask.js'
import { askCharCount } from '../../src/host/ask.js'

const META = { displayName: '测试书', title: '测试书', author: '作者' }

function chunk(seq, chapterId, chapterTitle, text) {
  return {
    id: `c-${String(seq).padStart(6, '0')}`,
    seq,
    chapterId,
    chapterTitle,
    chapterPath: chapterTitle,
    text,
    chars: askCharCount(text),
  }
}

const CHUNKS = [
  chunk(1, 'ch-001', '第一章', '第一章第一段：核心概念的定义。'),
  chunk(2, 'ch-001', '第一章', '第一章第二段：核心概念的边界。'),
  chunk(3, 'ch-001', '第一章', '第一章第三段：一个反例。'),
  chunk(4, 'ch-002', '第二章', '第二章第一段：把概念用在实践里。'),
]

const MAP = {
  schemaVersion: 1,
  bookId: 'b0123456789ab',
  root: {
    id: 'n-root',
    kind: 'book',
    title: '测试书',
    summary: '这是一本讲核心概念的书。'.repeat(3),
    citations: [],
    questions: ['核心概念是什么？'],
    children: [
      {
        id: 'n-ch1',
        kind: 'chapter',
        title: '第一章',
        summary: '第一章交代了核心概念的定义与边界。'.repeat(3),
        citations: [{ chunkId: 'c-000001' }],
        questions: ['为什么要先定义？'],
        children: [
          {
            id: 'n-point',
            kind: 'point',
            title: '核心概念',
            summary: '核心概念是全书的地基，后面所有论证都建立在它上面。'.repeat(2),
            citations: [{ chunkId: 'c-000002' }],
            questions: ['这个概念为什么重要？', '有没有反例？'],
            children: [],
          },
        ],
      },
    ],
  },
}

describe('ask 上下文拼装（UT-ASK）', () => {
  it('UT-ASK-01 findNodeWithPath 返回节点与祖先标题路径；未知 id 返回 null', () => {
    const found = findNodeWithPath(MAP.root, 'n-point')
    assert.ok(found)
    assert.equal(found.node.title, '核心概念')
    assert.deepEqual(found.path, ['测试书', '第一章', '核心概念'])
    assert.equal(findNodeWithPath(MAP.root, 'n-missing'), null)
  })

  it('UT-ASK-02 选中节点：含书名、章节路径、摘要与带 id 的原文块', () => {
    const result = composeAskContext({ meta: META, map: MAP, chunks: CHUNKS, nodeId: 'n-point' })
    assert.match(result.context, /书名《测试书》/)
    assert.match(result.context, /章节路径：第一章 > 核心概念/)
    assert.match(result.context, /选中节点摘要：核心概念是全书的地基/)
    assert.match(result.context, /相关原文：/)
    assert.match(result.context, /\[c-000002\]/)
    assert.equal(result.nodeTitle, '核心概念')
    assert.equal(result.truncated, false)
    assert.ok(result.contextChars > 0 && result.contextChars <= ASK_CONTEXT_MAX_CHARS)
  })

  it('UT-ASK-03 引用不足 3 条时用同章邻近块补足，且不超过 5 条', () => {
    const node = MAP.root.children[0].children[0]
    const picked = selectAskChunks(node, CHUNKS)
    assert.equal(picked.length, ASK_MIN_CITATIONS)
    assert.deepEqual(picked.map((item) => item.id), ['c-000002', 'c-000001', 'c-000003'])

    const rich = {
      ...node,
      citations: CHUNKS.map((item) => ({ chunkId: item.id })),
    }
    assert.equal(selectAskChunks(rich, CHUNKS).length, 5 > CHUNKS.length ? CHUNKS.length : 5)
  })

  it('UT-ASK-04 超长上下文按码点截断到 6000 以内并标「已截断」', () => {
    const huge = [1, 2, 3, 4].map((seq) => chunk(seq, 'ch-001', '第一章', '长'.repeat(4000)))
    const node = { ...MAP.root.children[0].children[0], citations: huge.map((item) => ({ chunkId: item.id })) }
    const map = { ...MAP, root: { ...MAP.root, children: [{ ...MAP.root.children[0], children: [node] }] } }
    const result = composeAskContext({ meta: META, map, chunks: huge, nodeId: 'n-point' })
    assert.equal(result.truncated, true)
    assert.ok(result.contextChars <= ASK_CONTEXT_MAX_CHARS, `contextChars=${result.contextChars}`)
    assert.match(result.context, /…（已截断）/)
  })

  it('UT-ASK-05 未知 nodeId 报 E_BAD_REQUEST/unknown-node；节点无引用块报 no-citation', () => {
    assert.throws(
      () => composeAskContext({ meta: META, map: MAP, chunks: CHUNKS, nodeId: 'n-missing' }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.reason === 'unknown-node',
    )
    const orphan = { ...MAP.root.children[0].children[0], citations: [{ chunkId: 'c-999999' }] }
    const map = { ...MAP, root: { ...MAP.root, children: [{ ...MAP.root.children[0], children: [orphan] }] } }
    assert.throws(
      () => composeAskContext({ meta: META, map, chunks: CHUNKS, nodeId: 'n-point' }),
      (error) => error.code === 'E_BAD_REQUEST' && error.details.reason === 'no-citation',
    )
  })

  it('UT-ASK-06 无选中节点时给全书概览：根摘要 + 每章首块，最多 12 章', () => {
    const many = []
    for (let index = 1; index <= 14; index += 1) {
      many.push(chunk(index, `ch-${String(index).padStart(3, '0')}`, `第${index}章`, `第${index}章正文。`))
    }
    const result = composeAskContext({ meta: META, map: MAP, chunks: many, nodeId: null })
    assert.match(result.context, /全书概览：/)
    assert.match(result.context, /第1章：第1章正文/)
    assert.match(result.context, /…（已截断）/)
    const previewLines = result.context.split('\n').filter((line) => /^第\d+章：/.test(line))
    assert.equal(previewLines.length, ASK_OVERVIEW_CHAPTERS)
    assert.deepEqual(result.citations, [])
  })

  it('UT-ASK-07 注入文本首行是隐藏关联标记，并带引用格式与「只基于给定内容」要求', () => {
    const prompt = buildAskPrompt({
      threadId: 't-01',
      messageId: 'm-02',
      title: '测试书',
      context: '上下文正文',
      question: '这张卡片是什么意思？',
    })
    const lines = prompt.split('\n')
    assert.equal(lines[0], '<!-- reading-lab thread=t-01 message=m-02 -->')
    assert.match(prompt, /请只基于这些内容回答/)
    assert.match(prompt, /我的问题：这张卡片是什么意思？/)
    assert.match(prompt, /\[c-000123\]/)
    assert.match(prompt, /用中文/)
  })

  it('UT-ASK-08 readAssistantMessage 兼容 data.message / payload，拼接所有 text block', () => {
    const withMessage = readAssistantMessage({
      type: 'assistant/message',
      data: { message: { id: 'msg-1', content: [{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }] } },
    })
    assert.equal(withMessage.messageId, 'msg-1')
    assert.equal(withMessage.text, '第一段\n第二段')

    const withPayload = readAssistantMessage({
      type: 'assistant/message',
      payload: { id: 'msg-2', content: [{ type: 'tool_use', id: 'x' }, { type: 'text', text: '  答案  ' }] },
    })
    assert.equal(withPayload.messageId, 'msg-2')
    assert.equal(withPayload.text, '答案')

    assert.deepEqual(readAssistantMessage({ type: 'agent/status' }), { text: '', messageId: null })
  })
})