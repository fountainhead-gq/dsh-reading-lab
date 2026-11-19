/* 面板外壳与浮层容器（owner: ask-ui，03 §3.1 / §3.3）。 */

var runtimeStarted = false
var runtimeCleanup = null

function loadLibrary() {
  return api
    .listBooks()
    .then(function (data) {
      store.set({
        books: Array.isArray(data && data.books) ? data.books : [],
        revision: data && typeof data.revision === 'number' ? data.revision : 0,
        status: 'idle',
      })
    })
    .catch(function (error) {
      store.set({ status: 'unavailable', lastError: error && error.code ? error.code : 'E_UNKNOWN' })
    })
}

function loadHealth() {
  return api
    .health()
    .then(function (data) {
      store.set({
        storage: data && data.storage === 'unavailable' ? 'unavailable' : 'ok',
        pluginVersion: (data && data.pluginVersion) || '',
        dshVersion: (data && data.dshVersion) || '',
        status: store.get().status === 'booting' ? 'idle' : store.get().status,
      })
    })
    .catch(function (error) {
      // health 只是诊断探针：它失败不该把书库一起判死。
      // 真实桌面端曾因宿主 ctx 访问异常让 /health 500，此时 /books 仍然可用。
      store.set({ lastError: error && error.code ? error.code : 'E_UNKNOWN' })
    })
}

/** 挂载时启动：一次 health + 一次书库拉取 + 一条 SSE，卸载时全部关掉。 */
function startRuntime() {
  if (runtimeStarted) return runtimeCleanup
  runtimeStarted = true
  loadHealth()
  loadLibrary()
  var closeEvents = api.subscribeEvents({
    onHello: function (payload) {
      store.set({
        books: Array.isArray(payload && payload.books) ? payload.books : [],
        revision: payload && typeof payload.revision === 'number' ? payload.revision : 0,
        status: 'idle',
      })
      // 唯一一条 EventSource 同时喂给画布的生成状态（t30）。
      if (typeof canvasRuntimeHello === 'function') canvasRuntimeHello()
    },
    onEvent: function (type, payload) {
      if (typeof canvasRuntimeEvent === 'function') canvasRuntimeEvent(type, payload)
      if (type === 'book' && payload) loadLibrary()
      // 询问 AI：线程被写入/失败/停止都只 bump 计数，浮层自己重拉（03 §8.2）。
      if (type === 'thread' && payload) {
        store.set(function (current) {
          return { threadRevision: (current.threadRevision || 0) + 1 }
        })
      }
      // 引导式学习：路径被重建/标记/回答回写都只 bump 计数（t20）。
      if (type === 'tutor' && payload) {
        store.set(function (current) {
          return { tutorRevision: (current.tutorRevision || 0) + 1 }
        })
      }
    },
    onError: function () {
      if (typeof canvasRuntimeOffline === 'function') canvasRuntimeOffline()
      if (store.get().status === 'booting') store.set({ status: 'unavailable' })
    },
  })
  runtimeCleanup = function () {
    try {
      closeEvents()
    } catch (error) {
      /* already closed */
    }
    runtimeCleanup = null
    runtimeStarted = false
  }
  return runtimeCleanup
}

/** 上传一个文件，成功后刷新书库并选中新书（04 §4.3）。 */
function uploadFile(file, reset) {
  if (typeof reset === 'function') reset()
  if (!file) return Promise.resolve(null)
  store.set({ importing: true, lastError: null })
  return api
    .importBook(file)
    .then(function (data) {
      var book = data && data.book ? data.book : null
      return loadLibrary().then(function () {
        if (book && book.id) {
          selectBook(book.id)
          setUiMode('panel')
        }
        return book
      })
    })
    .catch(function (error) {
      store.set({ lastError: error && error.code ? error.code : 'E_UNKNOWN' })
      return null
    })
    .then(function (book) {
      store.set({ importing: false })
      return book
    })
}

function createActions() {
  return {
    selectBook: function (bookId) {
      selectBook(bookId)
    },
    refresh: function () {
      loadHealth()
      loadLibrary()
    },
    /** 打开系统文件选择器（真正的 <input type=file> 在 library.js 里）。 */
    importBook: function () {
      var input = typeof document !== 'undefined' ? document.getElementById('rl-file-input') : null
      if (input && typeof input.click === 'function') input.click()
    },
    pickFile: function (event) {
      var input = event && event.target ? event.target : null
      var file = input && input.files && input.files[0] ? input.files[0] : null
      uploadFile(file, function () {
        if (input) input.value = ''
      })
    },
    /**
     * 询问浮层与详情侧卡互斥（t31 / QA-17-01）：打开浮层自动收起详情。
     * 焦点：打开前记住触发元素，关闭时还回去。
     */
    toggleAsk: function () {
      var willOpen = !store.get().askOpen
      if (willOpen) captureFocus('ask')
      store.set(function (state) {
        if (!willOpen) return { askOpen: false }
        return { askOpen: true, detailOpen: false }
      })
      if (!willOpen) restoreFocus('ask')
    },
    closeAsk: function () {
      store.set({ askOpen: false })
      restoreFocus('ask')
    },
    /** 研究笔记面板：同一时间只开一个（重复点同一个就收起）。 */
    toggleNotes: function () {
      var willOpen = !store.get().notesOpen
      if (willOpen) captureFocus('notes')
      store.set(function (state) {
        if (!willOpen) return { notesOpen: false }
        return { notesOpen: true, askOpen: false, detailOpen: false }
      })
      if (!willOpen) restoreFocus('notes')
    },
    openDetail: function (nodeId) {
      if (!nodeId) {
        store.set({ selectedNodeId: null, detailOpen: false })
        restoreFocus('detail')
        return
      }
      captureFocus('detail')
      store.set({ selectedNodeId: nodeId, detailOpen: true, askOpen: false })
    },
    /** 引导式学习浮层（v0.3）：与询问 AI / 详情 / 笔记互斥。 */
    toggleTutor: function () {
      var willOpen = !store.get().tutorOpen
      if (willOpen) captureFocus('tutor')
      store.set(function (state) {
        if (!willOpen) return { tutorOpen: false }
        return { tutorOpen: true, askOpen: false, detailOpen: false, notesOpen: false }
      })
      if (!willOpen) restoreFocus('tutor')
    },
    closeTutor: function () {
      store.set({ tutorOpen: false })
      restoreFocus('tutor')
    },
    bumpTutor: function () {
      store.set(function (state) {
        return { tutorRevision: (state.tutorRevision || 0) + 1 }
      })
    },
    /**
     * 导出当前书：POST /books/:id/export → 记住产物路径（04 §4.2 #22）。
     * `includeThreads` 默认带上问答精选；失败只记错误码，不打断画布。
     */
    exportBook: function (format) {
      var current = store.get()
      var bookId = current.selectedBookId
      if (!bookId || current.exporting) return Promise.resolve(null)
      store.set({ exporting: true, lastError: null })
      return api
        .exportBook(bookId, { format: format || 'md', includeThreads: true })
        .then(function (data) {
          store.set({ exporting: false, lastExport: data || null })
          return data
        })
        .catch(function (error) {
          store.set({ exporting: false, lastError: error && error.code ? error.code : 'E_IO' })
          return null
        })
    },
    closeOverlay: function () {
      setUiMode('panel')
    },
  }
}

VIEWS.Shell = function Shell(props) {
  var state = props.state
  var actions = props.actions
  var statusLine = null
  if (state.status === 'booting') statusLine = t('state.booting')
  else if (state.status === 'unavailable') statusLine = t('state.unavailable')

  // 焦点契约（QA-17-01）：任一浮层/侧卡打开时，背景三层都不可聚焦、不进无障碍树。
  var modal = Boolean(state.askOpen || state.detailOpen || state.notesOpen || state.tutorOpen)
  var backdrop = { style: { display: 'contents' } }
  if (modal) {
    backdrop.inert = ''
    backdrop['aria-hidden'] = 'true'
  }
  // 互斥兜底：浮层优先于详情/笔记，避免同时渲染两个面板。
  var showDetail = Boolean(state.detailOpen) && !state.askOpen && !state.tutorOpen
  var showNotes = Boolean(state.notesOpen) && !state.askOpen && !state.tutorOpen

  return h(
    'div',
    { className: 'rl-root' },
    h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
    h('div', backdrop, h(VIEWS.Header, { state: state, actions: actions })),
    h(
      'div',
      { className: 'rl-body' },
      h('div', backdrop, h(VIEWS.Library, { state: state, actions: actions })),
      h(
        'div',
        { className: 'rl-main' },
        h('div', backdrop, h(VIEWS.Canvas, { state: state, actions: actions })),
        showDetail ? h(VIEWS.Detail, { state: state, actions: actions }) : null,
        showNotes ? h(VIEWS.Notes, { state: state, actions: actions }) : null,
        state.askOpen ? h(VIEWS.Ask, { state: state, actions: actions }) : null,
        state.tutorOpen ? h(VIEWS.Tutor, { state: state, actions: actions }) : null,
      ),
    ),
    statusLine ? h('div', { className: 'rl-status', role: 'status' }, statusLine) : null,
  )
}

/** main 槽位（key=reading-lab）挂的组件。 */
VIEWS.Panel = function Panel() {
  var state = useStore()
  var actions = React.useMemo(createActions, [])
  React.useEffect(function () {
    var cleanup = startRuntime()
    return function () {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])
  return h(VIEWS.Shell, { state: state, actions: actions })
}

/** shell.overlay 兜底容器（03 §3.3）：同一套 Shell，加一层全窗框。 */
VIEWS.Overlay = function Overlay() {
  var state = useStore()
  var actions = React.useMemo(createActions, [])
  React.useEffect(function () {
    var cleanup = startRuntime()
    return function () {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])
  return h(
    'div',
    { className: 'rl-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('panel.title') },
    h('div', { className: 'rl-overlay__frame' }, h(VIEWS.Shell, { state: state, actions: actions })),
  )
}

/** sidebar.panellist 的图标（id 与 main 的 key 相同）。 */
VIEWS.PanelIcon = function PanelIcon() {
  return h(
    'svg',
    { width: 18, height: 18, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' },
    h('path', {
      fill: 'currentColor',
      d: 'M4 4h7c1.1 0 2 .9 2 2v14c0-1.1-.9-2-2-2H4V4zm16 0h-7c-1.1 0-2 .9-2 2v14c0-1.1.9-2 2-2h7V4z',
    }),
    h('path', { fill: 'currentColor', d: 'M18.5 2.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z' }),
  )
}