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
  if (book.stats && typeof book.stats.chapters === 'number') {
    meta.push(h('span', { key: 'chapters' }, t('library.meta.chapters', { count: book.stats.chapters })))
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

/**
 * 存储位置（t33）：显示 Host 解析出来的绝对路径；回退时给警告，不允许看起来正常。
 * 修改走 PUT /settings/library-root，成功/失败都落到块内的可见文案（不弹窗）。
 */
function storageSection(state, actions) {
  var settings = state.settings
  if (!settings) return null
  var path = settings.resolvedRoot || ''
  var feedback = state.settingsFeedback
  var feedbackText = ''
  if (feedback && feedback.code) {
    feedbackText = feedback.code.indexOf('settings.') === 0 ? t(feedback.code) : t('error.' + feedback.code)
  }
  return h(
    'div',
    { className: 'rl-storage' },
    h('div', { className: 'rl-storage__head' }, h('span', { className: 'rl-storage__title' }, t('settings.title'))),
    h('div', { className: 'rl-storage__path', title: path }, path || t('settings.path.unknown')),
    settings.isFallback
      ? h('div', { className: 'rl-storage__warn', role: 'status' }, t('settings.fallback'))
      : null,
    h('input', {
      className: 'rl-input rl-storage__input',
      type: 'text',
      value: state.settingsDraft,
      placeholder: t('settings.path.placeholder'),
      'aria-label': t('settings.path.placeholder'),
      onChange: actions.setStorageDraft,
    }),
    h(
      'label',
      { className: 'rl-storage__check' },
      h('input', {
        type: 'checkbox',
        checked: Boolean(state.settingsMoveExisting),
        onChange: actions.toggleStorageMove,
      }),
      t('settings.move'),
    ),
    h(
      'div',
      { className: 'rl-storage__actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'rl-btn rl-btn--primary',
          disabled: Boolean(state.settingsBusy),
          onClick: actions.applyLibraryRoot,
        },
        state.settingsBusy ? t('settings.working') : t('settings.apply'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-btn rl-btn--ghost',
          disabled: Boolean(state.settingsBusy),
          onClick: actions.resetLibraryRoot,
        },
        t('settings.reset'),
      ),
    ),
    feedbackText
      ? h(
          'div',
          {
            className: 'rl-storage__feedback rl-storage__feedback--' + (feedback.kind === 'ok' ? 'ok' : 'error'),
            role: 'status',
          },
          feedbackText,
        )
      : null,
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
          { type: 'button', className: 'rl-btn rl-btn--primary', onClick: actions.importBook },
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
      // 笔记只读面板的入口：选中一本书后才可用（v0.2 由 Agent 生成）。
      h(
        'button',
        {
          type: 'button',
          className: 'rl-btn rl-btn--ghost',
          onClick: actions.toggleNotes,
          disabled: !state.selectedBookId,
          title: t('notes.toggle'),
        },
        t('notes.toggle'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-btn rl-btn--ghost',
          onClick: actions.importBook,
          disabled: Boolean(state.importing),
          title: t('library.empty.action'),
        },
        state.importing ? t('library.status.parsing') : t('library.empty.action'),
      ),
      // 真正的文件选择器：按钮只负责 click()，见 overlay.js 的 importBook。
      h('input', {
        id: 'rl-file-input',
        className: 'rl-file-input',
        type: 'file',
        accept: '.epub,.pdf',
        'aria-label': t('library.empty.action'),
        onChange: actions.pickFile,
      }),
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
    storageSection(state, actions),
  )
}