/* 书架（owner: library，03 §4.1）。R1 之后：导入/设置都在顶栏，书架只管选书与搜索。 */

function bookStatusLabel(status) {
  if (status === 'parsing') return t('library.status.parsing')
  if (status === 'ready') return t('library.status.ready')
  if (status === 'failed') return t('library.status.failed')
  if (status === 'unsupported') return t('library.status.unsupported')
  return ''
}

/** 书名首字母（中文取首字）当封面占位，避免一排纯文字分不清。 */
function bookInitial(book) {
  var source = String((book && (book.displayName || book.title || book.id)) || '').trim()
  if (source === '') return '·'
  return source.slice(0, 1)
}

function BookCard(props) {
  var book = props.book
  var selected = props.selected
  var meta = []
  var label = bookStatusLabel(book.status)
  if (label) meta.push(h('span', { key: 'status', className: 'rl-pill rl-pill--' + (book.status || '') }, label))
  var extra = []
  if (book.stats && typeof book.stats.chapters === 'number') {
    extra.push(t('library.meta.chapters', { count: book.stats.chapters }))
  }
  if (book.stats && typeof book.stats.chunks === 'number') {
    extra.push(t('library.meta.chunks', { count: book.stats.chunks }))
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'rl-card',
      role: 'option',
      'aria-selected': selected ? 'true' : 'false',
      'data-book-id': book.id,
      title: book.title || book.id,
      onClick: function () {
        props.onSelect(book.id)
      },
    },
    h('span', { className: 'rl-card__cover', 'aria-hidden': 'true' }, bookInitial(book)),
    h(
      'span',
      { className: 'rl-card__text' },
      h('span', { className: 'rl-card__title' }, book.title || book.id),
      h('span', { className: 'rl-card__meta' }, meta),
      extra.length > 0 ? h('span', { className: 'rl-card__meta' }, h('span', { className: 'rl-card__meta-text' }, extra.join(' · '))) : null,
    ),
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
          { type: 'button', className: 'rl-btn rl-btn--primary', onClick: actions.importBook, disabled: Boolean(state.importing) },
          state.importing ? t('library.status.parsing') : t('library.empty.action'),
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
      h('span', { className: 'rl-pill' }, t('header.count', { count: Array.isArray(state.books) ? state.books.length : 0 })),
    ),
    h(
      'div',
      { className: 'rl-library__search' },
      h(
        'svg',
        { className: 'rl-icon rl-library__search-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false', fill: 'none' },
        h('path', {
          d: 'M7 11.5a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10.4 10.4L14 14',
          stroke: 'currentColor',
          strokeWidth: '1.5',
          strokeLinecap: 'round',
        }),
      ),
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
    // 书架底部只留一句当前存储位置；改路径在设置抽屉里（R1）。
    h(
      'div',
      { className: 'rl-library__foot' },
      h('span', { className: 'rl-card__meta-text', title: (state.settings && state.settings.resolvedRoot) || '' },
        state.settings && state.settings.resolvedRoot ? state.settings.resolvedRoot : t('settings.path.unknown'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-btn rl-btn--ghost rl-btn--sm',
          'data-action': 'open-settings',
          onClick: actions.openSettings,
        },
        t('settings.title'),
      ),
    ),
    // 真正的文件选择器：按钮只负责 click()，见 overlay.js 的 importBook。
    h('input', {
      id: 'rl-file-input',
      className: 'rl-file-input',
      type: 'file',
      accept: '.epub,.pdf',
      'aria-label': t('header.import'),
      onChange: actions.pickFile,
    }),
  )
}