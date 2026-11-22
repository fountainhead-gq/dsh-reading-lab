/* 面板外壳与浮层容器（owner: ask-ui，03 §3.1 / §3.3）。 */

/** 存储位置（t33）：把 /settings 的结果放进 store，草稿跟随当前根初始化一次。 */
function loadSettings() {
  return api
    .getSettings()
    .then(function (data) {
      store.set(function () {
        return {
          settings: data,
          settingsDraft: data && data.resolvedRoot ? data.resolvedRoot : '',
          exportDraft: data && data.resolvedExportRoot ? data.resolvedExportRoot : '',
        }
      })
    })
    .catch(function (error) {
      store.set({ settings: null, lastError: error && error.code ? error.code : 'E_UNKNOWN' })
    })
}

/** 应用 / 恢复默认：成功后重新拉设置与书库，失败把错误码变成可见文案。 */
function runLibraryRootChange(path, reset) {
  store.set({ settingsBusy: true, settingsFeedback: null })
  return api
    .setLibraryRoot({ path: reset ? null : path, moveExisting: store.get().settingsMoveExisting })
    .then(function (data) {
      store.set({
        settings: data,
        settingsDraft: data && data.resolvedRoot ? data.resolvedRoot : '',
        // 导出目录默认跟着书库走，换根后要同步草稿，否则输入框显示旧路径。
        exportDraft: data && data.resolvedExportRoot ? data.resolvedExportRoot : store.get().exportDraft,
        settingsBusy: false,
        settingsFeedback: { kind: 'ok', code: reset ? 'settings.restored' : 'settings.applied' },
      })
      pushToast({ kind: 'ok', key: reset ? 'settings.restored' : 'settings.applied' })
      return loadLibrary().then(function () {
        return loadHealth()
      })
    })
    .catch(function (error) {
      var code = error && error.code ? error.code : 'E_UNKNOWN'
      store.set({
        settingsBusy: false,
        settingsFeedback: { kind: 'error', code: code },
      })
      pushToast({ kind: 'error', key: 'error.' + code })
    })
}

/** R2：改导出目录。不迁移旧文件，成功/失败都只通过 toast 与节内提示反馈。 */
function runExportRootChange(path, reset) {
  store.set({ exportBusy: true, exportFeedback: null })
  return api
    .setExportRoot({ path: reset ? null : path })
    .then(function (data) {
      store.set({
        settings: data,
        exportDraft: data && data.resolvedExportRoot ? data.resolvedExportRoot : '',
        exportBusy: false,
        exportFeedback: { kind: 'ok', code: reset ? 'settings.exportRestored' : 'settings.exportApplied' },
      })
      pushToast({ kind: 'ok', key: reset ? 'settings.exportRestored' : 'settings.exportApplied' })
    })
    .catch(function (error) {
      var code = error && error.code ? error.code : 'E_UNKNOWN'
      store.set({ exportBusy: false, exportFeedback: { kind: 'error', code: code } })
      pushToast({ kind: 'error', key: 'error.' + code })
    })
}

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
  loadSettings()
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
          pushToast({
            kind: 'ok',
            key: data && data.duplicate ? 'toast.imported.duplicate' : 'toast.imported',
            params: { name: book.title || book.id },
          })
        }
        return book
      })
    })
    .catch(function (error) {
      var code = error && error.code ? error.code : 'E_UNKNOWN'
      store.set({ lastError: code })
      pushToast({ kind: 'error', key: 'error.' + code })
      return null
    })
    .then(function (book) {
      store.set({ importing: false })
      return book
    })
}

/**
 * R4：把当前顺序写回 Host（`PUT /books/order`）。失败时回滚成本地保存的旧顺序并 toast，
 * 不能出现「界面看着换好了、刷新又跳回去」的静默失败。
 */
function saveBookOrder(previous) {
  var ids = (store.get().books || []).map(function (book) {
    return book && book.id
  })
  return api
    .setBookOrder({ ids: ids })
    .then(function (data) {
      if (data && Array.isArray(data.books)) store.set({ books: data.books })
      return data
    })
    .catch(function (error) {
      var code = error && error.code ? error.code : 'E_UNKNOWN'
      store.set({ books: Array.isArray(previous) ? previous : store.get().books, lastError: code })
      pushToast({ kind: 'error', key: 'error.' + code })
      return null
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
      loadSettings()
      pushToast({ kind: 'info', key: 'toast.refreshed' })
    },
    /** 视图切换（R7 地基）：导图 / 笔记共用主区。 */
    setViewMode: function (mode) {
      setViewMode(mode === 'notes' ? 'notes' : 'map')
    },
    /** R4：书架隐藏/显示（顶部左键），状态存 localStorage。 */
    toggleLibrary: function () {
      setLibraryOpen(!store.get().libraryOpen)
    },
    /** R8：书架宽度拖拽（m01951），store 侧夹取 220–480。 */
    setLibraryWidth: function (width) {
      setLibraryWidth(width)
    },
    /** m01951：悬浮卡片上的「询问 AI」直接以该节点为上下文打开浮层。 */
    askNode: function (nodeId) {
      if (!nodeId) return
      store.set({ selectedNodeId: nodeId, askOpen: true, detailOpen: false })
    },
    startBookDrag: function (bookId) {
      setDragBook(bookId)
    },
    hoverBook: function (index) {
      var state = store.get()
      if (!state.dragBookId) return
      moveBook(state.dragBookId, index)
    },
    endBookDrag: function () {
      setDragBook(null)
    },
    /** drop：把拖着的书放到 `toIndex`（0 基，落在目标项位置上）。 */
    dropBook: function (bookId, toIndex) {
      var state = store.get()
      var dragged = state.dragBookId || bookId
      if (!dragged) return
      var list = Array.isArray(state.books) ? state.books : []
      var index = -1
      for (var i = 0; i < list.length; i += 1) if (list[i] && list[i].id === dragged) index = i
      if (index < 0) {
        setDragBook(null)
        return
      }
      var target = Math.max(0, Math.min(list.length - 1, typeof toIndex === 'number' ? toIndex : index))
      moveBook(dragged, target)
      setDragBook(null)
      saveBookOrder(state.books)
    },
    /** 键盘路径：Alt+↑/↓（R4 验收要求键盘可用）。 */
    moveBookTo: function (bookId, toIndex) {
      var state = store.get()
      var list = Array.isArray(state.books) ? state.books : []
      var index = -1
      for (var i = 0; i < list.length; i += 1) if (list[i] && list[i].id === bookId) index = i
      if (index < 0) return
      var target = Math.max(0, Math.min(list.length - 1, typeof toIndex === 'number' ? toIndex : index))
      if (target === index) return
      moveBook(bookId, target)
      saveBookOrder(list)
    },
    dismissToast: function (id) {
      dismissToast(id)
    },
    /** 设置抽屉（R1）：与询问/详情/笔记/引导互斥。 */
    toggleSettings: function () {
      store.set(function (state) {
        if (state.settingsOpen) return { settingsOpen: false }
        return { settingsOpen: true, askOpen: false, detailOpen: false, notesOpen: false, tutorOpen: false }
      })
    },
    openSettings: function () {
      store.set({ settingsOpen: true, askOpen: false, detailOpen: false, notesOpen: false, tutorOpen: false })
    },
    closeSettings: function () {
      store.set({ settingsOpen: false })
    },
    /** 存储位置（t33）：输入框草稿、迁移开关、应用与恢复默认。 */
    setStorageDraft: function (event) {
      var value = event && event.target ? event.target.value : ''
      store.set({ settingsDraft: typeof value === 'string' ? value : '' })
    },
    toggleStorageMove: function () {
      store.set(function (state) {
        return { settingsMoveExisting: !state.settingsMoveExisting }
      })
    },
    applyLibraryRoot: function () {
      var path = String(store.get().settingsDraft || '').trim()
      if (!path) {
        store.set({ settingsFeedback: { kind: 'error', code: 'E_PATH' } })
        return
      }
      runLibraryRootChange(path, false)
    },
    resetLibraryRoot: function () {
      runLibraryRootChange(null, true)
    },
    /** R2：导出目录草稿、应用与恢复默认（不迁移已有导出文件）。 */
    setExportDraft: function (event) {
      var value = event && event.target ? event.target.value : ''
      store.set({ exportDraft: typeof value === 'string' ? value : '' })
    },
    applyExportRoot: function () {
      var path = String(store.get().exportDraft || '').trim()
      if (!path) {
        store.set({ exportFeedback: { kind: 'error', code: 'E_PATH' } })
        return
      }
      runExportRootChange(path, false)
    },
    resetExportRoot: function () {
      runExportRootChange(null, true)
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
    /** 研究笔记：R7 之后是主区视图切换，不再是覆盖式面板。 */
    toggleNotes: function () {
      if (!store.get().selectedBookId) {
        pushToast({ kind: 'info', key: 'notes.selectFirst' })
        return
      }
      setViewMode(store.get().viewMode === 'notes' ? 'map' : 'notes')
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
          if (data && data.name) pushToast({ kind: 'ok', key: 'toast.exported', params: { name: data.name } })
          return data
        })
        .catch(function (error) {
          var code = error && error.code ? error.code : 'E_IO'
          store.set({ exporting: false, lastError: code })
          pushToast({ kind: 'error', key: 'error.' + code })
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
  // 设置抽屉是非模态的（aria-modal=false），不参与 inert，否则抽屉里的输入框自己也会失焦。
  var modal = Boolean(state.askOpen || state.detailOpen || state.tutorOpen)
  var backdrop = { style: { display: 'contents' } }
  if (modal) {
    backdrop.inert = ''
    backdrop['aria-hidden'] = 'true'
  }
  // 互斥兜底：浮层优先于详情，避免同时渲染两个面板。
  var showDetail = Boolean(state.detailOpen) && !state.askOpen && !state.tutorOpen
  var viewMode = state.viewMode === 'notes' ? 'notes' : 'map'
  var notesMain = viewMode === 'notes' && Boolean(state.selectedBookId)

  return h(
    'div',
    { className: 'rl-root' },
    h('style', { dangerouslySetInnerHTML: { __html: STYLES } }),
    h('div', backdrop, h(VIEWS.Header, { state: state, actions: actions })),
    h(
      'div',
      { className: 'rl-body' + (state.libraryOpen === false ? ' rl-body--library-closed' : '') },
      h('div', backdrop, h(VIEWS.Library, { state: state, actions: actions })),
      h(
        'div',
        { className: 'rl-main' },
        notesMain
          ? h(VIEWS.Notes, { state: state, actions: actions, variant: 'main' })
          : h('div', backdrop, h(VIEWS.Canvas, { state: state, actions: actions })),
        showDetail ? h(VIEWS.Detail, { state: state, actions: actions }) : null,
        state.askOpen ? h(VIEWS.Ask, { state: state, actions: actions }) : null,
        state.tutorOpen ? h(VIEWS.Tutor, { state: state, actions: actions }) : null,
        state.settingsOpen ? h(VIEWS.Settings, { state: state, actions: actions }) : null,
      ),
    ),
    statusLine ? h('div', { className: 'rl-status', role: 'status' }, statusLine) : null,
    h(VIEWS.Toasts, { state: state, actions: actions }),
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