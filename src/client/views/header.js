/* 顶部工具条（owner: library，03 §4.1 header 48px）。 */

var EXPORT_FORMATS = ['md', 'opml', 'json']

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
  return h(
    'details',
    { key: 'export', className: 'rl-export' },
    h(
      'summary',
      {
        className: 'rl-btn rl-btn--ghost rl-export__toggle',
        role: 'button',
        'aria-disabled': disabled ? 'true' : 'false',
        title: state.selectedBookId ? t('export.button') : t('export.disabled'),
      },
      state.exporting ? t('export.busy') : t('export.button'),
    ),
    h('div', { className: 'rl-export__menu', role: 'menu', 'aria-label': t('export.menu') }, items),
  )
}

VIEWS.Header = function Header(props) {
  var state = props.state
  var actions = props.actions
  var count = Array.isArray(state.books) ? state.books.length : 0
  var children = [
    h('span', { key: 'title', className: 'rl-header__title' }, t('panel.title')),
    h('span', { key: 'subtitle', className: 'rl-header__subtitle' }, t('panel.subtitle')),
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
        {
          key: 'exported',
          className: 'rl-header__exported',
          role: 'status',
          title: state.lastExport.path,
        },
        t('export.done', { name: state.lastExport.name || state.lastExport.path }),
      ),
    )
  }
  children.push(h('span', { key: 'count', className: 'rl-header__count' }, t('header.count', { count: count })))
  children.push(exportMenu(state, actions))
  children.push(
    h(
      'button',
      {
        key: 'ask',
        type: 'button',
        className: 'rl-btn' + (state.askOpen ? ' rl-btn--primary' : ''),
        'aria-pressed': state.askOpen ? 'true' : 'false',
        onClick: actions.toggleAsk,
      },
      t('ask.title'),
    ),
  )
  children.push(
    h(
      'button',
      {
        key: 'refresh',
        type: 'button',
        className: 'rl-btn rl-btn--ghost',
        onClick: actions.refresh,
        'aria-label': t('header.refresh'),
      },
      t('header.refresh'),
    ),
  )
  children.push(
    h(
      'button',
      {
        key: 'import',
        type: 'button',
        className: 'rl-btn rl-btn--primary',
        onClick: actions.importBook,
        disabled: Boolean(state.importing),
      },
      state.importing ? t('library.status.parsing') : t('header.import'),
    ),
  )
  return h('header', { className: 'rl-header' }, children)
}