import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { charCount, chunkDocument, splitLongParagraph } from '../../src/host/chunk.js'
import { LIMITS } from '../../src/host/limits.js'

const longText = (length, fill = 'a') => fill.repeat(length)
const chapter = (id, blocks) => ({ id, title: `Chapter ${id}`, level: 1, path: [`Chapter ${id}`], blocks })

describe('超长段落切分（03 §6.5）', () => {
  it('不超过硬上限时原样返回', () => {
    assert.deepEqual(splitLongParagraph('short', 10), ['short'])
  })

  it('优先按句末标点切，单段不超过硬上限', () => {
    const sentence = '这是一个句子。'
    const text = sentence.repeat(400) // 2400 码点
    const pieces = splitLongParagraph(text, 1000)
    assert.ok(pieces.length >= 3)
    for (const piece of pieces) {
      assert.ok(charCount(piece) <= 1000, `长度 ${charCount(piece)} 超限`)
    }
    assert.equal(pieces.join(''), text, '切分不丢字')
    assert.ok(pieces[0].endsWith('。'), '优先在句末切')
  })

  it('没有标点的超长文本按码点硬切，不产生空片', () => {
    const pieces = splitLongParagraph(longText(2500), 1000)
    assert.deepEqual(pieces.map((piece) => piece.length), [1000, 1000, 500])
  })
})

describe('章节分块（03 §6.5）', () => {
  it('块不超过硬上限，且块内不跨章节', () => {
    const document = {
      chapters: [
        chapter('ch-001', [longText(1200, '甲'), longText(1200, '乙')]),
        chapter('ch-002', [longText(300, '丙')]),
      ],
    }
    const result = chunkDocument(document, LIMITS)
    assert.equal(result.stats.chapters, 2)
    for (const chunk of result.chunks) {
      assert.ok(chunk.chars <= LIMITS.chunkHardMax, `${chunk.id} 超硬上限`)
      assert.ok(chunk.chars >= LIMITS.chunkMinChars || chunk.chapterId === 'ch-002')
    }
    const byChapter = new Map()
    for (const chunk of result.chunks) {
      byChapter.set(chunk.chapterId, (byChapter.get(chunk.chapterId) ?? 0) + 1)
    }
    assert.equal(byChapter.get('ch-001'), 2)
    assert.equal(byChapter.get('ch-002'), 1)
  })

  it('块 id / seq 连续，toc 指向首末块', () => {
    const document = { chapters: [chapter('ch-001', [longText(1500)]), chapter('ch-002', [longText(1500)])] }
    const result = chunkDocument(document, LIMITS)
    assert.deepEqual(
      result.chunks.map((chunk) => chunk.id),
      result.chunks.map((chunk, index) => `c-${String(index + 1).padStart(6, '0')}`),
    )
    assert.deepEqual(
      result.chunks.map((chunk) => chunk.seq),
      result.chunks.map((chunk, index) => index + 1),
    )
    assert.equal(result.toc[0].chunkStart, result.chunks[0].id)
    assert.equal(result.toc[1].chunkEnd, result.chunks[result.chunks.length - 1].id)
  })

  it('章节尾部不足下限时并入上一块', () => {
    const document = { chapters: [chapter('ch-001', [longText(1000, '甲'), longText(20, '乙')])] }
    const result = chunkDocument(document, LIMITS)
    assert.equal(result.chunks.length, 1)
    assert.ok(result.chunks[0].text.endsWith('乙'.repeat(20)))
    assert.equal(result.chunks[0].chars, charCount(result.chunks[0].text))
  })

  it('偏移量是章节文本内的码点偏移，且随块递增', () => {
    const document = { chapters: [chapter('ch-001', [longText(900, '甲'), longText(900, '乙')])] }
    const result = chunkDocument(document, LIMITS)
    let previousEnd = -1
    for (const chunk of result.chunks) {
      assert.ok(chunk.startOffset > previousEnd, `${chunk.id} startOffset 应递增`)
      assert.equal(chunk.endOffset, chunk.startOffset + chunk.chars)
      previousEnd = chunk.endOffset
    }
  })

  it('同样的输入得到逐字节相同的块（确定性）', () => {
    const build = () => ({ chapters: [chapter('ch-001', [longText(700, '甲'), longText(700, '乙')])] })
    assert.deepEqual(chunkDocument(build(), LIMITS), chunkDocument(build(), LIMITS))
  })

  it('块数或总字符超限时抛 E_TOO_LARGE，不静默截断', () => {
    const document = { chapters: [chapter('ch-001', [longText(1500)]), chapter('ch-002', [longText(1500)])] }
    assert.throws(
      () => chunkDocument(document, { ...LIMITS, maxChunks: 1 }),
      (error) => error.code === 'E_TOO_LARGE' && error.details.reason === 'chunks',
    )
    assert.throws(
      () => chunkDocument(document, { ...LIMITS, maxEpubChars: 10 }),
      (error) => error.code === 'E_TOO_LARGE' && error.details.reason === 'chars',
    )
  })

  it('chunker 字段与 03 §5.3 一致', () => {
    const result = chunkDocument({ chapters: [chapter('ch-001', [longText(1500)])] }, LIMITS)
    assert.deepEqual(result.chunker, { version: 1, target: 1000, max: 2000, min: 100 })
    assert.equal(result.stats.pages, null)
    assert.equal(result.stats.chars, result.chunks.reduce((sum, chunk) => sum + chunk.chars, 0))
  })
})