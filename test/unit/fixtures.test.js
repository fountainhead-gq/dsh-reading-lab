import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findEntry, readZipEntries } from '../support/zip.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DIR = join(ROOT, 'test', 'fixtures')
const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))

const load = (name) => readFileSync(join(DIR, name))
const entriesOf = (name) => readZipEntries(load(name))

test('CT-FIX-01 manifest 覆盖全部夹具且哈希/体积一致', () => {
  assert.equal(manifest.generator, 'scripts/gen-fixtures.mjs')
  assert.ok(manifest.fixtures.length >= 6, '夹具数量不足')
  const listed = new Set(manifest.fixtures.map((f) => f.name))
  for (const expected of ['epub3-mini.epub', 'epub2-ncx.epub', 'pdf-text-2p.pdf', 'pdf-zh-2p.pdf', 'pdf-text-10p.pdf', 'pdf-scanned-5p.pdf', 'corrupt.pdf', 'evil-zip.epub', 'bomb.epub']) {
    assert.ok(listed.has(expected), `manifest 缺少 ${expected}`)
  }
  for (const fixture of manifest.fixtures) {
    assert.ok(existsSync(join(DIR, fixture.name)), `缺少文件 ${fixture.name}`)
    const data = load(fixture.name)
    assert.equal(data.length, fixture.bytes, `${fixture.name} 体积变化`)
    assert.equal(createHash('sha256').update(data).digest('hex'), fixture.sha256, `${fixture.name} 哈希变化`)
    assert.ok(fixture.purpose.length > 0, `${fixture.name} 缺少用途说明`)
  }
})

test('CT-FIX-02 EPUB3 夹具结构：mimetype 首条且 store、nav + 2 章', () => {
  const entries = entriesOf('epub3-mini.epub')
  assert.equal(entries[0].name, 'mimetype')
  assert.equal(entries[0].method, 0, 'mimetype 必须 store（不压缩）')
  assert.equal(entries[0].read().toString('utf8'), 'application/epub+zip')

  const container = findEntry(entries, 'META-INF/container.xml').read().toString('utf8')
  assert.match(container, /full-path="OEBPS\/content\.opf"/)

  const opf = findEntry(entries, 'OEBPS/content.opf').read().toString('utf8')
  assert.match(opf, /version="3\.0"/)
  assert.match(opf, /<dc:title>The Lantern of Small Hours<\/dc:title>/)
  assert.match(opf, /properties="nav"/)

  const names = entries.map((e) => e.name)
  assert.ok(names.includes('OEBPS/ch1.xhtml'))
  assert.ok(names.includes('OEBPS/ch2.xhtml'))
  assert.ok(names.includes('OEBPS/nav.xhtml'))
  assert.ok(!names.includes('OEBPS/toc.ncx'), 'EPUB3 夹具不应含 NCX')
})

test('CT-FIX-03 EPUB2 夹具结构：NCX 且无 nav', () => {
  const entries = entriesOf('epub2-ncx.epub')
  const names = entries.map((e) => e.name)
  assert.ok(names.includes('OEBPS/toc.ncx'))
  assert.ok(!names.includes('OEBPS/nav.xhtml'), 'EPUB2 夹具不应含 nav')

  const opf = findEntry(entries, 'OEBPS/content.opf').read().toString('utf8')
  assert.match(opf, /version="2\.0"/)
  assert.match(opf, /<spine toc="ncx">/)

  const ncx = findEntry(entries, 'OEBPS/toc.ncx').read().toString('utf8')
  assert.equal((ncx.match(/<navPoint /g) ?? []).length, 2)
})

test('CT-FIX-04 恶意 ZIP 夹具保留越界路径（供解析器拒绝）', () => {
  const names = entriesOf('evil-zip.epub').map((e) => e.name)
  assert.ok(names.includes('../evil.txt'), '缺少 ../evil.txt')
  assert.ok(names.includes('OEBPS/../../evil2.txt'), '缺少嵌套越界条目')
  assert.ok(names.every((n) => !n.startsWith('/')), '夹具不应含绝对路径（由其他用例构造）')
})

test('CT-FIX-05 压缩炸弹夹具压缩比 > 100', () => {
  const entries = entriesOf('bomb.epub')
  const bomb = findEntry(entries, 'OEBPS/bomb.txt')
  assert.equal(bomb.uncompressedSize, 8 * 1024 * 1024)
  assert.ok(bomb.uncompressedSize / bomb.compressedSize > 100, `压缩比过低：${bomb.uncompressedSize}/${bomb.compressedSize}`)
  assert.ok(load('bomb.epub').length < 50 * 1024, '炸弹夹具体积应 < 50 KB')
})

test('CT-FIX-06 文本 PDF 夹具：2 页、含文本操作符、元数据可读', () => {
  const pdf = load('pdf-text-2p.pdf').toString('latin1')
  assert.match(pdf, /^%PDF-1\.4/)
  assert.match(pdf, /%%EOF\s*$/)
  assert.match(pdf, /\/Title \(Reading Lab Text Fixture - 2 pages\)/)
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2)
  assert.match(pdf, /\/Count 2\b/)
  assert.ok((pdf.match(/ Tj/g) ?? []).length >= 10, '文本操作符过少')
})

test('CT-FIX-07 扫描版 PDF 夹具：5 页且无文本操作符', () => {
  const pdf = load('pdf-scanned-5p.pdf').toString('latin1')
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 5)
  assert.match(pdf, /\/Count 5\b/)
  assert.ok(!/\bTj\b/.test(pdf), '扫描版夹具不应含 Tj')
})

test('CT-FIX-08 损坏 PDF 夹具：缺少 /Root，解析器应报 E_PARSE', () => {
  const pdf = load('corrupt.pdf').toString('latin1')
  assert.match(pdf, /^%PDF-1\.7/)
  assert.match(pdf, /startxref/)
  assert.ok(!pdf.includes('/Root'), '损坏夹具不应含有效 /Root')
})

test('CT-FIX-11 10 页英文 PDF：页数、页脚与跨页正文齐全', () => {
  const pdf = load('pdf-text-10p.pdf').toString('latin1')
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 10)
  assert.match(pdf, /\/Count 10\b/)
  assert.match(pdf, /\/Title \(Reading Lab Text Fixture - 10 pages\)/)
  assert.match(pdf, /\(Page 10 of 10 - dsh-reading-lab fixture\) Tj/)
  assert.match(pdf, /segment 60/)
  assert.ok((pdf.match(/ Tj/g) ?? []).length >= 60, '跨页正文行数不足')
})

test('CT-FIX-09 夹具可确定性重建（scripts/gen-fixtures.mjs --check）', () => {
  const script = join(ROOT, 'scripts', 'gen-fixtures.mjs')
  const output = execFileSync(process.execPath, [script, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.match(output, /fixtures:check 通过/)
})

test('CT-FIX-10 中文 PDF 夹具：2 页、CID 字体 + ToUnicode 映射', () => {
  const pdf = load('pdf-zh-2p.pdf').toString('latin1')
  assert.match(pdf, /^%PDF-1\.4/)
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 2)
  assert.match(pdf, /\/Subtype \/CIDFontType0/)
  assert.match(pdf, /\/Encoding \/Identity-H/)
  assert.match(pdf, /\/ToUnicode \d+ 0 R/)
  assert.match(pdf, /beginbfchar/)
  assert.match(pdf, /<0001> <9605>/, '首个码位应映射到「阅」')
  // 页面内容使用 2 字节 Identity-H 编码，文本操作符数为 6+6（正文 5 行 + 页码 1 行）。
  assert.equal((pdf.match(/ Tj/g) ?? []).length, 12)
})