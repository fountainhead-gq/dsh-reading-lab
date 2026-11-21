/* SVG 导图几何与场景构建（owner: canvas，03 §2.2 / §7.4）。
 *
 * 这一层只做纯计算：坐标来自 map.json 的 layout（Host 计算，Client 不得重算），
 * 这里只负责「哪些节点可见、连线怎么画、文字怎么折行、视口怎么裁剪」。
 * 不读 DOM、不读 store，便于在 node:test 里直接跑 500 节点样例。
 */

var SVG = (function () {
  var MIN_ZOOM = 0.25
  var MAX_ZOOM = 2
  var FIT_MIN_ZOOM = 0.02
  var FIT_PADDING = 48
  var CARD_PADDING = 12
  var TITLE_LINE = 20
  var SUMMARY_LINE = 18
  var DEPTH_TOKENS = [
    'var(--dsw-alias-brand-primary)',
    'var(--dsw-alias-state-business-primary)',
    'var(--dsw-alias-state-success-primary)',
    'var(--dsw-alias-state-warn-primary)',
  ]

  function clamp(value, min, max) {
    if (!isFinite(value)) return min
    if (value < min) return min
    if (value > max) return max
    return value
  }

  function isCjk(code) {
    return (
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3000 && code <= 0x303f)
    )
  }

  /** 粗测文本宽度：只用于折行与截断，不追求字体度量级精确。 */
  function measure(text, fontSize, weight) {
    var factor = weight === 600 ? 1.04 : 1
    var total = 0
    for (var index = 0; index < text.length; index += 1) {
      var code = text.codePointAt(index)
      var char = String.fromCodePoint(code)
      if (code > 0xffff) index += 1
      if (isCjk(code)) total += fontSize
      else if (char === ' ') total += fontSize * 0.3
      else if (/[A-Z0-9]/.test(char)) total += fontSize * 0.62
      else total += fontSize * 0.54
    }
    return total * factor
  }

  /** 按词/CJK 字符切分，折行时英文单词不腰斩。 */
  function tokenize(text) {
    var tokens = []
    var buffer = ''
    var index = 0
    while (index < text.length) {
      var code = text.codePointAt(index)
      var char = String.fromCodePoint(code)
      index += char.length
      if (isCjk(code)) {
        if (buffer) {
          tokens.push(buffer)
          buffer = ''
        }
        tokens.push(char)
      } else if (char === ' ' || char === '\t' || char === '\n') {
        if (buffer) {
          tokens.push(buffer)
          buffer = ''
        }
        tokens.push(' ')
      } else {
        buffer += char
      }
    }
    if (buffer) tokens.push(buffer)
    return tokens
  }

  function truncate(text, maxWidth, fontSize, weight) {
    var source = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    if (!source) return ''
    if (measure(source, fontSize, weight) <= maxWidth) return source
    var output = ''
    for (var index = 0; index < source.length; index += 1) {
      var next = output + source.charAt(index)
      if (measure(next + '…', fontSize, weight) > maxWidth) break
      output = next
    }
    return output ? output + '…' : '…'
  }

  /** 折行：返回 { lines, truncated }，行数不超过 maxLines。 */
  function wrapText(text, maxWidth, fontSize, maxLines, weight) {
    var source = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
    if (!source || maxWidth <= 0 || maxLines <= 0) return { lines: [], truncated: false }
    var tokens = tokenize(source)
    var lines = []
    var current = ''
    var truncated = false
    for (var index = 0; index < tokens.length; index += 1) {
      var token = tokens[index]
      var candidate = current ? current + token : token
      if (measure(candidate.replace(/\s+$/, ''), fontSize, weight) <= maxWidth) {
        current = candidate
        continue
      }
      if (current) {
        lines.push(current.replace(/\s+$/, ''))
        current = ''
        if (lines.length >= maxLines) {
          truncated = true
          break
        }
      }
      if (token === ' ') continue
      // 单个 token 超宽。已是最后一行且前面已有内容时，宁可留白加省略号，也不把英文单词拦腰截断。
      if (lines.length + 1 >= maxLines) {
        if (!lines.length) {
          var head = ''
          for (var cursor = 0; cursor < token.length; cursor += 1) {
            var piece = head + token.charAt(cursor)
            if (measure(piece, fontSize, weight) > maxWidth) break
            head = piece
          }
          lines.push((head || token.charAt(0)) + '…')
        }
        truncated = true
        break
      }
      // 单个 token 超宽：按字符硬切。
      var rest = token
      while (rest && measure(rest, fontSize, weight) > maxWidth) {
        var cut = ''
        for (var cursor = 0; cursor < rest.length; cursor += 1) {
          var next = cut + rest.charAt(cursor)
          if (measure(next, fontSize, weight) > maxWidth) break
          cut = next
        }
        if (!cut) cut = rest.charAt(0)
        lines.push(cut)
        rest = rest.slice(cut.length)
        if (lines.length >= maxLines) {
          truncated = Boolean(rest)
          break
        }
      }
      if (lines.length >= maxLines) break
      current = rest
    }
    if (!truncated && current) {
      if (lines.length < maxLines) lines.push(current.replace(/\s+$/, ''))
      else truncated = true
    }
    truncated = truncated || measure(lines.join(''), fontSize, weight) < measure(source, fontSize, weight)
    if (truncated && lines.length) {
      var lastIndex = lines.length - 1
      if (!/…$/.test(lines[lastIndex])) lines[lastIndex] += '…'
    }
    return { lines: lines, truncated: truncated }
  }

  function boundsOf(nodes) {
    var box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (var index = 0; index < nodes.length; index += 1) {
      var node = nodes[index]
      if (node.x < box.minX) box.minX = node.x
      if (node.y < box.minY) box.minY = node.y
      if (node.x + node.w > box.maxX) box.maxX = node.x + node.w
      if (node.y + node.h > box.maxY) box.maxY = node.y + node.h
    }
    if (!isFinite(box.minX)) return { x: 0, y: 0, width: 0, height: 0 }
    return { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY }
  }

  /** 以 (px,py) 屏幕点为锚缩放；返回新的 {x,y,zoom}。 */
  function zoomAt(view, factor, px, py) {
    // 适应窗口可能低于 25%（500 节点）；此时允许继续缩小到当前比例，但不再放大到 25% 以上跳变。
    var lower = Math.min(view.zoom || 1, MIN_ZOOM)
    var zoom = clamp((view.zoom || 1) * factor, lower, MAX_ZOOM)
    var ratio = zoom / (view.zoom || 1)
    return {
      x: px - (px - view.x) * ratio,
      y: py - (py - view.y) * ratio,
      zoom: zoom,
    }
  }

  /** 屏幕点到世界点。 */
  function toWorld(view, px, py) {
    return { x: (px - view.x) / (view.zoom || 1), y: (py - view.y) / (view.zoom || 1) }
  }

  /** 让 bounds 居中并完整落在 viewport 内；大图允许低于 25%（03 §4.8 500 节点验收）。 */
  function fitView(bounds, viewport, padding) {
    var width = Math.max(1, bounds.width || 0)
    var height = Math.max(1, bounds.height || 0)
    var viewWidth = Math.max(1, (viewport && viewport.width) || 0)
    var viewHeight = Math.max(1, (viewport && viewport.height) || 0)
    var pad = typeof padding === 'number' ? padding : FIT_PADDING
    var zoom = clamp(Math.min((viewWidth - pad * 2) / width, (viewHeight - pad * 2) / height), FIT_MIN_ZOOM, 1)
    return {
      x: (viewWidth - width * zoom) / 2 - bounds.x * zoom,
      y: (viewHeight - height * zoom) / 2 - bounds.y * zoom,
      zoom: zoom,
    }
  }

  function centerOn(node, viewport, zoom) {
    var level = clamp(zoom || 1, FIT_MIN_ZOOM, MAX_ZOOM)
    var viewWidth = Math.max(1, (viewport && viewport.width) || 0)
    var viewHeight = Math.max(1, (viewport && viewport.height) || 0)
    return {
      x: viewWidth / 2 - (node.x + node.w / 2) * level,
      y: viewHeight / 2 - (node.y + node.h / 2) * level,
      zoom: level,
    }
  }

  /** map.json 的 layout 是根节点树 + 扁平 nodes；这里建索引，父关系只认树。 */
  function indexMap(doc) {
    var nodes = {}
    var order = []
    var duplicates = []
    var parentOf = {}
    var childrenOf = {}
    var layout = doc && doc.layout && doc.layout.nodes ? doc.layout.nodes : {}
    function walk(raw, parentId, depth) {
      if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') return
      if (Object.prototype.hasOwnProperty.call(nodes, raw.id)) {
        // 重复 id 会形成环；记下来让 validateMap 拒绝，而不是无限递归。
        duplicates.push(raw.id)
        return
      }
      var slot = layout[raw.id]
      nodes[raw.id] = raw
      order.push(raw.id)
      parentOf[raw.id] = parentId
      childrenOf[raw.id] = []
      if (parentId) childrenOf[parentId].push(raw.id)
      if (slot && typeof slot.depth === 'number') depth = slot.depth
      var children = Array.isArray(raw.children) ? raw.children : []
      for (var index = 0; index < children.length; index += 1) walk(children[index], raw.id, depth + 1)
    }
    if (doc && doc.root) walk(doc.root, null, 0)
    return { doc: doc, nodes: nodes, order: order, duplicates: duplicates, parentOf: parentOf, childrenOf: childrenOf, layout: layout }
  }

  function validateMap(doc) {
    if (!doc || typeof doc !== 'object') return { ok: false, reason: 'empty' }
    if (doc.schemaVersion !== 1) return { ok: false, reason: 'schema' }
    if (!doc.root || typeof doc.root.id !== 'string') return { ok: false, reason: 'root' }
    if (!doc.layout || typeof doc.layout !== 'object') return { ok: false, reason: 'layout' }
    if (!doc.layout.nodes || typeof doc.layout.nodes !== 'object') return { ok: false, reason: 'layout-nodes' }
    var index = indexMap(doc)
    if (index.duplicates.length) return { ok: false, reason: 'duplicate-id', nodeId: index.duplicates[0] }
    for (var cursor = 0; cursor < index.order.length; cursor += 1) {
      var id = index.order[cursor]
      var slot = index.layout[id]
      if (!slot) return { ok: false, reason: 'missing-layout', nodeId: id }
      if (![slot.x, slot.y, slot.w, slot.h].every(function (value) {
        return typeof value === 'number' && isFinite(value)
      })) {
        return { ok: false, reason: 'bad-geometry', nodeId: id }
      }
    }
    return { ok: true, index: index }
  }

  function citationCount(node) {
    if (!node || !Array.isArray(node.citations)) return 0
    var seen = {}
    var total = 0
    for (var index = 0; index < node.citations.length; index += 1) {
      var citation = node.citations[index]
      var id = citation && (citation.chunkId || citation.id)
      if (!id || seen[id]) continue
      seen[id] = true
      total += 1
    }
    return total
  }

  function summaryLinesFor(node, width, height) {
    if (!node.summary) return { lines: [], truncated: false }
    var available = width - CARD_PADDING * 2
    var maxLines = Math.floor((height - CARD_PADDING * 2 - TITLE_LINE) / SUMMARY_LINE)
    maxLines = clamp(maxLines, 1, 3)
    return wrapText(node.summary, available, 12, maxLines)
  }

  function edgePath(parent, child) {
    var fromRight = child.x >= parent.x + parent.w / 2
    var startX = fromRight ? parent.x + parent.w : parent.x
    var endX = fromRight ? child.x : child.x + child.w
    var startY = parent.y + parent.h / 2
    var endY = child.y + child.h / 2
    var distance = Math.abs(endX - startX)
    var handle = clamp(distance * 0.45, 24, 140)
    var c1 = fromRight ? startX + handle : startX - handle
    var c2 = fromRight ? endX - handle : endX + handle
    return 'M ' + startX + ' ' + startY + ' C ' + c1 + ' ' + startY + ', ' + c2 + ' ' + endY + ', ' + endX + ' ' + endY
  }

  /**
   * 构建可渲染场景。
   * options: { collapsed: {id:true}, selectedId, culling: { view, viewport, margin } }
   */
  function buildScene(doc, options) {
    var settings = options || {}
    var index = indexMap(doc)
    var collapsed = settings.collapsed || {}
    var selectedId = settings.selectedId || null
    var layout = index.layout
    var all = []
    var rendered = []
    var edges = []
    var parentVisible = {}
    var missing = 0

    // 先按树序展开（收起节点的子树整体跳过），再统一做视口裁剪。
    function walk(id, parentId, depth) {
      var raw = index.nodes[id]
      var slot = layout[id]
      if (!raw || !slot) {
        missing += 1
        return
      }
      var children = index.childrenOf[id] || []
      var expanded = children.length > 0 && !collapsed[id]
      var isRoot = depth === 0
      var width = slot.w
      var height = slot.h
      var title = isRoot ? raw.title || settings.bookTitle || '' : raw.title || ''
      var model = {
        id: id,
        kind: raw.kind || (isRoot ? 'book' : 'point'),
        depth: typeof slot.depth === 'number' ? slot.depth : depth,
        side: slot.side || (isRoot ? 'root' : ''),
        parentId: parentId,
        x: slot.x,
        y: slot.y,
        w: width,
        h: height,
        isRoot: isRoot,
        title: title,
        titleText: '',
        author: isRoot ? settings.author || '' : '',
        coverChar: isRoot ? String(title).trim().charAt(0) || '书' : '',
        summaryLines: [],
        summaryTruncated: false,
        citationCount: citationCount(raw),
        questions: Array.isArray(raw.questions) ? raw.questions.length : 0,
        hasChildren: children.length > 0,
        expanded: expanded,
        selected: selectedId === id,
        childCount: children.length,
      }
      if (isRoot) {
        var coverWidth = 40
        var textLeft = CARD_PADDING * 2 + coverWidth + 12
        model.titleText = truncate(title, width - textLeft - CARD_PADDING, 16, 600)
        model.authorText = truncate(model.author, width - textLeft - CARD_PADDING, 12, 400)
        var rootLines = wrapText(raw.summary, width - CARD_PADDING * 2, 12, 2)
        model.summaryLines = rootLines.lines
        model.summaryTruncated = rootLines.truncated
      } else {
        model.titleText = truncate(title, width - CARD_PADDING * 2, 14, 600)
        var summary = summaryLinesFor(raw, width, height)
        model.summaryLines = summary.lines
        model.summaryTruncated = summary.truncated
      }
      all.push(model)
      var visible = true
      if (settings.culling) {
        var view = settings.culling.view || { x: 0, y: 0, zoom: 1 }
        var viewport = settings.culling.viewport || { width: 1200, height: 800 }
        var margin = typeof settings.culling.margin === 'number' ? settings.culling.margin : 240
        var left = model.x * view.zoom + view.x
        var top = model.y * view.zoom + view.y
        var right = (model.x + model.w) * view.zoom + view.x
        var bottom = (model.y + model.h) * view.zoom + view.y
        visible =
          right >= -margin && left <= viewport.width + margin && bottom >= -margin && top <= viewport.height + margin
      }
      if (visible) {
        rendered.push(model)
        parentVisible[id] = true
        if (parentId && parentVisible[parentId]) {
          var parentModel = null
          for (var cursor = 0; cursor < rendered.length; cursor += 1) {
            if (rendered[cursor].id === parentId) parentModel = rendered[cursor]
          }
          if (parentModel) edges.push({ from: parentId, to: id, d: edgePath(parentModel, model), side: model.side })
        }
      }
      if (!expanded) return
      for (var indexChild = 0; indexChild < children.length; indexChild += 1) {
        walk(children[indexChild], id, depth + 1)
      }
    }

    if (doc && doc.root) walk(doc.root.id, null, 0)

    var source = all.length ? all : rendered
    var bounds = boundsOf(source)
    var collapsedCount = 0
    Object.keys(collapsed).forEach(function (id) {
      if (index.nodes[id]) collapsedCount += 1
    })
    if (
      collapsedCount === 0 &&
      doc &&
      doc.layout &&
      typeof doc.layout.width === 'number' &&
      doc.layout.width > 0 &&
      typeof doc.layout.height === 'number' &&
      doc.layout.height > 0
    ) {
      bounds = { x: 0, y: 0, width: doc.layout.width, height: doc.layout.height }
    }
    var stats = (doc && doc.stats) || {}
    return {
      nodes: rendered,
      edges: edges,
      all: all,
      bounds: bounds,
      nodeCount: all.length,
      renderedCount: rendered.length,
      stats: {
        nodes: typeof stats.nodes === 'number' ? stats.nodes : index.order.length,
        depth: typeof stats.depth === 'number' ? stats.depth : 0,
        citations: typeof stats.citations === 'number' ? stats.citations : 0,
      },
      missingLayout: missing,
    }
  }

  /** 大图按需渲染：只保留视口（含一屏余量）内的节点与其两端都可见的连线。 */
  function cullScene(scene, view, viewport, margin) {
    if (!scene || !view || scene.nodes.length <= 300) return scene
    var pad = typeof margin === 'number' ? margin : 240
    var nodes = []
    var kept = {}
    for (var index = 0; index < scene.nodes.length; index += 1) {
      var node = scene.nodes[index]
      var left = node.x * view.zoom + view.x
      var top = node.y * view.zoom + view.y
      var right = (node.x + node.w) * view.zoom + view.x
      var bottom = (node.y + node.h) * view.zoom + view.y
      if (right < -pad || left > viewport.width + pad || bottom < -pad || top > viewport.height + pad) continue
      nodes.push(node)
      kept[node.id] = true
    }
    var edges = []
    for (var cursor = 0; cursor < scene.edges.length; cursor += 1) {
      var edge = scene.edges[cursor]
      if (kept[edge.from] && kept[edge.to]) edges.push(edge)
    }
    return {
      nodes: nodes,
      edges: edges,
      all: scene.all,
      bounds: scene.bounds,
      nodeCount: scene.nodeCount,
      renderedCount: nodes.length,
      stats: scene.stats,
      culled: scene.renderedCount !== nodes.length,
    }
  }

  function navigate(scene, currentId, key) {
    // 大图裁剪后 scene.nodes 只是视口子集；键盘导航要覆盖整棵树。
    var order = scene.all && scene.all.length ? scene.all : scene.nodes
    if (!order.length) return null
    var cursor = -1
    for (var index = 0; index < order.length; index += 1) {
      if (order[index].id === currentId) {
        cursor = index
        break
      }
    }
    if (key === 'next') return order[cursor < 0 ? 0 : Math.min(order.length - 1, cursor + 1)].id
    if (key === 'previous') return order[cursor < 0 ? 0 : Math.max(0, cursor - 1)].id
    if (cursor < 0) return order[0].id
    var node = order[cursor]
    if (key === 'first') return order[0].id
    if (key === 'last') return order[order.length - 1].id
    if (key === 'child') {
      for (var next = cursor + 1; next < order.length; next += 1) {
        if (order[next].parentId === node.id) return order[next].id
      }
      return node.id
    }
    if (key === 'parent') {
      if (!node.parentId) return node.id
      for (var back = cursor - 1; back >= 0; back -= 1) {
        if (order[back].id === node.parentId) return order[back].id
      }
      return node.parentId
    }
    return node.id
  }

  function ancestorsOf(index, nodeId) {
    var output = []
    var current = index.parentOf[nodeId]
    while (current) {
      output.push(current)
      current = index.parentOf[current]
    }
    return output
  }

  return {
    MIN_ZOOM: MIN_ZOOM,
    MAX_ZOOM: MAX_ZOOM,
    FIT_MIN_ZOOM: FIT_MIN_ZOOM,
    DEPTH_TOKENS: DEPTH_TOKENS,
    clamp: clamp,
    measure: measure,
    truncate: truncate,
    wrapText: wrapText,
    boundsOf: boundsOf,
    zoomAt: zoomAt,
    toWorld: toWorld,
    fitView: fitView,
    centerOn: centerOn,
    indexMap: indexMap,
    validateMap: validateMap,
    citationCount: citationCount,
    buildScene: buildScene,
    cullScene: cullScene,
    navigate: navigate,
    ancestorsOf: ancestorsOf,
    edgePath: edgePath,
  }
})()