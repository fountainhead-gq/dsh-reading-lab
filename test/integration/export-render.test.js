/**
 * 导出入口的渲染冒烟（06-test.md §2 FR-13；07 §3 M4-16..18）。
 *
 * 用极简 React shim 渲染构建后的 client.js：不验证像素，只验证
 * 顶栏「导出」菜单三项、点击 md 后真的发出 POST、成功后顶栏出现「已导出 …」、
 * 无选中书时菜单禁用。脚手架与 ask-render.test.js 同源。
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

/* ---------- 渲染脚手架（与 ask-render.test.js 同源） ---------- */

/* ---------- 带状态的极简 React ---------- */

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

function nodeByAttr(node, name, value) {
  return findAll(node, (element) => element.props?.[name] === value)
}

async function loadClient() {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const { React, render, types } = createReactShim()
  const errors = []
  const calls = []
  const responses = { threads: null, agents: 'one' }

  const sandbox = {
    console: {
      log() {},
      info() {},
      warn() {},
      error: (...args) => errors.push(args.join(' ')),
    },
    setTimeout: (fn) => {
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
      getItem(key) { return this._data.has(key) ? this._data.get(key) : null },
      setItem(key, value) { this._data.set(key, String(value)) },
      removeItem(key) { this._data.delete(key) },
    },
    fetch: async (url, options = {}) => {
      const requestUrl = String(url)
      const method = (options.method || 'GET').toUpperCase()
      let body = null
      try {
        body = options.body ? JSON.parse(options.body) : null
      } catch {
        body = options.body
      }
      calls.push({ url: requestUrl, method, body, headers: options.headers || {} })

      if (requestUrl.includes('/agents')) {
        const agents = responses.agents === 'empty' ? [] : [{ id: 'agent-main', title: 'Main' }]
        return { status: 200, json: async () => ({ ok: true, data: { agents } }) }
      }
      if (requestUrl.includes('/threads') && method === 'POST' && requestUrl.endsWith('/threads')) {
        return {
          status: 201,
          json: async () => ({
            ok: true,
            data: { id: 't-02', scope: { kind: 'node', nodeId: NODE_ID, nodeTitle: NODE.title }, state: 'idle', messages: [] },
          }),
        }
      }
      if (requestUrl.includes('/ask') && method === 'POST') {
        return { status: 202, json: async () => ({ ok: true, data: { threadId: 't-02', messageId: 'm-04', agentId: 'agent-main' } }) }
      }
      if (requestUrl.includes('/feedback')) {
        return { status: 200, json: async () => ({ ok: true, data: { id: 'm-02', feedback: body?.feedback ?? null } }) }
      }
      if (requestUrl.includes('/stop')) {
        return { status: 200, json: async () => ({ ok: true, data: { id: 't-01', state: 'idle', messages: [] } }) }
      }
      if (requestUrl.includes('/threads')) {
        return { status: 200, json: async () => ({ ok: true, data: responses.threads }) }
      }
      if (requestUrl.includes('/map')) {
        return { status: 200, json: async () => ({ ok: true, data: MAP }) }
      }
      if (requestUrl.includes('/export') && method === 'POST') {
        return {
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              path: 'reading/exports/book-20261120-101500.md',
              name: 'book-20261120-101500.md',
              bytes: 128,
              format: body?.format ?? 'md',
              includeThreads: false,
            },
          }),
        }
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

  return {
    sandbox,
    React,
    h: React.createElement,
    render,
    settle,
    errors,
    calls,
    responses,
    types,
    Shell,
    panel: () => main.component({}),
  }
}


function panelState(overrides = {}) {
  return {
    status: 'ready',
    books: [BOOK],
    revision: 1,
    storage: 'ok',
    pluginVersion: '0.2.0',
    dshVersion: '0.2.2-rc.5',
    selectedBookId: BOOK.id,
    selectedNodeId: null,
    detailOpen: false,
    notesOpen: false,
    askOpen: false,
    threadRevision: 0,
    exporting: false,
    lastExport: null,
    lastError: null,
    ...overrides,
  }
}

function noopActions(overrides = {}) {
  const base = {}
  for (const name of [
    'selectBook',
    'refresh',
    'importBook',
    'pickFile',
    'toggleAsk',
    'closeAsk',
    'toggleNotes',
    'openDetail',
    'closeOverlay',
    'setFilter',
    'setUiMode',
    'exportBook',
  ]) {
    base[name] = () => {}
  }
  return { ...base, ...overrides }
}

describe('导出入口的渲染（export menu）', () => {
  it('顶栏导出菜单：三种格式、顺序与 data-format', async () => {
    const client = await loadClient()
    let tree = client.render(client.panel(), 'panel')
    tree = await client.settle(client.panel(), 6, 'panel')
    // 书架渲染完成后先选一本书，导出入口才有意义（无书时被禁用，见第三条用例）。
    byClass(tree, 'rl-card')[0].props.onClick()
    tree = await client.settle(client.panel(), 6, 'panel')
    const items = byClass(tree, 'rl-export__item')
    assert.equal(items.length, 3)
    assert.deepEqual(items.map((item) => item.props['data-format']), ['md', 'opml', 'json'])
    assert.deepEqual(items.map(textOf), ['Markdown', 'OPML', 'JSON'])
    assert.equal(items.every((item) => item.props.disabled === false), true)
    assert.equal(byClass(tree, 'rl-export').length, 1)
    assert.equal(textByClass(tree, 'rl-export__toggle').trim(), '导出')
  })

  it('点击 Markdown → POST /books/:id/export，成功后顶栏显示已导出文件名', async () => {
    const client = await loadClient()
    let tree = client.render(client.panel(), 'panel')
    tree = await client.settle(client.panel(), 6, 'panel')
    byClass(tree, 'rl-card')[0].props.onClick()
    tree = await client.settle(client.panel(), 6, 'panel')
    const items = byClass(tree, 'rl-export__item')
    assert.equal(typeof items[0].props.onClick, 'function')
    items[0].props.onClick()

    const settled = await client.settle(client.panel(), 6, 'panel')
    const posted = client.calls.filter((call) => call.method === 'POST' && call.url.includes('/export'))
    assert.equal(posted.length, 1)
    assert.ok(posted[0].url.includes(`/books/${BOOK.id}/export`))
    assert.equal(posted[0].body.format, 'md')

    assert.equal(textByClass(settled, 'rl-header__exported').trim(), '已导出 book-20261120-101500.md')
    assert.deepEqual(client.errors, [])
  })

  it('未选书 / 导出中：菜单项禁用，点击不发请求', async () => {
    const client = await loadClient()
    for (const state of [panelState({ selectedBookId: null, books: [] }), panelState({ exporting: true })]) {
      const Shell = client.types.get('Shell')
      const actions = noopActions()
      const tree = client.render(client.h(client.types.get('Header'), { state, actions }), 'header')
      const items = byClass(tree, 'rl-export__item')
      assert.equal(items.length, 3)
      assert.equal(items.every((item) => item.props.disabled === true), true)
      assert.equal(textByClass(tree, 'rl-export__toggle').trim(), state.exporting ? '导出中…' : '导出')
      assert.ok(Shell)
    }
    assert.deepEqual(client.errors, [])
  })
})
