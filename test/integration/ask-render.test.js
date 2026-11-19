/**
 * 询问 AI 浮层的渲染冒烟（06-test.md §2 FR-11；参考图 3）。
 *
 * 用极简 React shim 渲染构建后的 client.js：不验证像素，只验证结构与交互接线
 * （快捷指令、追问建议、反馈按钮、运行中停止、无 agent 的禁用与提示）。
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
const NODE = (function find(node, id) {
  if (!node) return null
  if (node.id === id) return node
  for (const child of node.children || []) {
    const found = find(child, id)
    if (found) return found
  }
  return null
})(MAP.root, NODE_ID)
const BOOK = {
  id: MAP.bookId,
  title: '时间之灯：记忆如何塑造我们',
  author: '林晚',
  format: 'epub',
  mapUpdatedAt: '2026-11-20T01:02:03.000Z',
}

const THREADS = {
  schemaVersion: 1,
  bookId: BOOK.id,
  updatedAt: '2026-11-20T03:00:00.000Z',
  threads: [
    {
      id: 't-01',
      scope: { kind: 'node', nodeId: NODE_ID, nodeTitle: NODE.title },
      createdAt: '2026-11-20T02:58:00.000Z',
      updatedAt: '2026-11-20T03:00:00.000Z',
      state: 'idle',
      messages: [
        {
          id: 'm-01',
          role: 'user',
          text: '这条线索为什么重要？',
          citations: [],
          createdAt: '2026-11-20T02:58:00.000Z',
          status: 'done',
          messageId: null,
          feedback: null,
        },
        {
          id: 'm-02',
          role: 'assistant',
          text: '因为它把记忆与证据连在一起。\n\n第二次回想时，人已经在改写草稿。',
          citations: [{ chunkId: 'c-000001' }],
          createdAt: '2026-11-20T02:59:00.000Z',
          status: 'done',
          messageId: 'msg-1',
          feedback: 'up',
        },
      ],
    },
  ],
}

function runningThreads() {
  const file = JSON.parse(JSON.stringify(THREADS))
  file.threads[0].state = 'running'
  file.threads[0].messages.push({
    id: 'm-03',
    role: 'user',
    text: '再问一句',
    citations: [],
    createdAt: '2026-11-20T03:01:00.000Z',
    status: 'pending',
    messageId: null,
    feedback: null,
  })
  return file
}

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
  const responses = { threads: THREADS, agents: 'one' }

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

  return { sandbox, React, h: React.createElement, render, settle, errors, calls, responses, types, Shell }
}

function shellState(overrides = {}) {
  return {
    status: 'ready',
    books: [BOOK],
    selectedBookId: BOOK.id,
    selectedNodeId: NODE_ID,
    detailOpen: false,
    notesOpen: false,
    askOpen: true,
    threadRevision: 0,
    lastError: null,
    storage: 'ok',
    ...overrides,
  }
}

function makeActions() {
  const calls = { closeAsk: 0 }
  return {
    calls,
    actions: {
      closeAsk: () => { calls.closeAsk += 1 },
      openDetail: () => {},
      toggleAsk: () => {},
      closeOverlay: () => {},
      selectBook: () => {},
      refresh: () => {},
      importBook: () => {},
      pickFile: () => {},
      toggleNotes: () => {},
      setFilter: () => {},
    },
  }
}

describe('询问 AI 浮层（t15）', () => {
  it('渲染标题、节点范围、五项快捷指令、线程消息与追问建议', async () => {
    const client = await loadClient()
    const { h, settle, Shell } = client
    const tree = await settle(h(Shell, { state: shellState(), actions: makeActions().actions }))

    const aside = byClass(tree, 'rl-ask')
    assert.equal(aside.length, 1)
    assert.equal(aside[0].props.role, 'dialog')
    assert.equal(aside[0].props['aria-modal'], 'true')

    assert.equal(textByClass(tree, 'rl-header__title').includes('询问 AI'), true)
    assert.equal(textByClass(tree, 'rl-ask__scope'), NODE.title)

    const quick = byClass(tree, 'rl-ask__quick-btn')
    assert.equal(quick.length, 5)
    assert.match(quick.map(textOf).join(' '), /深入|解释|简化|举例|引导/)
    for (const chip of quick) assert.equal(chip.props.disabled, false)

    const messages = byClass(tree, 'rl-ask__msg')
    assert.equal(messages.length, 2)
    assert.equal(messages[0].props['data-role'], 'user')
    assert.equal(messages[1].props['data-role'], 'assistant')
    assert.equal(messages[1].props['data-status'], 'done')
    assert.match(textByClass(tree, 'rl-ask__msg-text'), /记忆与证据/)
    assert.match(textByClass(tree, 'rl-cite'), /\[c-000001\]/)

    const up = nodeByAttr(tree, 'data-feedback', 'up')[0]
    const down = nodeByAttr(tree, 'data-feedback', 'down')[0]
    assert.equal(up.props['aria-pressed'], 'true')
    assert.equal(down.props['aria-pressed'], 'false')

    const followups = byClass(tree, 'rl-ask__followup')
    // 夹具里这个节点没有追问建议，就不该凭空出现「猜你想问」。
    assert.equal(followups.length, 0)

    const input = byClass(byClass(tree, 'rl-ask')[0], 'rl-input')[0]
    assert.equal(input.props.maxlength, 2000)
    assert.equal(input.props.disabled, false)

    // 换一个带追问建议的节点：最多三条，点第一条即提问。
    const qNode = (function find(node) {
      if (!node) return null
      if (Array.isArray(node.questions) && node.questions.length > 0) return node
      for (const child of node.children || []) {
        const found = find(child)
        if (found) return found
      }
      return null
    })(MAP.root)
    assert.ok(qNode, '夹具里应至少有一个带追问建议的节点')
    client.responses.threads = {
      ...THREADS,
      threads: [{ ...THREADS.threads[0], scope: { kind: 'node', nodeId: qNode.id, nodeTitle: qNode.title } }],
    }
    const withQuestions = await settle(
      h(Shell, { state: shellState({ selectedNodeId: qNode.id }), actions: makeActions().actions }),
      5,
      'ask-followups',
    )
    const chips = byClass(withQuestions, 'rl-ask__followup')
    assert.ok(chips.length >= 1 && chips.length <= 3, '追问建议数量应在 1..3')
    assert.equal(textOf(chips[0]), qNode.questions[0])
  })

  it('点快捷指令会创建线程并提问（POST /threads + POST /ask）', async () => {
    const client = await loadClient()
    const { h, settle, Shell, calls, responses } = client
    responses.threads = { ...THREADS, threads: [] }
    const tree = await settle(h(Shell, { state: shellState(), actions: makeActions().actions }))
    const chip = byClass(tree, 'rl-ask__quick-btn')[0]
    chip.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await settle(h(Shell, { state: shellState(), actions: makeActions().actions }))

    const createdThread = calls.find((call) => call.method === 'POST' && call.url.endsWith('/threads'))
    assert.ok(createdThread, '缺少创建线程请求：' + calls.map((c) => c.method + ' ' + c.url).join(', '))
    assert.deepEqual(createdThread.body, { scope: { kind: 'node', nodeId: NODE_ID } })
    const asked = calls.find((call) => call.method === 'POST' && call.url.includes('/ask'))
    assert.ok(asked)
    assert.equal(typeof asked.body.question, 'string')
    assert.equal(asked.headers['Idempotency-Key'].startsWith('rl-'), true)
  })

  it('运行中：显示停止按钮、禁用快捷指令与发送', async () => {
    const client = await loadClient()
    const { h, settle, Shell, responses } = client
    responses.threads = runningThreads()
    const tree = await settle(h(Shell, { state: shellState(), actions: makeActions().actions }), 6, 'ask-running')

    for (const chip of byClass(tree, 'rl-ask__quick-btn')) assert.equal(chip.props.disabled, true)
    const stop = findAll(tree, (element) => element.type === 'button' && textOf(element).includes('停止'))
    assert.equal(stop.length, 1)
    const send = findAll(tree, (element) => element.type === 'button' && textOf(element).includes('发送'))
    assert.equal(send.length, 0)
    assert.match(textByClass(tree, 'rl-ask__msg-status'), /等待/)
  })

  it('没有可用 agent 时提示原因并禁用输入', async () => {
    const client = await loadClient()
    const { h, settle, Shell, responses } = client
    responses.agents = 'empty'
    const tree = await settle(h(Shell, { state: shellState(), actions: makeActions().actions }), 6, 'ask-noagent')

    assert.match(textByClass(tree, 'rl-ask__notice'), /没有可用|未连接|agent/i)
    const askAside = byClass(tree, 'rl-ask')[0]
    assert.equal(byClass(askAside, 'rl-input')[0].props.disabled, true)
    for (const chip of byClass(askAside, 'rl-ask__quick-btn')) assert.equal(chip.props.disabled, true)
  })

  it('点 👍 发出反馈请求；再点同值取消（feedback:null）', async () => {
    const client = await loadClient()
    const { h, settle, Shell, calls } = client
    const tree = await settle(h(Shell, { state: shellState(), actions: makeActions().actions }), 6, 'ask-feedback')
    const up = nodeByAttr(tree, 'data-feedback', 'up')[0]
    up.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const sent = calls.find((call) => call.url.includes('/feedback'))
    assert.ok(sent, '缺少反馈请求')
    assert.match(sent.url, /\/threads\/t-01\/messages\/m-02\/feedback$/)
    assert.deepEqual(sent.body, { feedback: null })
  })

  it('未选中书时只渲染空态，不发任何请求', async () => {
    const client = await loadClient()
    const { h, settle, Shell, calls } = client
    calls.length = 0
    const tree = await settle(
      h(Shell, { state: shellState({ selectedBookId: null, selectedNodeId: null, books: [] }), actions: makeActions().actions }),
      4,
      'ask-empty',
    )
    assert.equal(byClass(tree, 'rl-ask').length, 1)
    assert.equal(byClass(tree, 'rl-ask__quick-btn').length, 0)
    assert.match(textByClass(tree, 'rl-empty__title'), /先选一本|选择/)
    assert.equal(calls.filter((call) => call.url.includes('/threads')).length, 0)
  })
})