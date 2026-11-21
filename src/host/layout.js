/**
 * 导图布局（owner: map，docs/03-design.md §7.4、docs/04-api.md §3.3）。
 *
 * 这里是**纯函数**：同一棵树、同一组常量必然得到同样的坐标，无随机、无时钟、
 * 不碰文件系统。Client 直接使用 Host 算好的 `layout`，不得重算（03 §5.4）。
 *
 * 算法是 tidy-tree 的简化版：
 *   1. 自底向上量每棵子树需要多高（`sub`）；
 *   2. 根居中，一级章节按 `index % 2` 左右交替，每侧独立纵向排布；
 *   3. 更深层继承父节点的 side，子孙在父节点的纵向跨度内居中；
 *   4. 整体平移，使包围盒左上角落在 `padding` 处。
 */

/** 布局数据版本（写进 `map.json` 的 `layout.version`）。 */
export const LAYOUT_VERSION = 1

/** 兄弟节点的最小纵向间距。 */
export const GAP_Y = 24

/** 相邻层之间的水平基础间距（实际 = base + depth * depthStep）。 */
export const GAP_X_BASE = 80
export const GAP_X_DEPTH = 8

/** 画布四周留白。 */
export const PADDING = 80

/** 书卡尺寸（根节点）。 */
export const BOOK_CARD = Object.freeze({ w: 240, h: 120 })

/** 章节/论点卡片的宽度与高度区间；高度按摘要长度自适应。 */
export const NODE_CARD = Object.freeze({ w: 220, h: 96 })
export const NODE_CARD_MAX_H = 160
export const SUMMARY_CHARS_PER_LINE = 16

const BASE_CARD_H = 56
const LINE_H = 18

/**
 * 按摘要长度估算卡片高度（确定性、无测量依赖）。
 * @param {unknown} summary
 * @returns {number} 96–160 之间的整数
 */
export function cardHeight(summary) {
  const chars = Array.from(String(summary ?? '')).length
  const lines = Math.max(1, Math.ceil(chars / SUMMARY_CHARS_PER_LINE))
  const raw = BASE_CARD_H + lines * LINE_H
  return Math.max(NODE_CARD.h, Math.min(NODE_CARD_MAX_H, raw))
}

function childList(node) {
  return Array.isArray(node?.children) ? node.children : []
}

/** 自底向上量高：返回带 `size / kids / sub` 的影子树。 */
function measure(node, depth, side, options, seen) {
  const id = node?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('layoutTree: every node needs a string id')
  }
  if (seen.has(id)) {
    throw new Error(`layoutTree: duplicate node id ${id}`)
  }
  seen.add(id)

  const isRoot = depth === 0
  const size = isRoot
    ? { w: options.book.w, h: options.book.h }
    : { w: options.node.w, h: cardHeight(node.summary) }
  const shadow = { id, depth, side: isRoot ? 'root' : side, size, kids: [], sub: size.h }

  childList(node).forEach((child, index) => {
    // 只有一层分左右；更深层跟父节点同侧。
    const childSide = isRoot ? (index % 2 === 0 ? 'right' : 'left') : shadow.side
    shadow.kids.push(measure(child, depth + 1, childSide, options, seen))
  })

  if (shadow.kids.length > 0) {
    if (isRoot) {
      // 两侧并行排布，纵向跨度取较高的一侧，避免根被两侧总和撑高。
      const totals = { left: 0, right: 0 }
      for (const sideName of ['left', 'right']) {
        const group = shadow.kids.filter((kid) => kid.side === sideName)
        if (group.length === 0) continue
        totals[sideName] =
          group.reduce((sum, kid) => sum + kid.sub, 0) + options.gapY * (group.length - 1)
      }
      shadow.sub = Math.max(size.h, totals.left, totals.right)
    } else {
      const stacked =
        shadow.kids.reduce((sum, kid) => sum + kid.sub, 0) + options.gapY * (shadow.kids.length - 1)
      shadow.sub = Math.max(size.h, stacked)
    }
  }

  return shadow
}

/** 自上而下摆放；`top` 是本子树纵向跨度的起点。 */
function place(node, top, parent, options, out) {
  let x
  if (!parent) {
    x = -node.size.w / 2
  } else {
    const gap = options.gapXBase + node.depth * options.gapXDepth
    x = node.side === 'right' ? parent.x + parent.size.w + gap : parent.x - gap - node.size.w
  }
  const y = top + (node.sub - node.size.h) / 2
  const box = { x, y, w: node.size.w, h: node.size.h }
  out.boxes.set(node.id, { box, depth: node.depth, side: node.side })
  node.x = x
  node.y = y

  if (node.kids.length === 0) return

  if (!parent) {
    for (const sideName of ['left', 'right']) {
      const group = node.kids.filter((kid) => kid.side === sideName)
      if (group.length === 0) continue
      const total =
        group.reduce((sum, kid) => sum + kid.sub, 0) + options.gapY * (group.length - 1)
      let cursor = y + (node.size.h - total) / 2
      for (const kid of group) {
        place(kid, cursor, node, options, out)
        cursor += kid.sub + options.gapY
      }
    }
    return
  }

  const total = node.kids.reduce((sum, kid) => sum + kid.sub, 0) + options.gapY * (node.kids.length - 1)
  let cursor = top + (node.sub - total) / 2
  for (const kid of node.kids) {
    place(kid, cursor, node, options, out)
    cursor += kid.sub + options.gapY
  }
}

function collectEdges(node, out) {
  for (const kid of node.kids) {
    out.push({ from: node.id, to: kid.id })
    collectEdges(kid, out)
  }
}

/** 坐标取整，保证快照与多端一致（`layout` 会被持久化）。 */
function normalize(boxes, padding) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { box } of boxes.values()) {
    minX = Math.min(minX, box.x)
    minY = Math.min(minY, box.y)
    maxX = Math.max(maxX, box.x + box.w)
    maxY = Math.max(maxY, box.y + box.h)
  }
  const dx = padding - minX
  const dy = padding - minY
  return {
    shiftX: Math.round(dx),
    shiftY: Math.round(dy),
    width: Math.round(maxX - minX + padding * 2),
    height: Math.round(maxY - minY + padding * 2),
  }
}

/**
 * 计算整棵树的布局。
 *
 * @param {{ id: string, kind?: string, title?: string, summary?: string, children?: any[] }} root
 * @param {{ gapY?: number, padding?: number, gapXBase?: number, gapXDepth?: number, card?: { book?: {w:number,h:number}, node?: {w:number,h:number} } }} [options]
 * @returns {{ version: number, width: number, height: number, nodes: Record<string, {x:number,y:number,w:number,h:number,depth:number,side:'root'|'left'|'right'}>, edges: Array<{from:string,to:string}> }}
 */
export function layoutTree(root, options = {}) {
  const settings = {
    gapY: options.gapY ?? GAP_Y,
    padding: options.padding ?? PADDING,
    gapXBase: options.gapXBase ?? GAP_X_BASE,
    gapXDepth: options.gapXDepth ?? GAP_X_DEPTH,
    book: { w: options.card?.book?.w ?? BOOK_CARD.w, h: options.card?.book?.h ?? BOOK_CARD.h },
    node: { w: options.card?.node?.w ?? NODE_CARD.w, h: options.card?.node?.h ?? NODE_CARD.h },
  }

  const shadow = measure(root, 0, 'root', settings, new Set())
  /** @type {{ boxes: Map<string, { box: {x:number,y:number,w:number,h:number}, depth: number, side: string }> }} */
  const out = { boxes: new Map() }
  place(shadow, 0, null, settings, out)

  const edges = []
  collectEdges(shadow, edges)
  const { shiftX, shiftY, width, height } = normalize(out.boxes, settings.padding)

  /** @type {Record<string, {x:number,y:number,w:number,h:number,depth:number,side:string}>} */
  const nodes = {}
  for (const [id, entry] of out.boxes) {
    nodes[id] = {
      x: Math.round(entry.box.x) + shiftX,
      y: Math.round(entry.box.y) + shiftY,
      w: entry.box.w,
      h: entry.box.h,
      depth: entry.depth,
      side: entry.side,
    }
  }

  return { version: LAYOUT_VERSION, width, height, nodes, edges }
}

/** 树的最大深度（根为 0）；供 `stats.depth` 与校验共用。 */
export function treeDepth(root) {
  const kids = childList(root)
  if (kids.length === 0) return 0
  let deepest = 0
  for (const kid of kids) deepest = Math.max(deepest, treeDepth(kid))
  return deepest + 1
}

/** 树中节点数（含根）。 */
export function countNodes(root) {
  return 1 + childList(root).reduce((sum, kid) => sum + countNodes(kid), 0)
}