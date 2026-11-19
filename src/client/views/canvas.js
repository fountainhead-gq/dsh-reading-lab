/* 导图画布（owner: canvas，03 §4.1 flex:1 最小 320）。M3 之前是空态。 */

VIEWS.Canvas = function Canvas(props) {
  var state = props.state
  var books = Array.isArray(state.books) ? state.books : []
  var book = null
  for (var index = 0; index < books.length; index += 1) {
    if (books[index] && books[index].id === state.selectedBookId) {
      book = books[index]
      break
    }
  }

  if (!book) {
    return h(
      'section',
      { className: 'rl-canvas', 'aria-label': t('canvas.empty.title') },
      h(
        'div',
        { className: 'rl-empty' },
        h(
          'svg',
          { className: 'rl-empty__icon', viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' },
          h('path', {
            fill: 'currentColor',
            d: 'M24 6v12M24 30v12M6 24h12M30 24h12M11 11l8 8M29 29l8 8M37 11l-8 8M19 29l-8 8',
            stroke: 'currentColor',
            strokeWidth: '2',
            strokeLinecap: 'round',
          }),
        ),
        h('div', { className: 'rl-empty__title' }, t('canvas.empty.title')),
        h('div', { className: 'rl-empty__hint' }, t('canvas.empty.hint')),
      ),
    )
  }

  return h(
    'section',
    { className: 'rl-canvas', role: 'tree', 'aria-label': book.title || book.id },
    h(
      'div',
      { className: 'rl-empty' },
      h('div', { className: 'rl-empty__title' }, book.title || book.id),
      h('div', { className: 'rl-empty__hint' }, t('state.stub')),
      h('div', { className: 'rl-skeleton', 'aria-hidden': 'true' }),
    ),
  )
}