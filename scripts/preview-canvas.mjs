#!/usr/bin/env node
/**
 * 画布预览生成器（仅用于视觉验证，不参与插件运行时）。
 *
 * 把 src/client 的 i18n/styles/svg/views/canvas 片段与 test/fixtures/map/map-500.json
 * 拼成一个自包含 HTML，用极简 React 替身渲染真实的 VIEWS.CanvasSurface，
 * 再交给 headless Chrome 截图。
 *
 * DSH 的 --dsw-alias-* 主题变量由宿主注入。为了截图与真实主题一致，
 * 需要传入从 DSH 安装包里抽出的 token CSS：
 *   node scripts/preview-canvas.mjs --tokens D:\\Qunar\\personal\\dsh\\_tmp
 * 目录内需有 tokens-static.css / tokens-light.css / tokens-dark.css
 * （抽取方法见 docs/05-dev.md 的「主题 token 取证」一节）。
 *
 * 用法：node scripts/preview-canvas.mjs [--out DIR] [--tokens DIR]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)

function flag(name, fallback) {
  const index = argv.indexOf('--' + name)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

const OUT = path.resolve(flag('out', path.join(ROOT, '..', '_tmp', 'canvas-preview')))
const TOKENS = flag('tokens', '')

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8')
}

const tokenFiles = ['tokens-static.css', 'tokens-light.css', 'tokens-dark.css']
const tokenCSS = {}
for (const name of tokenFiles) {
  const file = TOKENS ? path.join(TOKENS, name) : ''
  tokenCSS[name] = file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!tokenCSS[name]) console.warn('[preview] 缺少 ' + name + '，截图将没有真实主题变量')
}

const source = [
  'src/client/i18n.js',
  'src/client/styles.js',
  'src/client/svg.js',
  'src/client/views/canvas.js',
  'src/client/views/detail.js',
]
  .map(read)
  .join('\n')

const DICTS = {}
for (const lang of ['zh', 'en']) {
  const raw = JSON.parse(read(`locale/${lang}.json`))
  const flat = {}
  for (const [key, value] of Object.entries(raw.ui ?? {})) flat[key] = value
  for (const [code, value] of Object.entries(raw.error ?? {})) flat[`error.${code}`] = value
  DICTS[lang] = flat
}

const MAP = JSON.parse(read('test/fixtures/map/map-500.json'))
const BOOK = {
  id: MAP.bookId,
  title: MAP.root.title,
  author: '林知远',
  format: 'epub',
  status: 'ready',
  stats: { chapters: 8, chunks: 993, chars: 128400, pages: 214 },
}

/**
 * 详情卡预览数据：真实 VIEWS.Detail 需要异步取 map 与 chunks，
 * 截图脚本直接构造同一形状的 props（组件本身仍来自 client.js）。
 */
function detailFixture() {
  const nodeId = 'n-ch-01-s01-p03'
  const nodesById = {}
  ;(function walk(node) {
    nodesById[node.id] = node
    ;(node.children || []).forEach(walk)
  })(MAP.root)
  const node = nodesById[nodeId]
  const parentOf = {}
  for (const edge of MAP.layout.edges) parentOf[edge.to] = edge.from
  const path = []
  for (let id = nodeId; id; id = parentOf[id]) path.unshift(nodesById[id]?.title || id)
  const chunks = {}
  const texts = [
    '记忆不是录像带，而是每次回想都重写一遍的草稿。',
    '同一段经历被反复讲述后，细节会被后来的解释悄悄替换。',
    '因此证词的可靠性取决于提问方式，而不只是目击者的诚实。',
  ]
  node.citations.forEach((citation, index) => {
    chunks[citation.chunkId] = {
      id: citation.chunkId,
      seq: Number(citation.chunkId.slice(2)) || index + 1,
      chapterId: 'c-01',
      chapterTitle: '第一章 记忆的暗室',
      chapterPath: '第一章 记忆的暗室',
      page: 12 + index,
      text: texts[index % texts.length],
      chars: 27,
    }
  })
  return {
    node,
    path,
    citations: {
      status: 'ready',
      items: node.citations.map((citation) => ({
        chunkId: citation.chunkId,
        quote: citation.quote || '',
        chunk: chunks[citation.chunkId],
        invalid: false,
      })),
    },
    activeCitation: node.citations[0]?.chunkId || null,
  }
}

const DETAIL = detailFixture()

function viewFor(mode) {
  if (mode === 'detail' || mode === 'detail-cite') {
    const node = MAP.layout.nodes[DETAIL.node.id]
    const zoom = 0.9
    return {
      x: Math.round(1160 / 2 - (node.x + node.w / 2) * zoom),
      y: Math.round(852 / 2 - (node.y + node.h / 2) * zoom),
      zoom,
      collapsed: [],
      selectedNodeId: DETAIL.node.id,
    }
  }
  if (mode === 'actual') {
    const focusId = 'n-ch-03'
    const layout = MAP.layout.nodes
    const node = layout[focusId] || layout[MAP.root.id]
    const kids = MAP.layout.edges.filter((edge) => edge.from === focusId).map((edge) => layout[edge.to]).filter(Boolean)
    const box = kids.reduce(
      (acc, kid) => ({
        x1: Math.min(acc.x1, kid.x),
        y1: Math.min(acc.y1, kid.y),
        x2: Math.max(acc.x2, kid.x + kid.w),
        y2: Math.max(acc.y2, kid.y + kid.h),
      }),
      { x1: node.x, y1: node.y, x2: node.x + node.w, y2: node.y + node.h },
    )
    const canvasWidth = 1160
    const canvasHeight = 852
    const zoom = 0.9
    // 90% 局部：选中章节 + 右侧一列论点，四周留出足够空白，避免截图贴边。
    const centerX = (box.x1 + Math.min(box.x2, node.x + node.w + 96 + 220)) / 2
    const centerY = node.y + node.h / 2
    return {
      x: Math.round(canvasWidth / 2 - centerX * zoom),
      y: Math.round(canvasHeight / 2 - centerY * zoom),
      zoom,
      collapsed: [],
      selectedNodeId: focusId,
    }
  }
  return { x: 0, y: 0, zoom: 0.025, collapsed: [], selectedNodeId: null }
}

function mapStateLiteral(mode) {
  if (mode === 'loading') return "{ status: 'loading', doc: null, error: null }"
  if (mode === 'missing') return "{ status: 'missing', doc: null, error: null }"
  if (mode === 'error') {
    return "{ status: 'error', doc: null, error: { code: 'E_IO', message: 'workspace storage unavailable' } }"
  }
  return "{ status: 'ready', doc: MAP, error: null, bookId: BOOK.id }"
}

function page(mode, theme) {
  const isDetail = mode === 'detail' || mode === 'detail-cite'
  const view = viewFor(mode)
  const state =
    "{ selectedNodeId: " +
    JSON.stringify(view.selectedNodeId) +
    ', selectedBookId: BOOK.id, books: [BOOK], detailOpen: ' +
    (isDetail ? 'true' : 'false') +
    ' }'
  const showCanvas = mode !== 'empty'

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>canvas preview · ${mode} · ${theme}</title>
<style>:root{${tokenCSS['tokens-static.css']}}\nbody{${tokenCSS['tokens-light.css']}}\nbody[data-ds-dark-theme]{${tokenCSS['tokens-dark.css']}}</style>
<style>
html,body{margin:0;height:100%;}
body{font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;background:var(--dsw-alias-bg-base,#fff);}
#app{height:100vh;}
.rl-root{height:100vh;}
</style>
<script>
(function () {
  var SVG_ELEMENTS = { svg: 1, g: 1, path: 1, rect: 1, circle: 1, text: 1, tspan: 1, line: 1 }
  var NS = 'http://www.w3.org/2000/svg'
  var CURSOR = 0
  var SLOTS = []
  var EFFECTS = []
  var DIRTY = false

  function useState(init) {
    var i = CURSOR++
    if (!(i in SLOTS)) SLOTS[i] = typeof init === 'function' ? init() : init
    var set = function (value) {
      SLOTS[i] = typeof value === 'function' ? value(SLOTS[i]) : value
      DIRTY = true
    }
    return [SLOTS[i], set]
  }
  function useRef(value) {
    var i = CURSOR++
    if (!(i in SLOTS)) SLOTS[i] = { current: value }
    return SLOTS[i]
  }
  function useMemo(fn) {
    CURSOR++
    return fn()
  }
  function useCallback(fn) {
    CURSOR++
    return fn
  }
  function useEffect(fn, deps) {
    var i = CURSOR++
    var slot = SLOTS[i]
    var changed = !slot || !deps || !slot.deps || deps.length !== slot.deps.length
    if (!changed) {
      for (var j = 0; j < deps.length; j += 1) if (deps[j] !== slot.deps[j]) changed = true
    }
    if (changed) {
      SLOTS[i] = { deps: deps }
      EFFECTS.push(fn)
    }
  }
  function memo(component) {
    return component
  }
  function createElement(type, props) {
    var copy = {}
    if (props) for (var key in props) copy[key] = props[key]
    if (arguments.length > 2) {
      var kids = Array.prototype.slice.call(arguments, 2)
      copy.children = kids.length === 1 ? kids[0] : kids
    }
    return { type: type, props: copy }
  }
  window.React = {
    createElement: createElement,
    useState: useState,
    useRef: useRef,
    useMemo: useMemo,
    useCallback: useCallback,
    useEffect: useEffect,
    useId: function () { return 'rl-preview' },
    memo: memo,
  }

  function kebab(name) {
    return name.replace(/[A-Z]/g, function (ch) { return '-' + ch.toLowerCase() })
  }

  function applyProps(el, props) {
    for (var key in props) {
      var value = props[key]
      if (key === 'children' || key === 'key' || key === 'ref' || key === 'dangerouslySetInnerHTML') continue
      if (key.slice(0, 2) === 'on' && typeof value === 'function') continue
      if (key === 'className') { el.setAttribute('class', value); continue }
      if (key === 'style') {
        if (typeof value === 'string') el.setAttribute('style', value)
        else for (var prop in value) el.style[prop] = value[prop]
        continue
      }
      if (value === undefined || value === null || value === false) continue
      if (value === true) { el.setAttribute(kebab(key), ''); continue }
      el.setAttribute(kebab(key), String(value))
    }
    if (props.dangerouslySetInnerHTML) el.innerHTML = props.dangerouslySetInnerHTML.__html || ''
    if (props.ref && typeof props.ref === 'object') props.ref.current = el
  }

  function render(vnode) {
    if (vnode === null || vnode === undefined || vnode === false) return null
    if (typeof vnode === 'string' || typeof vnode === 'number') return document.createTextNode(String(vnode))
    if (Array.isArray(vnode)) {
      var fragment = document.createDocumentFragment()
      vnode.forEach(function (item) {
        var child = render(item)
        if (child) fragment.appendChild(child)
      })
      return fragment
    }
    if (typeof vnode.type === 'function') return render(vnode.type(vnode.props))
    var el = SVG_ELEMENTS[vnode.type] ? document.createElementNS(NS, vnode.type) : document.createElement(vnode.type)
    applyProps(el, vnode.props || {})
    var children = vnode.props && vnode.props.children
    if (Array.isArray(children)) {
      children.forEach(function (child) {
        var node = render(child)
        if (node) el.appendChild(node)
      })
    } else if (children !== undefined && children !== null) {
      var single = render(children)
      if (single) el.appendChild(single)
    }
    return el
  }

  window.previewMount = function (vnode, container) {
    for (var attempt = 0; attempt < 4; attempt += 1) {
      CURSOR = 0
      EFFECTS = []
      DIRTY = false
      container.textContent = ''
      container.appendChild(render(vnode))
      while (EFFECTS.length) EFFECTS.shift()()
      if (!DIRTY) break
    }
  }
})()
</script>
</head>
<body${theme === 'dark' ? ' data-ds-dark-theme=""' : ''}>
<div id="app"></div>
<script>var DICTS = ${JSON.stringify(DICTS)}; var h = window.React.createElement; var VIEWS = {};
window.onerror = function (message, source, line) { document.title = 'ERR ' + message + ' @' + line };</script>
<script>${source}</script>
<script>(function () { var style = document.createElement('style'); style.textContent = STYLES; document.head.appendChild(style) })()</script>
<script>
var BOOK = ${JSON.stringify(BOOK)};
var MAP = ${JSON.stringify(MAP)};
var actions = { openDetail: function () {}, closeOverlay: function () {}, selectBook: function () {}, refresh: function () {}, toggleAsk: function () {}, closeAsk: function () {}, importBook: function () {} };
var state = ${state};
var mapState = ${mapStateLiteral(mode)};
var initialView = ${JSON.stringify(view)};
var showCanvas = ${showCanvas};

function chrome(child) {
  return h('div', { className: 'rl-root' },
    h('header', { className: 'rl-header' },
      h('span', { className: 'rl-header__title' }, t('entry.label')),
      h('span', { className: 'rl-header__spacer' }),
      h('span', { className: 'rl-header__count' }, '1 本书')),
    h('div', { className: 'rl-main', style: 'display:flex;flex:1 1 auto;min-height:0;' },
      h('aside', { className: 'rl-library' },
        h('div', { className: 'rl-library__head' }, h('span', { className: 'rl-library__title' }, '书架')),
        h('ul', { className: 'rl-library__list' },
          h('li', null,
            h('button', { className: 'rl-card', 'aria-selected': 'true' },
              h('span', { className: 'rl-card__title' }, BOOK.title),
              h('span', { className: 'rl-card__meta' }, BOOK.author + ' · ' + BOOK.format.toUpperCase()))))),
      child))
}

var child = showCanvas
  ? h(VIEWS.CanvasSurface, {
      book: BOOK,
      mapState: mapState,
      state: state,
      actions: actions,
      initialView: initialView,
      onRetry: function () {},
    })
  : h(VIEWS.Canvas, { state: { books: [], selectedBookId: null, selectedNodeId: null, detailOpen: false }, actions: actions });

if (${JSON.stringify(isDetail)}) {
  var detail = ${JSON.stringify(
    isDetail
      ? { node: DETAIL.node, path: DETAIL.path, citations: DETAIL.citations.items, activeCitation: mode === 'detail-cite' ? DETAIL.activeCitation : null }
      : null,
  )};
  var surface = h('div', { className: 'rl-canvas-host', style: 'position:relative;flex:1 1 auto;min-width:0;min-height:0;display:flex;' }, child);
  var card = h(VIEWS.DetailCard, {
    node: detail.node,
    book: BOOK,
    doc: MAP,
    path: detail.path,
    citations: detail.citations,
    citationsStatus: 'ready',
    activeCitation: detail.activeCitation,
    flash: detail.activeCitation ? true : false,
    copied: false,
    onCite: function () {},
    onCopy: function () {},
    onAsk: function () {},
    onClose: function () {},
  });
  child = h('div', { style: 'position:relative;display:flex;flex:1 1 auto;min-width:0;min-height:0;' }, surface, card);
}

window.previewMount(chrome(child), document.getElementById('app'));
</script>
</body>
</html>`
}

fs.mkdirSync(OUT, { recursive: true })
const written = []
for (const mode of ['fit', 'actual', 'detail', 'detail-cite', 'loading', 'missing', 'error', 'empty']) {
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark' && !['actual', 'fit', 'error', 'detail', 'detail-cite'].includes(mode)) continue
    const file = path.join(OUT, 'canvas-' + mode + '-' + theme + '.html')
    fs.writeFileSync(file, page(mode, theme))
    written.push(file)
  }
}
console.log('wrote ' + written.length + ' preview(s) to ' + OUT)