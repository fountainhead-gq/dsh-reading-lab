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
        // M2 接 <input type="file"> 与 POST /books/import（03 §4.5）。
        title: t('state.stub'),
      },
      t('header.import'),
    ),
  )
  return h('header', { className: 'rl-header' }, children)
}