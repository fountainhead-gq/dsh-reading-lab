#!/usr/bin/env node
/**
 * 生成 500 节点导图夹具（零依赖、确定性，docs/03-design.md §5.4 / §7.4）。
 *
 *   node scripts/gen-map-fixture.mjs           写入 test/fixtures/map/map-500.json
 *   node scripts/gen-map-fixture.mjs --check   重新生成并与磁盘逐字节比对
 *
 * 布局规则与 Host 侧 tidy-tree 一致：根居中、一级子节点 index%2 左右交替、
 * gapX=80+depth*8、gapY=24、父节点 y=子树包围盒中心、输出绝对坐标 +80 padding。
 * 夹具自身也是布局算法的参考实现，生成时断言「节点两两不重叠」。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = join(ROOT, 'test', 'fixtures', 'map', 'map-500.json')

const GAP_Y = 24
const PADDING = 80
const ROOT_SIZE = { w: 240, h: 120 }
const CARD_WIDTH = 220
const CHAPTER_COUNT = 8
const SECTION_COUNT = 6
const TOTAL_NODES = 500

const CHAPTER_TOPICS = [
  '记忆如何被写下',
  '遗忘不是故障',
  '时间的心理刻度',
  '叙事与自我',
  '睡眠里的重放',
  '情绪的加权',
  '注意力的闸门',
  '记忆的未来',
]
const SECTION_TOPICS = ['线索', '编码', '巩固', '提取', '偏差', '应用']
const POINT_TEMPLATES = [
  '这一段把机制拆成可观察的步骤，强调线索与情境共同决定回忆的成功率。',
  '作者用实验数据说明：间隔重复比集中重复留下更稳定的痕迹，但需要足够的睡眠配合。',
  '这里的论证依赖一个反例：当情绪强度过高时，细节反而更容易被重构，而不是被保存。',
  '把「遗忘」理解为一种资源分配策略，比把它当成存储损坏更符合后续章节的证据链。',
]

let chunkCursor = 1

function nextCitations(count) {
  const list = []
  for (let index = 0; index < count; index += 1) {
    list.push({ chunkId: 'c-' + String(chunkCursor).padStart(6, '0') })
    chunkCursor += 1
  }
  return list
}

function makeSummary(index, length) {
  const base = POINT_TEMPLATES[index % POINT_TEMPLATES.length]
  const suffix = '（夹具示例文本，用于验证折行与层级配色，不引用真实出版物。）'
  let text = base + suffix
  while (text.length < length) text += suffix
  return text.slice(0, length)
}

function cardHeight(summary) {
  if (summary.length > 96) return 128
  if (summary.length > 60) return 112
  return 96
}

function buildTree() {
  const root = {
    id: 'n-root',
    kind: 'book',
    title: '时间之灯：记忆如何塑造我们',
    summary: '一本关于记忆、遗忘与叙事的原创示例书，用于验证 500 节点导图的布局、连线与交互性能。',
    citations: [],
    questions: ['记忆可以被训练吗？'],
    children: [],
  }

  // 443 个论点分摊到 48 节：前 11 节各 10 个，其余各 9 个，合计 500 个节点。
  const sectionIds = CHAPTER_COUNT * SECTION_COUNT
  const perSection = new Array(sectionIds).fill(0)
  let remaining = TOTAL_NODES - 1 - CHAPTER_COUNT - sectionIds
  for (let index = 0; index < sectionIds && remaining > 0; index += 1) {
    perSection[index] = index < 11 ? 10 : 9
    remaining -= perSection[index]
  }
  if (remaining !== 0) throw new Error('point budget mismatch: ' + remaining)

  let pointIndex = 0
  for (let chapter = 0; chapter < CHAPTER_COUNT; chapter += 1) {
    const chapterNode = {
      id: 'n-ch-' + String(chapter + 1).padStart(2, '0'),
      kind: 'chapter',
      title: '第 ' + (chapter + 1) + ' 章 ' + CHAPTER_TOPICS[chapter],
      summary: '本章综述：' + makeSummary(chapter, 56),
      citations: nextCitations(1 + (chapter % 2)),
      questions: [],
      children: [],
    }
    for (let section = 0; section < SECTION_COUNT; section += 1) {
      const sectionIndex = chapter * SECTION_COUNT + section
      const sectionNode = {
        id: chapterNode.id + '-s' + String(section + 1).padStart(2, '0'),
        kind: 'section',
        title: SECTION_TOPICS[section] + ' · ' + (chapter + 1) + '.' + (section + 1),
        summary: makeSummary(chapter + section, 72),
        citations: nextCitations(2),
        questions: [],
        children: [],
      }
      for (let point = 0; point < perSection[sectionIndex]; point += 1) {
        const length = [44, 64, 104, 120][pointIndex % 4]
        sectionNode.children.push({
          id: sectionNode.id + '-p' + String(point + 1).padStart(2, '0'),
          kind: 'point',
          title: '论点 ' + (pointIndex + 1) + '：' + SECTION_TOPICS[section] + '的边界条件',
          summary: makeSummary(pointIndex, length),
          citations: nextCitations(1 + (pointIndex % 3)),
          questions: [],
        })
        pointIndex += 1
      }
      chapterNode.children.push(sectionNode)
    }
    root.children.push(chapterNode)
  }
  return root
}

function sizeOf(raw) {
  if (raw.kind === 'book') return { ...ROOT_SIZE }
  return { w: CARD_WIDTH, h: cardHeight(raw.summary || '') }
}

function layoutTree(root) {
  const sub = new Map()
  const sizes = new Map()

  function measure(node) {
    const size = sizeOf(node)
    sizes.set(node.id, size)
    const children = node.children || []
    if (!children.length) {
      sub.set(node.id, size.h)
      return size.h
    }
    let total = 0
    children.forEach((child, index) => {
      total += measure(child) + (index ? GAP_Y : 0)
    })
    const height = Math.max(size.h, total)
    sub.set(node.id, height)
    return height
  }

  measure(root)

  const result = new Map()

  function place(node, top, depth, side, parentSlot) {
    const size = sizes.get(node.id)
    const height = sub.get(node.id)
    let x
    if (!parentSlot) {
      x = -size.w / 2
    } else {
      const gap = 80 + depth * 8
      x = side === 'right' ? parentSlot.x + parentSlot.w + gap : parentSlot.x - gap - size.w
    }
    const slot = { x, y: top + (height - size.h) / 2, w: size.w, h: size.h, depth, side }
    result.set(node.id, slot)

    const children = node.children || []
    if (!children.length) return
    let total = 0
    children.forEach((child, index) => {
      total += sub.get(child.id) + (index ? GAP_Y : 0)
    })
    let cursor = top + (height - total) / 2
    for (const child of children) {
      place(child, cursor, depth + 1, side, slot)
      cursor += sub.get(child.id) + GAP_Y
    }
  }

  const rootSize = sizes.get(root.id)
  const rootSlot = {
    x: -rootSize.w / 2,
    y: -rootSize.h / 2,
    w: rootSize.w,
    h: rootSize.h,
    depth: 0,
    side: 'root',
  }
  result.set(root.id, rootSlot)

  const sides = { right: [], left: [] }
  root.children.forEach((child, index) => {
    sides[index % 2 === 0 ? 'right' : 'left'].push(child)
  })

  for (const side of ['right', 'left']) {
    const children = sides[side]
    if (!children.length) continue
    let total = 0
    children.forEach((child, index) => {
      total += sub.get(child.id) + (index ? GAP_Y : 0)
    })
    let cursor = -total / 2
    for (const child of children) {
      place(child, cursor, 1, side, rootSlot)
      cursor += sub.get(child.id) + GAP_Y
    }
  }

  return result
}

function assertNoOverlap(nodes) {
  const list = Object.entries(nodes)
  for (let a = 0; a < list.length; a += 1) {
    const [idA, boxA] = list[a]
    for (let b = a + 1; b < list.length; b += 1) {
      const [idB, boxB] = list[b]
      const overlap =
        boxA.x < boxB.x + boxB.w && boxB.x < boxA.x + boxA.w && boxA.y < boxB.y + boxB.h && boxB.y < boxA.y + boxA.h
      if (overlap) throw new Error('overlap detected: ' + idA + ' vs ' + idB)
    }
  }
}

function buildDoc() {
  const root = buildTree()
  const result = layoutTree(root)

  for (const [id, slot] of result) {
    if (![slot.x, slot.y, slot.w, slot.h].every(Number.isFinite)) {
      throw new Error('non-finite slot ' + id + ' ' + JSON.stringify(slot))
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const slot of result.values()) {
    minX = Math.min(minX, slot.x)
    minY = Math.min(minY, slot.y)
    maxX = Math.max(maxX, slot.x + slot.w)
    maxY = Math.max(maxY, slot.y + slot.h)
  }
  const offsetX = PADDING - minX
  const offsetY = PADDING - minY
  const nodes = {}
  for (const [id, slot] of result) {
    nodes[id] = {
      x: slot.x + offsetX,
      y: slot.y + offsetY,
      w: slot.w,
      h: slot.h,
      depth: slot.depth,
      side: slot.side,
    }
  }

  const edges = []
  const stats = { nodes: 0, depth: 0, citations: 0 }
  ;(function walk(raw, depth) {
    stats.nodes += 1
    stats.depth = Math.max(stats.depth, depth)
    stats.citations += (raw.citations || []).length
    for (const child of raw.children || []) {
      edges.push({ from: raw.id, to: child.id })
      walk(child, depth + 1)
    }
  })(root, 0)

  assertNoOverlap(nodes)

  return {
    schemaVersion: 1,
    bookId: 'b-fixture500',
    generatedAt: '2026-01-01T00:00:00.000Z',
    generator: 'scripts/gen-map-fixture.mjs',
    root,
    layout: {
      version: 1,
      width: Math.round(maxX - minX + PADDING * 2),
      height: Math.round(maxY - minY + PADDING * 2),
      nodes,
      edges,
    },
    stats,
  }
}

const doc = buildDoc()
const output = JSON.stringify(doc, null, 2) + '\n'

if (process.argv.includes('--check')) {
  if (!existsSync(OUT)) {
    console.error('missing fixture: ' + OUT)
    process.exit(1)
  }
  const current = readFileSync(OUT, 'utf8')
  if (current !== output) {
    console.error('fixture is stale: run node scripts/gen-map-fixture.mjs')
    process.exit(1)
  }
  console.log('map fixture up to date (' + doc.stats.nodes + ' nodes, ' + Buffer.byteLength(output) + ' bytes)')
} else {
  writeFileSync(OUT, output, 'utf8')
  console.log(
    'wrote ' +
      OUT +
      ' (' +
      doc.stats.nodes +
      ' nodes, depth ' +
      doc.stats.depth +
      ', ' +
      doc.layout.width +
      'x' +
      doc.layout.height +
      ', ' +
      Buffer.byteLength(output) +
      ' bytes)',
  )
}