/**
 * PDF 解析（03 §6.4 / §6.6）。
 *
 * 夹具是 `scripts/gen-fixtures.mjs` 生成的最小 PDF：无压缩流、WinAnsi 英文与
 * Identity-H + ToUnicode 中文；扫描版只有一块灰色矩形，没有任何文本算子。
 * 这里断言「页 → 行 → 段」的可见结果，避免把实现细节写进测试。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it } from 'node:test'

import {
  decodeWithFont,
  effectiveChars,
  extractTextItems,
  groupItemsIntoLines,
  linesToParagraphs,
  parsePdf,
  parseToUnicode,
  samplePageIndexes,
  validatePdfContainer,
} from '../../src/host/parse/pdf.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const readFixture = (name) => readFile(path.join(fixtures, name))

describe('PDF 分页文本抽取', () => {
  it('英文两页：元数据、页数、页码定位符', async () => {
    const doc = parsePdf(await readFixture('pdf-text-2p.pdf'))
    assert.equal(doc.format, 'pdf')
    assert.equal(doc.pages, 2)
    assert.equal(doc.title, 'Reading Lab Text Fixture - 2 pages')
    assert.equal(doc.author, 'Reading Lab Fixtures')
    assert.equal(doc.chapters.length, 1)
    assert.equal(doc.chapters[0].title, '第 1–2 页')
    const pages = new Set(doc.chapters[0].blocks.map((block) => block.page))
    assert.deepEqual([...pages].sort((a, b) => a - b), [1, 2])
    const text = doc.chapters[0].blocks.map((block) => block.text).join('\n')
    assert.match(text, /Reading Lab Fixture/)
    assert.match(text, /Page 1 of 2 - dsh-reading-lab fixture/)
    assert.match(text, /Page 2 of 2 - dsh-reading-lab fixture/)
  })

  it('十页：每 20 页一节的分节规则', async () => {
    const doc = parsePdf(await readFixture('pdf-text-10p.pdf'))
    assert.equal(doc.pages, 10)
    assert.deepEqual(
      doc.chapters.map((chapter) => chapter.title),
      ['第 1–10 页'],
    )
    assert.equal(doc.chapters[0].pageStart, 1)
    assert.equal(doc.chapters[0].pageEnd, 10)
  })

  it('中文 Identity-H：ToUnicode 解码后是中文而不是乱码', async () => {
    const doc = parsePdf(await readFixture('pdf-zh-2p.pdf'))
    assert.equal(doc.pages, 2)
    const text = doc.chapters.flatMap((chapter) => chapter.blocks.map((block) => block.text)).join('\n')
    assert.match(text, /阅读实验室中文夹具/)
    assert.match(text, /第 1 页/)
    assert.match(text, /第 2 页/)
    // 抽取结果里不应出现替换字符（说明码位没有被 ToUnicode 覆盖）。
    assert.doesNotMatch(text, /\uFFFD/)
  })

  it('扫描版：采样页几乎没有有效字符 → E_SCANNED', async () => {
    await assert.rejects(
      async () => parsePdf(await readFixture('pdf-scanned-5p.pdf')),
      (error) => error.code === 'E_SCANNED' && error.details.pages === 5,
    )
  })

  it('损坏文件：没有页树 → E_PARSE', async () => {
    await assert.rejects(
      async () => parsePdf(await readFixture('corrupt.pdf')),
      (error) => error.code === 'E_PARSE',
    )
  })

  it('容器级校验：非 PDF 魔数 → E_FORMAT', async () => {
    assert.throws(() => validatePdfContainer(Buffer.from('hello')), (error) => error.code === 'E_FORMAT' && error.details.reason === 'not-pdf')
    const pdf = await readFixture('pdf-text-2p.pdf')
    assert.doesNotThrow(() => validatePdfContainer(pdf))
  })
})

describe('PDF 文本工具的纯函数边界', () => {
  it('采样页号：不足三页全取，否则首页/中间/末页', () => {
    assert.deepEqual(samplePageIndexes(1), [1])
    assert.deepEqual(samplePageIndexes(2), [1, 2])
    assert.deepEqual(samplePageIndexes(3), [1, 2, 3])
    assert.deepEqual(samplePageIndexes(5), [1, 2, 5])
    assert.deepEqual(samplePageIndexes(10), [1, 5, 10])
  })

  it('有效字符只统计非空白、非标点', () => {
    assert.equal(effectiveChars('   '), 0)
    assert.equal(effectiveChars('，。！'), 0)
    assert.equal(effectiveChars('a, b.'), 2)
  })

  it('ToUnicode：bfchar 与 bfrange', () => {
    const charMap = parseToUnicode('beginbfchar\n<0003> <4E2D>\nendbfchar')
    assert.equal(charMap.get('0003'), '中')
    const rangeMap = parseToUnicode('beginbfrange\n<0010> <0012> <0041>\nendbfrange')
    assert.equal(rangeMap.get('0010'), 'A')
    assert.equal(rangeMap.get('0012'), 'C')
  })

  it('两字节字体：未映射码位落成替换字符，不是静默丢弃', () => {
    const font = { twoByte: true, map: new Map([['0001', '书']]) }
    assert.equal(decodeWithFont('\u0000\u0001\u0000\u0002', font), '书\uFFFD')
  })

  it('同 y 的文本项合并成一行，行内按 x 排序；CJK 之间不加空格', () => {
    const items = [
      { text: 'world', x: 40, y: 700, size: 12, width: 30 },
      { text: 'hello', x: 10, y: 700.4, size: 12, width: 25 },
      { text: '第二', x: 40, y: 680, size: 12, width: 24 },
      { text: '第一', x: 10, y: 680, size: 12, width: 24 },
    ]
    const lines = groupItemsIntoLines(items)
    assert.equal(lines[0].text, 'hello world')
    assert.equal(lines[1].text, '第一第二')
  })

  it('行距超过 1.8 倍中位行距 → 分段', () => {
    const lines = [
      { text: 'one', y: 700, size: 12 },
      { text: 'two', y: 684, size: 12 },
      { text: 'three', y: 668, size: 12 },
      { text: 'next paragraph', y: 600, size: 12 },
    ]
    assert.deepEqual(linesToParagraphs(lines), ['one two three', 'next paragraph'])
  })

  it('行尾连字符与下一行小写开头时去连字符', () => {
    assert.deepEqual(linesToParagraphs([{ text: 'inter-', y: 700, size: 12 }, { text: 'national', y: 684, size: 12 }]), ['international'])
  })

  it('文本算子：Tf/Td/TJ/T* 与字距调整', () => {
    const content = 'BT /F1 10 Tf 12 TL 72 700 Td (Hello) Tj T* (World) Tj ET'
    const items = extractTextItems(content, new Map())
    assert.deepEqual(
      items.map((item) => item.text),
      ['Hello', 'World'],
    )
    assert.ok(items[1].y < items[0].y, 'T* 必须下移一行')
  })
})