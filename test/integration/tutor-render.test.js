/**
 * 引导式学习浮层的渲染冒烟（06 §2 FR-11/FR-12；07 §3 M5-07，t20）。
 *
 * 用极简 React shim 渲染构建后的 client.js：不验证像素，只验证
 * 入口按钮 → 浮层结构（进度、步骤、检查点、引用）→ 标记掌握/跳过 → 提问 → 重新开始 →
 * 无 agent / 无导图的降级。脚手架与 export-render.test.js 同源。
 */
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

const STEPS = [
  {
    id: 's-01',
    nodeId: 'n-ch-01',
    title: '第一章 · 记忆的现场',
    summary: '记忆不是录像，而是每次重写的现场。',
    depth: 1,
    kind: 'chapter',
    question: '这一章为什么说记忆是重写？',
    hint: '记忆不是录像，而是每次重写的现场。',
    citations: ['c-000001'],
    state: 'pending',
    attempts: 0,
    threadId: null,
    messageId: null,
    updatedAt: null,
  },
  {
    id: 's-02',
    nodeId: 'n-ch-02',
    title: '第二章 · 灯火与遗忘',
    summary: '遗忘也是记忆的一部分。',
    depth: 1,
    kind: 'chapter',
    question: '遗忘在这里起了什么作用？',
    hint: '遗忘也是记忆的一部分。',
    citations: ['c-000002'],
    state: 'pending',
    attempts: 0,
    threadId: null,
    messageId: null,
    updatedAt: null,
  },
]

function tutorView(overrides = {}) {
  return {
    bookId: BOOK.id,
    pathId: 'p-01',
    goal: 'explain',
    mapUpdatedAt: BOOK.mapUpdatedAt,
    updatedAt: '2026-11-20T06:00:00.000Z',
    cursor: 0,
    currentStepId: 's-01',
    steps: STEPS.map((step) => ({ ...step })),
    progress: { total: 2, answered: 0, mastered: 0, skipped: 0, done: 0, cursor: 0, percent: 0 },
    rebuilt: true,
    ...overrides,
  }
}

/* ---------- 带状态的极简 React（与 export-render.test.js 同源） ---------- */

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

async function loadClient(options = {}) {
  const source = await readFile(path.join(ROOT, 'client.js'), 'utf8')
  const { React, render, types } = createReactShim()
  const errors = []
  const calls = []
  const responses = {
    path: tutorView(),
    agents: options.noAgent ? 'empty' : 'one',
    missingMap: Boolean(options.missingMap),
    threads: null,
  }

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
    fetch: async (url, fetchOptions = {}) => {
      const requestUrl = String(url)
      const method = (fetchOptions.method || 'GET').toUpperCase()
      let body = null
      try {
        body = fetchOptions.body ? JSON.parse(fetchOptions.body) : null
      } catch {
        body = fetchOptions.body
      }
      calls.push({ url: requestUrl, method, body, headers: fetchOptions.headers || {} })

      if (requestUrl.includes('/agents')) {
        const agents = responses.agents === 'empty' ? [] : [{ id: 'agent-main', title: 'Main' }]
        return { status: 200, json: async () => ({ ok: true, data: { agents } }) }
      }
      if (requestUrl.includes('/tutor/steps/') && requestUrl.endsWith('/answer')) {
        const stepId = requestUrl.split('/tutor/steps/')[1].split('/')[0]
        const step = responses.path.steps.find((candidate) => candidate.id === stepId)
        step.state = 'answered'
        step.attempts += 1
        step.threadId = 't-01'
        step.messageId = 'm-01'
        responses.threads = {
          schemaVersion: 1,
          bookId: BOOK.id,
          updatedAt: '2026-11-20T06:01:00.000Z',
          threads: [
            {
              id: 't-01',
              scope: { kind: 'node', nodeId: step.nodeId, nodeTitle: step.title },
              createdAt: '2026-11-20T06:01:00.000Z',
              updatedAt: '2026-11-20T06:01:00.000Z',
              state: 'idle',
              messages: [
                { id: 'm-01', role: 'user', text: body?.question ?? '', citations: [], createdAt: '2026-11-20T06:01:00.000Z', status: 'pending' },
                {
                  id: 'm-02',
                  role: 'assistant',
                  text: '因为每次回忆都会重写一遍痕迹。',
                  citations: [{ chunkId: 'c-000001' }],
                  createdAt: '2026-11-20T06:02:00.000Z',
                  status: 'done',
                },
              ],
            },
          ],
        }
        return {
          status: 202,
          json: async () => ({
            ok: true,
            data: { step, threadId: 't-01', messageId: 'm-01', agentId: 'agent-main', cursor: 1 },
          }),
        }
      }
      if (requestUrl.includes('/tutor/steps/') && method === 'POST') {
        const stepId = requestUrl.split('/tutor/steps/')[1]
        const steps = responses.path.steps.map((step) =>
          step.id === stepId ? { ...step, state: body?.state ?? 'mastered' } : step,
        )
        const mastered = steps.filter((step) => step.state === 'mastered').length
        const skipped = steps.filter((step) => step.state === 'skipped').length
        const done = mastered + skipped
        responses.path = {
          ...responses.path,
          steps,
          cursor: Math.min(steps.length - 1, steps.findIndex((step) => step.id === stepId) + 1),
          progress: {
            ...responses.path.progress,
            mastered,
            skipped,
            done,
            percent: Math.round((done / steps.length) * 100),
          },
        }
        const marked = steps.find((step) => step.id === stepId)
        return { status: 200, json: async () => ({ ok: true, data: { ...responses.path, step: marked } }) }
      }
      if (requestUrl.includes('/tutor') && method === 'POST') {
        const goal = body?.goal ?? 'explain'
        responses.path = {
          ...tutorView(),
          pathId: 'p-02',
          goal,
          steps: STEPS.map((step) => ({ ...step })),
          rebuilt: true,
        }
        return { status: 201, json: async () => ({ ok: true, data: responses.path }) }
      }
      if (requestUrl.includes('/tutor')) {
        if (responses.missingMap) {
          return {
            status: 404,
            json: async () => ({ ok: false, error: { code: 'E_NOT_FOUND', message: 'not found', details: { reason: 'no-map' } } }),
          }
        }
        return { status: 200, json: async () => ({ ok: true, data: responses.path }) }
      }
      if (requestUrl.includes('/threads')) {
        return {
          status: 200,
          json: async () => ({
            ok: true,
            data: responses.threads ?? { schemaVersion: 1, bookId: BOOK.id, updatedAt: null, threads: [] },
          }),
        }
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
      activeElement: null,
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
  // Tutor 只有打开时才会被渲染；先点一次顶栏入口，让组件注册进 types。
  let probe = render(main.component({}), 'panel')
  const entryButton = findAll(probe, (element) => element.props?.['data-tutor-toggle'] === '')
  assert.equal(entryButton.length, 1, '顶栏应有引导学习入口')
  entryButton[0].props.onClick()
  probe = render(main.component({}), 'panel')
  const Tutor = types.get('Tutor')
  assert.ok(Tutor, '打包后的 client.js 应包含 Tutor 视图')
  assert.ok(byClass(probe, 'rl-tutor').length >= 1, '打开入口后应渲染浮层')

  async function settle(node, times = 6, key = 'tutor') {
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
    Tutor,
    panel: () => main.component({}),
  }
}

function tutorState(overrides = {}) {
  return {
    status: 'ready',
    books: [BOOK],
    revision: 1,
    storage: 'ok',
    pluginVersion: '0.3.0',
    dshVersion: '0.2.2-rc.5',
    selectedBookId: BOOK.id,
    selectedNodeId: null,
    detailOpen: false,
    notesOpen: false,
    askOpen: false,
    tutorOpen: true,
    threadRevision: 0,
    tutorRevision: 0,
    exporting: false,
    lastExport: null,
    lastError: null,
    ...overrides,
  }
}

function tutorActions(overrides = {}) {
  const base = {}
  for (const name of ['toggleTutor', 'closeTutor', 'bumpTutor', 'toggleAsk', 'closeAsk', 'toggleNotes', 'openDetail']) {
    base[name] = () => {}
  }
  return { ...base, ...overrides }
}

describe('引导式学习浮层的渲染（tutor panel）', () => {
  it('渲染进度、步骤、检查点与引用；上一步禁用、无草稿时提问禁用', async () => {
    const client = await loadClient()
    const tree = await client.settle(
      client.h(client.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    const root = byClass(tree, 'rl-tutor')[0]
    assert.ok(root, '应渲染 .rl-tutor')
    assert.equal(root.props.role, 'dialog')
    assert.equal(root.props['aria-modal'], 'true')
    assert.match(textByClass(tree, 'rl-tutor__title'), /引导式学习/)
    assert.match(textByClass(tree, 'rl-tutor__path'), /p-01/)
    assert.match(textByClass(tree, 'rl-tutor__progress-text'), /0\/2 步完成（0%）/)
    assert.equal(byClass(tree, 'rl-tutor__step').length, 1)
    assert.match(textByClass(tree, 'rl-tutor__step-title'), /第一章/)
    assert.match(textByClass(tree, 'rl-tutor__question'), /这一章为什么说记忆是重写/)
    const cites = byClass(tree, 'rl-cite')
    assert.deepEqual(cites.map(textOf), ['[c-000001]'])
    assert.equal(nodeByAttr(tree, 'data-tutor-prev', '')[0].props.disabled, true)
    assert.equal(nodeByAttr(tree, 'data-tutor-next', '')[0].props.disabled, false)
    assert.equal(nodeByAttr(tree, 'data-tutor-send', '')[0].props.disabled, true)
  })

  it('点「我掌握了」→ POST 标记 mastered，进度与状态更新', async () => {
    const client = await loadClient()
    let tree = await client.settle(
      client.h(client.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    const mark = nodeByAttr(tree, 'data-tutor-mark', 'mastered')[0]
    mark.props.onClick()
    tree = await client.settle(
      client.h(client.Tutor, { state: tutorState({ tutorRevision: 1 }), actions: tutorActions() }),
    )
    const post = client.calls.find(
      (call) => call.method === 'POST' && call.url.includes('/tutor/steps/s-01') && !call.url.endsWith('/answer'),
    )
    assert.ok(post, '应发出标记请求')
    assert.equal(post.body.state, 'mastered')
    assert.match(textByClass(tree, 'rl-tutor__progress-text'), /1\/2 步完成（50%）/)
    assert.equal(client.responses.path.steps[0].state, 'mastered')
    // 标记后游标前进到下一步；退回上一步应看到「已掌握」。
    nodeByAttr(tree, 'data-tutor-prev', '')[0].props.onClick()
    tree = await client.settle(
      client.h(client.Tutor, { state: tutorState({ tutorRevision: 1 }), actions: tutorActions() }),
    )
    assert.match(textByClass(tree, 'rl-tutor__state'), /已掌握/)
  })

  it('输入问题后发送 → POST answer 且线程回答出现在浮层里', async () => {
    const client = await loadClient()
    let tree = await client.settle(
      client.h(client.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    const input = findAll(tree, (element) => element.type === 'input')[0]
    assert.ok(input)
    input.props.onInput({ target: { value: '为什么记忆会被重写？' } })
    tree = await client.settle(
      client.h(client.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    const send = nodeByAttr(tree, 'data-tutor-send', '')[0]
    assert.equal(send.props.disabled, false)
    send.props.onClick()
    tree = await client.settle(
      client.h(client.Tutor, { state: tutorState({ tutorRevision: 1 }), actions: tutorActions() }),
    )
    const posted = client.calls.find((call) => call.method === 'POST' && call.url.endsWith('/answer'))
    assert.ok(posted)
    assert.equal(posted.body.question, '为什么记忆会被重写？')
    assert.equal(posted.headers['Idempotency-Key'].startsWith('rl-tutor-s-01-'), true)
    assert.match(textByClass(tree, 'rl-tutor__answers'), /每次回忆都会重写/)
    assert.match(textByClass(tree, 'rl-tutor__state'), /已提问/)
  })

  it('重新开始：三个 goal 按钮，点「自测」→ POST goal=quiz，路径变 p-02', async () => {
    const client = await loadClient()
    let tree = await client.settle(
      client.h(client.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    const goals = findAll(tree, (element) => element.props && 'data-tutor-goal' in element.props)
    assert.deepEqual(goals.map((button) => button.props['data-tutor-goal']), ['explain', 'quiz', 'socratic'])
    nodeByAttr(tree, 'data-tutor-goal', 'quiz')[0].props.onClick()
    tree = await client.settle(
      client.h(client.Tutor, { state: tutorState({ tutorRevision: 1 }), actions: tutorActions() }),
    )
    const post = client.calls.find((call) => call.method === 'POST' && call.url.endsWith('/tutor'))
    assert.ok(post)
    assert.equal(post.body.goal, 'quiz')
    assert.match(textByClass(tree, 'rl-tutor__path'), /p-02/)
  })

  it('无 agent 时提示并禁用提问；无导图时显示空态', async () => {
    const noAgent = await loadClient({ noAgent: true })
    const tree = await noAgent.settle(
      noAgent.h(noAgent.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    assert.match(textByClass(tree, 'rl-tutor__notice'), /没有可用的 AI 会话/)
    assert.equal(nodeByAttr(tree, 'data-tutor-send', '')[0].props.disabled, true)
    assert.equal(findAll(tree, (element) => element.type === 'input')[0].props.disabled, true)

    const noMap = await loadClient({ missingMap: true })
    const missing = await noMap.settle(
      noMap.h(noMap.Tutor, { state: tutorState(), actions: tutorActions() }),
    )
    assert.match(textByClass(missing, 'rl-tutor__empty'), /还没有导图/)
  })

  it('顶栏有「引导学习」入口：未选书时禁用，选书后可用', async () => {
    const client = await loadClient()
    let tree = await client.settle(client.panel(), 6, 'panel')
    const before = nodeByAttr(tree, 'data-tutor-toggle', '')
    assert.equal(before.length, 1, '顶栏应有引导学习入口')
    assert.equal(before[0].props.disabled, true, '未选书时应禁用')
    // R10：顶栏入口图标化，可见文字为空，语义改由 aria-label 承担。
    assert.match(before[0].props['aria-label'], /引导学习/)
    assert.equal(textOf(before[0]).trim(), '')

    byClass(tree, 'rl-card')[0].props.onClick()
    tree = await client.settle(client.panel(), 6, 'panel')
    const after = nodeByAttr(tree, 'data-tutor-toggle', '')
    assert.equal(after.length, 1)
    assert.equal(after[0].props.disabled, false)
    // loadClient 的探针已经点开过浮层，所以这里反映「已打开」。
    assert.equal(after[0].props['aria-pressed'], 'true')
  })
})