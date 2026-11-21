import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '../..')

function loadSvg() {
  const source = readFileSync(path.join(ROOT, 'src/client/svg.js'), 'utf8')
  const sandbox = {}
  vm.runInNewContext(source, sandbox, { filename: 'svg.js' })
  return sandbox.SVG
}

function readFixture(name) {
  return JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/map', name), 'utf8'))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

const SVG = loadSvg()
const MAP = readFixture('map-500.json')

function subtreeSize(raw) {
  let total = 1
  for (const child of raw.children || []) total += subtreeSize(child)
  return total
}

function overlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

describe('svg 布局纯函数', () => {
  it('常量与缩放范围符合 03 §4.5', () => {
    assert.equal(SVG.MIN_ZOOM, 0.25)
    assert.equal(SVG.MAX_ZOOM, 2)
    assert.ok(SVG.FIT_MIN_ZOOM <= SVG.MIN_ZOOM)
    assert.deepEqual(Array.from(SVG.DEPTH_TOKENS), [
      'var(--dsw-alias-brand-primary)',
      'var(--dsw-alias-state-business-primary)',
      'var(--dsw-alias-state-success-primary)',
      'var(--dsw-alias-state-warn-primary)',
    ])
  })

  it('clamp 处理非有限值', () => {
    assert.equal(SVG.clamp(0.5, 0.25, 2), 0.5)
    assert.equal(SVG.clamp(9, 0.25, 2), 2)
    assert.equal(SVG.clamp(Number.NaN, 0.25, 2), 0.25)
    assert.equal(SVG.clamp(-Infinity, 0.25, 2), 0.25)
  })

  it('truncate 超宽加省略号，空值返回空串', () => {
    assert.equal(SVG.truncate('', 100, 12), '')
    assert.equal(SVG.truncate('短标题', 200, 14), '短标题')
    const long = '这是一个非常长的章节标题用来验证截断行为是否会在末尾补上省略号'
    const cut = SVG.truncate(long, 120, 14, 600)
    assert.ok(cut.length < long.length)
    assert.ok(cut.endsWith('…'))
  })

  it('wrapText 中文按字折行、英文按词不腰斩、超行截断', () => {
    const cjk = SVG.wrapText('记忆并不是录像带而是每次回忆时重新搭建的现场', 60, 12, 3)
    assert.ok(cjk.lines.length >= 2 && cjk.lines.length <= 3)
    const english = SVG.wrapText('memory is reconstructed each time we recall it', 80, 12, 2)
    assert.equal(english.truncated, true)
    assert.equal(english.lines[0], 'memory is…')
    for (const line of english.lines) assert.equal(line.includes('reconstr'), false)
    const one = SVG.wrapText('photography', 40, 12, 1)
    assert.equal(one.lines.length, 1)
    assert.equal(one.truncated, true)
    assert.match(one.lines[0], /^photog.*…$/)
    assert.deepEqual(Array.from(SVG.wrapText('', 10, 12, 2).lines), [])
  })

  it('measure 对 CJK 与拉丁字符给出不同宽度', () => {
    assert.ok(SVG.measure('中', 12) > SVG.measure('i', 12))
    assert.ok(SVG.measure('ABC', 12) > SVG.measure('abc', 12))
  })

  it('boundsOf 返回外接矩形，空集合返回零矩形', () => {
    const box = SVG.boundsOf([
      { x: 10, y: 20, w: 100, h: 40 },
      { x: -10, y: 5, w: 20, h: 60 },
    ])
    assert.deepEqual({ ...box }, { x: -10, y: 5, width: 120, height: 60 })
    assert.deepEqual({ ...SVG.boundsOf([]) }, { x: 0, y: 0, width: 0, height: 0 })
  })
})

describe('svg 视口数学', () => {
  it('zoomAt 保持锚点下的世界坐标不变', () => {
    const before = { x: 40, y: -60, zoom: 0.8 }
    const px = 300
    const py = 200
    const worldBefore = SVG.toWorld(before, px, py)
    const after = SVG.zoomAt(before, 1.37, px, py)
    const worldAfter = SVG.toWorld(after, px, py)
    assert.ok(Math.abs(worldBefore.x - worldAfter.x) < 1e-9)
    assert.ok(Math.abs(worldBefore.y - worldAfter.y) < 1e-9)
    assert.ok(after.zoom > before.zoom)
  })

  it('zoomAt 上限 2，适应窗口低于 25% 时不会被拉回', () => {
    assert.equal(SVG.zoomAt({ x: 0, y: 0, zoom: 2 }, 4, 0, 0).zoom, 2)
    const fit = { x: 0, y: 0, zoom: 0.02 }
    const shrunk = SVG.zoomAt(fit, 0.5, 0, 0)
    assert.equal(shrunk.zoom, 0.02)
    const grown = SVG.zoomAt(fit, 1.2, 0, 0)
    assert.ok(grown.zoom > 0.02)
  })

  it('fitView 居中并完整容纳包围盒', () => {
    const bounds = { x: 0, y: 0, width: 2000, height: 1000 }
    const view = SVG.fitView(bounds, { width: 800, height: 600 }, 0)
    assert.ok(view.zoom <= 1)
    assert.ok(view.zoom >= SVG.FIT_MIN_ZOOM)
    const left = bounds.x * view.zoom + view.x
    const top = bounds.y * view.zoom + view.y
    const right = (bounds.x + bounds.width) * view.zoom + view.x
    const bottom = (bounds.y + bounds.height) * view.zoom + view.y
    assert.ok(left >= -1e-6 && right <= 800 + 1e-6)
    assert.ok(top >= -1e-6 && bottom <= 600 + 1e-6)
    assert.ok(Math.abs(left + right - 800) < 1e-6)
    assert.ok(Math.abs(top + bottom - 600) < 1e-6)
  })

  it('fitView 对 500 节点长图取整图比例（低于 25%）', () => {
    const view = SVG.fitView({ x: 0, y: 0, width: MAP.layout.width, height: MAP.layout.height }, { width: 1200, height: 800 })
    assert.ok(view.zoom < SVG.MIN_ZOOM)
    assert.ok(view.zoom >= SVG.FIT_MIN_ZOOM)
  })

  it('centerOn 把卡片中心放到视口中心', () => {
    const node = { x: 100, y: 200, w: 200, h: 100 }
    const view = SVG.centerOn(node, { width: 800, height: 600 }, 1)
    assert.equal((node.x + node.w / 2) * view.zoom + view.x, 400)
    assert.equal((node.y + node.h / 2) * view.zoom + view.y, 300)
  })
})

describe('map.json 校验与索引', () => {
  it('500 节点样例通过校验', () => {
    const check = SVG.validateMap(MAP)
    assert.equal(check.ok, true)
    assert.equal(check.index.order.length, 500)
    assert.deepEqual(Array.from(check.index.duplicates), [])
  })

  it('拒绝缺少 layout / 几何非法 / 重复 id / schema 不符', () => {
    const noLayout = clone(MAP)
    delete noLayout.layout
    assert.equal(SVG.validateMap(noLayout).reason, 'layout')

    const badGeometry = clone(MAP)
    badGeometry.layout.nodes['n-ch-01'].x = Number.NaN
    const bad = SVG.validateMap(badGeometry)
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, 'bad-geometry')
    assert.equal(bad.nodeId, 'n-ch-01')

    const dup = clone(MAP)
    dup.root.children[1].id = dup.root.children[0].id
    const dupCheck = SVG.validateMap(dup)
    assert.equal(dupCheck.ok, false)
    assert.equal(dupCheck.reason, 'duplicate-id')

    const schema = clone(MAP)
    schema.schemaVersion = 2
    assert.equal(SVG.validateMap(schema).reason, 'schema')

    assert.equal(SVG.validateMap(null).reason, 'empty')
    assert.equal(SVG.validateMap({}).reason, 'schema')
  })

  it('indexMap 还原父子关系与树序', () => {
    const index = SVG.indexMap(MAP)
    assert.equal(index.order[0], 'n-root')
    assert.equal(index.parentOf['n-root'], null)
    assert.equal(index.parentOf['n-ch-01'], 'n-root')
    assert.equal(index.childrenOf['n-root'].length, 8)
    assert.equal(index.childrenOf['n-ch-01'].length, 6)
    assert.ok(index.layout['n-root'])
    assert.equal(Object.keys(index.nodes).length, 500)
  })

  it('citationCount 去重并忽略空引用', () => {
    assert.equal(SVG.citationCount({ citations: [{ chunkId: 'c-1' }, { chunkId: 'c-1' }, { chunkId: 'c-2' }] }), 2)
    assert.equal(SVG.citationCount({ citations: [{}, { chunkId: '' }] }), 0)
    assert.equal(SVG.citationCount({}), 0)
  })
})

describe('场景构建（500 节点）', () => {
  it('全部节点可渲染且两两不重叠', () => {
    const scene = SVG.buildScene(MAP)
    assert.equal(scene.nodeCount, 500)
    assert.equal(scene.renderedCount, 500)
    assert.equal(scene.missingLayout, 0)
    assert.equal(scene.edges.length, 499)
    assert.equal(scene.stats.nodes, 500)
    assert.equal(scene.stats.depth, 3)
    assert.equal(scene.stats.citations, 993)
    const all = scene.all
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        assert.equal(overlap(all[i], all[j]), false, `节点重叠: ${all[i].id} / ${all[j].id}`)
      }
    }
  })

  it('深度 0–3、根卡有封面首字、非根有摘要行与引用角标', () => {
    const scene = SVG.buildScene(MAP, { bookTitle: '时间之灯', author: '林晚' })
    const root = scene.all.find((node) => node.isRoot)
    assert.equal(root.depth, 0)
    assert.equal(root.side, 'root')
    assert.equal(root.coverChar, '时')
    assert.equal(root.author, '林晚')
    const depths = new Set(scene.all.map((node) => node.depth))
    assert.deepEqual(Array.from(depths).sort(), [0, 1, 2, 3])
    const point = scene.all.find((node) => node.kind === 'point')
    assert.ok(point.summaryLines.length >= 1)
    assert.ok(point.citationCount >= 1)
    for (const node of scene.all) assert.ok(node.titleText.length > 0)
  })

  it('bounds 优先使用 Host 持久化的 layout 尺寸', () => {
    const scene = SVG.buildScene(MAP)
    assert.equal(scene.bounds.width, MAP.layout.width)
    assert.equal(scene.bounds.height, MAP.layout.height)
  })

  it('收起章节后其子树整体隐藏，bounds 退回包围盒', () => {
    const chapter = MAP.root.children[0]
    const hidden = subtreeSize(chapter)
    const scene = SVG.buildScene(MAP, { collapsed: { [chapter.id]: true } })
    assert.equal(scene.nodeCount, 500 - hidden + 1)
    assert.equal(scene.edges.length, 499 - (hidden - 1))
    assert.ok(scene.bounds.height < MAP.layout.height)
  })

  it('选中节点带 selected 标记', () => {
    const target = MAP.root.children[2].id
    const scene = SVG.buildScene(MAP, { selectedId: target })
    assert.equal(scene.all.filter((node) => node.selected).length, 1)
    assert.equal(scene.all.find((node) => node.selected).id, target)
  })

  it('大图裁剪只保留视口内节点，all 仍是整棵树', () => {
    const scene = SVG.buildScene(MAP)
    const view = { x: 0, y: 0, zoom: 1 }
    const culled = SVG.cullScene(scene, view, { width: 900, height: 700 }, 160)
    assert.ok(culled.nodes.length < 500)
    assert.ok(culled.nodes.length > 0)
    assert.equal(culled.all.length, 500)
    assert.equal(culled.nodeCount, 500)
    assert.equal(culled.culled, true)
    for (const edge of culled.edges) {
      assert.ok(culled.nodes.some((node) => node.id === edge.from))
      assert.ok(culled.nodes.some((node) => node.id === edge.to))
    }
    const fit = SVG.fitView(scene.bounds, { width: 900, height: 700 })
    const whole = SVG.cullScene(scene, fit, { width: 900, height: 700 }, 160)
    assert.equal(whole.nodes.length, 500)
    assert.equal(whole.culled, false)
  })

  it('navigate 覆盖 next/previous/parent/child/first/last', () => {
    const scene = SVG.buildScene(MAP)
    const root = MAP.root.id
    const first = MAP.root.children[0]
    assert.equal(SVG.navigate(scene, root, 'next'), first.id)
    assert.equal(SVG.navigate(scene, first.id, 'previous'), root)
    assert.equal(SVG.navigate(scene, first.id, 'parent'), root)
    assert.equal(SVG.navigate(scene, root, 'parent'), root)
    assert.equal(SVG.navigate(scene, root, 'child'), first.id)
    assert.equal(SVG.navigate(scene, first.id, 'first'), root)
    const lastId = scene.all[scene.all.length - 1].id
    assert.equal(SVG.navigate(scene, first.id, 'last'), lastId)
    assert.equal(SVG.navigate(scene, null, 'next'), root)
    assert.equal(SVG.navigate(scene, null, 'previous'), root)
  })

  it('ancestorsOf 从近到远返回祖先链', () => {
    const index = SVG.indexMap(MAP)
    const section = MAP.root.children[0].children[0]
    const chain = SVG.ancestorsOf(index, section.id)
    assert.deepEqual(Array.from(chain), [MAP.root.children[0].id, MAP.root.id])
  })

  it('edgePath 从父卡最近的竖边出发，右侧子节点向右延伸', () => {
    const parent = { x: 100, y: 100, w: 200, h: 100 }
    const right = { x: 500, y: 120, w: 200, h: 100 }
    const left = { x: -300, y: 120, w: 200, h: 100 }
    const rightPath = SVG.edgePath(parent, right)
    const leftPath = SVG.edgePath(parent, left)
    assert.match(rightPath, /^M 300 150 C /)
    assert.match(leftPath, /^M 100 150 C /)
    assert.match(rightPath, /, 500 170$/)
    assert.match(leftPath, /, -100 170$/)
  })
})