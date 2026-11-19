/* 导图画布（owner: canvas，03 §4.1 / §4.3 / §4.5 / §4.8）。
 *
 * 只读渲染 map.json：坐标来自 Host 计算的 layout，这里不重算布局。
 * 组件拆成两层：
 *   VIEWS.Canvas        —— 选书、取图、加载/缺失/错误态；
 *   VIEWS.CanvasSurface —— 拿到 map 之后的 SVG 画布（视口、选中、收起、搜索）。
 * 拆开是为了让状态可以单独渲染（测试与截图都走同一套视图代码）。
 */

var CANVAS_VIEW_PREFIX = 'reading-lab:view:'
var CANVAS_MAP_CACHE = {}
var CANVAS_CULL_THRESHOLD = 300
var CANVAS_DOT_SIZE = 24

var CANVAS_STYLES = [
  '.rl-canvas--map{position:relative;display:block;overflow:hidden;padding:0;background-color:var(--dsw-alias-bg-base);background-image:radial-gradient(circle,var(--dsw-alias-border-l2) 1px,transparent 1px);background-size:' +
    CANVAS_DOT_SIZE +
    'px ' +
    CANVAS_DOT_SIZE +
    'px;cursor:grab;}',
  '.rl-canvas--map:active{cursor:grabbing;}',
  '.rl-canvas__viewport{position:absolute;inset:0;outline:none;overflow:hidden;touch-action:none;}',
  '.rl-canvas__svg{display:block;width:100%;height:100%;user-select:none;}',
  '.rl-canvas__hud{position:absolute;left:12px;top:12px;right:12px;display:flex;align-items:center;gap:8px;z-index:2;pointer-events:none;}',
  '.rl-canvas__search{pointer-events:auto;width:220px;max-width:46%;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;box-shadow:0 2px 8px var(--dsw-alias-bg-mask-1);}',
  '.rl-canvas__search::placeholder{color:var(--dsw-alias-label-caption);}',
  '.rl-canvas__search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.rl-canvas__stats{pointer-events:none;font-size:11px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 10px;}',
  '.rl-canvas__hint{pointer-events:none;font-size:11px;color:var(--dsw-alias-label-caption);}',
  '.rl-canvas__zoombar{position:absolute;right:12px;bottom:12px;z-index:2;display:flex;align-items:center;gap:4px;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 2px 10px var(--dsw-alias-bg-mask-1);}',
  '.rl-canvas__zoombtn{min-width:28px;height:28px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;}',
  '.rl-canvas__zoombtn:hover{background:var(--dsw-alias-interactive-bg-hover);}',
  '.rl-canvas__zoombtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
  '.rl-canvas__zoomvalue{min-width:46px;text-align:center;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}',
  '.rl-canvas__state{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:3;background:var(--dsw-alias-bg-base);}',
  '.rl-node{cursor:pointer;outline:none;}',
  '.rl-node__card{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2);stroke-width:1;}',
  '.rl-node:hover .rl-node__card{stroke:var(--dsw-alias-border-l4);}',
  '.rl-node:focus-visible .rl-node__card,.rl-node--selected .rl-node__card{stroke:var(--dsw-alias-brand-primary);stroke-width:2;}',
  '.rl-node__bar{opacity:.9;}',
  '.rl-node--d1 .rl-node__bar{fill:var(--dsw-alias-brand-primary);}',
  '.rl-node--d2 .rl-node__bar{fill:var(--dsw-alias-state-business-primary);}',
  '.rl-node--d3 .rl-node__bar{fill:var(--dsw-alias-state-success-primary);}',
  '.rl-node__title{fill:var(--dsw-alias-label-primary);font-size:14px;font-weight:600;}',
  '.rl-node--root .rl-node__title{font-size:16px;}',
  '.rl-node__summary{fill:var(--dsw-alias-label-secondary);font-size:12px;}',
  '.rl-node__author{fill:var(--dsw-alias-label-caption);font-size:12px;}',
  '.rl-node__cover{fill:var(--dsw-alias-bg-layer-2);stroke:var(--dsw-alias-border-l1);stroke-width:1;}',
  '.rl-node__covertext{fill:var(--dsw-alias-label-secondary);font-size:22px;font-weight:600;}',
  '.rl-node__cite{fill:var(--dsw-alias-markdown-citation);}',
  '.rl-node__citetext{fill:var(--dsw-alias-label-secondary);font-size:11px;}',
  '.rl-node__toggle{fill:var(--dsw-alias-bg-layer-1);stroke:var(--dsw-alias-border-l2);stroke-width:1;}',
  '.rl-node__toggleglyph{fill:var(--dsw-alias-label-tertiary);font-size:12px;}',
  '.rl-edge{fill:none;stroke:var(--dsw-alias-label-tertiary);stroke-opacity:.7;stroke-width:1.6;}',
  '.rl-edge--active{stroke:var(--dsw-alias-brand-primary);stroke-opacity:.9;stroke-width:2;}',
  '.rl-edge--root{stroke:var(--dsw-alias-border-l4);stroke-opacity:1;stroke-width:2;}',
  '.rl-canvas__emptyicon{width:48px;height:48px;color:var(--dsw-alias-label-caption);}',
  '.rl-canvas__emptyicon--error{color:var(--dsw-alias-state-error-primary);}',
  '.rl-canvas__spinner{width:28px;height:28px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:rl-canvas-spin 900ms linear infinite;}',
  '@keyframes rl-canvas-spin{to{transform:rotate(360deg);}}',
  '@media (prefers-reduced-motion: reduce){.rl-canvas__spinner{animation:none;}}',
  '.rl-canvas__err{font-size:11px;color:var(--dsw-alias-state-error-primary);font-variant-numeric:tabular-nums;}',
  '.rl-gen{position:absolute;inset:0;z-index:4;pointer-events:none;}',
  '.rl-gen__track{position:absolute;left:0;right:0;top:0;height:3px;overflow:hidden;background:var(--dsw-alias-border-l1);}',
  '.rl-gen__fill{width:36%;height:100%;background:var(--dsw-alias-brand-primary);border-radius:3px;animation:rl-gen-slide 1300ms ease-in-out infinite;}',
  '@keyframes rl-gen-slide{0%{transform:translateX(-110%);}100%{transform:translateX(310%);}}',
  '.rl-gen__pill{pointer-events:auto;position:absolute;top:48px;right:12px;display:flex;align-items:center;gap:8px;max-width:calc(100% - 24px);padding:6px 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;box-shadow:0 2px 10px var(--dsw-alias-bg-mask-1);}',
  '.rl-gen__center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;}',
  '.rl-gen--centered .rl-gen__center{background:var(--dsw-alias-bg-base);pointer-events:auto;}',
  '.rl-gen--floating .rl-gen__center{background:transparent;}',
  '.rl-gen--floating .rl-gen__card{pointer-events:auto;box-shadow:0 8px 28px var(--dsw-alias-bg-mask-1);}',
  '.rl-gen__card{display:flex;flex-direction:column;align-items:flex-start;gap:8px;width:min(360px,100%);box-sizing:border-box;padding:24px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 2px 12px var(--dsw-alias-bg-mask-1);}',
  '.rl-gen__card--progress{align-items:center;text-align:center;}',
  '.rl-gen__spinner{width:14px;height:14px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:rl-canvas-spin 900ms linear infinite;flex:0 0 auto;}',
  '.rl-gen__spinner--lg{width:26px;height:26px;margin-bottom:4px;}',
  '.rl-gen__title{font-size:16px;font-weight:600;line-height:1.4;}',
  '.rl-gen__reason{font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary);}',
  '.rl-gen__meta{font-size:12px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;}',
  '.rl-gen__icon{width:28px;height:28px;color:var(--dsw-alias-state-error-primary);margin-bottom:2px;}',
  '.rl-gen__message{margin:4px 0 0;max-height:160px;overflow:auto;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}',
  '.rl-gen__actions{display:flex;align-items:center;gap:8px;margin-top:8px;flex-wrap:wrap;}',
  '@media (prefers-reduced-motion: reduce){.rl-gen__fill{animation:none;width:100%;opacity:.4;}.rl-gen__spinner{animation:none;}}',
].join('\n')

function canvasStorageKey(bookId) {
  return CANVAS_VIEW_PREFIX + bookId
}

function readCanvasView(bookId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    var raw = window.localStorage.getItem(canvasStorageKey(bookId))
    if (!raw) return null
    var parsed = JSON.parse(raw)
    if (!parsed || typeof parsed.zoom !== 'number' || typeof parsed.x !== 'number' || typeof parsed.y !== 'number') {
      return null
    }
    return {
      x: parsed.x,
      y: parsed.y,
      zoom: SVG.clamp(parsed.zoom, SVG.FIT_MIN_ZOOM, SVG.MAX_ZOOM),
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
      selectedNodeId: typeof parsed.selectedNodeId === 'string' ? parsed.selectedNodeId : null,
    }
  } catch (error) {
    return null
  }
}

function writeCanvasView(bookId, view, collapsed, selectedNodeId) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    var ids = []
    Object.keys(collapsed || {}).forEach(function (id) {
      if (collapsed[id]) ids.push(id)
    })
    window.localStorage.setItem(
      canvasStorageKey(bookId),
      JSON.stringify({ x: view.x, y: view.y, zoom: view.zoom, collapsed: ids, selectedNodeId: selectedNodeId || null }),
    )
  } catch (error) {
    /* 隐私模式/配额满：不阻断画布 */
  }
}

function canvasCacheKey(book) {
  if (!book) return ''
  return String(book.mapUpdatedAt || book.updatedAt || book.id || '')
}

/** 取图：404 + reason=no-map 视为「书还没有导图」，其余错误交给错误态。 */
function loadCanvasMap(book) {
  var key = canvasCacheKey(book)
  var cached = CANVAS_MAP_CACHE[book.id]
  if (cached && cached.key === key) return Promise.resolve({ status: 'ready', doc: cached.doc })
  return request('/books/' + encodeURIComponent(book.id) + '/map')
    .then(function (doc) {
      var check = SVG.validateMap(doc)
      if (!check.ok) {
        return { status: 'error', error: { code: 'E_MAP_INVALID', message: check.reason } }
      }
      CANVAS_MAP_CACHE[book.id] = { key: key, doc: doc }
      return { status: 'ready', doc: doc }
    })
    .catch(function (error) {
      if (error && error.status === 404 && (!error.details || error.details.reason === 'no-map')) {
        return { status: 'missing' }
      }
      return {
        status: 'error',
        error: {
          code: (error && error.code) || 'E_UNKNOWN',
          message: (error && error.message) || '',
          status: (error && error.status) || 0,
        },
      }
    })
}

function findCanvasBook(state) {
  var books = state && Array.isArray(state.books) ? state.books : []
  for (var index = 0; index < books.length; index += 1) {
    if (books[index] && books[index].id === state.selectedBookId) return books[index]
  }
  return null
}

function canvasCitationLabel(count) {
  return t('canvas.citation', { count: count })
}

/* ---------------------------------------------------------------------------
 * 生成状态（t30）：t29 的 Host 已经能报 pending/running/done/failed，
 * 这里把 SSE 的 progress/map 事件和 GET 状态查询收敛成一份画布可读的快照。
 *
 * 数据只活在内存里：状态是「这次会话里看到的进展」，不是持久业务数据；
 * 重新加载页面时由 GET /actions/generate-map 兜底。
 * ------------------------------------------------------------------------- */

var CANVAS_GENERATION_STORE = {}
var CANVAS_GENERATION_LISTENERS = new Set()
var CANVAS_GENERATION_INFLIGHT = {}
var CANVAS_GENERATION_STATES = { idle: true, pending: true, running: true, done: true, failed: true }
var CANVAS_GENERATION_REASONS = {
  'agent-error': true,
  'turn-ended': true,
  'inbox-discarded': true,
  timeout: true,
  'agent-disposed': true,
  'agent-missing': true,
  'inject-failed': true,
  'request-failed': true,
  unknown: true,
}

function canvasGenerationEmpty(bookId) {
  return {
    bookId: bookId || '',
    state: 'idle',
    reason: null,
    message: '',
    startedAt: null,
    finishedAt: null,
    elapsedMs: 0,
    timeoutMs: 0,
    updatedAt: null,
    mapRevision: 0,
  }
}

function canvasGenerationEntry(bookId) {
  if (!bookId) return canvasGenerationEmpty('')
  return CANVAS_GENERATION_STORE[bookId] || canvasGenerationEmpty(bookId)
}

function canvasGenerationNotify(entry) {
  CANVAS_GENERATION_LISTENERS.forEach(function (listener) {
    try {
      listener(entry)
    } catch (error) {
      console.warn('[reading-lab] generation listener failed', error)
    }
  })
}

function canvasGenerationPath(bookId) {
  return '/books/' + encodeURIComponent(bookId) + '/actions/generate-map'
}

/**
 * 合并一次状态更新。中间态会清掉 finishedAt；终态没带 elapsedMs 时
 * 用 startedAt 估算，保证失败卡即使没收到 progress 也能显示「已耗时」。
 */
function canvasGenerationApply(bookId, patch) {
  if (!bookId) return null
  var current = canvasGenerationEntry(bookId)
  var next = Object.assign({}, current, patch || {}, { bookId: bookId })
  if (!CANVAS_GENERATION_STATES[next.state]) next.state = 'idle'
  if (next.state === 'pending' || next.state === 'running') {
    if (!next.startedAt) next.startedAt = new Date().toISOString()
    next.finishedAt = null
  } else if (next.state === 'done' || next.state === 'failed') {
    if (!next.finishedAt) next.finishedAt = new Date().toISOString()
    if (typeof patch.elapsedMs !== 'number' && next.startedAt) {
      next.elapsedMs = Math.max(0, Date.now() - Date.parse(next.startedAt))
    }
  }
  CANVAS_GENERATION_STORE[bookId] = next
  canvasGenerationNotify(next)
  return next
}

/** 把 GET 状态查询的 wire 快照映射到本地状态。 */
function canvasGenerationApplySnapshot(bookId, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null
  var state = typeof snapshot.state === 'string' ? snapshot.state : 'idle'
  var patch = {
    state: state,
    reason: typeof snapshot.reason === 'string' ? snapshot.reason : null,
    message: typeof snapshot.message === 'string' ? snapshot.message : '',
    startedAt: typeof snapshot.startedAt === 'string' ? snapshot.startedAt : null,
    finishedAt: typeof snapshot.finishedAt === 'string' ? snapshot.finishedAt : null,
    elapsedMs: typeof snapshot.elapsedMs === 'number' ? snapshot.elapsedMs : 0,
    timeoutMs: typeof snapshot.timeoutMs === 'number' ? snapshot.timeoutMs : 0,
    updatedAt: typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : null,
  }
  return canvasGenerationApply(bookId, patch)
}

/** 状态查询兜底：页面加载、SSE 重连、E_BUSY 之后都用它对齐真实状态。 */
function canvasGenerationRefresh(bookId) {
  if (!bookId) return Promise.resolve(null)
  if (CANVAS_GENERATION_INFLIGHT[bookId]) return CANVAS_GENERATION_INFLIGHT[bookId]
  var task = request(canvasGenerationPath(bookId))
    .then(function (snapshot) {
      return canvasGenerationApplySnapshot(bookId, snapshot)
    })
    .catch(function () {
      // 查询失败不改写本地状态：SSE 仍可能把终态送到。
      return null
    })
    .then(function (entry) {
      delete CANVAS_GENERATION_INFLIGHT[bookId]
      return entry
    })
  CANVAS_GENERATION_INFLIGHT[bookId] = task
  return task
}

/** 发一次生成请求；失败时把可读原因留在画布上，E_BUSY 则回到状态查询。 */
function canvasGenerationStart(bookId) {
  if (!bookId) return Promise.resolve(null)
  canvasGenerationApply(bookId, {
    state: 'pending',
    reason: null,
    message: '',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    elapsedMs: 0,
  })
  return request(canvasGenerationPath(bookId), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: '{}',
  })
    .then(function (data) {
      return canvasGenerationApply(bookId, {
        state: data && data.state ? data.state : 'pending',
        timeoutMs: data && typeof data.timeoutMs === 'number' ? data.timeoutMs : 0,
        updatedAt: new Date().toISOString(),
      })
    })
    .catch(function (error) {
      if (error && error.code === 'E_BUSY') {
        canvasGenerationRefresh(bookId)
        return null
      }
      return canvasGenerationApply(bookId, {
        state: 'failed',
        reason: 'request-failed',
        message: (error && error.message) || '',
        finishedAt: new Date().toISOString(),
      })
    })
}

/**
 * SSE 入口（由 overlay 的 runtime 调用，保证只有一条 EventSource）：
 * progress 驱动进度与失败原因，map 事件触发新图重载并把状态收口为 done。
 */
function canvasRuntimeEvent(type, payload) {
  if (!payload || typeof payload.bookId !== 'string' || !payload.bookId) return null
  var bookId = payload.bookId
  if (type === 'progress') {
    if (payload.phase === 'failed') {
      return canvasGenerationApply(bookId, {
        state: 'failed',
        reason: typeof payload.reason === 'string' ? payload.reason : 'unknown',
        message: typeof payload.message === 'string' ? payload.message : '',
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
      })
    }
    if (payload.phase === 'done') {
      return canvasGenerationApply(bookId, {
        state: 'done',
        updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
      })
    }
    if (payload.phase !== 'mapping') return null
    var current = canvasGenerationEntry(bookId)
    // 页面在生成中途才打开：进度事件没有 startedAt，补一次状态查询。
    if (!current.startedAt) canvasGenerationRefresh(bookId)
    return canvasGenerationApply(bookId, {
      state: payload.state === 'running' ? 'running' : 'pending',
      updatedAt: typeof payload.updatedAt === 'string' ? payload.updatedAt : new Date().toISOString(),
    })
  }
  if (type === 'map') {
    delete CANVAS_MAP_CACHE[bookId]
    var entry = canvasGenerationEntry(bookId)
    return canvasGenerationApply(bookId, {
      state: 'done',
      reason: null,
      message: '',
      mapRevision: (entry.mapRevision || 0) + 1,
      updatedAt: typeof payload.mapUpdatedAt === 'string' ? payload.mapUpdatedAt : new Date().toISOString(),
    })
  }
  return null
}

/** SSE 建立/重连（hello）时对齐一次，避免错过终态。 */
function canvasRuntimeHello() {
  var selected = store.get().selectedBookId
  if (selected) canvasGenerationRefresh(selected)
}

/** 断线：保留现有状态（进度条继续显示），等下一次 hello 再对齐。 */
function canvasRuntimeOffline() {
  var selected = store.get().selectedBookId
  if (!selected) return
  var entry = canvasGenerationEntry(selected)
  if (entry.state === 'pending' || entry.state === 'running') {
    canvasGenerationApply(selected, { updatedAt: new Date().toISOString() })
  }
}

function canvasGenerationElapsed(entry, now) {
  if (!entry) return 0
  if ((entry.state === 'pending' || entry.state === 'running') && entry.startedAt) {
    var started = Date.parse(entry.startedAt)
    if (isFinite(started)) return Math.max(0, now - started)
  }
  return typeof entry.elapsedMs === 'number' && entry.elapsedMs > 0 ? entry.elapsedMs : 0
}

/** 紧凑耗时（0:07 / 2:13 / 1:02:03），不依赖 Intl。 */
function canvasFormatElapsed(ms) {
  var total = Math.max(0, Math.floor((ms || 0) / 1000))
  var seconds = total % 60
  var minutes = Math.floor(total / 60) % 60
  var hours = Math.floor(total / 3600)
  var tail = (minutes < 10 ? '0' : '') + minutes + ':' + (seconds < 10 ? '0' : '') + seconds
  return hours > 0 ? hours + ':' + tail : minutes + ':' + (seconds < 10 ? '0' : '') + seconds
}

function useCanvasGeneration(bookId) {
  var pair = React.useState(function () {
    return canvasGenerationEntry(bookId)
  })
  var entry = pair[0]
  var setEntry = pair[1]
  React.useEffect(
    function () {
      setEntry(canvasGenerationEntry(bookId))
      return function () {}
    },
    [bookId],
  )
  React.useEffect(
    function () {
      function listener(next) {
        if (next.bookId === bookId) setEntry(next)
      }
      CANVAS_GENERATION_LISTENERS.add(listener)
      return function () {
        CANVAS_GENERATION_LISTENERS.delete(listener)
      }
    },
    [bookId],
  )
  return entry && entry.bookId === bookId ? entry : canvasGenerationEntry(bookId)
}

/** 进度条 / 失败卡（t30）：只在 pending/running/failed 时出现。 */
VIEWS.CanvasGeneration = function CanvasGeneration(props) {
  var generation = props.generation || canvasGenerationEmpty('')
  var state = generation.state
  var active = state === 'pending' || state === 'running'
  var detailsPair = React.useState(false)
  var detailsOpen = detailsPair[0]
  var setDetailsOpen = detailsPair[1]
  var clockPair = React.useState(0)
  var setClock = clockPair[1]

  React.useEffect(
    function () {
      if (!active || typeof setInterval !== 'function') return
      var timer = setInterval(function () {
        setClock(Date.now())
      }, 1000)
      return function () {
        clearInterval(timer)
      }
    },
    [active],
  )

  if (!active && state !== 'failed') return null

  var elapsed = canvasGenerationElapsed(generation, Date.now())
  var timeText = canvasFormatElapsed(elapsed)
  var centered = !props.hasMap
  var className = 'rl-gen' + (centered ? ' rl-gen--centered' : ' rl-gen--floating')

  if (active) {
    var label = state === 'pending' ? t('canvas.generate.pending') : t('canvas.generate.running')
    return h(
      'div',
      { className: className, 'data-generation-state': state, role: 'status', 'aria-live': 'polite' },
      h('div', { className: 'rl-gen__track', 'aria-hidden': 'true' }, h('div', { className: 'rl-gen__fill' })),
      centered
        ? h(
            'div',
            { className: 'rl-gen__center' },
            h(
              'div',
              { className: 'rl-gen__card rl-gen__card--progress' },
              h('div', { className: 'rl-gen__spinner rl-gen__spinner--lg', 'aria-hidden': 'true' }),
              h('div', { className: 'rl-gen__title' }, label),
              h('div', { className: 'rl-gen__meta', 'data-generation-elapsed': true }, t('canvas.generate.elapsed', { time: timeText })),
              h('div', { className: 'rl-gen__reason' }, t('canvas.generate.hint')),
            ),
          )
        : h(
            'div',
            { className: 'rl-gen__pill' },
            h('span', { className: 'rl-gen__spinner', 'aria-hidden': 'true' }),
            h('span', null, label),
            h('span', { className: 'rl-gen__meta', 'data-generation-elapsed': true }, t('canvas.generate.elapsed', { time: timeText })),
          ),
    )
  }

  var reason = typeof generation.reason === 'string' && generation.reason ? generation.reason : 'unknown'
  if (!CANVAS_GENERATION_REASONS[reason]) reason = 'unknown'
  var reasonKey = 'canvas.generate.reason.' + reason
  var reasonText = t(reasonKey)
  if (reasonText === reasonKey) reasonText = t('canvas.generate.reason.unknown')
  var meta = t('canvas.generate.elapsed', { time: timeText })
  if (generation.timeoutMs > 0) meta += ' · ' + t('canvas.generate.failed.timeout', { time: canvasFormatElapsed(generation.timeoutMs) })

  return h(
    'div',
    {
      className: className + ' rl-gen--failed',
      'data-generation-state': 'failed',
      'data-generation-reason': reason,
      role: 'alert',
    },
    h(
      'div',
      { className: 'rl-gen__center' },
      h(
        'div',
        { className: 'rl-gen__card' },
        h(
          'svg',
          { className: 'rl-gen__icon', viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' },
          h('path', {
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '2',
            strokeLinecap: 'round',
            d: 'M24 8 44 40H4zM24 19v10M24 34v.5',
          }),
        ),
        h('div', { className: 'rl-gen__title' }, t('canvas.generate.failed.title')),
        h('div', { className: 'rl-gen__reason', 'data-generation-reason-text': true }, reasonText),
        h('div', { className: 'rl-gen__meta' }, meta),
        detailsOpen
          ? h(
              'pre',
              { className: 'rl-gen__message', 'data-generation-message': true },
              generation.message || t('canvas.generate.reason.unknown'),
            )
          : null,
        h(
          'div',
          { className: 'rl-gen__actions' },
          h(
            'button',
            {
              type: 'button',
              className: 'rl-btn rl-btn--primary',
              'data-generation-retry': true,
              onClick: function () {
                setDetailsOpen(false)
                if (props.onRetry) props.onRetry()
              },
            },
            t('canvas.generate.failed.retry'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'rl-btn',
              'data-generation-details': true,
              'aria-expanded': detailsOpen ? 'true' : 'false',
              onClick: function () {
                setDetailsOpen(!detailsOpen)
              },
            },
            detailsOpen ? t('canvas.generate.failed.hide') : t('canvas.generate.failed.details'),
          ),
        ),
      ),
    ),
  )
}

VIEWS.Canvas = function Canvas(props) {
  var state = props.state
  var actions = props.actions
  var book = findCanvasBook(state)
  var mapStatePair = React.useState({ status: 'idle', doc: null, error: null, bookId: null })
  var mapState = mapStatePair[0]
  var setMapState = mapStatePair[1]
  var retryState = React.useState(0)
  var retry = retryState[0]
  var setRetry = retryState[1]
  var cacheKey = book ? canvasCacheKey(book) : ''
  var bookId = book ? book.id : ''

  React.useEffect(
    function () {
      if (!book) {
        setMapState({ status: 'idle', doc: null, error: null, bookId: null })
        return
      }
      var cancelled = false
      var cached = retry === 0 ? CANVAS_MAP_CACHE[book.id] : null
      if (cached && cached.key === cacheKey) {
        setMapState({ status: 'ready', doc: cached.doc, error: null, bookId: book.id })
        return
      }
      setMapState({ status: 'loading', doc: null, error: null, bookId: book.id })
      loadCanvasMap(book).then(function (result) {
        if (cancelled) return
        setMapState({
          status: result.status,
          doc: result.doc || null,
          error: result.error || null,
          bookId: book.id,
        })
      })
      return function () {
        cancelled = true
      }
    },
    [bookId, cacheKey, retry],
  )

  var generation = useCanvasGeneration(bookId)

  // 页面加载、切书、SSE 重连都对齐一次 Host 状态，避免错过终态。
  React.useEffect(
    function () {
      if (!bookId) return
      canvasGenerationRefresh(bookId)
      return function () {}
    },
    [bookId],
  )

  // 新 map 落盘：先清缓存再取图；旧图保留到新图到达，避免闪白。
  React.useEffect(
    function () {
      if (!bookId || !generation.mapRevision) return
      var cancelled = false
      delete CANVAS_MAP_CACHE[bookId]
      request('/books/' + encodeURIComponent(bookId) + '/map')
        .then(function (doc) {
          if (cancelled) return
          var check = SVG.validateMap(doc)
          if (!check.ok) {
            setMapState({ status: 'error', doc: null, error: { code: 'E_MAP_INVALID', message: check.reason }, bookId: bookId })
            return
          }
          CANVAS_MAP_CACHE[bookId] = { key: book ? canvasCacheKey(book) : bookId, doc: doc }
          setMapState({ status: 'ready', doc: doc, error: null, bookId: bookId })
        })
        .catch(function (error) {
          if (cancelled) return
          if (error && error.status === 404) {
            setMapState({ status: 'missing', doc: null, error: null, bookId: bookId })
            return
          }
          setMapState(function (current) {
            if (current && current.doc) return current
            return { status: 'error', doc: null, error: error, bookId: bookId }
          })
        })
      return function () {
        cancelled = true
      }
    },
    [bookId, generation.mapRevision],
  )

  function retryMap() {
    if (book) delete CANVAS_MAP_CACHE[book.id]
    setRetry(function (value) {
      return value + 1
    })
  }

  function generateMap() {
    if (!book) return
    canvasGenerationStart(book.id)
  }

  if (!book) {
    return h(
      'section',
      { className: 'rl-canvas', 'aria-label': t('canvas.empty.title') },
      h(
        'div',
        { className: 'rl-empty' },
        h(
          'svg',
          { className: 'rl-empty__icon', viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' },
          h('path', {
            fill: 'currentColor',
            d: 'M24 6v12M24 30v12M6 24h12M30 24h12M11 11l8 8M29 29l8 8M37 11l-8 8M19 29l-8 8',
            stroke: 'currentColor',
            strokeWidth: '2',
            strokeLinecap: 'round',
          }),
        ),
        h('div', { className: 'rl-empty__title' }, t('canvas.empty.title')),
        h('div', { className: 'rl-empty__hint' }, t('canvas.empty.hint')),
      ),
    )
  }

  return h(VIEWS.CanvasSurface, {
    key: book.id,
    book: book,
    mapState: mapState,
    state: state,
    actions: actions,
    initialView: readCanvasView(book.id),
    onRetry: retryMap,
    onGenerate: generateMap,
    generation: generation,
  })
}

/** 加载/缺失/错误三种覆盖态；ready 时返回 null。 */
VIEWS.CanvasState = function CanvasState(props) {
  var status = props.status
  var book = props.book
  var error = props.error || {}
  var actions = props.actions
  var onGenerate = props.onGenerate
  var title = ''
  var hint = ''
  var code = ''
  if (status === 'loading' || status === 'idle') {
    title = t('canvas.loading.title')
    hint = t('canvas.loading.hint')
  } else if (status === 'missing') {
    title = t('canvas.noMap.title')
    hint = t('canvas.noMap.hint')
  } else if (status === 'error') {
    title = t('canvas.error.title')
    hint = t('canvas.error.hint')
    code = error.code || 'E_UNKNOWN'
  }

  return h(
    'div',
    { className: 'rl-canvas__state', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { className: 'rl-empty' },
      status === 'loading' || status === 'idle'
        ? h('div', { className: 'rl-canvas__spinner', 'aria-hidden': 'true' })
        : h(
            'svg',
            {
              className: 'rl-canvas__emptyicon' + (status === 'error' ? ' rl-canvas__emptyicon--error' : ''),
              viewBox: '0 0 48 48',
              'aria-hidden': 'true',
              focusable: 'false',
            },
            h('path', {
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: '2',
              strokeLinecap: 'round',
              d:
                status === 'error'
                  ? 'M24 8 44 40H4zM24 19v10M24 34v.5'
                  : 'M10 12h12v10H10zM26 12h12v10H26zM18 34h12M24 22v12',
            }),
          ),
      h('div', { className: 'rl-empty__title' }, title),
      h('div', { className: 'rl-empty__hint' }, hint),
      status === 'error'
        ? h('div', { className: 'rl-canvas__err', 'aria-hidden': 'false' }, code)
        : null,
      status !== 'loading' && status !== 'idle'
        ? h(
            'div',
            { className: 'rl-empty__actions' },
            status === 'missing' && onGenerate
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'rl-btn rl-btn--primary',
                    'data-generate-map': true,
                    onClick: function () {
                      onGenerate()
                    },
                  },
                  t('canvas.generate.title'),
                )
              : null,
            h(
              'button',
              {
                type: 'button',
                className: 'rl-btn',
                onClick: function () {
                  if (props.onRetry) props.onRetry()
                },
              },
              t('canvas.retry'),
            ),
          )
        : null,
      h('div', { className: 'rl-sr' }, book && book.title ? book.title : ''),
    ),
  )
}

VIEWS.CanvasNode = function CanvasNode(props) {
  var node = props.node
  var focused = props.focused
  var onSelect = props.onSelect
  var onToggle = props.onToggle
  var onFocus = props.onFocus
  var className =
    'rl-node rl-node--d' +
    node.depth +
    (node.isRoot ? ' rl-node--root' : '') +
    (focused ? ' rl-node--focused' : '') +
    (node.selected ? ' rl-node--selected' : '')
  var citeText = node.citationCount > 0 ? canvasCitationLabel(node.citationCount) : ''
  var citeWidth = citeText ? Math.max(30, SVG.measure(citeText, 11, 400) + 14) : 0
  var citeX = node.w - citeWidth - 10
  var citeY = node.isRoot ? node.h - 28 : 10

  var children = []
  children.push(
    h('title', { key: 'tooltip' }, node.title + (node.summaryLines.length ? ' · ' + node.summaryLines.join('') : '')),
  )
  children.push(
    h('rect', {
      key: 'card',
      className: 'rl-node__card',
      x: 0,
      y: 0,
      width: node.w,
      height: node.h,
      rx: node.isRoot ? 12 : 8,
    }),
  )
  if (!node.isRoot) {
    children.push(
      h('rect', { key: 'bar', className: 'rl-node__bar', x: 0, y: 10, width: 3, height: node.h - 20, rx: 1.5 }),
    )
    children.push(
      h(
        'text',
        { key: 'title', className: 'rl-node__title', x: 12, y: 28 },
        node.titleText,
      ),
    )
    node.summaryLines.forEach(function (line, index) {
      children.push(
        h(
          'text',
          { key: 'summary-' + index, className: 'rl-node__summary', x: 12, y: 50 + index * 18 },
          line,
        ),
      )
    })
  } else {
    children.push(
      h('rect', { key: 'cover', className: 'rl-node__cover', x: 16, y: 16, width: 40, height: 52, rx: 8 }),
    )
    children.push(
      h(
        'text',
        { key: 'covertext', className: 'rl-node__covertext', x: 36, y: 49, textAnchor: 'middle' },
        node.coverChar,
      ),
    )
    children.push(h('text', { key: 'title', className: 'rl-node__title', x: 68, y: 34 }, node.titleText))
    children.push(h('text', { key: 'author', className: 'rl-node__author', x: 68, y: 54 }, node.authorText))
    node.summaryLines.forEach(function (line, index) {
      children.push(
        h('text', { key: 'summary-' + index, className: 'rl-node__summary', x: 16, y: 88 + index * 18 }, line),
      )
    })
  }
  if (citeText) {
    children.push(
      h('rect', {
        key: 'cite',
        className: 'rl-node__cite',
        x: citeX,
        y: citeY,
        width: citeWidth,
        height: 18,
        rx: 9,
      }),
    )
    children.push(
      h(
        'text',
        { key: 'citetext', className: 'rl-node__citetext', x: citeX + citeWidth / 2, y: citeY + 13, textAnchor: 'middle' },
        citeText,
      ),
    )
  }
  if (node.hasChildren) {
    children.push(
      h('circle', {
        key: 'toggle',
        className: 'rl-node__toggle',
        cx: node.w,
        cy: node.h / 2,
        r: 9,
      }),
    )
    children.push(
      h(
        'text',
        {
          key: 'toggleglyph',
          className: 'rl-node__toggleglyph',
          x: node.w,
          y: node.h / 2 + 4,
          textAnchor: 'middle',
        },
        node.expanded ? '−' : '+',
      ),
    )
  }

  return h(
    'g',
    {
      className: className,
      transform: 'translate(' + node.x + ',' + node.y + ')',
      role: 'treeitem',
      'data-node-id': node.id,
      'data-depth': String(node.depth),
      'aria-level': String(node.depth + 1),
      'aria-expanded': node.hasChildren ? (node.expanded ? 'true' : 'false') : undefined,
      'aria-selected': node.selected ? 'true' : 'false',
      'aria-label': node.title + (node.citationCount ? ' · ' + canvasCitationLabel(node.citationCount) : ''),
      tabIndex: focused ? 0 : -1,
      onClick: function (event) {
        if (event && event.stopPropagation) event.stopPropagation()
        onSelect(node.id)
      },
      onDoubleClick: function (event) {
        if (event && event.stopPropagation) event.stopPropagation()
        if (node.hasChildren) onToggle(node.id, true)
      },
      onFocus: function () {
        onFocus(node.id)
      },
    },
    children,
  )
}

VIEWS.CanvasSurface = function CanvasSurface(props) {
  var book = props.book
  var mapState = props.mapState || { status: 'loading' }
  var state = props.state
  var actions = props.actions
  var initialView = props.initialView || null
  var generation = props.generation || null
  var onGenerate = props.onGenerate || null
  var containerRef = React.useRef(null)
  var viewportState = React.useState({ width: 1200, height: 800 })
  var viewport = viewportState[0]
  var setViewport = viewportState[1]
  var viewState = React.useState(function () {
    return initialView ? { x: initialView.x, y: initialView.y, zoom: initialView.zoom } : null
  })
  var view = viewState[0]
  var setView = viewState[1]
  var collapsedState = React.useState(function () {
    var initial = {}
    if (initialView && Array.isArray(initialView.collapsed)) {
      initialView.collapsed.forEach(function (id) {
        initial[id] = true
      })
    }
    return initial
  })
  var collapsed = collapsedState[0]
  var setCollapsed = collapsedState[1]
  var focusState = React.useState(null)
  var focusId = focusState[0]
  var setFocusId = focusState[1]
  var queryState = React.useState('')
  var query = queryState[0]
  var setQuery = queryState[1]
  var dragState = React.useState(false)
  var dragging = dragState[0]
  var setDragging = dragState[1]
  var viewRef = React.useRef(view)
  viewRef.current = view
  var viewportRef = React.useRef(viewport)
  viewportRef.current = viewport
  var dragRef = React.useRef(null)
  var frameRef = React.useRef(0)
  var pendingRef = React.useRef(null)
  var persistRef = React.useRef(0)
  var restoredRef = React.useRef(false)
  var detailPanRef = React.useRef('')
  var doc = mapState.status === 'ready' ? mapState.doc : null

  var scene = React.useMemo(
    function () {
      if (!doc) return null
      var check = SVG.validateMap(doc)
      if (!check.ok) return null
      return SVG.buildScene(doc, {
        collapsed: collapsed,
        selectedId: state.selectedNodeId,
        bookTitle: book.title,
        author: book.author,
      })
    },
    [doc, collapsed, state.selectedNodeId, book.title, book.author],
  )

  var visibleScene = React.useMemo(
    function () {
      if (!scene) return null
      if (scene.nodes.length <= CANVAS_CULL_THRESHOLD || !view) return scene
      return SVG.cullScene(scene, view, viewport)
    },
    [scene, view, viewport],
  )

  React.useEffect(
    function () {
      var node = containerRef.current
      if (!node || typeof node.getBoundingClientRect !== 'function') return
      function measure() {
        var rect = node.getBoundingClientRect()
        if (!rect || !rect.width || !rect.height) return
        setViewport({ width: rect.width, height: rect.height })
      }
      measure()
      if (typeof ResizeObserver === 'function') {
        var observer = new ResizeObserver(measure)
        observer.observe(node)
        return function () {
          observer.disconnect()
        }
      }
    },
    [],
  )

  React.useEffect(
    function () {
      if (restoredRef.current) return
      if (!scene || !initialView || !initialView.selectedNodeId) return
      var exists = false
      for (var index = 0; index < scene.all.length; index += 1) {
        if (scene.all[index].id === initialView.selectedNodeId) exists = true
      }
      if (!exists) return
      restoredRef.current = true
      if (!state.selectedNodeId && actions && typeof actions.openDetail === 'function') {
        actions.openDetail(initialView.selectedNodeId)
      }
    },
    [scene, initialView, state.selectedNodeId, actions],
  )

  React.useEffect(
    function () {
      if (!scene || view) return
      setView(SVG.fitView(scene.bounds, viewportRef.current))
    },
    [scene, view],
  )

  /*
   * 详情卡是右侧覆盖层（宽 360 + 右距 16）。选中卡若落在覆盖区下方，
   * 按需向左平移画布，保证「详情不遮挡选中卡」，同时不改变缩放。
   */
  React.useEffect(
    function () {
      if (!view || !scene) return
      var stamp = (state && state.detailOpen ? '1' : '0') + '|' + ((state && state.selectedNodeId) || '')
      if (detailPanRef.current === stamp) return
      if (!state || !state.detailOpen || !state.selectedNodeId) {
        detailPanRef.current = stamp
        return
      }
      var vp = viewportRef.current
      if (!vp || !vp.width || vp.width <= 720) {
        detailPanRef.current = stamp
        return
      }
      var target = null
      for (var index = 0; index < scene.all.length; index += 1) {
        if (scene.all[index].id === state.selectedNodeId) target = scene.all[index]
      }
      if (!target) {
        detailPanRef.current = stamp
        return
      }
      detailPanRef.current = stamp
      var safeRight = vp.width - 376 - 24
      var screenX = view.x + target.x * view.zoom
      var screenRight = screenX + target.w * view.zoom
      if (screenRight <= safeRight && screenX >= 8) return
      var dx = safeRight - screenRight
      if (screenX + dx < 8) dx = 8 - screenX
      if (!dx) return
      setView({ x: view.x + dx, y: view.y, zoom: view.zoom })
    },
    [scene, view, state.detailOpen, state.selectedNodeId, viewport.width],
  )

  React.useEffect(
    function () {
      if (!view) return
      if (persistRef.current) clearTimeout(persistRef.current)
      persistRef.current = setTimeout(function () {
        writeCanvasView(book.id, view, collapsed, state.selectedNodeId)
      }, 200)
      return function () {
        if (persistRef.current) clearTimeout(persistRef.current)
      }
    },
    [view, collapsed, state.selectedNodeId, book.id],
  )

  function commitView(next) {
    pendingRef.current = next
    if (typeof requestAnimationFrame !== 'function') {
      setView(next)
      return
    }
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(function () {
      frameRef.current = 0
      setView(pendingRef.current)
    })
  }

  React.useEffect(
    function () {
      var node = containerRef.current
      if (!node || typeof node.addEventListener !== 'function') return
      function onWheel(event) {
        event.preventDefault()
        var rect = node.getBoundingClientRect()
        var current = viewRef.current
        if (!current) return
        var factor = Math.exp(-event.deltaY * 0.0015)
        commitView(SVG.zoomAt(current, factor, event.clientX - rect.left, event.clientY - rect.top))
      }
      node.addEventListener('wheel', onWheel, { passive: false })
      return function () {
        node.removeEventListener('wheel', onWheel)
        if (frameRef.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameRef.current)
        frameRef.current = 0
      }
    },
    [],
  )

  function focusNode(id) {
    setFocusId(id)
    var node = containerRef.current
    if (!node || typeof node.querySelector !== 'function') return
    var target = node.querySelector('[data-node-id="' + String(id).replace(/"/g, '') + '"]')
    if (target && typeof target.focus === 'function') target.focus()
  }

  function center(id) {
    if (!scene) return
    var target = null
    for (var index = 0; index < scene.all.length; index += 1) {
      if (scene.all[index].id === id) target = scene.all[index]
    }
    if (!target) return
    commitView(SVG.centerOn(target, viewportRef.current, 1))
  }

  function expandTo(id) {
    if (!doc) return
    var index = SVG.indexMap(doc)
    var ancestors = SVG.ancestorsOf(index, id)
    if (!ancestors.length) return
    setCollapsed(function (current) {
      var next = Object.assign({}, current)
      var changed = false
      ancestors.forEach(function (ancestorId) {
        if (next[ancestorId]) {
          delete next[ancestorId]
          changed = true
        }
      })
      return changed ? next : current
    })
  }

  function toggle(id, ensureSelected) {
    if (ensureSelected && actions) actions.openDetail(id)
    var node = null
    for (var index = 0; index < scene.all.length; index += 1) {
      if (scene.all[index].id === id) node = scene.all[index]
    }
    if (!node || !node.hasChildren) return
    setCollapsed(function (current) {
      var next = Object.assign({}, current)
      if (next[id]) delete next[id]
      else next[id] = true
      return next
    })
  }

  function select(id) {
    if (!actions) return
    if (state.selectedNodeId === id) actions.openDetail(null)
    else actions.openDetail(id)
    setFocusId(id)
  }

  function move(direction) {
    if (!scene) return
    var current = focusId || state.selectedNodeId || (scene.nodes[0] && scene.nodes[0].id)
    var next = SVG.navigate(scene, current, direction)
    if (next) focusNode(next)
  }

  function zoomBy(factor) {
    if (!view) return
    commitView(SVG.zoomAt(view, factor, viewport.width / 2, viewport.height / 2))
  }

  function fit() {
    if (!scene) return
    setView(SVG.fitView(scene.bounds, viewportRef.current))
  }

  function actualSize() {
    if (!view) return
    var world = SVG.toWorld(view, viewport.width / 2, viewport.height / 2)
    setView({ x: viewport.width / 2 - world.x, y: viewport.height / 2 - world.y, zoom: 1 })
  }

  function onKeyDown(event) {
    if (!scene) return
    var key = event.key
    var current = focusId || state.selectedNodeId || (scene.nodes[0] && scene.nodes[0].id)
    var node = null
    for (var index = 0; index < scene.all.length; index += 1) {
      if (scene.all[index].id === current) node = scene.all[index]
    }
    if (key === 'ArrowDown') {
      event.preventDefault()
      move('next')
    } else if (key === 'ArrowUp') {
      event.preventDefault()
      move('previous')
    } else if (key === 'ArrowRight') {
      event.preventDefault()
      if (node && node.hasChildren && !node.expanded) toggle(node.id, false)
      else move('child')
    } else if (key === 'ArrowLeft') {
      event.preventDefault()
      if (node && node.hasChildren && node.expanded) toggle(node.id, false)
      else move('parent')
    } else if (key === 'Home') {
      event.preventDefault()
      move('first')
    } else if (key === 'End') {
      event.preventDefault()
      move('last')
    } else if (key === 'Enter') {
      event.preventDefault()
      if (node) actions.openDetail(node.id)
    } else if (key === ' ') {
      event.preventDefault()
      if (node) toggle(node.id, true)
    } else if (key === 'PageDown' || key === 'PageUp') {
      event.preventDefault()
      var direction = key === 'PageDown' ? 1 : -1
      if (view) setView({ x: view.x, y: view.y - viewport.height * 0.8 * direction, zoom: view.zoom })
    } else if (key === 'Escape') {
      if (state.detailOpen || state.selectedNodeId) actions.openDetail(null)
    } else if (key === '+' || key === '=') {
      event.preventDefault()
      zoomBy(1.2)
    } else if (key === '-') {
      event.preventDefault()
      zoomBy(1 / 1.2)
    } else if (key === '0') {
      event.preventDefault()
      actualSize()
    } else if (key === 'f' || key === 'F') {
      event.preventDefault()
      fit()
    }
  }

  function onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    var target = event.target
    if (target && typeof target.closest === 'function' && target.closest('[data-node-id]')) return
    var base = viewRef.current
    if (!base) return
    dragRef.current = { x: event.clientX, y: event.clientY, view: base, pointerId: event.pointerId }
    setDragging(true)
    var current = event.currentTarget
    if (current && typeof current.setPointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        current.setPointerCapture(event.pointerId)
      } catch (error) {
        /* 旧浏览器忽略 */
      }
    }
  }

  function onPointerMove(event) {
    var drag = dragRef.current
    if (!drag) return
    commitView({
      x: drag.view.x + (event.clientX - drag.x),
      y: drag.view.y + (event.clientY - drag.y),
      zoom: drag.view.zoom,
    })
  }

  function onPointerUp(event) {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    var current = event.currentTarget
    if (current && typeof current.releasePointerCapture === 'function' && event.pointerId !== undefined) {
      try {
        current.releasePointerCapture(event.pointerId)
      } catch (error) {
        /* 指针已释放 */
      }
    }
  }

  var matches = React.useMemo(
    function () {
      if (!scene || !query.trim()) return []
      var needle = query.trim().toLowerCase()
      return scene.all.filter(function (node) {
        return (
          String(node.title || '').toLowerCase().indexOf(needle) >= 0 ||
          String(node.summaryLines.join('')).toLowerCase().indexOf(needle) >= 0
        )
      })
    },
    [scene, query],
  )
  var matchCursor = React.useRef(0)

  function submitSearch(event) {
    if (event && event.key && event.key !== 'Enter') return
    if (event && event.preventDefault) event.preventDefault()
    if (!matches.length) return
    var index = matchCursor.current % matches.length
    var target = matches[index]
    matchCursor.current = index + 1
    expandTo(target.id)
    if (actions) actions.openDetail(target.id)
    setFocusId(target.id)
    center(target.id)
  }

  var surface = null
  if (mapState.status === 'ready' && scene) {
    var nodes = visibleScene ? visibleScene.nodes : []
    var edges = visibleScene ? visibleScene.edges : []
    surface = h(
      'div',
      {
        className: 'rl-canvas__viewport',
        tabIndex: 0,
        role: 'tree',
        'aria-label': book.title || book.id,
        'aria-multiselectable': 'false',
        onKeyDown: onKeyDown,
      },
      h(
        'svg',
        {
          className: 'rl-canvas__svg',
          onPointerDown: onPointerDown,
          onPointerMove: onPointerMove,
          onPointerUp: onPointerUp,
          onPointerCancel: onPointerUp,
        },
        h(
          'g',
          { transform: 'translate(' + (view ? view.x : 0) + ',' + (view ? view.y : 0) + ') scale(' + (view ? view.zoom : 1) + ')' },
          edges.map(function (edge) {
            return h('path', {
              key: 'e-' + edge.from + '-' + edge.to,
              className:
                'rl-edge' +
                (edge.side === 'root' ? ' rl-edge--root' : '') +
                (state.selectedNodeId && (edge.from === state.selectedNodeId || edge.to === state.selectedNodeId)
                  ? ' rl-edge--active'
                  : ''),
              d: edge.d,
            })
          }),
          nodes.map(function (node) {
            return h(VIEWS.CanvasNode, {
              key: node.id,
              node: node,
              focused: focusId === node.id,
              onSelect: select,
              onToggle: toggle,
              onFocus: setFocusId,
            })
          }),
        ),
      ),
    )
  }

  var stateOverlay =
    mapState.status === 'ready' && scene
      ? null
      : h(VIEWS.CanvasState, {
          status: mapState.status === 'ready' ? 'error' : mapState.status,
          book: book,
          error:
            mapState.status === 'ready'
              ? { code: 'E_MAP_INVALID', message: 'map layout rejected' }
              : mapState.error,
          actions: actions,
          onRetry: props.onRetry,
          onGenerate: onGenerate,
        })

  // 生成中的状态胜过「没有导图」空态：进度/失败卡已经说明了正在发生什么。
  var generationBusy =
    generation && (generation.state === 'pending' || generation.state === 'running' || generation.state === 'failed')
  if (generationBusy && stateOverlay && mapState.status !== 'error') stateOverlay = null

  var generationNode =
    generation && generationBusy
      ? h(VIEWS.CanvasGeneration, {
          generation: generation,
          hasMap: Boolean(scene),
          onRetry: onGenerate,
        })
      : null

  var zoom = view ? view.zoom : 1

  return h(
    'section',
    {
      className: 'rl-canvas rl-canvas--map' + (dragging ? ' rl-canvas--dragging' : ''),
      'aria-label': t('canvas.map.label'),
      'data-map-status': mapState.status,
      'data-generation-state': generation ? generation.state : 'idle',
      ref: containerRef,
    },
    h('style', { dangerouslySetInnerHTML: { __html: CANVAS_STYLES } }),
    surface,
    stateOverlay,
    generationNode,
    mapState.status === 'ready' && scene
      ? h(
          'div',
          { className: 'rl-canvas__hud' },
          h('input', {
            className: 'rl-canvas__search',
            type: 'search',
            value: query,
            placeholder: t('canvas.search.placeholder'),
            'aria-label': t('canvas.search.placeholder'),
            onChange: function (event) {
              matchCursor.current = 0
              setQuery(event && event.target ? event.target.value : '')
            },
            onKeyDown: function (event) {
              if (event && event.key === 'Enter') submitSearch(event)
              else if (event && event.stopPropagation) event.stopPropagation()
            },
          }),
          query.trim()
            ? h(
                'span',
                { className: 'rl-canvas__hint', role: 'status' },
                matches.length ? t('canvas.search.matches', { count: matches.length }) : t('canvas.search.empty'),
              )
            : null,
          h('span', { className: 'rl-canvas__stats' }, t('canvas.stats', {
            nodes: scene.stats.nodes,
            citations: scene.stats.citations,
          })),
        )
      : null,
    mapState.status === 'ready' && scene
      ? h(
          'div',
          { className: 'rl-canvas__zoombar', role: 'group', 'aria-label': t('canvas.zoom.label') },
          h(
            'button',
            {
              type: 'button',
              className: 'rl-canvas__zoombtn',
              'aria-label': t('canvas.zoom.out'),
              title: t('canvas.zoom.out'),
              onClick: function () {
                zoomBy(1 / 1.2)
              },
            },
            '−',
          ),
          h('span', { className: 'rl-canvas__zoomvalue', 'aria-live': 'polite' }, Math.round(zoom * 100) + '%'),
          h(
            'button',
            {
              type: 'button',
              className: 'rl-canvas__zoombtn',
              'aria-label': t('canvas.zoom.in'),
              title: t('canvas.zoom.in'),
              onClick: function () {
                zoomBy(1.2)
              },
            },
            '+',
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'rl-canvas__zoombtn',
              'aria-label': t('canvas.zoom.fit'),
              title: t('canvas.zoom.fit'),
              onClick: fit,
            },
            t('canvas.zoom.fit'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'rl-canvas__zoombtn',
              'aria-label': t('canvas.zoom.reset'),
              title: t('canvas.zoom.reset'),
              onClick: actualSize,
            },
            '100%',
          ),
        )
      : null,
  )
}