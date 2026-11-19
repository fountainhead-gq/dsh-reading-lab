/* 统一状态容器（03 §2.2 client-shell）：所有视图只读这里，禁止各自持有业务状态。 */

var STORAGE_KEY = 'dsh-reading-lab.ui'
var STATE_VERSION = 1

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
  detailOpen: false,
  askOpen: false,
  // 研究笔记只读面板（v0.2）：与详情互不排斥，都覆盖在画布上
  notesOpen: false,
  // 询问 AI 线程的失效计数：SSE `thread` 事件与本地发送都会 ++（03 §8.2）
  threadRevision: 0,
  // 上传进行中：按钮转 loading，避免重复点击
  importing: false,
  // 导出：进行中禁用菜单；lastExport 记住最近一次结果（路径 + 字节数）供顶栏提示
  exporting: false,
  lastExport: null,
  lastError: null,
})

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

function visibleBooks(state) {
  var query = (state.filter || '').trim().toLowerCase()
  var books = Array.isArray(state.books) ? state.books : []
  if (!query) return books
  return books.filter(function (book) {
    var haystack = String(book.title || '') + ' ' + String(book.author || '')
    return haystack.toLowerCase().indexOf(query) !== -1
  })
}