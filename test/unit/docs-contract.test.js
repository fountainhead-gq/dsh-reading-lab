/**
 * 文档契约：06 测试方案必须与仓库里的真实用例、夹具、命令保持一致。
 * 这里只校验“可机械判定”的部分；语义评审仍需人工。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const DOCS = join(ROOT, 'docs')
const doc = readFileSync(join(DOCS, '06-test.md'), 'utf8')

function listFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath ?? e.path, e.name))
}

const testSources = listFiles(join(ROOT, 'test'))
  .filter((f) => f.endsWith('.js') || f.endsWith('.txt'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')

test('DOC-06-01 文档存在且达到最低规模，无占位标记', () => {
  assert.ok(doc.length > 12000, `06-test.md 过短：${doc.length}`)
  for (const word of ['待补', 'TBD', 'TBC', 'FIXME', 'XXX']) {
    assert.ok(!doc.includes(word), `文档残留占位标记：${word}`)
  }
  assert.match(doc, /状态：\*\*方案定稿/)
})

test('DOC-06-02 必备章节齐全', () => {
  for (const heading of [
    '## 1. 目标与判定口径',
    '## 2. 环境矩阵',
    '## 3. 分层策略',
    '## 4. 测试命令',
    '## 6. FR → 用例矩阵',
    '## 7. 接口契约矩阵',
    '## 8. 验收场景与手工步骤',
    '## 9. 非功能验证',
    '## 10. 夹具计划',
    '## 11. 通过标准与回归清单',
    '### 11.3 合并 main 前回归清单',
    '## 13. 与 02/03 的偏差与维护',
  ]) {
    assert.ok(doc.includes(heading), `缺少章节：${heading}`)
  }
})

test('DOC-06-03 FR-01..15 全部覆盖', () => {
  for (let i = 1; i <= 15; i += 1) {
    const id = `FR-${String(i).padStart(2, '0')}`
    assert.ok(doc.includes(`| ${id} `) || doc.includes(`| ${id}（`), `矩阵缺少 ${id}`)
  }
})

test('DOC-06-04 AC-01..10 全部覆盖（以 02 §9.1 为准）', () => {
  for (let i = 1; i <= 10; i += 1) {
    const id = `AC-${String(i).padStart(2, '0')}`
    assert.match(doc, new RegExp(`\\| ${id} \\|`), `缺少 ${id}`)
  }
})

test('DOC-06-05 C-01..12 契约全部覆盖', () => {
  for (let i = 1; i <= 12; i += 1) {
    const id = `C-${String(i).padStart(2, '0')}`
    assert.match(doc, new RegExp(`\\| ${id} \\|`), `缺少 ${id}`)
  }
})

test('DOC-06-06 NFR-01..12 全部覆盖', () => {
  for (let i = 1; i <= 12; i += 1) {
    const id = `NFR-${String(i).padStart(2, '0')}`
    assert.match(doc, new RegExp(`\\| ${id} \\|`), `缺少 ${id}`)
  }
})

test('DOC-06-07 MAN-01..15 与 v0.3 扩展均有定义', () => {
  for (let i = 1; i <= 15; i += 1) {
    const id = `MAN-${String(i).padStart(2, '0')}`
    assert.match(doc, new RegExp(`\\| ${id} \\|`), `缺少 ${id}`)
  }
  for (const id of ['V03-EDIT', 'V03-REVIEW', 'V03-EXPORT', 'V03-STUDY', 'V03-SEARCH']) {
    assert.ok(doc.includes(id), `缺少 ${id}`)
  }
})

test('DOC-06-08 文档引用的用例前缀在 test/ 中真实存在', () => {
  const prefixes = new Set(
    (doc.match(/\b(UT|IT|CT|SMK|MAN|V03)-[A-Z0-9]+/g) ?? []).map((id) => id.replace(/-\d+$/, '')),
  )
  assert.ok(prefixes.size >= 20, `用例前缀过少：${prefixes.size}`)
  for (const prefix of prefixes) {
    assert.ok(testSources.includes(prefix), `文档引用了不存在的用例前缀：${prefix}`)
  }
})

test('DOC-06-09 标准命令与关键路径存在', () => {
  for (const token of [
    'npm run verify',
    'npm test',
    'npm run fixtures:check',
    'npm pack --dry-run',
    'node --test "test/**/*.test.js"',
    'http://127.0.0.1:5807',
    'reading/books/<bookId>/',
    'reading/exports/',
    'agent.followup',
  ]) {
    assert.ok(doc.includes(token), `缺少关键命令/路径：${token}`)
  }
})

test('DOC-06-10 文档内相对链接目标存在', () => {
  const links = [...doc.matchAll(/\]\((?!https?:)([^)#]+\.md)(?:#[^)]*)?\)/g)].map((m) => m[1])
  assert.ok(links.length >= 3, `相对链接过少：${links.length}`)
  for (const link of links) {
    assert.ok(existsSync(join(DOCS, link)), `链接失效：${link}`)
  }
})

test('DOC-06-11 夹具清单与磁盘一致（9 个 + manifest）', () => {
  const fixtures = readdirSync(join(ROOT, 'test', 'fixtures')).filter(
    (f) => f !== '.generated' && statSync(join(ROOT, 'test', 'fixtures', f)).isFile(),
  )
  const expected = ['epub3-mini.epub', 'epub2-ncx.epub', 'pdf-text-2p.pdf', 'pdf-zh-2p.pdf', 'pdf-text-10p.pdf', 'pdf-scanned-5p.pdf', 'corrupt.pdf', 'evil-zip.epub', 'bomb.epub', 'manifest.json']
  for (const name of expected) {
    assert.ok(fixtures.includes(name), `夹具缺失：${name}`)
    assert.ok(doc.includes(name), `文档未登记夹具：${name}`)
  }
  assert.equal(fixtures.sort().join(','), expected.sort().join(','), 'test/fixtures 存在未登记文件')
})

test('DOC-06-12 安装冒烟与手工验收未被宣称为已执行', () => {
  assert.match(doc, /当前状态：待执行/)
  assert.ok(doc.includes('尚未执行过安装验证'))
  assert.ok(doc.includes('未执行的安装/手工项统一标“待执行”'))
})

test('DOC-06-13 manual 手册、skip 登记与测试目录入口存在', () => {
  for (const file of ['test/manual/README.md', 'test/skip.txt', 'test/support/zip.mjs', 'scripts/gen-fixtures.mjs']) {
    assert.ok(existsSync(join(ROOT, file)), `缺少 ${file}`)
  }
  const manual = readFileSync(join(ROOT, 'test', 'manual', 'README.md'), 'utf8')
  assert.match(manual, /尚未执行/)
  assert.match(manual, /MAN-01\.\.MAN-15|MAN-01\.\.MAN-15/)
  assert.match(manual, /127\.0\.0\.1:5807/)
  const skip = readFileSync(join(ROOT, 'test', 'skip.txt'), 'utf8')
  assert.match(skip, /编号 \| 原因 \| 负责人 \| 截止里程碑/)
})