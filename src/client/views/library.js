/* 书架（owner: library，03 §4.1 宽 280 / 240–360）。 */

function bookStatusLabel(status) {
  if (status === 'parsing') return t('library.status.parsing')
  if (status === 'ready') return t('library.status.ready')
  if (status === 'failed') return t('library.status.failed')
  if (status === 'unsupported') return t('library.status.unsupported')
  return ''
}

function BookCard(props) {
  var book = props.book
  var selected = props.selected
  var meta = []
  var label = bookStatusLabel(book.status)
  if (label) meta.push(h('span', { key: 'status', className: 'rl-pill rl-pill--' + (book.status || '') }, label))
  if (typeof book.chapterCount === 'number') {
    meta.push(h('span', { key: 'chapters' }, t('library.meta.chapters', { count: book.chapterCount })))
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'rl-card',
      role: 'option',
      'aria-selected': selected ? 'true' : 'false',
      onClick: function () {
        props.onSelect(book.id)
      },
    },
    h('span', { className: 'rl-card__title', title: book.title || '' }, book.title || book.id),
    h('span', { className: 'rl-card__meta' }, meta),
  )
}

VIEWS.Library = function Library(props) {
  var state = props.state
  var actions = props.actions
  var books = visibleBooks(state)
  var body

  if (books.length > 0) {
    body = h(
      'ul',
      { className: 'rl-library__list', role: 'listbox', 'aria-label': t('library.title') },
      books.map(function (book) {
        return h(
          'li',
          { key: book.id, role: 'none' },
          h(BookCard, {
            book: book,
            selected: state.selectedBookId === book.id,
            onSelect: actions.selectBook,
          }),
        )
      }),
    )
  } else if (state.filter) {
    body = h('div', { className: 'rl-status' }, t('library.empty.title'))
  } else {
    body = h(
      'div',
      { className: 'rl-empty' },
      h(
        'svg',
        { className: 'rl-empty__icon', viewBox: '0 0 48 48', 'aria-hidden': 'true', focusable: 'false' },
        h('path', {
          fill: 'currentColor',
          d: 'M8 10h13c2 0 3 1 3 3v25c0-2-1-3-3-3H8V10zm32 0H27c-2 0-3 1-3 3v25c0-2 1-3 3-3h13V10z',
        }),
      ),
      h('div', { className: 'rl-empty__title' }, t('library.empty.title')),
      h('div', { className: 'rl-empty__hint' }, t('library.empty.hint')),
      h(
        'div',
        { className: 'rl-empty__actions' },
        h(
          'button',
          { type: 'button', className: 'rl-btn rl-btn--primary', onClick: actions.importBook, disabled: true, title: t('state.stub') },
          t('library.empty.action'),
        ),
      ),
    )
  }

  return h(
    'aside',
    { className: 'rl-library', 'aria-label': t('library.title') },
    h(
      'div',
      { className: 'rl-library__head' },
      h('span', { className: 'rl-library__title' }, t('library.title')),
    ),
    h(
      'div',
      { style: { padding: '0 12px 8px' } },
      h('input', {
        className: 'rl-input',
        type: 'search',
        value: state.filter,
        placeholder: t('library.search.placeholder'),
        'aria-label': t('library.search.placeholder'),
        onChange: function (event) {
          setFilter(event && event.target ? event.target.value : '')
        },
      }),
    ),
    body,
  )
}