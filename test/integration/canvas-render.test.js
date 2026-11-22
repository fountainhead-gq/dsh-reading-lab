import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MAP = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/map/map-500.json'), 'utf8'))
const BOOK = { id: 'b-time-lamp', title: '时间之灯', author: '林晚', format: 'epub' }

function createReactShim() {
  const Fragment = Symbol.for('react.fragment')
  function createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  }
  return {
    Fragment,
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => fn(),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (initial) => ({ current: initial }),
    useId: () => 'rl-id',
    memo: (component) => component,
    Children: { toArray: (children) => (Array.isArray(children) ? children : [children]) },
  }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textOf)
  if (typeof node.type === 'function') return textOf(node.type(node.props ?? {}))
  return textOf(node.props?.children)
}

function collectStyles(node) {
  if (!node || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap(collectStyles)
  if (typeof node.type === 'function') return collectStyles(node.type(node.props ?? {}))
  const own = node.type === 'style' && node.props?.dangerouslySetInnerHTML ? [node.props.dangerouslySetInnerHTML.__html] : []
  return own.concat(collectStyles(node.props?.children))
}

function findAll(node, predicate, output = []) {
  if (!node || typeof node !== 'object') return output
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, predicate, output)
    return output
  }
  if (predicate(node)) output.push(node)
  if (typeof node.type === 'function') findAll(node.type(node.props ?? {}), predicate, output)
  else findAll(node.props?.children, predicate, output)
  return output
}

function findComponentType(node, name, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findComponentType(item, name, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof node.type === 'function') {
    if (node.type.name === name) return node.type
    return findComponentType(node.type(node.props ?? {}), name, depth + 1)
  }
  return findComponentType(node.props?.children, name, depth + 1)
}

async function loadClient() {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const errors = []
  let entry = null
  const sandbox = {
    console: { log() {}, info() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    Object,
    Array,
    Set,
    Map,
    String,
    Number,
    Boolean,
    Math,
    Date,
    Error,
    encodeURIComponent,
    decodeURIComponent,
    navigator: { language: 'zh-CN', languages: ['zh-CN'] },
    location: { href: 'http://127.0.0.1:5807/' },
    localStorage: {
      _data: new Map(),
      getItem(key) {
        return this._data.has(key) ? this._data.get(key) : null
      },
      setItem(key, value) {
        this._data.set(key, String(value))
      },
      removeItem(key) {
        this._data.delete(key)
      },
    },
    fetch: async () => ({ status: 200, json: async () => ({ ok: true, data: { books: [], revision: 0 } }) }),
    document: { createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} } },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = {
    load(descriptor) {
      entry = descriptor
    },
  }
  sandbox.require = (id) => {
    if (id === 'react') return createReactShim()
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${id}`)
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(entry)
  const registrations = []
  const ctx = {
    locale: { register() { return () => {} }, bind() { return (key) => key }, current: 'zh' },
    slots: {
      inject(_name, fn) {
        return fn()
      },
      register(meta, component) {
        registrations.push({ meta, component })
        return () => {}
      },
    },
    effect(fn) {
      return fn()
    },
    layout: { toggleSidebar() {}, openDetails() {}, closeDetails() {} },
  }
  const plugin = entry.factory(sandbox.require)
  plugin.apply(ctx)
  const main = registrations.find((item) => item.meta.name === 'main')
  const Canvas = findComponentType(main.component({}), 'Canvas')
  assert.ok(Canvas, 'main 渲染树里应有 Canvas 组件')
  const actions = {
    openDetail() {},
    closeOverlay() {},
    selectBook() {},
    refresh() {},
    toggleAsk() {},
    closeAsk() {},
    importBook() {},
  }
  const readyState = { selectedNodeId: null, books: [BOOK], selectedBookId: BOOK.id }
  const canvasTree = Canvas({ state: readyState, actions })
  const CanvasSurface = findComponentType(canvasTree, 'CanvasSurface')
  assert.ok(CanvasSurface, 'Canvas 选中书后应渲染 CanvasSurface')
  const CanvasState = findComponentType(CanvasSurface({ book: BOOK, mapState: { status: 'loading' }, state: readyState, actions }), 'CanvasState')
  assert.ok(CanvasState, '非 ready 状态应渲染 CanvasState')
  return { sandbox, Canvas, CanvasSurface, CanvasState, actions, readyState, errors }
}

function renderSurface(components, overrides = {}) {
  return components.CanvasSurface({
    book: BOOK,
    mapState: { status: 'ready', doc: MAP, error: null, bookId: BOOK.id },
    state: components.readyState,
    actions: components.actions,
    initialView: { x: 0, y: 0, zoom: 0.02, collapsed: [], selectedNodeId: null },
    onRetry() {},
    ...overrides,
  })
}

describe('SVG 导图画布渲染', () => {
  it('500 节点渲染成 500 个 treeitem 与 499 条贝塞尔连线', async () => {
    const components = await loadClient()
    const tree = renderSurface(components)
    const items = findAll(tree, (node) => node.type === 'g' && node.props?.role === 'treeitem')
    const edges = findAll(tree, (node) => node.type === 'path' && String(node.props?.className || '').includes('rl-edge'))
    assert.equal(items.length, 500)
    assert.equal(edges.length, 499)
    for (const edge of edges) assert.match(edge.props.d, /^M [\d.-]+ [\d.-]+ C /)
    assert.deepEqual(components.errors, [])
  })

  it('根卡绘制自绘封面首字、书名与作者', async () => {
    const components = await loadClient()
    const tree = renderSurface(components)
    const root = findAll(tree, (node) => node.type === 'g' && node.props?.role === 'treeitem' && node.props?.['data-node-id'] === 'n-root')
    assert.equal(root.length, 1)
    const text = textOf(root[0]).join(' ')
    assert.match(text, /时间之灯/)
    assert.match(text, /林晚/)
    assert.match(text, /时/)
    assert.equal(root[0].props['aria-level'], '1')
    assert.equal(root[0].props['aria-expanded'], 'true')
  })

  it('节点卡片带标题、摘要、引用角标与层级色条', async () => {
    const components = await loadClient()
    const tree = renderSurface(components)
    const point = findAll(tree, (node) => node.type === 'g' && node.props?.['data-node-id'] === 'n-ch-01-s01-p01')
    assert.equal(point.length, 1)
    const text = textOf(point[0]).join(' ')
    assert.match(text, /处引用/)
    assert.ok(point[0].props['aria-label'].includes('处引用'))
    assert.equal(point[0].props['aria-expanded'], undefined)
    const styled = findAll(point[0], (node) => node.type === 'rect' && node.props?.className === 'rl-node__bar')
    assert.equal(styled.length, 1, '非根卡片有 3px 层级色条')
  })

  it('状态栏展示节点数/引用数，缩放条默认 100%', async () => {
    const components = await loadClient()
    const tree = renderSurface(components, {
      initialView: { x: 0, y: 0, zoom: 1, collapsed: [], selectedNodeId: null },
    })
    const text = textOf(tree).join(' ')
    assert.match(text, /500 节点 · 993 条引用/)
    assert.match(text, /100%/)
    // R8：缩放控件在顶部 HUD 里、按钮图标化，「适应窗口」只留在 aria-label 上。
    const fit = findAll(tree, (node) => node.props?.['aria-label'] === '适应窗口')
    assert.equal(fit.length, 1, '应有「适应窗口」按钮')
    assert.equal(textOf(fit).join('').trim(), '', '按钮只显示图标，不显示文字')
    const zoombar = findAll(tree, (node) => node.props?.className === 'rl-canvas__zoombar')
    assert.equal(zoombar.length, 1)
    const hud = findAll(tree, (node) => node.props?.className === 'rl-canvas__hud')
    assert.equal(hud.length, 1)
    assert.ok(
      JSON.stringify(hud[0]).includes('rl-canvas__zoombar'),
      '缩放条应与搜索/统计同一行（顶部），不再浮在右下角',
    )
    const search = findAll(tree, (node) => node.type === 'input' && node.props?.type === 'search')
    assert.equal(search.length, 1)
    assert.equal(search[0].props.placeholder, '搜索节点标题')
  })

  it('空态：没有选中书时提示选一本书', async () => {
    const components = await loadClient()
    const tree = components.Canvas({ state: { books: [], selectedBookId: null, selectedNodeId: null }, actions: {} })
    const text = textOf(tree).join(' ')
    assert.match(text, /选一本书开始/)
    assert.match(text, /思维导图会出现在这里/)
    assert.equal(findAll(tree, (node) => node.type === 'section' && String(node.props?.className || '').includes('rl-canvas--map')).length, 0)
  })

  it('加载/缺失/错误三态都有文案，错误态显示错误码并可重试', async () => {
    const components = await loadClient()
    let retried = 0
    const onRetry = () => {
      retried += 1
    }
    const loading = textOf(components.CanvasState({ status: 'loading', book: BOOK })).join(' ')
    assert.match(loading, /正在生成导图/)
    const missing = textOf(components.CanvasState({ status: 'missing', book: BOOK, onRetry })).join(' ')
    assert.match(missing, /这本书还没有导图/)
    const error = components.CanvasState({ status: 'error', book: BOOK, error: { code: 'E_IO' }, onRetry })
    const text = textOf(error).join(' ')
    assert.match(text, /导图加载失败/)
    assert.match(text, /E_IO/)
    const retry = findAll(error, (node) => node.type === 'button')
    assert.equal(retry.length, 1)
    retry[0].props.onClick()
    assert.equal(retried, 1)
  })

  it('ready 但 layout 非法的 map 降级为 E_MAP_INVALID 错误态', async () => {
    const components = await loadClient()
    const broken = JSON.parse(JSON.stringify(MAP))
    delete broken.layout.nodes['n-ch-02']
    const tree = renderSurface(components, { mapState: { status: 'ready', doc: broken, error: null, bookId: BOOK.id } })
    const text = textOf(tree).join(' ')
    assert.match(text, /导图加载失败/)
    assert.match(text, /E_MAP_INVALID/)
  })

  it('收起状态只渲染可见子树', async () => {
    const components = await loadClient()
    const tree = renderSurface(components, {
      initialView: { x: 0, y: 0, zoom: 0.02, collapsed: ['n-ch-01'], selectedNodeId: null },
    })
    const items = findAll(tree, (node) => node.type === 'g' && node.props?.role === 'treeitem')
    assert.ok(items.length < 500)
    assert.equal(items.some((node) => node.props['data-node-id'] === 'n-ch-01'), true)
    assert.equal(items.some((node) => node.props['data-node-id'] === 'n-ch-01-s01'), false)
  })

  it('m01951：悬浮卡片浮出「询问 AI / 详情」按钮，点击直接触发对应 action', async () => {
    const components = await loadClient()
    const CanvasNode = findComponentType(renderSurface(components), 'CanvasNode')
    assert.ok(CanvasNode, '画布应渲染 CanvasNode')
    const calls = []
    const node = {
      id: 'n-ask',
      depth: 2,
      side: 'right',
      x: 0,
      y: 0,
      w: 300,
      h: 96,
      isRoot: false,
      title: '示例节点',
      titleText: '示例节点',
      author: '',
      coverChar: '',
      summaryLines: ['摘要一句话'],
      summaryTruncated: false,
      citationCount: 2,
      questions: 0,
      hasChildren: true,
      expanded: true,
      selected: false,
      childCount: 2,
    }
    const tree = CanvasNode({
      node,
      focused: false,
      hovered: true,
      onSelect() {},
      onToggle() {},
      onFocus() {},
      onHover() {},
      onAsk: (id) => calls.push(['ask', id]),
      onDetail: (id) => calls.push(['detail', id]),
      onResize() {},
    })
    const bar = findAll(tree, (el) => el.props?.className === 'rl-node__actions')
    assert.equal(bar.length, 1, '悬停时应出现卡片工具条')
    const askBtn = findAll(tree, (el) => el.props?.['data-node-action'] === 'ask')[0]
    const detailBtn = findAll(tree, (el) => el.props?.['data-node-action'] === 'detail')[0]
    assert.ok(askBtn, '工具条应含询问 AI 按钮')
    assert.ok(detailBtn, '工具条应含详情按钮')
    askBtn.props.onClick({ stopPropagation() {} })
    detailBtn.props.onClick({ stopPropagation() {} })
    assert.deepEqual(calls, [
      ['ask', node.id],
      ['detail', node.id],
    ])
  })

  it('m01951：未悬停不出工具条，根卡不提供宽度手柄', async () => {
    const components = await loadClient()
    const CanvasNode = findComponentType(renderSurface(components), 'CanvasNode')
    const base = {
      id: 'n-x',
      depth: 2,
      x: 0,
      y: 0,
      w: 300,
      h: 96,
      isRoot: false,
      title: '示例',
      titleText: '示例',
      author: '',
      coverChar: '',
      summaryLines: [],
      summaryTruncated: false,
      citationCount: 0,
      questions: 0,
      hasChildren: false,
      expanded: false,
      selected: false,
      childCount: 0,
    }
    const plain = CanvasNode({
      node: base,
      focused: false,
      hovered: false,
      onSelect() {},
      onToggle() {},
      onFocus() {},
      onHover() {},
      onAsk() {},
      onDetail() {},
      onResize() {},
    })
    assert.equal(findAll(plain, (el) => el.props?.className === 'rl-node__actions').length, 0)
    const root = CanvasNode({
      node: Object.assign({}, base, { id: 'n-root', isRoot: true, depth: 0 }),
      focused: false,
      hovered: true,
      onSelect() {},
      onToggle() {},
      onFocus() {},
      onHover() {},
      onAsk() {},
      onDetail() {},
      onResize() {},
    })
    assert.equal(
      findAll(root, (el) => el.props?.className === 'rl-node__resize').length,
      0,
      '根卡不提供宽度手柄',
    )
  })

  it('m01951：HUD 提供展开全部 / 收起全部，收起后可见节点变少', async () => {
    const components = await loadClient()
    const tree = renderSurface(components)
    const collapseBtn = findAll(tree, (el) => el.props?.['data-canvas-action'] === 'collapse-all')[0]
    const expandBtn = findAll(tree, (el) => el.props?.['data-canvas-action'] === 'expand-all')[0]
    assert.ok(collapseBtn, 'HUD 应有收起全部按钮')
    assert.ok(expandBtn, 'HUD 应有展开全部按钮')
    assert.equal(typeof collapseBtn.props.onClick, 'function')
    assert.equal(typeof expandBtn.props.onClick, 'function')

    // m02220：连根节点一起折叠 —— 收起全部后画布上只剩根卡，等价于「完整收叠到一起」。
    const folded = []
    function collect(node) {
      if (!node || typeof node !== 'object') return
      const kids = Array.isArray(node.children) ? node.children : []
      if (kids.length > 0) folded.push(node.id)
      kids.forEach(collect)
    }
    collect(MAP.root)
    assert.ok(folded.length > 0, '夹具应有多层节点')

    const expandedCount = findAll(tree, (el) => el.type === 'g' && el.props?.role === 'treeitem').length
    const foldedTree = renderSurface(components, {
      initialView: { x: 0, y: 0, zoom: 0.02, collapsed: folded, selectedNodeId: null },
    })
    const foldedItems = findAll(foldedTree, (el) => el.type === 'g' && el.props?.role === 'treeitem')
    assert.equal(foldedItems.length, 1, '收起全部后应只剩根卡')
    assert.ok(foldedItems.length < expandedCount, '收起后渲染的节点数应减少')
  })

  it('m02220：点卡片只选中，不打开详情', async () => {
    const components = await loadClient()
    const calls = []
    const tree = renderSurface(components, {
      actions: {
        selectNode(id) {
          calls.push(['select', id])
        },
        openDetail(id) {
          calls.push(['detail', id])
        },
        askNode(id) {
          calls.push(['ask', id])
        },
      },
    })
    const item = findAll(tree, (el) => el.type === 'g' && el.props?.role === 'treeitem')[0]
    item.props.onClick({ stopPropagation() {} })
    assert.deepEqual(
      calls,
      [['select', item.props['data-node-id']]],
      '单击只选中；详情与询问只能从悬浮工具条进入',
    )
  })

  it('m02220：悬浮工具条含透明桥接区，鼠标可从卡片移到按钮', async () => {
    const components = await loadClient()
    const tree = renderSurface(components)
    const nodeId = 'n-ch-03'
    const CanvasNode = findComponentType(tree, 'CanvasNode')
    const hovered = CanvasNode({
      node: Object.assign({}, MAP.layout ? {} : {}, {
        id: nodeId,
        depth: 2,
        x: 0,
        y: 0,
        w: 320,
        h: 96,
        isRoot: false,
        title: '示例',
        titleText: '示例',
        author: '',
        coverChar: '',
        summaryLines: [],
        summaryTruncated: false,
        citationCount: 0,
        questions: 0,
        hasChildren: false,
        expanded: false,
        selected: false,
        childCount: 0,
      }),
      focused: false,
      hovered: true,
      onSelect() {},
      onToggle() {},
      onFocus() {},
      onHover() {},
      onAsk() {},
      onDetail() {},
      onResize() {},
      zoom: 1,
    })
    const bridge = findAll(hovered, (el) => el.props?.className === 'rl-node__bridge')
    assert.equal(bridge.length, 1, '工具条与卡片之间要有桥接区，避免移过去就消失')
    // 工具条组 translate(barX,-34)；桥接区从 y=24 起 12px → 世界坐标 -10..2，正好盖住空隙并压住卡片顶边。
    assert.equal(bridge[0].props.y + bridge[0].props.height - 34, 2, '桥接区应覆盖工具条到卡片顶边的空隙')
  })

  it('画布 CSS 只用 --dsw-alias-* token，不含硬编码颜色', async () => {
    const components = await loadClient()
    const css = collectStyles(renderSurface(components)).join('\n')
    assert.ok(css.length > 1000)
    assert.match(css, /var\(--dsw-alias-/)
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(css, /\brgba?\(/)
    assert.doesNotMatch(css, /\bhsla?\(/)
    assert.doesNotMatch(css, /prefers-color-scheme/)
    assert.doesNotMatch(css, /\bpx\b[^;{}]*#[0-9a-fA-F]/)
  })

  it('缩放/平移后的 transform 不出现 NaN', async () => {
    const components = await loadClient()
    const tree = renderSurface(components, {
      initialView: { x: -100, y: -200, zoom: 0.02, collapsed: [], selectedNodeId: 'n-ch-03' },
      state: { ...components.readyState, selectedNodeId: 'n-ch-03' },
    })
    const group = findAll(tree, (node) => node.type === 'g' && String(node.props?.transform || '').includes('scale('))
    assert.equal(group.length, 1)
    assert.doesNotMatch(group[0].props.transform, /NaN|Infinity/)
    const selected = findAll(tree, (node) => node.type === 'g' && node.props?.['aria-selected'] === 'true')
    assert.equal(selected.length, 1)
    assert.equal(selected[0].props['data-node-id'], 'n-ch-03')
  })
})