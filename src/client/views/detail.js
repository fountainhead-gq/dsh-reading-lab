/* 笔记详情（owner: detail，03 §4.1 覆盖宽 360）。M4 之前是空态。 */

VIEWS.Detail = function Detail(props) {
  var state = props.state
  return h(
    'aside',
    { className: 'rl-detail', 'aria-label': t('detail.empty.title') },
    h(
      'div',
      { className: 'rl-empty' },
      h('div', { className: 'rl-empty__title' }, t('detail.empty.title')),
      h('div', { className: 'rl-empty__hint' }, t('detail.empty.hint')),
    ),
    h(
      'div',
      { className: 'rl-status' },
      state.selectedBookId ? t('state.stub') : '',
    ),
  )
}