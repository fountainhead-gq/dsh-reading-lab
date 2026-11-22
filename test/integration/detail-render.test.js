import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MAP = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/map/map-500.json'), 'utf8'))
const BOOK = {
  id: MAP.bookId,
  title: '时间之灯：记忆如何塑造我们',
  author: '林晚',
  format: 'epub',
  mapUpdatedAt: '2026-11-20T01:02:03.000Z',
}
// 探测组件类型时用不同的缓存键，避免成功的 map 进入正式用例的缓存。
const PROBE_BOOK = { ...BOOK, mapUpdatedAt: 'probe-map' }
const NODE_ID = 'n-ch-01-s01-p03'
const NODE = (function find(node, id) {
  if (!node) return null
  if (node.id === id) return node
  for (const child of node.children || []) {
    const found = find(child, id)
    if (found) return found
  }
  return null
})(MAP.root, NODE_ID)
const CITATION_IDS = NODE.citations.map((citation) => citation.chunkId).slice(0, 3)
const CARD_NODE = { ...NODE, questions: ['这条线索在后续论证里如何被使用？', '作者这里的证据强度如何？'] }

function chunkFor(chunkId, index = 0) {
  return {
    id: chunkId,
    seq: 100 + index,
    chapterId: 'ch-01',
    chapterTitle: '第一章 记忆的暗室',
    chapterPath: ['第一章 记忆的暗室'],
    page: 12 + index,
    text: '原文 ' + chunkId + '：记忆不是录像带，而是每次回想都重写一遍的草稿。',
    chars: 31 + index,
  }
}

function citationItem(chunkId, index = 0, invalid = false) {
  return {
    chunkId,
    quote: '',
    chunk: invalid ? null : chunkFor(chunkId, index),
    invalid,
  }
}

/* ---------- 带状态的极简 React：useState 可触发重渲染，useEffect 在渲染后执行 ---------- */

function createReactShim() {
  const Fragment = Symbol.for('react.fragment')
  const instances = new Map()
  const types = new Map()
  let current = null
  let effectQueue = []
  let dirty = false

  function enter(key) {
    let instance = instances.get(key)
    if (!instance) {
      instance = { key, list: [], index: 0 }
      instances.set(key, instance)
    }
    instance.index = 0
    const previous = current
    current = instance
    return () => {
      current = previous
    }
  }

  function createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  }

  function useState(initial) {
    if (!current) throw new Error('useState outside render')
    const instance = current
    const index = instance.index++
    if (!Object.prototype.hasOwnProperty.call(instance.list, index)) {
      instance.list[index] = { value: typeof initial === 'function' ? initial() : initial }
    }
    const slot = instance.list[index]
    const setValue = (next) => {
      const value = typeof next === 'function' ? next(slot.value) : next
      if (!Object.is(value, slot.value)) {
        slot.value = value
        dirty = true
      }
    }
    return [slot.value, setValue]
  }

  function depsEqual(previous, next) {
    if (!previous || !next || previous.length !== next.length) return false
    for (let i = 0; i < next.length; i += 1) {
      if (!Object.is(previous[i], next[i])) return false
    }
    return true
  }

  function useEffect(fn, deps) {
    if (!current) return
    const instance = current
    const index = instance.index++
    let slot = instance.list[index]
    if (!slot) {
      slot = { deps: null, cleanup: null }
      instance.list[index] = slot
    }
    if (deps && depsEqual(slot.deps, deps)) return
    slot.deps = deps || null
    effectQueue.push(() => {
      if (typeof slot.cleanup === 'function') slot.cleanup()
      const cleanup = fn()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : null
    })
  }

  function useMemo(fn, deps) {
    if (!current) return fn()
    const instance = current
    const index = instance.index++
    let slot = instance.list[index]
    if (!slot) {
      slot = { deps: null, value: undefined }
      instance.list[index] = slot
    }
    if (!deps || !depsEqual(slot.deps, deps)) {
      slot.value = fn()
      slot.deps = deps || null
    }
    return slot.value
  }

  function useCallback(fn, deps) {
    return useMemo(() => fn, deps)
  }

  function useRef(initial) {
    if (!current) return { current: initial }
    const instance = current
    const index = instance.index++
    if (!instance.list[index]) instance.list[index] = { current: initial }
    return instance.list[index]
  }

  function renderNode(node, key) {
    if (node === null || node === undefined || typeof node === 'boolean') return node
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, key + '#' + index))
    if (typeof node.type === 'function') {
      if (node.type.name) types.set(node.type.name, node.type)
      const childKey = key + '>' + (node.type.name || 'anonymous')
      const leave = enter(childKey)
      let output
      try {
        output = node.type(node.props || {})
      } finally {
        leave()
      }
      return renderNode(output, childKey)
    }
    return {
      ...node,
      props: { ...(node.props || {}), children: renderNode(node.props?.children, key + '/c') },
    }
  }

  function render(root, key = 'root') {
    let rounds = 0
    let tree = null
    do {
      dirty = false
      effectQueue = []
      tree = renderNode(root, key)
      const effects = effectQueue
      effectQueue = []
      for (const effect of effects) effect()
      rounds += 1
    } while (dirty && rounds < 12)
    return tree
  }

  const React = {
    Fragment,
    createElement,
    useState,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    useId: () => 'rl-id',
    memo: (component) => component,
    Children: { toArray: (children) => (Array.isArray(children) ? children : [children]) },
  }
  return { React, render, types }
}

/* ---------- 元素查询 ---------- */

function classList(node) {
  const value = node?.props?.className
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
}

function findAll(node, predicate, output = []) {
  if (!node || typeof node !== 'object') return output
  if (Array.isArray(node)) {
    for (const item of node) findAll(item, predicate, output)
    return output
  }
  if (predicate(node)) output.push(node)
  findAll(node.props?.children, predicate, output)
  return output
}

function byClass(node, className) {
  return findAll(node, (element) => classList(element).includes(className))
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

function textByClass(node, className) {
  return byClass(node, className).map(textOf).join(' ')
}

function buttonByText(node, label) {
  const found = findAll(
    node,
    (element) => element.type === 'button' && !element.props?.disabled && textOf(element).includes(label),
  )
  assert.equal(found.length, 1, 'expected one button containing ' + label)
  return found[0]
}

function citationButton(node, chunkId) {
  const found = findAll(node, (element) => element.props?.['data-citation'] === chunkId)
  assert.equal(found.length, 1, 'expected one citation button for ' + chunkId)
  return found[0]
}

function cssOf(tree) {
  return findAll(
    tree,
    (element) => element.type === 'style' && element.props?.dangerouslySetInnerHTML?.__html,
  )
    .map((element) => element.props.dangerouslySetInnerHTML.__html)
    .join('\n')
}

/* ---------- 加载真实的 client.js ---------- */

async function loadClient(options = {}) {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const { React, render, types } = createReactShim()
  const errors = []
  const timers = []
  let entry = null
  // 组件类型探测阶段固定用成功响应，之后再切到本用例的失败注入。
  const responses = {}
  function setResponses(next) {
    for (const key of Object.keys(responses)) delete responses[key]
    Object.assign(responses, next || {})
  }
  const sandbox = {
    console: {
      log() {},
      info() {},
      warn() {},
      error: (...args) => errors.push(args.join(' ')),
    },
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, cancelled: false })
      return timers.length
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cancelled = true
    },
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
    navigator: {
      language: 'zh-CN',
      languages: ['zh-CN'],
      clipboard: { writeText: async (text) => { sandbox.__copied = text } },
    },
    location: { href: 'http://127.0.0.1:5807/' },
    localStorage: {
      _data: new Map(),
      getItem(key) { return this._data.has(key) ? this._data.get(key) : null },
      setItem(key, value) { this._data.set(key, String(value)) },
      removeItem(key) { this._data.delete(key) },
    },
    fetch: async (url) => {
      const requestUrl = String(url)
      if (requestUrl.includes('/map')) {
        if (responses.map === 'missing') {
          return {
            status: 404,
            json: async () => ({ ok: false, error: { code: 'E_NOT_FOUND', message: 'no map', details: { reason: 'no-map' } } }),
          }
        }
        if (responses.map === 'error') {
          return { status: 500, json: async () => ({ ok: false, error: { code: 'E_IO', message: 'read failed' } }) }
        }
        return { status: 200, json: async () => ({ ok: true, data: MAP }) }
      }
      if (requestUrl.includes('/chunks')) {
        if (responses.chunks === 'missing') {
          return {
            status: 404,
            json: async () => ({ ok: false, error: { code: 'E_NOT_FOUND', message: 'chunks missing', details: { reason: 'chunks' } } }),
          }
        }
        if (responses.chunks === 'error') {
          return { status: 500, json: async () => ({ ok: false, error: { code: 'E_IO', message: 'read failed' } }) }
        }
        const ids = decodeURIComponent(requestUrl.split('ids=')[1] || '')
          .split(',')
          .filter(Boolean)
        const chunks = ids.map((id, index) => chunkFor(id, index))
        return { status: 200, json: async () => ({ ok: true, data: { total: chunks.length, chunks, missing: [] } }) }
      }
      return { status: 200, json: async () => ({ ok: true, data: { books: [BOOK], revision: 1 } }) }
    },
    document: {
      createElement: () => ({ style: {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById: () => null,
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = {
    load(descriptor) {
      entry = descriptor
    },
  }
  sandbox.require = (id) => {
    if (id === 'react') return React
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error('unexpected require: ' + id)
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(entry)
  const registrations = []
  const ctx = {
    locale: { register() { return () => {} }, bind() { return (key) => key }, current: 'zh' },
    slots: {
      inject(_name, fn) { return fn() },
      register(meta, component) {
        registrations.push({ meta, component })
        return () => {}
      },
    },
    effect(fn) { return fn() },
    layout: { toggleSidebar() {}, openDetails() {}, closeDetails() {} },
  }
  const plugin = entry.factory(sandbox.require)
  plugin.apply(ctx)

  const main = registrations.find((item) => item.meta.name === 'main')
  assert.ok(main)
  render(main.component({}), 'panel')

  async function settle(root, times = 4, key = 'root') {
    let tree = render(root, key)
    for (let i = 0; i < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      tree = render(root, key)
    }
    return tree
  }

  // 探测一次完整的 Shell（详情打开）：既验证接线，也让组件类型进入 types 表。
  const ShellType = types.get('Shell')
  assert.ok(ShellType, 'main 渲染树里应出现 Shell 组件')
  await settle(
    React.createElement(ShellType, {
      state: readyState({ books: [PROBE_BOOK], selectedBookId: PROBE_BOOK.id }),
      actions: makeActions().actions,
    }),
    3,
    'probe',
  )
  setResponses(options.responses)
  for (const name of ['Detail', 'DetailCard', 'Shell', 'Canvas']) {
    assert.ok(types.get(name), 'main 渲染树里应出现 ' + name + ' 组件')
  }

  return { sandbox, registrations, React, h: React.createElement, render, settle, errors, timers, types }
}

function readyState(overrides = {}) {
  return {
    status: 'idle',
    books: [BOOK],
    selectedBookId: BOOK.id,
    selectedNodeId: NODE_ID,
    detailOpen: true,
    askOpen: false,
    lastError: null,
    storage: 'ok',
    ...overrides,
  }
}

function makeActions() {
  const calls = { openDetail: [], toggleAsk: 0 }
  return {
    calls,
    actions: {
      openDetail: (id) => calls.openDetail.push(id),
      toggleAsk: () => { calls.toggleAsk += 1 },
      closeOverlay: () => {},
      selectBook: () => {},
      refresh: () => {},
      importBook: () => {},
      closeAsk: () => {},
    },
  }
}

const DOC = { generatedAt: '2026-11-20T01:02:03.000Z' }
const PATH = ['时间之灯：记忆如何塑造我们', '第一章 记忆的暗室', '第一节 线索的边界', '论点 3：线索的边界条件']

describe('卡片详情抽屉（t14）', () => {
  it('详情卡渲染标题、摘要、引用列表、追问与工具栏', async () => {
    const { h, types, render } = await loadClient()
    const tree = render(
      h(types.get('DetailCard'), {
        node: CARD_NODE,
        book: BOOK,
        doc: DOC,
        path: PATH,
        citations: CITATION_IDS.map((id, index) => citationItem(id, index)),
        citationsStatus: 'ready',
        activeCitation: null,
        flash: false,
        copied: '',
        onCite: () => {},
        onCopy: () => {},
        onAsk: () => {},
        onClose: () => {},
      }),
    )
    const aside = byClass(tree, 'rl-detail--card')
    assert.equal(aside.length, 1)
    assert.equal(aside[0].props['data-node-id'], NODE_ID)
    assert.equal(aside[0].props.role, 'complementary')
    assert.match(textByClass(tree, 'rl-detail__title'), new RegExp(NODE.title.slice(0, 6)))
    assert.match(textByClass(tree, 'rl-detail__summary'), new RegExp(NODE.summary.slice(0, 8)))
    assert.match(textByClass(tree, 'rl-detail__crumb'), /第一章/)
    assert.equal(textByClass(tree, 'rl-detail__count'), '3 处')
    assert.equal(byClass(tree, 'rl-detail__cite').length, 3)
    assert.match(textOf(citationButton(tree, CITATION_IDS[0])), new RegExp(CITATION_IDS[0]))
    assert.match(textOf(citationButton(tree, CITATION_IDS[0])), /第一章 记忆的暗室/)
    assert.match(textOf(citationButton(tree, CITATION_IDS[0])), /第 12 页/)
    const questions = byClass(tree, 'rl-detail__question')
    assert.equal(questions.length, CARD_NODE.questions.length)
    assert.match(textOf(questions[0]), new RegExp(CARD_NODE.questions[0].slice(0, 8)))
    assert.match(textByClass(tree, 'rl-detail__muted'), /导图更新于 2026-11-20 \d\d:\d\d/)
    assert.ok(buttonByText(tree, '复制正文'))
    assert.ok(buttonByText(tree, '复制引用'))
    assert.ok(buttonByText(tree, '询问 AI'))
    assert.ok(buttonByText(tree, '关闭详情'))
  })

  it('详情卡只使用主题 token，抽屉绝对定位不挤压画布', async () => {
    const { h, types, render } = await loadClient()
    const tree = render(
      h(types.get('DetailCard'), {
        node: CARD_NODE,
        book: BOOK,
        doc: DOC,
        path: PATH,
        citations: [],
        citationsStatus: 'ready',
        activeCitation: null,
        onClose: () => {},
      }),
    )
    const css = cssOf(tree)
    assert.match(css, /\.rl-detail\.rl-detail--card\{[^}]*position:absolute/)
    assert.match(css, /\.rl-detail\.rl-detail--card\{[^}]*width:360px/)
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i)
    assert.doesNotMatch(css, /rgba?\(|hsla?\(/i)
    assert.doesNotMatch(css, /prefers-color-scheme/i)
    assert.match(css, /var\(--dsw-alias-label-primary\)/)
  })

  it('m02220：带卡片锚点时详情浮层贴在卡片右侧，右侧放不下翻到左侧', async () => {
    const { h, types, render } = await loadClient()
    const base = {
      node: CARD_NODE,
      book: BOOK,
      doc: DOC,
      path: PATH,
      citations: [],
      citationsStatus: 'ready',
      activeCitation: null,
      onClose: () => {},
    }
    const tree = render(
      h(types.get('DetailCard'), {
        ...base,
        anchor: { left: 100, top: 80, width: 300, height: 120, mainWidth: 1200, mainHeight: 800 },
      }),
    )
    const card = byClass(tree, 'rl-detail--anchored')[0]
    assert.ok(card, '有锚点时应带 rl-detail--anchored')
    assert.equal(card.props.style.position, 'absolute')
    assert.equal(card.props.style.left, '414px')
    assert.equal(card.props.style.top, '74px')
    assert.equal(card.props.style.maxHeight, '714px', '高度从卡片顶部往下展开，底部留 12px')

    const tight = render(
      h(types.get('DetailCard'), {
        ...base,
        anchor: { left: 900, top: 40, width: 260, height: 100, mainWidth: 1200, mainHeight: 800 },
      }),
    )
    assert.equal(byClass(tight, 'rl-detail--anchored')[0].props.style.left, '466px', '右侧放不下时翻到卡片左侧')

    const docked = render(h(types.get('DetailCard'), base))
    assert.equal(byClass(docked, 'rl-detail--anchored').length, 0, '没有锚点时保持右侧停靠')
  })

  it('点引用打开原文：标记按下、展示 chunk 原文、高亮 3 秒', async () => {
    const { h, types, render } = await loadClient()
    const seen = []
    const base = {
      node: CARD_NODE,
      book: BOOK,
      doc: DOC,
      path: PATH,
      citations: CITATION_IDS.map((id, index) => citationItem(id, index)),
      citationsStatus: 'ready',
      onCite: (id) => seen.push(id),
      onClose: () => {},
    }
    let tree = render(h(types.get('DetailCard'), { ...base, activeCitation: null, flash: false }))
    citationButton(tree, CITATION_IDS[1]).props.onClick({})
    assert.deepEqual(seen, [CITATION_IDS[1]])
    assert.equal(citationButton(tree, CITATION_IDS[1]).props['aria-pressed'], 'false')
    tree = render(
      h(types.get('DetailCard'), { ...base, activeCitation: CITATION_IDS[1], flash: true }),
    )
    assert.equal(citationButton(tree, CITATION_IDS[1]).props['aria-pressed'], 'true')
    const source = byClass(tree, 'rl-detail__chunk')
    assert.equal(source.length, 1)
    assert.equal(source[0].props.id, 'rl-detail-chunk-' + CITATION_IDS[1])
    assert.match(textOf(source[0]), new RegExp(CITATION_IDS[1]))
    assert.match(classList(source[0]).join(' '), /rl-detail__chunk--flash/)
    assert.match(textOf(tree), /已定位到该段并高亮 3 秒/)
  })

  it('无法定位的引用不渲染成链接，只标注引用失效', async () => {
    const { h, types, render } = await loadClient()
    const items = [citationItem(CITATION_IDS[0], 0), citationItem(CITATION_IDS[1], 1, true)]
    const tree = render(
      h(types.get('DetailCard'), {
        node: CARD_NODE,
        book: BOOK,
        doc: DOC,
        path: PATH,
        citations: items,
        citationsStatus: 'ready',
        activeCitation: null,
        onClose: () => {},
      }),
    )
    assert.equal(byClass(tree, 'rl-detail__cite').length, 1)
    assert.equal(textByClass(tree, 'rl-detail__count'), '1 处')
    const invalid = findAll(tree, (element) => element.props?.['data-invalid-citation'])
    assert.equal(invalid.length, 1)
    assert.equal(invalid[0].props['data-invalid-citation'], CITATION_IDS[1])
    assert.match(textOf(invalid[0]), /引用失效/)
    assert.equal(findAll(tree, (element) => element.props?.['data-citation'] === CITATION_IDS[1]).length, 0)
  })

  it('工具栏复制与 Esc 关闭走回调', async () => {
    const { h, types, render } = await loadClient()
    const copied = []
    let closed = 0
    const tree = render(
      h(types.get('DetailCard'), {
        node: CARD_NODE,
        book: BOOK,
        doc: DOC,
        path: PATH,
        citations: CITATION_IDS.map((id, index) => citationItem(id, index)),
        citationsStatus: 'ready',
        activeCitation: null,
        onCopy: (text, kind) => copied.push({ text, kind }),
        onClose: () => { closed += 1 },
      }),
    )
    buttonByText(tree, '复制正文').props.onClick({})
    buttonByText(tree, '复制引用').props.onClick({})
    assert.equal(copied.length, 2)
    assert.equal(copied[0].kind, 'body')
    assert.equal(copied[0].text, NODE.summary)
    assert.equal(copied[1].kind, 'refs')
    for (const id of CITATION_IDS) assert.match(copied[1].text, new RegExp('\\[' + id + '\\] '))
    assert.match(copied[1].text, /记忆不是录像带/)
    byClass(tree, 'rl-detail--card')[0].props.onKeyDown({ key: 'Escape', stopPropagation() {} })
    assert.equal(closed, 1)
  })

  it('没有选中卡片时显示空态', async () => {
    const { h, types, render } = await loadClient()
    const { actions } = makeActions()
    const tree = render(
      h(types.get('Detail'), {
        state: readyState({ selectedNodeId: null, detailOpen: false }),
        actions,
      }),
    )
    assert.match(textOf(tree), /还没有选中卡片/)
    assert.match(textOf(tree), /在画布上点一张卡片/)
    assert.equal(byClass(tree, 'rl-detail--card').length, 1)
  })

  it('容器从 map 与 chunks 组装详情，引用原文可展开', async () => {
    const { h, types, settle, errors } = await loadClient()
    const { actions, calls } = makeActions()
    let tree = await settle(h(types.get('Detail'), { state: readyState(), actions }))
    assert.match(textByClass(tree, 'rl-detail__title'), new RegExp(NODE.title.slice(0, 6)))
    assert.equal(byClass(tree, 'rl-detail__cite').length, 3)
    citationButton(tree, CITATION_IDS[0]).props.onClick({})
    tree = await settle(h(types.get('Detail'), { state: readyState(), actions }), 2)
    assert.match(textByClass(tree, 'rl-detail__chunk'), new RegExp(CITATION_IDS[0]))
    assert.match(textByClass(tree, 'rl-detail__chunk'), /记忆不是录像带/)
    assert.match(textOf(tree), /已定位到该段并高亮 3 秒/)
    assert.deepEqual(calls.openDetail, [])
    assert.deepEqual(errors, [])
  })

  it('chunks.json 缺失时不崩溃，引用全部标为失效', async () => {
    const { h, types, settle, errors } = await loadClient({ responses: { chunks: 'missing' } })
    const { actions } = makeActions()
    const tree = await settle(h(types.get('Detail'), { state: readyState(), actions }))
    assert.match(textByClass(tree, 'rl-detail__title'), new RegExp(NODE.title.slice(0, 6)))
    assert.match(textOf(tree), /引用原文不可用/)
    assert.equal(byClass(tree, 'rl-detail__cite').length, 0)
    assert.equal(findAll(tree, (element) => element.props?.['data-invalid-citation']).length, CITATION_IDS.length)
    assert.deepEqual(errors, [])
  })

  it('map 缺失或读取失败时显示错误态', async () => {
    for (const mode of ['missing', 'error']) {
      const { h, types, settle } = await loadClient({ responses: { map: mode } })
      const { actions } = makeActions()
      const tree = await settle(h(types.get('Detail'), { state: readyState(), actions }))
      assert.match(textOf(tree), /详情加载失败/, 'mode=' + mode)
      assert.match(textOf(tree), /导图可能已被替换/, 'mode=' + mode)
    }
  })

  it('详情与画布同时存在：画布宽度不被抽屉改变（无布局抖动）', async () => {
    const { h, types, settle } = await loadClient()
    const { actions } = makeActions()
    const tree = await settle(h(types.get('Shell'), { state: readyState(), actions }), 3)
    assert.equal(byClass(tree, 'rl-canvas').length, 1)
    assert.equal(byClass(tree, 'rl-detail--card').length, 1)
    const main = byClass(tree, 'rl-main')[0]
    const children = findAll(main, (element) => classList(element).includes('rl-canvas') || classList(element).includes('rl-detail--card'))
    assert.equal(children.length, 2)
    assert.equal(byClass(tree, 'rl-canvas')[0].props.className.includes('rl-canvas--map'), true)
  })

  it('详情打开时把落进抽屉区域的选中卡平移到可视区', async () => {
    const { h, types, settle, errors } = await loadClient()
    const { actions } = makeActions()
    const state = readyState({ selectedNodeId: 'n-ch-03', detailOpen: true })
    const tree = await settle(
      h(types.get('CanvasSurface'), {
        book: BOOK,
        mapState: { status: 'ready', doc: MAP, error: null, bookId: BOOK.id },
        state,
        actions,
        initialView: { x: -356, y: -12000, zoom: 1, collapsed: [], selectedNodeId: 'n-ch-03' },
        onRetry() {},
      }),
      6,
    )
    const groups = findAll(
      tree,
      (element) => element.type === 'g' && String(element.props?.transform || '').includes('scale('),
    )
    assert.equal(groups.length, 1)
    assert.equal(groups[0].props.transform, 'translate(-776,-12000) scale(1)')
    assert.deepEqual(errors, [])
  })
})

