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
    },
    onEvent: function (type, payload) {
      if (type === 'book' && payload) loadLibrary()
    },
    onError: function () {
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

function createActions() {
  return {
    selectBook: function (bookId) {
      selectBook(bookId)
    },
    refresh: function () {
      loadHealth()
      loadLibrary()
    },
    importBook: function () {
      // M2：<input type="file" accept=".epub,.pdf"> + POST /books/import。
      store.set({ lastError: 'E_NOT_IMPLEMENTED' })
    },
    toggleAsk: function () {
      store.set(function (state) {
        return { askOpen: !state.askOpen }
      })
    },
    closeAsk: function () {
      store.set({ askOpen: false })
    },
    openDetail: function (nodeId) {
      store.set({ selectedNodeId: nodeId || null, detailOpen: Boolean(nodeId) })
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

  return h(
    'div',
    { className: 'rl-root' },
    h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
    h(VIEWS.Header, { state: state, actions: actions }),
    h(
      'div',
      { className: 'rl-body' },
      h(VIEWS.Library, { state: state, actions: actions }),
      h(
        'div',
        { className: 'rl-main' },
        h(VIEWS.Canvas, { state: state, actions: actions }),
        state.detailOpen ? h(VIEWS.Detail, { state: state, actions: actions }) : null,
        state.askOpen ? h(VIEWS.Ask, { state: state, actions: actions }) : null,
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