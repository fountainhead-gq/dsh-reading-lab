/* 顶部工具条（owner: library，03 §4.1；R1 布局见 docs/13-ui-rework-backlog.md）。
 *
 * 顶栏只留两类东西：内容导航（视图切换）与高频动作（导入 / 询问 / 引导 / 导出 / 设置）。
 * 刷新、存储位置、版本信息都进设置抽屉——v0.2.1 的三处入口各说各话，是这次要修的问题。
 * 图标按 Ponder 参考图取 16px 线性、32×32 命中区；文案仍然走 locale。
 */

var EXPORT_FORMATS = ['md', 'opml', 'json']
var EXPORT_EXTS = { md: '.md', opml: '.opml', json: '.json' }

/** 线性图标：统一 16×16 viewBox，stroke 用 currentColor。 */
function icon(path, extra) {
  return h(
    'svg',
    Object.assign(
      { className: 'rl-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false', fill: 'none' },
      extra || {},
    ),
    h('path', Object.assign({ stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round', strokeLinejoin: 'round' }, path)),
  )
}

var ICONS = {
  map: function () {
    return icon({ d: 'M2 4h5v8H2zM9 2h5v5H9zM9 9h5v5H9z' })
  },
  notes: function () {
    return icon({ d: 'M3.5 2.5h9v11h-9zM5.5 5.5h5M5.5 8h5M5.5 10.5h3' })
  },
  export: function () {
    return icon({ d: 'M8 10.5V2.5M5 5.5L8 2.5l3 3M3 10v3.5h10V10' })
  },
  settings: function () {
    return icon({ d: 'M8 10.2a2.2 2.2 0 100-4.4 2.2 2.2 0 000 4.4zM13 8a5 5 0 00-.1-1l1.1-.9-1-1.7-1.4.5a5 5 0 00-1.7-1L9.6 2H7.4l-.3 1.5a5 5 0 00-1.7 1l-1.4-.5-1 1.7L4.1 7a5 5 0 000 2l-1.1.9 1 1.7 1.4-.5a5 5 0 001.7 1l.3 1.5h2.2l.3-1.5a5 5 0 001.7-1l1.4.5 1-1.7-1.1-.9c.1-.3.1-.7.1-1z' })
  },
  tutor: function () {
    return icon({ d: 'M8 3.2L9.7 7l3.8 1.7-3.8 1.7L8 14.2 6.3 10.4 2.5 8.7 6.3 7z' })
  },
  ask: function () {
    return icon({ d: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z' })
  },
  plus: function () {
    return icon({ d: 'M8 3.5v9M3.5 8h9' })
  },
  refresh: function () {
    return icon({ d: 'M13 8a5 5 0 11-1.6-3.7M13 2.5V6h-3.5' })
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
        ICONS.plus(),
      ),
      viewSwitch(state, actions),
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