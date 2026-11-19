/**
 * 询问浮层的键盘/点击契约（t31 / QA-17-01、QA-17-02；06-test.md FR-11）。
 *
 * 用极简 React shim 渲染构建后的 client.js：不验证像素，只验证
 *   1. 打开浮层后焦点进入（关闭按钮），Esc 关闭并把焦点还给触发元素；
 *   2. Tab / Shift+Tab 在浮层内环绕；
 *   3. 浮层打开时背景三层 inert + aria-hidden，详情侧卡不再渲染（互斥）；
 *   4. 引用 chip 可点 → 取 chunk 原文、显示预览并高亮；引用失效 → 标「引用失效」且不可点；
 *   5. 笔记面板的「生成笔记」在 v0.2 是禁用按钮（不是能点的 501）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '../..')
const MAP = JSON.parse(readFileSync(path.join(ROOT, 'test/fixtures/map/map-500.json'), 'utf8'))
const NODE_ID = 'n-ch-01-s01-p03'
const BOOK = {
  id: MAP.bookId,
  title: '时间之灯：记忆如何塑造我们',
  author: '林晚',
  format: 'epub',
  mapUpdatedAt: '2026-11-20T01:02:03.000Z',
}
const CHUNK_OK = 'c-000001'
const CHUNK_MISSING = 'c-000009'

/* ---------- 渲染脚手架（与 export-render.test.js 同源） ---------- */

/** focus() 写在宿主模块里，拿不到 sandbox 的 document；由 loadClient 注入。 */
let ACTIVE_DOC = null

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
    // 供焦点断言：所有元素都能被 focus()，并写进 sandbox.document.activeElement。
    return {
      type,
      props: merged,
      focus() {
        if (ACTIVE_DOC) ACTIVE_DOC.activeElement = this
      },
    }
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
    const rendered = {
      ...node,
      props: { ...(node.props || {}), children: renderNode(node.props?.children, key + '/c') },
    }
    if (typeof node.props?.ref === 'function') node.props.ref(rendered)
    return rendered
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

function nodeByAttr(node, name, value) {
  return findAll(node, (element) => element.props?.[name] === value)
}

const THREADS = {
  schemaVersion: 1,
  bookId: BOOK.id,
  updatedAt: '2026-11-20T01:03:00.000Z',
  threads: [
    {
      id: 't-01',
      scope: { kind: 'node', nodeId: NODE_ID, nodeTitle: '证据与记忆' },
      createdAt: '2026-11-20T01:02:30.000Z',
      updatedAt: '2026-11-20T01:03:00.000Z',
      state: 'idle',
      messages: [
        { id: 'm-01', role: 'user', text: '这张卡想说什么？', citations: [], createdAt: '2026-11-20T01:02:30.000Z', status: 'done' },
        {
          id: 'm-02',
          role: 'assistant',
          text: '作者把记忆当作可重建的证据。',
          citations: [{ chunkId: CHUNK_OK }, { chunkId: CHUNK_MISSING }],
          createdAt: '2026-11-20T01:03:00.000Z',
          status: 'done',
          feedback: null,
        },
      ],
    },
  ],
}

async function loadClient() {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const { React, render, types } = createReactShim()
  const errors = []
  const calls = []

  const sandbox = {
    console: {
      log() {},
      info() {},
      warn() {},
      error: (...args) => errors.push(args.join(' ')),
    },
    setTimeout: (fn, delay) => {
      // 3 秒的高亮定时器在测试里不触发，才能断言高亮态存在；其余仍立即执行。
      if (typeof delay === 'number' && delay >= 1000) return 0
      Promise.resolve().then(fn)
      return 0
    },
    clearTimeout: () => {},
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
    navigator: { language: 'zh-CN', languages: ['zh-CN'], clipboard: { writeText: async () => {} } },
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
    fetch: async (url, options = {}) => {
      const requestUrl = String(url)
      const method = (options.method || 'GET').toUpperCase()
      calls.push({ url: requestUrl, method, headers: options.headers || {} })

      if (requestUrl.includes('/agents')) {
        return { status: 200, json: async () => ({ ok: true, data: { agents: [{ id: 'agent-main', title: 'Main' }] } }) }
      }
      if (requestUrl.includes('/chunks/')) {
        const chunkId = requestUrl.split('/chunks/')[1]
        if (chunkId === CHUNK_MISSING) {
          return {
            status: 404,
            json: async () => ({ ok: false, error: { code: 'E_NOT_FOUND', message: 'chunk not found', details: { chunkId } } }),
          }
        }
        return {
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              chunk: { id: CHUNK_OK, seq: 1, chapterTitle: '第一章', chapterPath: ['第一章'], page: null, text: '记忆不是录像，而是每次重写的现场。', chars: 20 },
              prev: null,
              next: null,
            },
          }),
        }
      }
      if (requestUrl.includes('/threads')) {
        return { status: 200, json: async () => ({ ok: true, data: THREADS }) }
      }
      if (requestUrl.includes('/map')) {
        return { status: 200, json: async () => ({ ok: true, data: MAP }) }
      }
      return { status: 200, json: async () => ({ ok: true, data: { books: [BOOK], revision: 1 } }) }
    },
    document: {
      activeElement: null,
      createElement: () => ({ style: {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
      getElementById: () => null,
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  ACTIVE_DOC = sandbox.document
  let entry = null
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
  const Shell = types.get('Shell')
  assert.ok(Shell, 'main 渲染树里应出现 Shell 组件')

  async function settle(node, times = 6, key = 'ask') {
    let tree = render(node, key)
    for (let i = 0; i < times; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      tree = render(node, key)
    }
    return tree
  }

  return { sandbox, React, h: React.createElement, render, settle, errors, calls, types, Shell, panel: () => main.component({}) }
}

/* ---------- 状态与动作 ---------- */

function shellState(overrides = {}) {
  return {
    status: 'ready',
    storage: 'ok',
    pluginVersion: '0.2.0',
    dshVersion: '0.2.2',
    books: [BOOK],
    revision: 1,
    filter: '',
    selectedBookId: BOOK.id,
    selectedNodeId: NODE_ID,
    uiMode: 'panel',
    detailOpen: false,
    askOpen: true,
    notesOpen: false,
    importing: false,
    exporting: false,
    lastExport: null,
    lastError: null,
    threadRevision: 0,
    ...overrides,
  }
}

function makeActions() {
  const calls = { closeAsk: 0, openDetail: [] }
  const actions = {
    selectBook() {},
    refresh() {},
    importBook() {},
    pickFile() {},
    toggleAsk() {},
    closeAsk() {
      calls.closeAsk += 1
    },
    toggleNotes() {},
    openDetail(nodeId) {
      calls.openDetail.push(nodeId)
    },
    exportBook() {},
    closeOverlay() {},
  }
  return { actions, calls }
}

function keydown(element, event) {
  assert.equal(typeof element.props.onKeyDown, 'function')
  const handled = { prevented: false, stopped: false }
  element.props.onKeyDown({
    key: event.key,
    shiftKey: Boolean(event.shiftKey),
    currentTarget: event.currentTarget || null,
    preventDefault() {
      handled.prevented = true
    },
    stopPropagation() {
      handled.stopped = true
    },
  })
  return handled
}

/* ---------- 用例 ---------- */

describe('询问浮层的焦点与引用交互（t31）', () => {
  it('打开即聚焦关闭按钮；Esc 关闭并把焦点还给触发元素', async () => {
    const client = await loadClient()
    const { h, settle, Shell, sandbox } = client
    const trigger = { focus() { sandbox.document.activeElement = this }, name: 'trigger' }
    sandbox.document.activeElement = trigger
    const { actions } = makeActions()
    const tree = await settle(h(Shell, { state: shellState(), actions }))

    const aside = byClass(tree, 'rl-ask')[0]
    const closeButton = byClass(tree, 'rl-ask__close')[0]
    assert.ok(closeButton, '浮层里应有可聚焦的关闭按钮')
    assert.ok(classList(sandbox.document.activeElement).includes('rl-ask__close'), '打开浮层后焦点应在关闭按钮上')
    assert.equal(aside.props['aria-modal'], 'true')
    assert.equal(aside.props.tabIndex, -1)

    // 浮层的 Esc 走 actions.closeAsk（真实的 Shell 里会连带 restoreFocus）。
    const handled = keydown(aside, { key: 'Escape' })
    assert.equal(handled.prevented, true)
    assert.equal(handled.stopped, true)
  })

  it('Esc 关闭浮层并把焦点还给顶栏触发按钮', async () => {
    const client = await loadClient()
    const { h, settle, sandbox } = client

    // 走真实动作层：Panel 里点顶栏「询问 AI」→ 浮层打开 → Esc 关闭。
    let tree = await settle(h(client.panel), 6)
    const buttons = findAll(tree, (element) => element.type === 'button')
    const trigger = buttons.find((element) => /ask\.title|询问 AI/.test(textOf(element)))
    assert.ok(trigger, '顶栏应有「询问 AI」按钮；现有按钮：' + buttons.map(textOf).join(' | '))
    sandbox.document.activeElement = trigger

    trigger.props.onClick()
    tree = await settle(h(client.panel), 6)
    const aside = byClass(tree, 'rl-ask')[0]
    assert.ok(aside, '点击后浮层应打开')
    assert.ok(classList(sandbox.document.activeElement).includes('rl-ask__close'), '焦点应进入浮层')

    keydown(aside, { key: 'Escape' })
    tree = await settle(h(client.panel), 6)
    assert.equal(byClass(tree, 'rl-ask').length, 0, 'Esc 后浮层应关闭')
    assert.equal(sandbox.document.activeElement, trigger, '焦点应回到触发按钮')
  })

  it('Tab / Shift+Tab 在浮层内环绕，不落到背景', async () => {
    const client = await loadClient()
    const { h, settle, Shell, sandbox } = client
    const { actions } = makeActions()
    const tree = await settle(h(Shell, { state: shellState(), actions }))
    const aside = byClass(tree, 'rl-ask')[0]

    const first = { name: 'first', focus() { sandbox.document.activeElement = this } }
    const last = { name: 'last', focus() { sandbox.document.activeElement = this } }
    const currentTarget = { querySelectorAll: () => [first, last] }

    sandbox.document.activeElement = last
    setActiveElement(sandbox, last)
    const forward = keydown(aside, { key: 'Tab', currentTarget })
    assert.equal(forward.prevented, true)
    assert.equal(sandbox.document.activeElement, first, '尾元素 Tab 应回到首元素')

    setActiveElement(sandbox, first)
    const backward = keydown(aside, { key: 'Tab', shiftKey: true, currentTarget })
    assert.equal(backward.prevented, true)
    assert.equal(sandbox.document.activeElement, last, '首元素 Shift+Tab 应回到尾元素')
  })

  it('浮层打开时背景三层 inert + aria-hidden，且详情侧卡不渲染', async () => {
    const client = await loadClient()
    const { h, settle, Shell } = client
    const { actions } = makeActions()
    const tree = await settle(h(Shell, { state: shellState({ detailOpen: true, askOpen: true }), actions }))

    const hidden = findAll(tree, (element) => element.props?.['aria-hidden'] === 'true')
    assert.equal(hidden.length, 3, '顶栏 / 书库 / 画布三层都应对读屏隐藏')
    for (const element of hidden) assert.equal(element.props.inert, '')

    assert.equal(byClass(tree, 'rl-ask').length, 1)
    assert.equal(byClass(tree, 'rl-detail').length, 0, '浮层与详情侧卡互斥')

    // 全部关闭后背景恢复可聚焦/可读。
    const plain = await settle(h(Shell, { state: shellState({ askOpen: false }), actions }), 2, 'ask-plain')
    assert.equal(findAll(plain, (element) => element.props?.['aria-hidden'] === 'true').length, 0)
  })

  it('点引用 chip → 取 chunk 原文、显示预览并高亮；失效引用不可点', async () => {
    const client = await loadClient()
    const { h, settle, Shell, calls } = client
    const { actions } = makeActions()
    const tree = await settle(h(Shell, { state: shellState(), actions }))

    const chips = byClass(tree, 'rl-cite--button')
    assert.equal(chips.length, 2)
    const chip = chips.find((element) => element.props['data-chunk-id'] === CHUNK_OK)
    assert.ok(chip, '引用应渲染成可点的按钮')
    assert.equal(chip.type, 'button')
    assert.equal(chip.props.type, 'button')

    chip.props.onClick()
    const after = await settle(h(Shell, { state: shellState(), actions }), 8)

    assert.ok(
      calls.some((call) => call.method === 'GET' && call.url.endsWith('/books/' + BOOK.id + '/chunks/' + CHUNK_OK)),
      '点击应请求 chunk 原文',
    )
    assert.match(textByClass(after, 'rl-ask__cite-text'), /记忆不是录像/)
    const flash = byClass(after, 'rl-ask__cite-text--flash')
    assert.equal(flash.length, 1, '命中片段应有高亮态')
    assert.equal(byClass(after, 'rl-ask__cite-panel').length, 1)

    // 失效引用：第二次点击走 404 → 变成不可点的 span + 「引用失效」。
    const missingYet = byClass(after, 'rl-cite--button').find((element) => element.props['data-chunk-id'] === CHUNK_MISSING)
    assert.ok(missingYet)
    missingYet.props.onClick()
    const invalidTree = await settle(h(Shell, { state: shellState(), actions }), 8)
    const invalid = byClass(invalidTree, 'rl-cite--invalid')
    assert.equal(invalid.length, 1)
    assert.equal(invalid[0].type, 'span')
    assert.equal(invalid[0].props['aria-disabled'], 'true')
    assert.match(textOf(invalid[0]), /引用失效/)
    assert.equal(
      byClass(invalidTree, 'rl-cite--button').filter((element) => element.props['data-chunk-id'] === CHUNK_MISSING).length,
      0,
      '失效引用不应继续渲染成按钮',
    )
  })

  it('笔记面板的「生成笔记」是禁用按钮，不是能点的 501', async () => {
    const client = await loadClient()
    const { h, settle, Shell } = client
    const { actions } = makeActions()
    const tree = await settle(h(Shell, { state: shellState({ askOpen: false, notesOpen: true }), actions }), 4, 'notes')

    const button = nodeByAttr(tree, 'data-notes-generate', 'disabled')[0]
    assert.ok(button, '笔记面板应有生成笔记入口')
    assert.equal(button.type, 'button')
    assert.equal(button.props.disabled, true)
    assert.equal(button.props.onClick, undefined, '禁用按钮不应挂点击处理')
    assert.match(textOf(button), /v0\.3/)
  })
})

function setActiveElement(sandbox, element) {
  sandbox.document.activeElement = element
}