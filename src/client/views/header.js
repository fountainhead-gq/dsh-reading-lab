/* 顶部工具条（owner: library，03 §4.1；R1 布局见 docs/13-ui-rework-backlog.md）。
 *
 * 顶栏只留两类东西：内容导航（视图切换）与高频动作（导入 / 询问 / 引导 / 导出 / 设置）。
 * 刷新、存储位置、版本信息都进设置抽屉——v0.2.1 的三处入口各说各话，是这次要修的问题。
 * 图标按 Ponder 参考图取 16px 线性、32×32 命中区；文案仍然走 locale。
 */

var EXPORT_FORMATS = ['md', 'opml', 'json']

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
 * 导出菜单：`<details>` 折叠，三项格式各一个按钮（03 §9、04 §4.2 #22）。
 * 没选书或正在导出时禁用，避免发出必然失败的请求。
 */
function exportMenu(state, actions) {
  var disabled = !state.selectedBookId || Boolean(state.exporting)
  var items = EXPORT_FORMATS.map(function (format) {
    return h(
      'button',
      {
        key: format,
        type: 'button',
        className: 'rl-export__item',
        'data-format': format,
        disabled: disabled,
        onClick: function () {
          actions.exportBook(format)
        },
      },
      t('export.format.' + format),
    )
  })
  var title = state.exporting ? t('export.busy') : disabled ? t('export.disabled') : t('export.button')
  return h(
    'details',
    { key: 'export', className: 'rl-export' },
    h(
      'summary',
      {
        className: 'rl-icon-btn rl-export__toggle' + (state.exporting ? ' rl-icon-btn--busy' : ''),
        role: 'button',
        title: title,
        'aria-label': title,
        'data-exporting': state.exporting ? 'true' : 'false',
        'aria-busy': state.exporting ? 'true' : 'false',
        'aria-disabled': disabled ? 'true' : 'false',
      },
      ICONS.export(),
    ),
    h('div', { className: 'rl-export__menu', role: 'menu', 'aria-label': t('export.menu') }, items),
  )
}

/** 导图 / 笔记 视图切换（R7 地基）：没有选中书时禁用。 */
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
          disabled: disabled,
          onClick: function () {
            actions.setViewMode(option.key)
          },
        },
        option.make(),
        h('span', null, option.label),
      )
    }),
  )
}

VIEWS.Header = function Header(props) {
  var state = props.state
  var actions = props.actions
  var count = Array.isArray(state.books) ? state.books.length : 0
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
          className: 'rl-btn rl-btn--primary',
          'data-action': 'import',
          onClick: actions.importBook,
          disabled: Boolean(state.importing),
          title: t('header.import'),
        },
        ICONS.plus(),
        h('span', null, state.importing ? t('library.status.parsing') : t('header.import')),
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
      exportMenu(state, actions),
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
      h('span', { className: 'rl-header__count', title: t('settings.about.books') }, t('header.count', { count: count })),
    ),
  )

  return h('header', { className: 'rl-header' }, children)
}