/* 统一状态容器（03 §2.2 client-shell）：所有视图只读这里，禁止各自持有业务状态。 */

var STORAGE_KEY = 'dsh-reading-lab.ui'
var STATE_VERSION = 1

/** R4：书架宽度边界（px）。太窄放不下封面+标题，太宽把画布挤没了。 */
var LIBRARY_MIN_W = 220
var LIBRARY_MAX_W = 480

function safeStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch (error) {
    /* 隐私模式下访问会抛 */
  }
  return null
}

function readPersistedUi() {
  var storage = safeStorage()
  if (!storage) return {}
  try {
    var raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    var parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== STATE_VERSION) return {}
    return {
      selectedBookId: typeof parsed.selectedBookId === 'string' ? parsed.selectedBookId : null,
      uiMode: parsed.uiMode === 'overlay' ? 'overlay' : 'panel',
      viewMode: parsed.viewMode === 'notes' ? 'notes' : 'map',
      libraryOpen: parsed.libraryOpen !== false,
      libraryWidth: typeof parsed.libraryWidth === 'number' ? parsed.libraryWidth : null,
    }
  } catch (error) {
    return {}
  }
}

function persistUi(state) {
  var storage = safeStorage()
  if (!storage) return
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: STATE_VERSION,
        selectedBookId: state.selectedBookId,
        uiMode: state.uiMode,
        viewMode: state.viewMode === 'notes' ? 'notes' : 'map',
        libraryOpen: state.libraryOpen !== false,
        libraryWidth: typeof state.libraryWidth === 'number' ? state.libraryWidth : null,
      }),
    )
  } catch (error) {
    /* 配额满/隐私模式：不阻断 UI */
  }
}

function createStore(initial) {
  var current = initial
  var listeners = new Set()
  return {
    get: function () {
      return current
    },
    set: function (patch) {
      var next = typeof patch === 'function' ? patch(current) : patch
      if (!next) return current
      current = Object.assign({}, current, next)
      listeners.forEach(function (listener) {
        try {
          listener(current)
        } catch (error) {
          console.warn('[reading-lab] store listener failed', error)
        }
      })
      return current
    },
    subscribe: function (listener) {
      if (typeof listener !== 'function') return function () {}
      listeners.add(listener)
      return function () {
        listeners.delete(listener)
      }
    },
  }
}

var persisted = readPersistedUi()

var store = createStore({
  // booting → idle（连上 Host）→ 其余由各里程碑填充
  status: 'booting',
  // ok | unavailable（/health 的 storage 字段）
  storage: 'ok',
  pluginVersion: '',
  dshVersion: '',
  books: [],
  revision: 0,
  filter: '',
  selectedBookId: persisted.selectedBookId || null,
  selectedNodeId: null,
  uiMode: persisted.uiMode || 'panel',
  // 主区视图：导图 / 研究笔记（R7 的基础，两种视图共用同一主区）
  viewMode: persisted.viewMode || 'map',
  // R4：书架可隐藏、可拉宽；顺序由 Host 的 index.json 决定（这里只做乐观更新）。
  libraryOpen: persisted.libraryOpen !== false,
  libraryWidth: persisted.libraryWidth || null,
  dragBookId: null,
  // 设置抽屉（R1）：存储位置、诊断与刷新都收进去
  settingsOpen: false,
  // 统一反馈（R3）：{ id, kind:'info'|'ok'|'error', key, params, sticky }
  toasts: [],
  detailOpen: false,
  askOpen: false,
  // 详情/询问面板的锚点（m02220）：{ left, top, width, height, mainWidth, mainHeight }，
  // 由画布按被点卡片的屏幕矩形算出；为 null 时面板回到右侧停靠的老位置。
  panelAnchor: null,
  // 研究笔记只读面板（v0.2）：与详情互不排斥，都覆盖在画布上
  notesOpen: false,
  // 询问 AI 线程的失效计数：SSE `thread` 事件与本地发送都会 ++（03 §8.2）
  threadRevision: 0,
  // 引导式学习浮层（v0.3）：与询问 AI / 详情 / 笔记同一时间只开一个
  tutorOpen: false,
  // 学习路径的失效计数：SSE `tutor` 事件、标记与提问都会 ++
  tutorRevision: 0,
  // 上传进行中：按钮转 loading，避免重复点击
  importing: false,
  // 导出：进行中禁用菜单；lastExport 记住最近一次结果（路径 + 字节数）供顶栏提示
  exporting: false,
  lastExport: null,
  // 存储位置（t33）：settings 为最近一次 GET /settings 的结果；draft 是输入框内容。
  settings: null,
  settingsDraft: '',
  settingsMoveExisting: true,
  settingsBusy: false,
  // { kind: 'ok'|'error', text }：应用后的可见反馈（不弹窗）
  settingsFeedback: null,
  // R2：导出目录草稿与提交态（与存储位置分开，互不影响两处的错误提示）。
  exportDraft: '',
  exportBusy: false,
  exportFeedback: null,
  lastError: null,
})

/**
 * 详情/询问浮层贴卡片定位（m02220）：anchor 由画布算出（相对 .rl-main 的像素矩形）。
 * 优先放卡片右侧；右边放不下就翻到卡片左侧；高度跟着卡片顶部往下展开，底部留 12px。
 * anchor 为空时返回 null，视图回落到原来的右侧停靠位置。
 */
function anchoredPanelStyle(anchor) {
  if (!anchor) return null
  var railWidth = 420
  var gap = 14
  var mainWidth = anchor.mainWidth || 0
  var mainHeight = anchor.mainHeight || 0
  var left = anchor.left + anchor.width + gap
  if (mainWidth && left + railWidth > mainWidth - 8) left = anchor.left - railWidth - gap
  if (left < 8) left = 8
  var top = Math.max(8, anchor.top - 6)
  var width = railWidth
  if (mainWidth) width = Math.min(railWidth, Math.max(300, mainWidth - 16))
  var style = {
    position: 'absolute',
    left: left + 'px',
    top: top + 'px',
    width: width + 'px',
    zIndex: 30,
  }
  if (mainHeight) style.maxHeight = Math.max(240, mainHeight - top - 12) + 'px'
  return style
}

/** 视图订阅入口：返回快照，状态变化自动重渲染。 */
function useStore() {
  var snapshotState = React.useState(store.get())
  var snapshot = snapshotState[0]
  var setSnapshot = snapshotState[1]
  React.useEffect(function () {
    return store.subscribe(function (next) {
      setSnapshot(next)
    })
  }, [])
  return snapshot
}

function selectBook(bookId) {
  store.set(function (state) {
    return {
      selectedBookId: bookId,
      selectedNodeId: null,
      detailOpen: false,
    }
  })
  persistUi(store.get())
}

function setUiMode(mode) {
  store.set({ uiMode: mode === 'overlay' ? 'overlay' : 'panel' })
  persistUi(store.get())
}

function setFilter(value) {
  store.set({ filter: typeof value === 'string' ? value : '' })
}

function setLibraryOpen(open) {
  store.set({ libraryOpen: Boolean(open) })
  persistUi(store.get())
}

function setLibraryWidth(width) {
  var next = typeof width === 'number' && isFinite(width) ? Math.max(LIBRARY_MIN_W, Math.min(LIBRARY_MAX_W, Math.round(width))) : null
  store.set({ libraryWidth: next })
  persistUi(store.get())
}

/** R4 乐观排序：先本地换位，Host 失败时由调用方回滚（refreshBooks 会纠正成服务端顺序）。 */
function moveBook(bookId, toIndex) {
  store.set(function (state) {
    var list = Array.isArray(state.books) ? state.books.slice() : []
    var from = -1
    for (var i = 0; i < list.length; i += 1) if (list[i] && list[i].id === bookId) from = i
    if (from < 0) return {}
    var target = Math.max(0, Math.min(list.length - 1, Number(toIndex)))
    if (target === from) return {}
    var moved = list.splice(from, 1)[0]
    list.splice(target, 0, moved)
    return { books: list }
  })
}

function setDragBook(bookId) {
  store.set({ dragBookId: bookId || null })
}

function setViewMode(mode) {
  store.set({ viewMode: mode === 'notes' ? 'notes' : 'map' })
  persistUi(store.get())
}

var TOAST_SEQ = 0

/**
 * 推一条反馈（R3）：`key` 走 t()，`params` 用于插值。
 * 同 key 同 kind 的旧提示先移除，避免连点堆出一串相同文案。
 */
function pushToast(input) {
  var kind = input && input.kind === 'error' ? 'error' : input && input.kind === 'ok' ? 'ok' : 'info'
  var key = String((input && input.key) || '')
  if (!key) return null
  var toast = {
    id: 'toast-' + (TOAST_SEQ += 1),
    kind: kind,
    key: key,
    params: (input && input.params) || null,
    sticky: Boolean(input && input.sticky),
  }
  store.set(function (state) {
    var kept = (state.toasts || []).filter(function (item) {
      return !(item.kind === toast.kind && item.key === toast.key)
    })
    kept.push(toast)
    // 最多同时 3 条，老的先走。
    return { toasts: kept.slice(-3) }
  })
  return toast.id
}

function dismissToast(id) {
  store.set(function (state) {
    return {
      toasts: (state.toasts || []).filter(function (item) {
        return item.id !== id
      }),
    }
  })
}

function visibleBooks(state) {
  var query = (state.filter || '').trim().toLowerCase()
  var books = Array.isArray(state.books) ? state.books : []
  if (!query) return books
  return books.filter(function (book) {
    var haystack = String(book.title || '') + ' ' + String(book.author || '')
    return haystack.toLowerCase().indexOf(query) !== -1
  })
}