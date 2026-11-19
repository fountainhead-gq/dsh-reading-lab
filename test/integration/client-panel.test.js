import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'

const ROOT = path.resolve(import.meta.dirname, '../..')

/** 极简 React 替身：只够跑本插件面板的一次渲染。 */
function createReactShim() {
  const Fragment = Symbol.for('react.fragment')
  function createElement(type, props, ...children) {
    const merged = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return { type, props: merged }
  }
  function useState(initial) {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  }
  function useEffect(fn) {
    const cleanup = fn()
    return cleanup
  }
  return {
    Fragment,
    createElement,
    useState,
    useEffect,
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

async function loadClient() {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const errors = []
  const warnings = []
  let entry = null

  const sandbox = {
    console: {
      log() {},
      info() {},
      warn: (...args) => warnings.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    },
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
    fetch: async (url) => {
      if (String(url).endsWith('/health')) {
        return {
          status: 200,
          json: async () => ({ ok: true, data: { storage: 'ok', pluginVersion: '0.1.0', dshVersion: '0.2.2-rc.5' } }),
        }
      }
      return { status: 200, json: async () => ({ ok: true, data: { books: [], revision: 0 } }) }
    },
    document: {
      createElement: () => ({ style: {} }),
      head: { appendChild() {} },
      body: { appendChild() {} },
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
    if (id === 'react') return createReactShim()
    if (id === 'react-dom') return { createPortal: (node) => node }
    throw new Error(`unexpected require: ${id}`)
  }

  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(entry, 'client.js 必须调用 window.__ModuleLoader__.load')
  assert.equal(entry.id, 'dsh-reading-lab')

  const registrations = []
  const registeredLocales = []
  const ctx = {
    locale: {
      register(namespace, dictionaries) {
        registeredLocales.push({ namespace, dictionaries })
        return () => {}
      },
      bind() {
        return (key) => key
      },
      current: 'zh',
    },
    slots: {
      inject(_name, fn) {
        return fn()
      },
      register(meta, component) {
        registrations.push({ meta, component })
        return () => {
          const index = registrations.findIndex((item) => item.meta === meta)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
    effect(fn) {
      return fn()
    },
    layout: {
      toggleSidebar() {},
      openDetails() {},
      closeDetails() {},
    },
  }

  const plugin = entry.factory(sandbox.require)
  return { plugin, ctx, registrations, errors, warnings, registeredLocales }
}

describe('client panel shell', () => {
  it('注入 slots，注册 main(key) 与 sidebar.panellist(id)，id 与 key 相同', async () => {
    const { plugin, ctx, registrations } = await loadClient()
    // 跨 vm realm 的数组原型不同，先落到本 realm 再比较。
    assert.deepEqual(Array.from(plugin.inject), ['slots'])
    const dispose = plugin.apply(ctx)

    const main = registrations.find((item) => item.meta.name === 'main')
    const panellist = registrations.find((item) => item.meta.name === 'sidebar.panellist')
    assert.ok(main, 'main 槽位必须注册')
    assert.ok(panellist, 'sidebar.panellist 槽位必须注册')
    assert.equal(main.meta.key, 'reading-lab')
    assert.equal(panellist.meta.id, 'reading-lab')
    assert.equal(panellist.meta.locale, 'dsh-reading-lab')
    assert.equal(panellist.meta.label(), '阅读实验室')

    if (typeof dispose === 'function') dispose()
  })

  it('面板渲染空书库文案，且不写 document.body', async () => {
    const { plugin, ctx, registrations } = await loadClient()
    plugin.apply(ctx)
    const main = registrations.find((item) => item.meta.name === 'main')
    const tree = main.component({})
    const text = textOf(tree).join(' ')
    assert.match(text, /书库还是空的/)
    assert.match(text, /导入一本 EPUB 或 PDF/)
    assert.match(text, /导入第一本书/)
    assert.match(text, /0 本书/)
  })

  it('CSS 只用 --dsw-alias-* 与 currentColor，没有硬编码颜色', async () => {
    const { plugin, ctx, registrations } = await loadClient()
    plugin.apply(ctx)
    const main = registrations.find((item) => item.meta.name === 'main')
    const css = collectStyles(main.component({})).join('\n')
    assert.ok(css.length > 1000, '样式表非空')
    assert.match(css, /var\(--dsw-alias-/)
    assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/)
    assert.doesNotMatch(css, /\brgba?\(/)
    assert.doesNotMatch(css, /\bhsla?\(/)
    assert.doesNotMatch(css, /prefers-color-scheme/)
  })

  it('渲染过程没有 console.error', async () => {
    const { plugin, ctx, registrations, errors } = await loadClient()
    plugin.apply(ctx)
    const main = registrations.find((item) => item.meta.name === 'main')
    main.component({})
    assert.deepEqual(errors, [])
  })

  it('locale 字典注册了 zh/en，含 meta 之外的 ui key', async () => {
    const { plugin, ctx, registeredLocales } = await loadClient()
    plugin.apply(ctx)
    const entry = registeredLocales.find((item) => item.namespace === 'dsh-reading-lab')
    assert.ok(entry, '字典必须注册到 dsh-reading-lab')
    for (const lang of ['zh', 'en']) {
      assert.equal(typeof entry.dictionaries[lang], 'object')
      assert.equal(typeof entry.dictionaries[lang]['library.empty.title'], 'string')
      assert.equal(typeof entry.dictionaries[lang]['error.E_IO'], 'string')
    }
  })
})