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
  var index = typeof props.index === 'number' ? props.index : -1
  var dragging = props.dragging === true
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
      'data-index': String(index),
      'data-dragging': dragging ? 'true' : 'false',
      draggable: 'true',
      title: book.title || book.id,
      onClick: function () {
        props.onSelect(book.id)
      },
      // R4：原生 HTML5 拖拽。drop 目标由列表项自己算插入位置，避免依赖元素几何。
      onDragStart: function (event) {
        if (event && event.dataTransfer) {
          try {
            event.dataTransfer.setData('text/plain', book.id)
            event.dataTransfer.effectAllowed = 'move'
          } catch (error) {
            /* 某些合成事件没有真 dataTransfer */
          }
        }
        if (typeof props.onDragStart === 'function') props.onDragStart(book.id)
      },
      onDragEnd: function () {
        if (typeof props.onDragEnd === 'function') props.onDragEnd()
      },
      onDragOver: function (event) {
        if (event && event.preventDefault) event.preventDefault()
        if (typeof props.onDragOver === 'function') props.onDragOver(index)
      },
      onDrop: function (event) {
        if (event && event.preventDefault) event.preventDefault()
        var id = book.id
        if (event && event.dataTransfer && typeof event.dataTransfer.getData === 'function') {
          try {
            id = event.dataTransfer.getData('text/plain') || id
          } catch (error) {
            /* 用落点项自己的 id 兜底 */
          }
        }
        if (typeof props.onDrop === 'function') props.onDrop(id, index)
      },
      // 键盘替代路径：Alt+↑/↓ 把当前书前移/后移一位（R4 验收要求键盘可用）。
      onKeyDown: function (event) {
        if (!event || !event.altKey || typeof props.onMove !== 'function') return
        var delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
        if (delta === 0) return
        if (event.preventDefault) event.preventDefault()
        if (event.stopPropagation) event.stopPropagation()
        props.onMove(book.id, index + delta)
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
      books.map(function (book, index) {
        return h(
          'li',
          { key: book.id, role: 'none', className: 'rl-library__item' },
          h(BookCard, {
            book: book,
            index: index,
            dragging: state.dragBookId === book.id,
            selected: state.selectedBookId === book.id,
            onSelect: actions.selectBook,
            onDragStart: actions.startBookDrag,
            onDragEnd: actions.endBookDrag,
            onDragOver: actions.hoverBook,
            onDrop: actions.dropBook,
            onMove: actions.moveBookTo,
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

  // 书架宽度拖拽（m01951）：右缘一条 6px 热区，拖动即 setLibraryWidth（220–480 由 store 夹取）。
  function beginResize(event) {
    if (!event || typeof event.clientX !== 'number') return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof actions.setLibraryWidth !== 'function') return
    var startX = event.clientX
    var startWidth = Number(state.libraryWidth) || 288
    function move(moveEvent) {
      actions.setLibraryWidth(startWidth + (moveEvent.clientX - startX))
    }
    function finish() {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', finish)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', finish)
  }

  function resizeByKey(event) {
    if (!event || typeof actions.setLibraryWidth !== 'function') return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (typeof event.preventDefault === 'function') event.preventDefault()
      var step = event.key === 'ArrowLeft' ? -16 : 16
      actions.setLibraryWidth((Number(state.libraryWidth) || 288) + step)
    }
  }

  var libraryStyle = state.libraryWidth ? 'width:' + state.libraryWidth + 'px' : null

  return h(
    'aside',
    { className: 'rl-library', 'aria-label': t('library.title'), style: libraryStyle },
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
    h('div', {
      className: 'rl-library__resize',
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-label': t('library.resize'),
      tabIndex: 0,
      'data-library-resize': 'true',
      onMouseDown: beginResize,
      onKeyDown: resizeByKey,
    }),
    // 书架底部不再显示存储位置（m01365）：路径属于设置，抽屉里已有且可改，这里只留文件选择器。
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