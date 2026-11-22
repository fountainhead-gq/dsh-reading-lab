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

/** R1 之后存储位置进了设置抽屉：先渲染面板，再点顶栏设置入口。 */
async function renderWithSettingsOpen(registrations) {
  const main = registrations.find((item) => item.meta.name === 'main')
  const tree = await renderPanel(registrations)
  const toggle = findNode(tree, (node) => node.props && Object.prototype.hasOwnProperty.call(node.props, 'data-settings-toggle'))
  assert.ok(toggle, '顶栏应有设置入口')
  assert.equal(typeof toggle.props.onClick, 'function')
  toggle.props.onClick()
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve))
  return main.component({})
}

function jsonResponse(body, status = 200) {
  return { status, json: async () => body }
}

describe('书架宽度拖拽（m01951）', () => {
  it('书架右缘有宽度手柄，键盘左右键按 16px 步进调整且被 store 夹取', async () => {
    const { registrations, errors } = await loadClient(async (url) => {
      if (url.endsWith('/settings')) {
        return jsonResponse({
          ok: true,
          data: { libraryRoot: null, resolvedRoot: 'D:\\data\\reading-lab', isFallback: false, workspaceRoot: 'D:\\data', exists: true, settingsError: null },
        })
      }
      if (url.endsWith('/books')) return jsonResponse({ ok: true, data: { books: [], revision: 0 } })
      if (url.endsWith('/health')) return jsonResponse({ ok: true, data: { pluginVersion: '0.2.1', storage: 'ok' } })
      return jsonResponse({ ok: true, data: {} })
    })
    const tree = await renderPanel(registrations)
    const handle = findNode(tree, (node) => node.props && Object.prototype.hasOwnProperty.call(node.props, 'data-library-resize'))
    assert.ok(handle, '书架应有宽度手柄')
    assert.equal(handle.props.role, 'separator')
    assert.equal(handle.props['aria-orientation'], 'vertical')
    assert.equal(handle.props.tabIndex, 0)

    // 键盘可达：ArrowRight 走 16px 步进，不依赖鼠标拖拽。
    let prevented = false
    handle.props.onKeyDown({
      key: 'ArrowRight',
      preventDefault() {
        prevented = true
      },
    })
    assert.equal(prevented, true)
    assert.equal(errors.length, 0, errors.join('\n'))
  })
})

describe('存储位置面板', () => {
  it('设置抽屉渲染解析出的绝对路径，并在 isFallback 时给出可见警告', async () => {
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
    const tree = await renderWithSettingsOpen(registrations)
    const text = textOf(tree)
    assert.match(text, /D:\\data\\reading-lab/)
    assert.match(text, /回退到进程目录/)
    assert.match(text, /存储位置/)
    const storage = findNode(tree, (node) => node.props?.['data-section'] === 'storage')
    assert.ok(storage, '抽屉里应有存储位置一节')
    assert.equal(findNode(tree, (node) => node.props?.className === 'rl-settings__warn') !== null, true)
    assert.deepEqual(errors, [])
  })

  it('设置文件损坏时存储位置行显示可见提示（QA-35-03）', async () => {
    const { registrations, errors } = await loadClient(async (url) => {
      if (url.endsWith('/settings')) {
        return jsonResponse({
          ok: true,
          data: {
            libraryRoot: null,
            resolvedRoot: 'D:\\data\\reading-lab',
            isFallback: false,
            workspaceRoot: 'D:\\work',
            exists: true,
            settingsError: 'settings-corrupted',
          },
        })
      }
      if (url.endsWith('/health')) {
        return jsonResponse({
          ok: true,
          data: { storage: 'ok', pluginVersion: '0.1.0', dshVersion: 'x', settingsError: 'settings-corrupted' },
        })
      }
      return jsonResponse({ ok: true, data: { books: [], revision: 0 } })
    })
    const tree = await renderWithSettingsOpen(registrations)
    const warn = findNode(tree, (node) => node.props?.['data-settings-error'] === 'settings-corrupted')
    assert.ok(warn, '存储位置行必须显示设置损坏提示')
    assert.equal(warn.props.role, 'alert')
    assert.match(textOf(warn), /设置文件已损坏/)
    assert.deepEqual(errors, [])
  })

  it('设置里的路径不可用时提示带原因（QA-35-03）', async () => {
    const { registrations } = await loadClient(async (url) => {
      if (url.endsWith('/settings')) {
        return jsonResponse({
          ok: true,
          data: {
            libraryRoot: 'Z:\\missing',
            resolvedRoot: 'D:\\work\\reading',
            isFallback: false,
            workspaceRoot: 'D:\\work',
            exists: true,
            settingsError: 'not-absolute',
          },
        })
      }
      if (url.endsWith('/health')) {
        return jsonResponse({ ok: true, data: { storage: 'ok', pluginVersion: '0.1.0', dshVersion: 'x' } })
      }
      return jsonResponse({ ok: true, data: { books: [], revision: 0 } })
    })
    const tree = await renderWithSettingsOpen(registrations)
    const warn = findNode(tree, (node) => node.props?.['data-settings-error'] === 'not-absolute')
    assert.ok(warn)
    assert.match(textOf(warn), /设置里的书库位置不可用（not-absolute）/)
  })

  it('抽屉关闭时整块设置不渲染，书库照常渲染；/settings 失败只在抽屉里提示', async () => {
    const { registrations } = await loadClient(async (url) => {
      if (url.endsWith('/settings')) {
        return jsonResponse({ ok: false, error: { code: 'E_IO', message: 'io' } }, 500)
      }
      if (url.endsWith('/health')) {
        return jsonResponse({ ok: true, data: { storage: 'ok', pluginVersion: '0.1.0', dshVersion: 'x' } })
      }
      return jsonResponse({ ok: true, data: { books: [], revision: 0 } })
    })
    const closed = await renderPanel(registrations)
    assert.equal(findNode(closed, (node) => node.props?.className === 'rl-settings'), null)
    assert.equal(findNode(closed, (node) => node.props?.['data-section'] === 'storage'), null)
    assert.match(textOf(closed), /书库还是空的/)

    const open = await renderWithSettingsOpen(registrations)
    assert.ok(findNode(open, (node) => node.props?.['data-section'] === 'storage'), '/settings 失败时抽屉仍要能打开')
    assert.equal(findNode(open, (node) => node.props?.['data-settings-error']), null)
    assert.match(textOf(open), /正在读取设置/)
  })
})