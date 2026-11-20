import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

/* 存储位置（t33）的面板渲染：真 client.js + 极简 React/宿主桩。 */

const ROOT = path.resolve(import.meta.dirname, '../..')

function createReactShim() {
  function createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  }
  return {
    createElement,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: (fn) => {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanup()
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useId: () => 'id-1',
    memo: (component) => component,
    Fragment: Symbol.for('react.fragment'),
    Children: { toArray: (value) => (Array.isArray(value) ? value : value == null ? [] : [value]) },
  }
}

function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node.type === 'function') return textOf(node.type(node.props ?? {}))
  return textOf(node.props?.children)
}

function findNode(node, predicate) {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findNode(item, predicate)
      if (hit) return hit
    }
    return null
  }
  if (predicate(node)) return node
  if (typeof node.type === 'function') return findNode(node.type(node.props ?? {}), predicate)
  return findNode(node.props?.children, predicate)
}

async function loadClient(fetchImpl) {
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
    fetch: async (url, init) => fetchImpl(String(url), init),
    document: { createElement: () => ({ style: {} }), head: { appendChild() {} }, body: { appendChild() {} }, getElementById: () => null },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = { load(descriptor) { entry = descriptor } }
  sandbox.require = (id) => {
    if (id === 'react') return createReactShim()
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${id}`)
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  const registrations = []
  const ctx = {
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
      current: 'zh',
    },
    slots: {
      inject(_name, fn) {
        return fn()
      },
      register(meta, component) {
        registrations.push({ meta, component })
        return () => {}
      },
    },
    effect: (fn) => fn(),
  }
  const plugin = entry.factory(sandbox.require)
  plugin.apply(ctx)
  return { registrations, errors }
}

async function renderPanel(registrations) {
  const main = registrations.find((item) => item.meta.name === 'main')
  // 先走一遍树把 Panel 的 useEffect 触发了，等异步请求落地后再走一遍读新状态。
  textOf(main.component({}))
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve))
  return main.component({})
}

function jsonResponse(body, status = 200) {
  return { status, json: async () => body }
}

describe('存储位置面板', () => {
  it('渲染解析出的绝对路径，并在 isFallback 时给出可见警告', async () => {
    const { registrations, errors } = await loadClient(async (url) => {
      if (url.endsWith('/settings')) {
        return jsonResponse({
          ok: true,
          data: {
            libraryRoot: null,
            resolvedRoot: 'D:\\data\\reading-lab',
            isFallback: true,
            workspaceRoot: 'D:\\work',
            exists: true,
          },
        })
      }
      if (url.endsWith('/health')) {
        return jsonResponse({ ok: true, data: { storage: 'ok', pluginVersion: '0.1.0', dshVersion: 'x' } })
      }
      return jsonResponse({ ok: true, data: { books: [], revision: 0 } })
    })
    const tree = await renderPanel(registrations)
    const text = textOf(tree)
    assert.match(text, /D:\\data\\reading-lab/)
    assert.match(text, /回退到进程目录/)
    assert.match(text, /存储位置/)
    assert.equal(findNode(tree, (node) => node.props?.className === 'rl-storage__warn') !== null, true)
    assert.deepEqual(errors, [])
  })

  it('/settings 失败时只隐藏存储区块，书库仍然渲染', async () => {
    const { registrations } = await loadClient(async (url) => {
      if (url.endsWith('/settings')) {
        return jsonResponse({ ok: false, error: { code: 'E_IO', message: 'io' } }, 500)
      }
      if (url.endsWith('/health')) {
        return jsonResponse({ ok: true, data: { storage: 'ok', pluginVersion: '0.1.0', dshVersion: 'x' } })
      }
      return jsonResponse({ ok: true, data: { books: [], revision: 0 } })
    })
    const tree = await renderPanel(registrations)
    assert.equal(findNode(tree, (node) => node.props?.className === 'rl-storage'), null)
    assert.match(textOf(tree), /书库还是空的/)
  })
})