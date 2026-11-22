/* 顶部工具条（owner: library，03 §4.1；R1 布局见 docs/13-ui-rework-backlog.md）。
 *
 * 顶栏只留两类东西：内容导航（视图切换）与高频动作（导入 / 询问 / 引导 / 导出 / 设置）。
 * 刷新、存储位置、版本信息都进设置抽屉——v0.2.1 的三处入口各说各话，是这次要修的问题。
 * 图标按 Ponder 参考图取 16px 线性、32×32 命中区；文案仍然走 locale。
 */

var EXPORT_FORMATS = ['md', 'opml', 'json']
var EXPORT_EXTS = { md: '.md', opml: '.opml', json: '.json' }

/**
 * 线性图标：24×24 viewBox、1.7 描边、圆角端点——与 Lucide/Feather 同一套几何语言，
 * 显示尺寸由 CSS 收到 16px。节点可以是 path（给 d）或 rect/circle（给同名属性）。
 */
function icon(nodes) {
  var list = Array.isArray(nodes) ? nodes : [nodes]
  return h(
    'svg',
    {
      className: 'rl-icon',
      viewBox: '0 0 24 24',
      'aria-hidden': 'true',
      focusable: 'false',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: '1.7',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    },
    list.map(function (node, index) {
      var attrs = Object.assign({ key: 'node-' + index }, node)
      var tag = attrs.tag || 'path'
      delete attrs.tag
      return h(tag, attrs)
    }),
  )
}

var ICONS = {
  // 导图：三个节点 + 连线（Lucide network）
  map: function () {
    return icon([
      { tag: 'rect', x: '16', y: '16', width: '6', height: '6', rx: '1' },
      { tag: 'rect', x: '2', y: '16', width: '6', height: '6', rx: '1' },
      { tag: 'rect', x: '9', y: '2', width: '6', height: '6', rx: '1' },
      { d: 'M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3' },
      { d: 'M12 12V8' },
    ])
  },
  // 笔记：带折角的文稿（Lucide file-text）
  notes: function () {
    return icon([
      { d: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z' },
      { d: 'M14 3v5h5' },
      { d: 'M9 13h6M9 17h4' },
    ])
  },
  // 导入：箭头落到底线（Lucide download）
  import: function () {
    return icon([{ d: 'M12 3v12' }, { d: 'm7.5 10.5 4.5 4.5 4.5-4.5' }, { d: 'M4 20h16' }])
  },
  // 导出：箭头离开底线（Lucide upload）
  export: function () {
    return icon([{ d: 'M12 20V8' }, { d: 'm7.5 12.5 4.5-4.5 4.5 4.5' }, { d: 'M4 4h16' }])
  },
  // 设置：齿轮（Lucide settings）
  settings: function () {
    return icon([
      { tag: 'circle', cx: '12', cy: '12', r: '3' },
      {
        d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
      },
    ])
  },
  // 引导：星芒（Lucide sparkles）
  tutor: function () {
    return icon([
      { d: 'M12 3l1.7 4.4L18 9l-4.3 1.6L12 15l-1.7-4.4L6 9l4.3-1.6z' },
      { d: 'M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' },
    ])
  },
  // 询问：消息气泡（Lucide message-circle）
  ask: function () {
    return icon([
      {
        d: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z',
      },
    ])
  },
  // 书架显隐：左侧栏（Lucide panel-left）
  sidebar: function () {
    return icon([
      { tag: 'rect', x: '3', y: '3', width: '18', height: '18', rx: '2.5' },
      { d: 'M9 3v18' },
    ])
  },
  plus: function () {
    return icon([{ d: 'M12 5v14' }, { d: 'M5 12h14' }])
  },
  refresh: function () {
    return icon([{ d: 'M20 11a8 8 0 1 0-2.3 6.3' }, { d: 'M20 4v7h-7' }])
  },
}

/**
 * 导出菜单（R2 / m01365）：点击开合，鼠标移入展开、移出收起，Esc 关闭。
 *
 * 为什么不用 `<details>`：原生 details 只有「点开/点开别处」两种行为，既不能 hover
 * 展开，也没法在再次点击同一个按钮时收起（第二次点 summary 会关，但鼠标移出列表
 * 就停在打开状态）。这里显式管一个 open 状态，三种关闭路径都覆盖到。
 *
 * 菜单常驻 DOM、用 `rl-export--open` 控制显隐，这样键盘与测试都能稳定地找到菜单项。
 */
function ExportMenu(props) {
  var state = props.state || {}
  var actions = props.actions || {}
  var disabled = !state.selectedBookId || Boolean(state.exporting)
  var openPair = React.useState(false)
  var open = openPair[0]
  var setOpen = openPair[1]
  var closeTimer = React.useRef(null)

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  function openMenu() {
    cancelClose()
    setOpen(true)
  }
  function scheduleClose() {
    cancelClose()
    // 100ms 缓冲：从按钮斜着移到菜单项时指针会短暂离开两者之间的空隙。
    closeTimer.current = setTimeout(function () {
      closeTimer.current = null
      setOpen(false)
    }, 100)
  }
  React.useEffect(function () {
    return cancelClose
  }, [])

  var title = state.exporting ? t('export.busy') : disabled ? t('export.disabled') : t('export.button')
  var items = EXPORT_FORMATS.map(function (format) {
    return h(
      'button',
      {
        key: format,
        type: 'button',
        className: 'rl-export__item',
        'data-format': format,
        role: 'menuitem',
        disabled: disabled,
        onClick: function () {
          setOpen(false)
          actions.exportBook(format)
        },
      },
      h('span', { className: 'rl-export__name' }, t('export.name.' + format)),
      h('span', { className: 'rl-export__ext' }, EXPORT_EXTS[format] || format),
    )
  })

  return h(
    'div',
    {
      key: 'export',
      className: 'rl-export' + (open ? ' rl-export--open' : ''),
      onMouseEnter: openMenu,
      onMouseLeave: scheduleClose,
      onKeyDown: function (event) {
        if (event && event.key === 'Escape') {
          event.stopPropagation()
          setOpen(false)
        }
      },
    },
    h(
      'button',
      {
        type: 'button',
        className: 'rl-icon-btn rl-export__toggle' + (state.exporting ? ' rl-icon-btn--busy' : ''),
        title: title,
        'aria-label': title,
        'aria-haspopup': 'menu',
        'aria-expanded': open ? 'true' : 'false',
        'data-exporting': state.exporting ? 'true' : 'false',
        'aria-busy': state.exporting ? 'true' : 'false',
        'aria-disabled': disabled ? 'true' : 'false',
        onClick: function () {
          cancelClose()
          setOpen(!open)
        },
      },
      ICONS.export(),
    ),
    h(
      'div',
      { className: 'rl-export__menu', role: 'menu', 'aria-label': t('export.menu') },
      h(
        'div',
        { className: 'rl-export__head' },
        ICONS.export(),
        h('span', null, t('export.title')),
      ),
      items,
    ),
  )
}

/** 导图 / 笔记 视图切换（R7 地基）：纯图标，标签走 aria-label；没有选中书时禁用。 */
function viewSwitch(state, actions) {
  var disabled = !state.selectedBookId
  var options = [
    { key: 'map', label: t('view.map'), make: ICONS.map },
    { key: 'notes', label: t('view.notes'), make: ICONS.notes },
  ]
  return h(
    'div',
    { key: 'switch', className: 'rl-switch', role: 'group', 'aria-label': t('view.switch') },
    options.map(function (option) {
      var active = (state.viewMode || 'map') === option.key
      return h(
        'button',
        {
          key: option.key,
          type: 'button',
          className: 'rl-switch__item',
          'data-view': option.key,
          'aria-pressed': active ? 'true' : 'false',
          'aria-label': option.label,
          title: option.label,
          disabled: disabled,
          onClick: function () {
            actions.setViewMode(option.key)
          },
        },
        option.make(),
      )
    }),
  )
}

VIEWS.Header = function Header(props) {
  var state = props.state
  var actions = props.actions
  var current = null
  var books = Array.isArray(state.books) ? state.books : []
  for (var i = 0; i < books.length; i += 1) {
    if (books[i] && books[i].id === state.selectedBookId) current = books[i]
  }
  var subtitle = current ? current.displayName || current.title : t('panel.subtitle')

  var children = [
    h(
      'button',
      {
        key: 'sidebar',
        type: 'button',
        className: 'rl-icon-btn rl-header__sidebar' + (state.libraryOpen === false ? ' is-off' : ''),
        'data-action': 'toggle-library',
        'aria-pressed': state.libraryOpen === false ? 'false' : 'true',
        title: state.libraryOpen === false ? t('library.show') : t('library.hide'),
        'aria-label': state.libraryOpen === false ? t('library.show') : t('library.hide'),
        onClick: function () {
          if (typeof actions.toggleLibrary === 'function') actions.toggleLibrary()
        },
      },
      ICONS.sidebar(),
    ),
    h(
      'div',
      { key: 'brand', className: 'rl-header__brand' },
      h('span', { className: 'rl-header__title' }, t('panel.title')),
      h('span', { className: 'rl-header__subtitle', title: subtitle }, subtitle),
    ),
    h('span', { key: 'spacer', className: 'rl-header__spacer' }),
  ]

  if (state.storage === 'unavailable') {
    children.push(
      h('span', { key: 'warn', className: 'rl-header__warn', role: 'status' }, t('header.storage.unavailable')),
    )
  }
  if (state.lastError) {
    children.push(
      h('span', { key: 'error', className: 'rl-header__error', role: 'alert' }, t('error.' + state.lastError)),
    )
  }
  if (state.lastExport && state.lastExport.path) {
    children.push(
      h(
        'span',
        { key: 'exported', className: 'rl-header__exported', role: 'status', title: state.lastExport.path },
        t('export.done', { name: state.lastExport.name || state.lastExport.path }),
      ),
    )
  }

  children.push(
    h(
      'div',
      { key: 'actions', className: 'rl-header__group' },
      h(
        'button',
        {
          type: 'button',
          className: 'rl-icon-btn rl-icon-btn--accent',
          'data-action': 'import',
          'data-importing': state.importing ? 'true' : 'false',
          onClick: actions.importBook,
          disabled: Boolean(state.importing),
          title: state.importing ? t('library.status.parsing') : t('header.import'),
          'aria-label': state.importing ? t('library.status.parsing') : t('header.import'),
          'aria-busy': state.importing ? 'true' : 'false',
        },
        ICONS.import(),
      ),
      viewSwitch(state, actions),
      h('span', { key: 'divider', className: 'rl-header__divider', 'aria-hidden': 'true' }),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-icon-btn',
          'data-action': 'ask',
          'aria-pressed': state.askOpen ? 'true' : 'false',
          title: t('ask.title'),
          'aria-label': t('ask.title'),
          disabled: !state.selectedBookId,
          onClick: actions.toggleAsk,
        },
        ICONS.ask(),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-icon-btn',
          'data-tutor-toggle': '',
          'data-action': 'tutor',
          'aria-pressed': state.tutorOpen ? 'true' : 'false',
          title: state.selectedBookId ? t('tutor.title') : t('tutor.disabled'),
          'aria-label': t('tutor.entry'),
          disabled: !state.selectedBookId,
          onClick: actions.toggleTutor,
        },
        ICONS.tutor(),
      ),
      h(ExportMenu, { key: 'export', state: state, actions: actions }),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-icon-btn',
          'data-settings-toggle': '',
          'data-action': 'settings',
          'aria-pressed': state.settingsOpen ? 'true' : 'false',
          title: t('settings.title'),
          'aria-label': t('settings.title'),
          onClick: actions.toggleSettings,
        },
        ICONS.settings(),
      ),
    ),
  )

  return h('header', { className: 'rl-header' }, children)
}