/**
 * 研究笔记的渲染/解析/校验（03 §5.5）。
 *
 * 这些是纯函数测试：不碰磁盘，只断言「写出去的 markdown 能被自己读回来」，
 * 以及四类必然失败的输入各自给出哪个错误码——工具面把错误码翻成可执行的修法。
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  CITATION_EXAMPLE,
  EMPTY_SECTION_TEXT,
  NOTES_MAX_BYTES,
  SECTION_TITLES,
  chunkIdToCitation,
  citationToChunkId,
  parseNotesMarkdown,
  renderNotesMarkdown,
  validateNotes,
} from '../../src/host/notes.js'

const BOOK_ID = 'b3f9a1c07d2e'

function makeMarkdown(overrides = {}) {
  return renderNotesMarkdown({
    bookId: BOOK_ID,
    title: '测试书',
    generatedAt: '2026-01-02T03:04:05.000Z',
    sections: SECTION_TITLES.map((title) => ({
      title,
      body: overrides[title] ?? `这一节讲 ${title} [[c:000001]]`,
    })),
  })
}

describe('notes.md 渲染与解析', () => {
  it('首行是单行 JSON 注释，标题与五节顺序固定', () => {
    const markdown = makeMarkdown()
    const lines = markdown.split('\n')
    assert.match(lines[0], /^<!-- reading-lab:notes \{"schemaVersion":1,"bookId":"b3f9a1c07d2e","generatedAt":"[^"]+"\} -->$/)
    assert.equal(lines[1], '# 测试书 · 研究笔记')
    const headings = lines.filter((line) => line.startsWith('## '))
    assert.deepEqual(
      headings.map((line) => line.slice(3)),
      SECTION_TITLES,
    )
    const parsed = parseNotesMarkdown(markdown)
    assert.equal(parsed.meta.bookId, BOOK_ID)
    assert.equal(parsed.title, '测试书')
    assert.deepEqual(
      parsed.sections.map((section) => section.title),
      SECTION_TITLES,
    )
  })

  it('空节渲染成固定文案，能被校验识别为「空」', () => {
    const markdown = renderNotesMarkdown({
      bookId: BOOK_ID,
      title: '测试书',
      sections: [{ title: '主题脉络', body: '' }],
    })
    assert.match(markdown, new RegExp(`## 主题脉络\\n\\n${EMPTY_SECTION_TEXT}`))
    const parsed = parseNotesMarkdown(markdown)
    assert.equal(parsed.sections.find((section) => section.title === '主题脉络').body, EMPTY_SECTION_TEXT)
  })

  it('缺首行 meta / 缺某一节 / 版本不符都解析失败', () => {
    assert.throws(() => parseNotesMarkdown('# 没有 meta\n'), (error) => error.code === 'E_SCHEMA' && error.details.reason === 'notes-meta-missing')
    const withoutSection = makeMarkdown().replace('## 阅读建议', '## 其他')
    assert.throws(() => parseNotesMarkdown(withoutSection), (error) => error.details.reason === 'notes-section-missing')
    const wrongVersion = makeMarkdown().replace('"schemaVersion":1', '"schemaVersion":2')
    assert.throws(() => parseNotesMarkdown(wrongVersion), (error) => error.details.reason === 'notes-schema-version')
  })

  it('引用语法与 chunkId 互转', () => {
    assert.equal(citationToChunkId('[[c:000012]]'), 'c-000012')
    assert.equal(chunkIdToCitation('c-000012'), '[[c:000012]]')
    assert.equal(CITATION_EXAMPLE, '[[c:000003]]')
  })
})

describe('notes.md 写入校验', () => {
  const chunkIds = ['c-000001', 'c-000002']

  it('正常笔记：返回引用清单（去重）', () => {
    const markdown = makeMarkdown({
      主题脉络: '脉络一 [[c:000001]]，脉络二 [[c:000002]]',
      核心论点: '论点 [[c:000001]]',
    })
    const result = validateNotes(markdown, { bookId: BOOK_ID, chunkIds })
    assert.equal(result.sections.length, 5)
    assert.deepEqual(result.citations.sort(), ['c-000001', 'c-000002'])
    assert.equal(result.filled, 5, '每个非空节都有引用，全部计入')
  })

  it('引用不存在的块 → E_CITATION{reason:"unknown-chunk"}', () => {
    const markdown = makeMarkdown({ 核心论点: '引用了不存在的块 [[c:000009]]' })
    assert.throws(
      () => validateNotes(markdown, { bookId: BOOK_ID, chunkIds }),
      (error) => error.code === 'E_CITATION' && error.details.reason === 'unknown-chunk' && error.details.chunkId === 'c-000009',
    )
  })

  it('有内容但零引用 → E_CITATION{reason:"section-without-citation"}', () => {
    const markdown = makeMarkdown({ 阅读建议: '先读第一章，再读第二章。' })
    assert.throws(
      () => validateNotes(markdown, { bookId: BOOK_ID, chunkIds }),
      (error) => error.code === 'E_CITATION' && error.details.reason === 'section-without-citation' && error.details.section === '阅读建议',
    )
  })

  it('五节全空 → E_SCHEMA{reason:"notes-all-empty"}', () => {
    const markdown = renderNotesMarkdown({ bookId: BOOK_ID, title: '测试书', sections: [] })
    assert.throws(
      () => validateNotes(markdown, { bookId: BOOK_ID, chunkIds }),
      (error) => error.code === 'E_SCHEMA' && error.details.reason === 'notes-all-empty',
    )
  })

  it('bookId 不一致 → E_SCHEMA{reason:"notes-book-mismatch"}', () => {
    const markdown = makeMarkdown()
    assert.throws(
      () => validateNotes(markdown, { bookId: 'b00000000000', chunkIds }),
      (error) => error.code === 'E_SCHEMA' && error.details.reason === 'notes-book-mismatch',
    )
  })

  it('超过 200KB → E_TOO_LARGE', () => {
    const huge = makeMarkdown({ 核心论点: `${'字'.repeat(NOTES_MAX_BYTES)} [[c:000001]]` })
    assert.throws(
      () => validateNotes(huge, { bookId: BOOK_ID, chunkIds }),
      (error) => error.code === 'E_TOO_LARGE' && error.details.reason === 'notes',
    )
  })
})