import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BOOK = {
  id: 'bgen000001',
  title: '时间之灯：记忆如何塑造我们',
  author: '林晚',
  format: 'epub',
  mapUpdatedAt: 'v1',
}
const PROBE_BOOK = { ...BOOK, id: 'bprobe00001', mapUpdatedAt: 'probe-map' }

/* t30 只需要一张很小的图：根 + 章节 + 论点，足够验证「旧图 → 新图」。 */
function makeMap(marker, rootTitle, pointTitle) {
  const nodes = {
    'n-root': { x: 80, y: 200, w: 240, h: 120, depth: 0, side: 'root' },
    'n-ch': { x: 400, y: 220, w: 220, h: 96, depth: 1, side: 'right' },
    'n-pt': { x: 700, y: 230, w: 220, h: 96, depth: 2, side: 'right' },
  }
  return {
    schemaVersion: 1,
    bookId: BOOK.id,
    generatedAt: '2026-11-20T01:00:00.000Z',
    generator: 'test',
    root: {
      id: 'n-root',
      kind: 'book',
      title: rootTitle,
      summary: '这是一本关于记忆如何被改写的小书，' + marker,
      citations: [],
      questions: [],
      children: [
        {
          id: 'n-ch',
          kind: 'chapter',
          title: '第一章 记忆的暗室',
          summary: '本章讨论记忆的保存与重写，' + marker,
          citations: [{ chunkId: 'c-000001' }],
          questions: [],
          children: [
            {
              id: 'n-pt',
              kind: 'point',
              title: pointTitle,
              summary: '记忆不是录像带，而是每次回想都重写一遍的草稿。',
              citations: [{ chunkId: 'c-000002' }],
              questions: [],
              children: [],
            },
          ],
        },
      ],
    },
    layout: { version: 1, width: 1000, height: 600, nodes, edges: [{ from: 'n-root', to: 'n-ch' }] },
    stats: { nodes: 3, depth: 2, citations: 2 },
  }
}

const MAP_OLD = makeMap('旧图', '旧导图：时间之灯', '旧论点：记忆是草稿')
const MAP_NEW = makeMap('新图', '新导图：记忆重写', '新论点：回忆即重写')

/* ---------- 带状态的极简 React（同 detail-render.test.js） ---------- */

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

function classList(node) {
  const value = node?.props?.className
  return typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : []
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

function cssOf(tree) {
  return findAll(tree, (element) => element.type === 'style' && element.props?.dangerouslySetInnerHTML?.__html)
    .map((element) => element.props.dangerouslySetInnerHTML.__html)
    .join('\n')
}

function buttonData(node, name) {
  const found = findAll(node, (element) => element.props?.[name] !== undefined)
  assert.ok(found.length >= 1, 'expected a node with ' + name)
  return found[0]
}

/* ---------- 加载 client.js，并按用例注入 Host 响应 ---------- */

async function loadClient() {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const { React, render, types } = createReactShim()
  const errors = []
  let entry = null
  let postCount = 0
  let statusCount = 0
  let mapCount = 0
  let mapDoc = MAP_OLD
  let mapMissing = false
  let mapGate = null
  let postError = false
  let snapshot = { bookId: BOOK.id, state: 'idle' }
  const sources = []

  function ok(data) {
    return { status: 200, json: async () => ({ ok: true, data }) }
  }
  function fail(status, code, message, details) {
    return { status, json: async () => ({ ok: false, error: { code, message, details } }) }
  }

  const sandbox = {
    console: {
      log() {},
      info() {},
      warn() {},
      error: (...args) => errors.push(args.join(' ')),
    },
    setTimeout: (fn) => {
      fn()
      return 1
    },
    clearTimeout() {},
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
    fetch: async (url, init = {}) => {
      const requestUrl = String(url)
      const method = (init.method || 'GET').toUpperCase()
      if (requestUrl.includes('/actions/generate-map')) {
        if (method === 'POST') {
          postCount += 1
          if (postError) {
            return fail(502, 'E_AGENT', 'agent invocation failed', { reason: 'agent-error' })
          }
          snapshot = { ...snapshot, bookId: BOOK.id, state: 'pending', startedAt: new Date().toISOString(), timeoutMs: 180000 }
          return { status: 202, json: async () => ({ ok: true, data: { queued: true, state: 'pending', timeoutMs: 180000, agentId: 'a', promptId: 'p', statusUrl: 'x' } }) }
        }
        statusCount += 1
        return ok({ ...snapshot, bookId: BOOK.id })
      }
      if (requestUrl.includes('/map')) {
        mapCount += 1
        if (mapGate) await mapGate.promise
        if (mapMissing) {
          return fail(404, 'E_NOT_FOUND', 'no map', { reason: 'no-map' })
        }
        return ok(mapDoc)
      }
      return ok({ books: [BOOK], revision: 1 })
    },
    document: {
      createElement: () => ({ style: {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById: () => null,
    },
    EventSource: function EventSource(url) {
      this.url = url
      this.listeners = {}
      this.closed = false
      sources.push(this)
    },
  }
  sandbox.EventSource.prototype.addEventListener = function (type, fn) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }
  sandbox.EventSource.prototype.close = function () {
    this.closed = true
  }
  function emit(type, payload) {
    for (const source of sources) {
      if (source.closed) continue
      for (const fn of source.listeners[type] || []) fn({ data: JSON.stringify(payload) })
    }
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

  async function settle(root, times = 5, key = 'root') {
    let tree = render(root, key)
    for (let i = 0; i < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      tree = render(root, key)
    }
    return tree
  }

  // 探测组件类型：把状态快照设为 pending，Shell 里就会同时渲染 CanvasSurface 与进度卡。
  const ShellType = types.get('Shell')
  assert.ok(ShellType)
  const probeState = readyState({ books: [PROBE_BOOK], selectedBookId: PROBE_BOOK.id })
  const probeActions = makeActions().actions
  snapshot = { bookId: PROBE_BOOK.id, state: 'pending', startedAt: new Date().toISOString(), timeoutMs: 180000 }
  await settle(React.createElement(ShellType, { state: probeState, actions: probeActions }), 4, 'probe')
  snapshot = { bookId: BOOK.id, state: 'idle' }

  for (const name of ['Canvas', 'CanvasSurface', 'CanvasGeneration', 'CanvasState', 'Shell']) {
    assert.ok(types.get(name), '渲染树里应出现 ' + name)
  }

  return {
    sandbox,
    React,
    h: React.createElement,
    render,
    settle,
    types,
    errors,
    postCount: () => postCount,
    statusCount: () => statusCount,
    mapCount: () => mapCount,
    emit,
    setPostError: (next) => {
      postError = Boolean(next)
    },
    setSnapshot: (next) => {
      snapshot = { ...snapshot, ...next }
    },
    setMap: (next, missing = false) => {
      mapDoc = next
      mapMissing = missing
    },
    holdMap: () => {
      let release
      const promise = new Promise((resolve) => {
        release = resolve
      })
      mapGate = { promise }
      return () => {
        mapGate = null
        release()
      }
    },
  }
}

function readyState(overrides = {}) {
  return {
    status: 'idle',
    books: [BOOK],
    selectedBookId: BOOK.id,
    selectedNodeId: null,
    detailOpen: false,
    askOpen: false,
    notesOpen: false,
    lastError: null,
    storage: 'ok',
    ...overrides,
  }
}

function makeActions() {
  return { actions: { openDetail() {}, selectBook() {}, refresh() {}, importBook() {}, toggleAsk() {}, closeAsk() {}, closeOverlay() {} } }
}

function surfaceProps(overrides = {}) {
  return {
    book: BOOK,
    mapState: { status: 'ready', doc: MAP_OLD, error: null, bookId: BOOK.id },
    state: readyState(),
    actions: makeActions().actions,
    initialView: { x: 0, y: 0, zoom: 0.6, collapsed: [], selectedNodeId: null },
    onRetry() {},
    onGenerate() {},
    generation: { ...makeGeneration({ state: 'idle' }) },
    ...overrides,
  }
}

function makeGeneration(overrides = {}) {
  return {
    bookId: BOOK.id,
    state: 'idle',
    reason: null,
    message: '',
    startedAt: null,
    finishedAt: null,
    elapsedMs: 0,
    timeoutMs: 0,
    updatedAt: null,
    mapRevision: 0,
    ...overrides,
  }
}

/* ---------- 用例 ---------- */

describe('导图生成状态（t30）', () => {
  it('pending/running 显示进度卡与已耗时；有图时收成右上角 pill', async () => {
    const { h, types, render } = await loadClient()
    const pending = render(
      h(types.get('CanvasGeneration'), {
        generation: makeGeneration({ state: 'pending', startedAt: new Date(Date.now() - 7000).toISOString() }),
        hasMap: false,
        onRetry() {},
      }),
      'gen-pending',
    )
    assert.equal(pending.props['data-generation-state'], 'pending')
    assert.equal(byClass(pending, 'rl-gen__track').length, 1)
    assert.equal(byClass(pending, 'rl-gen__fill').length, 1)
    assert.match(textByClass(pending, 'rl-gen__title'), /已排队，等待 Agent 认领/)
    assert.match(textByClass(pending, 'rl-gen__meta'), /已耗时 0:0[67]/)
    assert.equal(byClass(pending, 'rl-gen--centered').length, 1)

    const running = render(
      h(types.get('CanvasGeneration'), {
        generation: makeGeneration({ state: 'running', startedAt: new Date(Date.now() - 42000).toISOString() }),
        hasMap: true,
        onRetry() {},
      }),
      'gen-running',
    )
    assert.match(textByClass(running, 'rl-gen__pill'), /正在生成导图/)
    assert.match(textByClass(running, 'rl-gen__pill'), /已耗时 0:4[23]/)
    assert.equal(byClass(running, 'rl-gen__card').length, 0)
  })

  it('failed 显示原因、耗时、可展开的 message 与重试按钮', async () => {
    const { h, types, render } = await loadClient()
    let retries = 0
    const root = h(types.get('CanvasGeneration'), {
      generation: makeGeneration({
        state: 'failed',
        reason: 'timeout',
        message: 'Host gave up after 180000 ms',
        startedAt: new Date(Date.now() - 65000).toISOString(),
        finishedAt: new Date().toISOString(),
        elapsedMs: 65000,
        timeoutMs: 180000,
      }),
      hasMap: false,
      onRetry() {
        retries += 1
      },
    })
    let tree = render(root, 'gen-failed')
    assert.equal(tree.props['data-generation-state'], 'failed')
    assert.equal(tree.props['data-generation-reason'], 'timeout')
    assert.match(textByClass(tree, 'rl-gen__title'), /导图生成失败/)
    assert.match(textByClass(tree, 'rl-gen__reason'), /等待超时/)
    assert.match(textByClass(tree, 'rl-gen__meta'), /已耗时 1:0[45]/)
    assert.match(textByClass(tree, 'rl-gen__meta'), /超时上限 3:00/)
    assert.equal(byClass(tree, 'rl-gen__message').length, 0)
    assert.equal(buttonData(tree, 'data-generation-retry').props['aria-expanded'], undefined)

    buttonData(tree, 'data-generation-details').props.onClick()
    tree = render(root, 'gen-failed')
    assert.match(textByClass(tree, 'rl-gen__message'), /Host gave up after 180000 ms/)
    assert.equal(buttonData(tree, 'data-generation-details').props['aria-expanded'], 'true')
    assert.match(textByClass(tree, 'rl-gen__actions'), /收起详情/)

    buttonData(tree, 'data-generation-retry').props.onClick()
    assert.equal(retries, 1)
  })

  it('无图空态可点「生成导图」：POST 后进入 pending', async () => {
    const { h, types, render, settle, postCount, setMap } = await loadClient()
    setMap(MAP_OLD, true)
    const root = h(types.get('Canvas'), { state: readyState(), actions: makeActions().actions })
    let tree = await settle(root, 5, 'canvas-generate')
    assert.equal(tree.props['data-map-status'], 'missing')
    const generate = buttonData(tree, 'data-generate-map')
    assert.match(textOf(generate), /生成导图/)

    generate.props.onClick()
    tree = await settle(root, 4, 'canvas-generate')
    assert.equal(postCount(), 1)
    assert.equal(tree.props['data-generation-state'], 'pending')
    assert.match(textByClass(tree, 'rl-gen__title'), /已排队/)
  })

  it('POST 失败展示失败卡与原因；重试回到 pending 并再次 POST', async () => {
    const {
      h,
      types,
      settle,
      postCount,
      setMap,
      setPostError,
    } = await loadClient()
    setMap(MAP_OLD, true)
    setPostError(true)
    const root = h(types.get('Canvas'), { state: readyState(), actions: makeActions().actions })
    let tree = await settle(root, 5, 'canvas-retry')
    buttonData(tree, 'data-generate-map').props.onClick()
    tree = await settle(root, 5, 'canvas-retry')
    assert.equal(tree.props['data-generation-state'], 'failed')
    assert.equal(byClass(tree, 'rl-gen--failed').length, 1)
    assert.match(textByClass(tree, 'rl-gen__reason'), /生成请求没能发出/)
    buttonData(tree, 'data-generation-details').props.onClick()
    tree = await settle(root, 2, 'canvas-retry')
    assert.match(textByClass(tree, 'rl-gen__message'), /agent invocation failed/)

    setPostError(false)
    buttonData(tree, 'data-generation-retry').props.onClick()
    tree = await settle(root, 4, 'canvas-retry')
    assert.equal(postCount(), 2)
    assert.equal(tree.props['data-generation-state'], 'pending')
    assert.match(textByClass(tree, 'rl-gen__title'), /已排队|正在生成/)
  })

  it('map 事件触发新图替换；旧图保留到新图到达，不闪白', async () => {
    const client = await loadClient()
    const Panel = client.types.get('Panel')
    let tree = await client.settle(client.h(Panel, {}), 4, 'canvas-switch')
    client.emit('hello', { books: [BOOK], revision: 1 })
    tree = await client.settle(client.h(Panel, {}), 4, 'canvas-switch')
    findAll(tree, (element) => element.type === 'button' && classList(element).includes('rl-card'))[0].props.onClick()
    tree = await client.settle(client.h(Panel, {}), 6, 'canvas-switch')
    assert.equal(byClass(tree, 'rl-canvas')[0].props['data-map-status'], 'ready')
    assert.match(textOf(tree), /旧导图：时间之灯/)

    client.setMap(MAP_NEW)
    const release = client.holdMap()
    client.emit('map', { bookId: BOOK.id, mapUpdatedAt: 'v2' })
    tree = await client.settle(client.h(Panel, {}), 2, 'canvas-switch')
    // 新图还在路上：旧树必须先留在屏幕上。
    assert.match(textOf(tree), /旧导图：时间之灯/)
    assert.doesNotMatch(textOf(tree), /新导图：记忆重写/)

    release()
    tree = await client.settle(client.h(Panel, {}), 8, 'canvas-switch')
    assert.match(textOf(tree), /新导图：记忆重写/)
    assert.doesNotMatch(textOf(tree), /旧导图：时间之灯/)
    assert.equal(byClass(tree, 'rl-canvas')[0].props['data-generation-state'], 'done')
    assert.ok(client.mapCount() >= 2)
    assert.deepEqual(client.errors, [])
  })

  it('页面加载时 GET 状态兜底：错过 SSE 也能看到 running 与 elapsed', async () => {
    const client = await loadClient()
    const startedAt = new Date(Date.now() - 12000).toISOString()
    // Canvas 挂载会 GET 一次状态；这里预置一条 running 快照。
    client.setSnapshot({ bookId: BOOK.id, state: 'running', startedAt, timeoutMs: 180000, updatedAt: startedAt })
    const tree = await client.settle(
      client.h(client.types.get('Canvas'), { state: readyState(), actions: makeActions().actions }),
      6,
      'canvas-fallback',
    )
    assert.ok(client.statusCount() >= 1)
    assert.equal(tree.props['data-generation-state'], 'running')
    // 已经有一张图时进度收成右上角 pill。
    assert.match(textByClass(tree, 'rl-gen__pill'), /正在生成导图/)
    assert.match(textByClass(tree, 'rl-gen__pill'), /已耗时 0:1[234]/)
  })

  it('SSE 重连（hello）后对齐状态：错过的 failed 会被补上', async () => {
    const client = await loadClient()
    client.setMap(MAP_OLD, true)
    const Panel = client.types.get('Panel')
    assert.ok(Panel)
    let tree = await client.settle(client.h(Panel, {}), 4, 'panel-live')
    client.emit('hello', { books: [BOOK], revision: 1 })
    tree = await client.settle(client.h(Panel, {}), 4, 'panel-live')
    const card = findAll(tree, (element) => element.type === 'button' && classList(element).includes('rl-card'))
    assert.equal(card.length, 1)
    card[0].props.onClick()
    tree = await client.settle(client.h(Panel, {}), 6, 'panel-live')

    client.setSnapshot({
      bookId: BOOK.id,
      state: 'failed',
      reason: 'turn-ended',
      message: 'turn ended without map commit',
      startedAt: new Date(Date.now() - 30000).toISOString(),
      elapsedMs: 30000,
    })
    client.emit('hello', { books: [BOOK], revision: 1 })
    tree = await client.settle(client.h(Panel, {}), 6, 'panel-live')
    assert.equal(tree.props.className, 'rl-root')
    assert.equal(byClass(tree, 'rl-gen--failed').length, 1)
    assert.match(textByClass(tree, 'rl-gen__reason'), /回合结束/)
    assert.match(textByClass(tree, 'rl-gen__title'), /导图生成失败/)
    assert.deepEqual(client.errors, [])
  })

  it('失败原因逐一映射成可读文案，未知原因回落', async () => {
    const { h, types, render } = await loadClient()
    const cases = {
      'agent-error': /Agent 回合报错/,
      'turn-ended': /回合结束/,
      'inbox-discarded': /请求被会话丢弃/,
      timeout: /等待超时/,
      'agent-disposed': /Agent 已关闭/,
      'agent-missing': /找不到可用的 Agent/,
      'inject-failed': /注入失败/,
      'request-failed': /生成请求没能发出/,
    }
    for (const [reason, pattern] of Object.entries(cases)) {
      const tree = render(
        h(types.get('CanvasGeneration'), {
          generation: makeGeneration({ state: 'failed', reason }),
          hasMap: false,
          onRetry() {},
        }),
        'gen-reason-' + reason,
      )
      assert.equal(tree.props['data-generation-reason'], reason)
      assert.match(textByClass(tree, 'rl-gen__reason'), pattern, reason)
    }
    const unknown = render(
      h(types.get('CanvasGeneration'), {
        generation: makeGeneration({ state: 'failed', reason: 'exploded' }),
        hasMap: false,
        onRetry() {},
      }),
      'gen-reason-unknown',
    )
    assert.equal(unknown.props['data-generation-reason'], 'unknown')
    assert.match(textByClass(unknown, 'rl-gen__reason'), /未知原因/)
  })

  it('生成相关 CSS 只用 --dsw-alias-* token', async () => {
    const { h, types, render } = await loadClient()
    const tree = render(
      h(
        types.get('CanvasSurface'),
        surfaceProps({
          generation: makeGeneration({ state: 'failed', reason: 'agent-error', message: 'boom' }),
        }),
      ),
      'gen-css',
    )
    const css = cssOf(tree)
    assert.match(css, /\.rl-gen__track\{/)
    assert.match(css, /var\(--dsw-alias-/)
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla)\(/)
    assert.doesNotMatch(css, /prefers-color-scheme/)
  })
})