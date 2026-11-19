/* 研究笔记（owner: notes，03 §5.5；FR-14）。
 *
 * 只读视图：v0.2 由 Agent 用 reading_notes 生成 `notes.md`，面板负责把它呈现出来
 * （编辑留到 v0.3，所以这里没有 textarea）。手改/损坏的文件后端会带 `parseError`，
 * 视图仍然显示原文，并明确告诉用户「已手工修改」。
 *
 * 引用 `[[c:000012]]` 渲染成小徽标；点击它把正文里的对应句子高亮出来——笔记正文
 * 不依赖导图节点，所以不跳详情，只在本面板内定位。
 */

var NOTES_PANEL_WIDTH = 420

var NOTES_STYLES = [
  '.rl-notes{position:absolute;top:0;right:0;bottom:0;width:' + NOTES_PANEL_WIDTH + 'px;max-width:100%;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);z-index:6;}',
  '.rl-notes__head{display:flex;align-items:flex-start;gap:8px;padding:16px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.rl-notes__heading{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto;}',
  '.rl-notes__title{margin:0;font-size:16px;font-weight:600;line-height:1.4;word-break:break-word;}',
  '.rl-notes__meta{font-size:11px;line-height:1.4;color:var(--dsw-alias-label-caption);}',
  '.rl-notes__warn{font-size:12px;line-height:1.5;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-secondary);}',
  '.rl-notes__close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 auto;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
  '.rl-notes__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.rl-notes__close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
  '.rl-notes__body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:20px;}',
  '.rl-notes__section{display:flex;flex-direction:column;gap:8px;}',
  '.rl-notes__section-title{margin:0;font-size:12px;font-weight:600;letter-spacing:0;color:var(--dsw-alias-label-tertiary);}',
  '.rl-notes__text{margin:0;font-size:13px;line-height:1.75;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word;}',
  '.rl-notes__text--empty{color:var(--dsw-alias-label-caption);}',
  '.rl-notes__cite{display:inline-block;margin:0 2px;padding:0 5px;border:0;border-radius:9px;background:var(--dsw-alias-markdown-citation);color:var(--dsw-alias-label-secondary);font-size:11px;line-height:18px;cursor:pointer;font-family:inherit;}',
  '.rl-notes__cite:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.rl-notes__mark{background:var(--dsw-alias-markdown-citation);border-radius:4px;padding:0 2px;}',
  '.rl-notes__table{width:100%;border-collapse:collapse;font-size:12px;}',
  '.rl-notes__table th,.rl-notes__table td{border:1px solid var(--dsw-alias-border-l1);padding:4px 6px;text-align:left;vertical-align:top;}',
  '.rl-notes__table th{color:var(--dsw-alias-label-tertiary);font-weight:600;}',
  '@media (max-width:720px){.rl-notes{width:100%;}}',
  '@media (prefers-reduced-motion:reduce){.rl-notes *{transition:none;animation:none;}}',
]

/** 把 `[[c:000012]]` 切分成可渲染片段（纯函数，测试直接断言输出）。 */
function notesInlineParts(text) {
  var parts = []
  var pattern = /\[\[c:(\d{6})\]\]/g
  var last = 0
  var match
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) })
    parts.push({ type: 'citation', chunkId: 'c-' + match[1], text: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

/** 术语表是 Markdown 表格：拆成表头 + 行（其余小节按段落渲染）。 */
function notesTableRows(body) {
  var lines = String(body || '')
    .split('\n')
    .map(function (line) {
      return line.trim()
    })
    .filter(function (line) {
      return line.indexOf('|') === 0
    })
  if (lines.length < 2) return null
  var cells = function (line) {
    return line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(function (cell) {
        return cell.trim()
      })
  }
  var header = cells(lines[0])
  var rows = lines.slice(1).filter(function (line) {
    return !/^\|[\s:|-]+\|$/.test(line)
  })
  if (rows.length === 0) return null
  return { header: header, rows: rows.map(cells) }
}

function notesInlineNodes(props, text, keyPrefix, activeCitation) {
  return notesInlineParts(text).map(function (part, index) {
    if (part.type === 'text') return part.text
    var active = part.chunkId === activeCitation
    return h(
      'button',
      {
        key: keyPrefix + '-' + index,
        type: 'button',
        className: 'rl-notes__cite' + (active ? ' rl-notes__mark' : ''),
        'data-citation': part.chunkId,
        'aria-pressed': active ? 'true' : 'false',
        onClick: function () {
          if (typeof props.onCitation === 'function') props.onCitation(part.chunkId)
        },
      },
      part.chunkId,
    )
  })
}

VIEWS.Notes = function Notes(props) {
  var state = props.state || {}
  var actions = props.actions || {}
  var bookId = state.selectedBookId || null
  var book = null
  var books = Array.isArray(state.books) ? state.books : []
  for (var i = 0; i < books.length; i += 1) {
    if (books[i] && books[i].id === bookId) book = books[i]
  }
  var pair = React.useState({ status: 'idle', notes: null, bookId: null })
  var loaded = pair[0]
  var setLoaded = pair[1]
  var activePair = React.useState(null)
  var activeCitation = activePair[0]
  var setActiveCitation = activePair[1]

  React.useEffect(
    function () {
      if (!bookId) {
        setLoaded({ status: 'idle', notes: null, bookId: null })
        return
      }
      var cancelled = false
      setLoaded({ status: 'loading', notes: null, bookId: bookId })
      api
        .getNotes(bookId)
        .then(function (notes) {
          if (!cancelled) setLoaded({ status: 'ready', notes: notes, bookId: bookId })
        })
        .catch(function (error) {
          if (!cancelled) {
            setLoaded({ status: 'error', notes: null, bookId: bookId, code: error && error.code ? error.code : 'E_IO' })
          }
        })
      return function () {
        cancelled = true
      }
    },
    [bookId],
  )

  var notes = loaded.bookId === bookId ? loaded.notes : null
  var body = null

  if (!bookId) {
    body = h(
      'div',
      { className: 'rl-empty' },
      h('div', { className: 'rl-empty__title' }, t('notes.empty.title')),
      h('div', { className: 'rl-empty__hint' }, t('notes.empty.hint')),
    )
  } else if (loaded.status === 'loading' || loaded.status === 'idle') {
    body = h(
      'div',
      { className: 'rl-empty' },
      h('div', { className: 'rl-empty__title' }, t('notes.loading.title')),
      h('div', { className: 'rl-empty__hint' }, t('notes.loading.hint')),
    )
  } else if (loaded.status === 'error') {
    body = h(
      'div',
      { className: 'rl-empty' },
      h('div', { className: 'rl-empty__title' }, t('notes.error.title')),
      h('div', { className: 'rl-empty__hint' }, t('error.' + (loaded.code || 'E_IO'))),
    )
  } else if (!notes || !notes.updatedAt || (Array.isArray(notes.sections) && notes.sections.length === 0)) {
    body = h(
      'div',
      { className: 'rl-empty' },
      h('div', { className: 'rl-empty__title' }, t('notes.none.title')),
      h('div', { className: 'rl-empty__hint' }, t('notes.none.hint')),
    )
  } else {
    var sections = Array.isArray(notes.sections) ? notes.sections : []
    body = h(
      'div',
      { className: 'rl-notes__body' },
      notes.parseError
        ? h('div', { className: 'rl-notes__warn', role: 'status' }, t('notes.parseError'))
        : null,
      sections.map(function (section) {
        var key = 'section-' + section.title
        var isEmpty = section.body === '本书未形成该部分'
        var table = isEmpty ? null : notesTableRows(section.body)
        return h(
          'section',
          { key: key, className: 'rl-notes__section', 'data-section': section.title },
          h('h3', { className: 'rl-notes__section-title' }, section.title),
          table
            ? h(
                'table',
                { className: 'rl-notes__table' },
                h(
                  'thead',
                  null,
                  h(
                    'tr',
                    null,
                    table.header.map(function (cell, index) {
                      return h('th', { key: key + '-h' + index }, cell)
                    }),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  table.rows.map(function (row, rowIndex) {
                    return h(
                      'tr',
                      { key: key + '-r' + rowIndex },
                      row.map(function (cell, cellIndex) {
                        return h('td', { key: key + '-c' + cellIndex }, notesInlineNodes(props, cell, key + '-c' + cellIndex, activeCitation))
                      }),
                    )
                  }),
                ),
              )
            : h(
                'p',
                { className: 'rl-notes__text' + (isEmpty ? ' rl-notes__text--empty' : '') },
                isEmpty ? section.body : notesInlineNodes(props, section.body, key, activeCitation),
              ),
        )
      }),
    )
  }

  return h(
    'aside',
    {
      className: 'rl-notes',
      role: 'complementary',
      'aria-label': t('notes.title'),
      'data-book-id': bookId || '',
      onKeyDown: function (event) {
        if (event && event.key === 'Escape' && typeof actions.toggleNotes === 'function') {
          event.stopPropagation()
          actions.toggleNotes()
        }
      },
    },
    h('style', { dangerouslySetInnerHTML: { __html: NOTES_STYLES.join('\n') } }),
    h(
      'div',
      { className: 'rl-notes__head' },
      h(
        'div',
        { className: 'rl-notes__heading' },
        h('h2', { className: 'rl-notes__title' }, t('notes.title')),
        h(
          'div',
          { className: 'rl-notes__meta' },
          [book ? book.displayName || book.title : '', notes && notes.updatedAt ? t('notes.updated', { time: notes.updatedAt.slice(0, 16).replace('T', ' ') }) : '']
            .filter(Boolean)
            .join(' · '),
        ),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-notes__close',
          'aria-label': t('notes.close'),
          onClick: function () {
            if (typeof actions.toggleNotes === 'function') actions.toggleNotes()
          },
        },
        h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
          h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
        ),
      ),
    ),
    body,
  )
}