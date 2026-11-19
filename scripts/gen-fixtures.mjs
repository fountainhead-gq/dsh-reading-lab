#!/usr/bin/env node
/**
 * 生成测试夹具（零依赖、确定性）。
 *
 *   node scripts/gen-fixtures.mjs            写入 test/fixtures/
 *   node scripts/gen-fixtures.mjs --check    只校验：重新生成并与磁盘逐字节比对
 *   node scripts/gen-fixtures.mjs --out DIR  写入指定目录（仍校验 manifest）
 *   node scripts/gen-fixtures.mjs --large    额外生成大文件到 test/fixtures/.generated/
 *
 * 所有夹具由本脚本合成，正文为原创英文示例，不含第三方版权内容。
 * 固定 ZIP 时间戳与对象顺序，因此同一 Node 版本的输出哈希稳定；manifest.json 记录哈希。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEFAULT_OUT = join(ROOT, 'test', 'fixtures')

// ---------------------------------------------------------------- ZIP (store/deflate)

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// 固定 DOS 时间：2020-01-01 00:00:00，保证可重复构建。
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1
const DOS_TIME = 0

function zip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const stored = entry.store === true
    const body = stored ? data : deflateRawSync(data, { level: 9 })
    const method = stored ? 0 : 8
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 name
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x0014, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)

    offset += local.length + name.length + body.length
  }

  const centralBuf = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralBuf, eocd])
}

// ---------------------------------------------------------------- EPUB

const CHAPTERS = [
  {
    id: 'ch1',
    title: 'The Lantern',
    href: 'ch1.xhtml',
    paragraphs: [
      'The lantern hung above the door for three nights before anyone spoke of it. Mara had found it in the attic, wrapped in a cloth that smelled of cedar, and she had carried it down without telling her brother.',
      'It was not a beautiful object. The glass was uneven, the brass was scratched, and the handle had been mended with wire. Yet when the wind rose, the flame inside leaned toward the street and did not go out.',
      'On the first night, a neighbor stopped to ask whether the house was for sale. On the second, a letter arrived with no stamp. On the third, Mara understood that the lantern was not a light but an invitation, and that invitations are only useful if someone is willing to answer.',
    ],
  },
  {
    id: 'ch2',
    title: 'The Answer',
    href: 'ch2.xhtml',
    paragraphs: [
      'The letter contained a single sentence: "We will come when the river is low." Mara read it aloud twice, once for herself and once for the empty kitchen, and then she put it in the drawer with the mismatched spoons.',
      'Her brother returned at dusk with mud on his boots and news of the bridge. The river had fallen faster than anyone expected, leaving a shelf of stones where the crossing used to be. He said the water sounded different, thinner, like a conversation running out of things to say.',
      'They lit the lantern together. The flame steadied. Somewhere beyond the fields, a bell rang once, and Mara knew that the answer had already begun to arrive, in the way that answers do, long before anyone recognizes them.',
    ],
  },
]

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

const CSS = `body { font-family: serif; line-height: 1.6; margin: 2em; }
h1 { font-size: 1.4em; }
p { margin: 0 0 1em; }
`

function xhtml(title, paragraphs) {
  const body = paragraphs.map((p) => `    <p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head>
    <meta charset="UTF-8"/>
    <title>${title}</title>
    <link rel="stylesheet" type="text/css" href="style.css"/>
  </head>
  <body>
    <h1>${title}</h1>
${body}
  </body>
</html>
`
}

function navXhtml() {
  const items = CHAPTERS.map((c) => `        <li><a href="${c.href}">${c.title}</a></li>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
  <head><meta charset="UTF-8"/><title>Contents</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`
}

function epub3() {
  const manifest = CHAPTERS.map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('\n')
  const spine = CHAPTERS.map((c) => `    <itemref idref="${c.id}"/>`).join('\n')
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:8f1d3f2e-6a4b-4c1e-9a77-0d2d6f3c1a10</dc:identifier>
    <dc:title>The Lantern of Small Hours</dc:title>
    <dc:creator>Reading Lab Fixtures</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Local fixtures</dc:publisher>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${manifest}
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/nav.xhtml', data: navXhtml() },
    ...CHAPTERS.map((c) => ({ name: `OEBPS/${c.href}`, data: xhtml(c.title, c.paragraphs) })),
    { name: 'OEBPS/style.css', data: CSS },
  ])
}

function epub2() {
  const manifest = CHAPTERS.map((c) => `    <item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join('\n')
  const spine = CHAPTERS.map((c) => `    <itemref idref="${c.id}"/>`).join('\n')
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:1b7c0d6e-2f53-4a8e-8c11-5a9e2f6b7c20</dc:identifier>
    <dc:title>The Lantern of Small Hours (NCX)</dc:title>
    <dc:creator>Reading Lab Fixtures</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${manifest}
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
</package>
`
  const navPoints = CHAPTERS.map((c, i) => `    <navPoint id="navPoint-${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${c.title}</text></navLabel>
      <content src="${c.href}"/>
    </navPoint>`).join('\n')
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="urn:uuid:1b7c0d6e-2f53-4a8e-8c11-5a9e2f6b7c20"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>The Lantern of Small Hours (NCX)</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: opf },
    { name: 'OEBPS/toc.ncx', data: ncx },
    ...CHAPTERS.map((c) => ({ name: `OEBPS/${c.href}`, data: xhtml(c.title, c.paragraphs) })),
    { name: 'OEBPS/style.css', data: CSS },
  ])
}

function evilZip() {
  // 结构上可被识别为 EPUB，但含 zip-slip 路径；解析器必须拒绝越界条目。
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:evil-fixture</dc:identifier>
    <dc:title>Evil Zip Fixture</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest><item id="ch1" href="../evil.txt" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>
`
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: opf },
    { name: '../evil.txt', data: 'zip-slip payload\n' },
    { name: 'OEBPS/../../evil2.txt', data: 'zip-slip payload 2\n' },
  ])
}

function bombEpub() {
  // 8 MB 零字节压缩到几 KB；用于压缩比上限与解压内存保护。
  const bomb = Buffer.alloc(8 * 1024 * 1024, 0x41)
  return zip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:bomb-fixture</dc:identifier>
    <dc:title>Bomb Fixture</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2020-01-01T00:00:00Z</meta>
  </metadata>
  <manifest><item id="b" href="bomb.txt" media-type="text/plain"/></manifest>
  <spine/>
</package>
` },
    { name: 'OEBPS/bomb.txt', data: bomb },
  ])
}

// ---------------------------------------------------------------- PDF

function pdfEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function pdf({ pageCount, title, author, lines, scanned = false }) {
  const fontNum = 3 + 2 * pageCount
  const infoNum = fontNum + 1
  const bodies = new Array(infoNum + 1)

  const kids = []
  for (let i = 0; i < pageCount; i += 1) {
    const pageNum = 3 + i
    const contentNum = 3 + pageCount + i
    kids.push(`${pageNum} 0 R`)

    let stream
    if (scanned) {
      stream = 'q\n0.9 0.9 0.9 rg\n40 40 515 760 re f\nQ\n'
    } else {
      const pageLines = lines.slice(i * 6, i * 6 + 6)
      const textOps = pageLines
        .map((line, idx) => `${idx === 0 ? '72 760 Td' : 'T*'} (${pdfEscape(line)}) Tj`)
        .join('\n')
      stream = `BT\n/F1 11 Tf\n16 TL\n${textOps}\nET\nBT\n/F1 9 Tf\n72 60 Td\n(${pdfEscape(`Page ${i + 1} of ${pageCount} - dsh-reading-lab fixture`)}) Tj\nET\n`
    }

    bodies[pageNum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`
    bodies[contentNum] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`
  }

  bodies[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  bodies[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`
  bodies[fontNum] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  bodies[infoNum] = `<< /Title (${pdfEscape(title)}) /Author (${pdfEscape(author)}) /Producer (dsh-reading-lab fixtures) /CreationDate (D:20200101000000Z) >>`

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = new Array(infoNum + 1).fill(0)
  for (let i = 1; i <= infoNum; i += 1) {
    offsets[i] = Buffer.byteLength(out, 'latin1')
    out += `${i} 0 obj\n${bodies[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${infoNum + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= infoNum; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${infoNum + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

function textPdf(pageCount) {
  const lines = [
    'Reading Lab Fixture',
    'This synthetic document exists to exercise the text-PDF path.',
    'It contains deterministic, royalty-free prose and a stable layout.',
    'Page one starts the argument; later pages continue it without images.',
    'Every line is plain ASCII so extraction is font-independent.',
    'The final page repeats the provenance for auditability.',
    'A second paragraph checks that line breaks survive extraction.',
    'The fixture is regenerated by scripts/gen-fixtures.mjs.',
    'No external resources, fonts, or annotations are used.',
    'EOF marker follows the cross-reference table.',
    'Chapter markers are intentionally absent; the parser must fall back.',
    'This line pads the sample to twelve visible lines across two pages.',
  ]
  const expanded = []
  for (let i = 0; i < pageCount * 6; i += 1) {
    expanded.push(i < lines.length ? lines[i] : `${lines[i % lines.length]} [segment ${i + 1}]`)
  }
  return pdf({
    pageCount,
    title: `Reading Lab Text Fixture - ${pageCount} pages`,
    author: 'Reading Lab Fixtures',
    lines: expanded,
  })
}

function corruptPdf() {
  return Buffer.from(
    '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 99 0 R >>\nendobj\nstartxref\n999999\n%%EOF\n',
    'latin1',
  )
}

/**
 * 两页中文 PDF：不嵌入字体文件，靠 Type0/Identity-H + ToUnicode 还原文本。
 * 这样夹具只有几 KB，且不引入任何字体版权；渲染字形不是本夹具的目标，
 * 文本抽取（getTextContent）才是被测路径。
 */
function cjkPdf() {
  const pages = [
    [
      '阅读实验室中文夹具',
      '这是一份合成的两页中文文档，用于验证文本抽取。',
      '第一页包含标题、正文与页码，不包含任何图片。',
      '抽取结果应与这些句子逐字一致。',
      '分块器需要正确识别中文标点与段落边界。',
    ],
    [
      '第二页继续论述，避免使用生僻字。',
      '引用应当能够定位到具体的句子。',
      '本文件由脚本生成，可以重复构建。',
      '没有嵌入字体文件，文本由 ToUnicode 映射还原。',
      '这是最后一页。',
    ],
  ]

  const codes = new Map()
  const codeOf = (ch) => {
    if (!codes.has(ch)) codes.set(ch, codes.size + 1)
    return codes.get(ch)
  }

  const streams = pages.map((lines, pageIndex) => {
    const hexLines = lines.map((line) => `<${Array.from(line, (ch) => codeOf(ch).toString(16).padStart(4, '0')).join('')}> Tj`)
    const textOps = hexLines.map((op, idx) => `${idx === 0 ? '72 760 Td' : 'T*'} ${op}`).join('\n')
    return `BT\n/F1 14 Tf\n22 TL\n${textOps}\nET\nBT\n/F1 9 Tf\n72 60 Td\n<${Array.from(`第 ${pageIndex + 1} 页`, (ch) => codeOf(ch).toString(16).padStart(4, '0')).join('')}> Tj\nET\n`
  })

  const cmapLines = [...codes.entries()].map(([ch, code]) => {
    const utf16 = Buffer.from(ch, 'utf16le').swap16().toString('hex').toUpperCase()
    return `<${code.toString(16).padStart(4, '0')}> <${utf16}>`
  })
  const cmap = `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${cmapLines.length} beginbfchar
${cmapLines.join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end
`

  const fontNum = 3 + 2 * pages.length // 7
  const objects = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${pages.length} >>`
  pages.forEach((_, i) => {
    objects[3 + i] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 ${fontNum} 0 R >> >> /Contents ${3 + pages.length + i} 0 R >>`
    objects[3 + pages.length + i] = { stream: streams[i] }
  })
  objects[fontNum] = `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /Identity-H /DescendantFonts [${fontNum + 1} 0 R] /ToUnicode ${fontNum + 3} 0 R >>`
  objects[fontNum + 1] = `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fontNum + 2} 0 R /DW 1000 >>`
  objects[fontNum + 2] = '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 80 >>'
  objects[fontNum + 3] = { stream: cmap }
  const infoNum = fontNum + 4
  objects[infoNum] = '<< /Title (Reading Lab Chinese Two Page Fixture) /Author (Reading Lab Fixtures) /Producer (dsh-reading-lab fixtures) /CreationDate (D:20200101000000Z) >>'
  return serializePdf(objects, infoNum)
}

function serializePdf(objects, infoNum) {
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets = new Array(infoNum + 1).fill(0)
  for (let i = 1; i <= infoNum; i += 1) {
    offsets[i] = Buffer.byteLength(out, 'latin1')
    const obj = objects[i]
    if (obj && typeof obj === 'object') {
      const body = Buffer.from(obj.stream, 'utf8')
      out += `${i} 0 obj\n<< /Length ${body.length} >>\nstream\n${body.toString('latin1')}\nendstream\nendobj\n`
    } else {
      out += `${i} 0 obj\n${obj}\nendobj\n`
    }
  }
  const xref = Buffer.byteLength(out, 'latin1')
  out += `xref\n0 ${infoNum + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= infoNum; i += 1) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${infoNum + 1} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

// ---------------------------------------------------------------- fixture registry

function buildFixtures() {
  return [
    {
      name: 'epub3-mini.epub',
      purpose: 'EPUB3 nav + 2 章；导入/解析/分块的正常路径（FR-04、AC-01）',
      data: epub3(),
    },
    {
      name: 'epub2-ncx.epub',
      purpose: 'EPUB2 NCX、无 nav；TOC 回退（FR-04）',
      data: epub2(),
    },
    {
      name: 'pdf-text-2p.pdf',
      purpose: '2 页文本型 PDF；基础抽取与页码（FR-05、AC-02 的自动化替代）',
      data: textPdf(2),
    },
    {
      name: 'pdf-zh-2p.pdf',
      purpose: '2 页中文 PDF（ToUnicode 映射）；中文抽取与分块（FR-05/FR-06、AC-02）',
      data: cjkPdf(),
    },
    {
      name: 'pdf-text-10p.pdf',
      purpose: '10 页英文 PDF；02 §9.2 发布门禁的论文样本与跨页抽取（FR-05、NFR-01）',
      data: textPdf(10),
    },
    {
      name: 'pdf-scanned-5p.pdf',
      purpose: '5 页无文本层；扫描版判定（FR-05/FR-15、AC-03）',
      data: pdf({ pageCount: 5, title: 'Scanned Fixture', author: 'Reading Lab Fixtures', lines: [], scanned: true }),
    },
    {
      name: 'corrupt.pdf',
      purpose: '损坏对象引用；E_PARSE 且不崩溃（FR-05/FR-15、AC-09）',
      data: corruptPdf(),
    },
    {
      name: 'evil-zip.epub',
      purpose: 'zip-slip 条目（../ 与 OEBPS/../../）；路径逃逸拒绝（NFR-10）',
      data: evilZip(),
    },
    {
      name: 'bomb.epub',
      purpose: '8 MB 零字节压缩炸弹；解压上限与压缩比保护（NFR-10）',
      data: bombEpub(),
    },
  ]
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function manifestFor(fixtures) {
  return {
    generator: 'scripts/gen-fixtures.mjs',
    generatorVersion: 1,
    note: '全部为合成夹具，原创示例文本（中英文）；勿随发布包分发（package.json files 不含 test/）。',
    fixtures: fixtures.map((f) => ({
      name: f.name,
      bytes: f.data.length,
      sha256: sha256(f.data),
      purpose: f.purpose,
    })),
  }
}

function stringifyManifest(manifest) {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const opts = { check: false, out: DEFAULT_OUT, large: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--check') opts.check = true
    else if (arg === '--large') opts.large = true
    else if (arg === '--out') {
      i += 1
      if (!argv[i]) throw new Error('--out 需要目录参数')
      opts.out = resolve(argv[i])
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else {
      throw new Error(`未知参数：${arg}`)
    }
  }
  return opts
}

function writeDirectory(outDir, fixtures) {
  mkdirSync(outDir, { recursive: true })
  for (const f of fixtures) writeFileSync(join(outDir, f.name), f.data)
  writeFileSync(join(outDir, 'manifest.json'), stringifyManifest(manifestFor(fixtures)))
  return fixtures.reduce((sum, f) => sum + f.data.length, 0)
}

function checkDirectory(outDir, fixtures) {
  const problems = []
  let checked = 0
  for (const f of fixtures) {
    const file = join(outDir, f.name)
    if (!existsSync(file)) {
      problems.push(`缺失 ${f.name}`)
      continue
    }
    const actual = readFileSync(file)
    if (!actual.equals(f.data)) problems.push(`内容不一致 ${f.name}`)
    checked += 1
  }
  const manifestFile = join(outDir, 'manifest.json')
  if (!existsSync(manifestFile)) {
    problems.push('缺失 manifest.json')
  } else {
    const expected = stringifyManifest(manifestFor(fixtures))
    if (readFileSync(manifestFile, 'utf8') !== expected) problems.push('manifest.json 与生成结果不一致')
  }
  return { checked, problems }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('用法：node scripts/gen-fixtures.mjs [--check] [--out DIR] [--large]')
    return
  }
  const fixtures = buildFixtures()

  if (opts.check) {
    const { checked, problems } = checkDirectory(opts.out, fixtures)
    if (problems.length > 0) {
      console.error(`fixtures:check 失败（${problems.length} 项）`)
      for (const p of problems) console.error(`  - ${p}`)
      process.exitCode = 1
      return
    }
    console.log(`fixtures:check 通过：${checked} 个夹具与 manifest.json 字节一致（${opts.out}）`)
    return
  }

  const bytes = writeDirectory(opts.out, fixtures)
  console.log(`已生成 ${fixtures.length} 个夹具 + manifest.json，共 ${bytes} 字节 → ${opts.out}`)

  if (opts.large) {
    const largeDir = join(DEFAULT_OUT, '.generated')
    mkdirSync(largeDir, { recursive: true })
    const large = textPdf(2000)
    const target = join(largeDir, 'pdf-2000p.pdf')
    writeFileSync(target, large)
    console.log(`已生成大文件夹具 ${target}（${large.length} 字节，2000 页；已 gitignore）`)
  }
}

main()