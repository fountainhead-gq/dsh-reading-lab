/* 顶部工具条（owner: library，03 §4.1 header 48px）。 */

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
  children.push(h('span', { key: 'count', className: 'rl-header__count' }, t('header.count', { count: count })))
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