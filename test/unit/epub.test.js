import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'node:test'

import { chunkDocument } from '../../src/host/chunk.js'
import { LIMITS } from '../../src/host/limits.js'
import { detectFormat, parseEpub } from '../../src/host/parse/epub.js'
import { extractText, normalizeText } from '../../src/host/parse/text.js'

const fixtures = path.resolve(import.meta.dirname, '../fixtures')
const read = (name) => readFileSync(path.join(fixtures, name))

describe('EPUB 解析（03 §6.3）', () => {
  it('魔数判定：epub / pdf / 其它', () => {
    assert.equal(detectFormat(read('epub3-mini.epub')), 'epub')
    assert.equal(detectFormat(read('pdf-text-2p.pdf')), 'pdf')
    assert.equal(detectFormat(Buffer.from('hello world')), null)
    assert.equal(detectFormat(Buffer.alloc(0)), null)
  })

  it('EPUB3 nav：元数据、章节顺序与标题', () => {
    const parsed = parseEpub(read('epub3-mini.epub'), { limits: LIMITS })
    assert.equal(parsed.title, 'The Lantern of Small Hours')
    assert.equal(parsed.author, 'Reading Lab Fixtures')
    assert.equal(parsed.language, 'en')
    assert.equal(parsed.format, 'epub')
    assert.equal(parsed.chapters.length, 2)
    assert.deepEqual(
      parsed.chapters.map((chapter) => chapter.title),
      ['The Lantern', 'The Answer'],
    )
    assert.deepEqual(
      parsed.chapters.map((chapter) => chapter.id),
      ['ch-001', 'ch-002'],
    )
    assert.deepEqual(parsed.chapters[0].path, ['The Lantern'])
    for (const chapter of parsed.chapters) {
      assert.ok(chapter.blocks.length > 0, `${chapter.title} 应有正文`)
      assert.ok(chapter.blocks.join('').length > 100, `${chapter.title} 正文过短`)
    }
    assert.deepEqual(parsed.warnings, [])
  })

  it('EPUB2 NCX：退回 navMap 仍得到同样两章', () => {
    const parsed = parseEpub(read('epub2-ncx.epub'), { limits: LIMITS })
    assert.equal(parsed.title, 'The Lantern of Small Hours (NCX)')
    assert.deepEqual(
      parsed.chapters.map((chapter) => chapter.title),
      ['The Lantern', 'The Answer'],
    )
  })

  it('分块后 toc 的 chunkStart/chunkEnd 指向真实块 id', () => {
    const parsed = parseEpub(read('epub3-mini.epub'), { limits: LIMITS })
    const chunked = chunkDocument(parsed, LIMITS)
    assert.equal(chunked.stats.chapters, 2)
    assert.ok(chunked.stats.chunks >= 2)
    assert.equal(chunked.stats.chars, chunked.chunks.reduce((sum, chunk) => sum + chunk.chars, 0))
    assert.equal(chunked.toc.length, 2)
    const ids = new Set(chunked.chunks.map((chunk) => chunk.id))
    for (const entry of chunked.toc) {
      assert.ok(ids.has(entry.chunkStart), entry.chunkStart)
      assert.ok(ids.has(entry.chunkEnd), entry.chunkEnd)
    }
    assert.deepEqual(Object.keys(chunked.chunker).sort(), ['max', 'min', 'target', 'version'])
  })

  it('非 ZIP 内容 → E_FORMAT/not-zip', () => {
    assert.throws(
      () => parseEpub(read('corrupt.pdf'), { limits: LIMITS }),
      (error) => error.code === 'E_FORMAT' && error.details.reason === 'not-zip',
    )
  })

  it('zip-slip 条目 → E_FORMAT/entry-traversal', () => {
    assert.throws(
      () => parseEpub(read('evil-zip.epub'), { limits: LIMITS }),
      (error) => error.code === 'E_FORMAT' && error.details.reason === 'entry-traversal',
    )
  })

  it('压缩炸弹 → E_TOO_LARGE/zip-ratio', () => {
    assert.throws(
      () => parseEpub(read('bomb.epub'), { limits: LIMITS }),
      (error) => error.code === 'E_TOO_LARGE' && error.details.reason === 'zip-ratio',
    )
  })

  it('缺 mimetype 的 ZIP → E_FORMAT/not-epub', () => {
    const zip = makeStoreZip([{ name: 'hello.txt', text: 'hi' }])
    assert.throws(
      () => parseEpub(zip, { limits: LIMITS }),
      (error) => error.code === 'E_FORMAT' && error.details.reason === 'not-epub',
    )
  })
})

describe('XHTML 文本抽取（03 §6.3 第 6 步）', () => {
  it('块级换行、br、图片占位与跳过 script', () => {
    const { blocks } = extractText(`<html><body>
      <h1>Title</h1>
      <p>first&nbsp;para</p>
      <p>second<br/>line</p>
      <script>var x = 1</script>
      <img alt="figure one"/>
      <img/>
    </body></html>`)
    assert.deepEqual(blocks, ['Title', 'first para', 'second\nline\n[图：figure one] [图]'])
    assert.ok(!blocks.join('').includes('var x'), 'script 内容不应进入正文')
  })

  it('NFKC 与控制字符被清理，空白折叠', () => {
    assert.equal(normalizeText('  ＡＢ\u0000   Ｃ\tＤ  '), 'AB C D')
    assert.equal(normalizeText('a\n\n\n\nb'), 'a\n\nb')
  })
})

/** 最小 store-only ZIP 写入（测试专用，不依赖任何库）。 */
export function makeStoreZip(entries) {
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.text, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0, 10)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)

    central.push(Buffer.concat([header, name]))
    chunks.push(Buffer.concat([local, name, data]))
    offset += 30 + name.length + data.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, directory, end])
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}