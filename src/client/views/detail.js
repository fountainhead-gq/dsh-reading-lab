/* 卡片详情抽屉（owner: detail，03 §4.1/§4.3；FR-09）。
 *
 * 结构：VIEWS.Detail 负责取数与交互状态，VIEWS.DetailCard 是纯展示组件
 * （测试与截图脚本直接用它，避免依赖浏览器的 fetch / DOM）。
 * 抽屉绝对定位覆盖在画布右侧，不改变画布宽度，所以不会产生布局抖动。
 */

var DETAIL_FLASH_MS = 3000

var DETAIL_STYLES = [
  '.rl-detail.rl-detail--card{position:absolute;top:64px;right:16px;bottom:64px;width:360px;max-width:calc(100% - 32px);display:flex;flex-direction:column;z-index:5;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);overflow:hidden;}',
  '.rl-detail__head{display:flex;align-items:flex-start;gap:8px;padding:16px 16px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);}',
  '.rl-detail__heading{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1 1 auto;}',
  '.rl-detail__crumb{display:flex;align-items:center;gap:6px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-tertiary);min-height:16px;}',
  '.rl-detail__dot{width:6px;height:6px;border-radius:3px;flex:0 0 auto;background:var(--dsw-alias-label-tertiary);}',
  '.rl-detail__title{font-size:16px;font-weight:600;line-height:1.4;margin:0;word-break:break-word;}',
  '.rl-detail__close{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 auto;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}',
  '.rl-detail__close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.rl-detail__close:focus-visible,.rl-detail__btn:focus-visible,.rl-detail__cite:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}',
  '.rl-detail__body{flex:1 1 auto;min-height:0;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:16px;}',
  '.rl-detail__summary{font-size:14px;line-height:1.6;color:var(--dsw-alias-label-secondary);margin:0;white-space:pre-wrap;}',
  '.rl-detail__section{display:flex;flex-direction:column;gap:8px;}',
  '.rl-detail__section-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:600;letter-spacing:0;color:var(--dsw-alias-label-tertiary);}',
  '.rl-detail__count{font-weight:400;font-size:11px;padding:1px 6px;border-radius:9px;background:var(--dsw-alias-markdown-citation);color:var(--dsw-alias-label-secondary);}',
  '.rl-detail__cites{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;}',
  '.rl-detail__cite{display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;text-align:left;cursor:pointer;color:inherit;}',
  '.rl-detail__cite:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2);}',
  '.rl-detail__cite[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-active);}',
  '.rl-detail__cite-top{display:flex;align-items:center;gap:6px;width:100%;min-width:0;}',
  '.rl-detail__cite-id{font-size:11px;line-height:18px;padding:0 6px;border-radius:9px;background:var(--dsw-alias-markdown-citation);color:var(--dsw-alias-label-secondary);flex:0 0 auto;}',
  '.rl-detail__cite-meta{font-size:11px;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
  '.rl-detail__cite-text{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
  '.rl-detail__invalid{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary);}',
  '.rl-detail__muted{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-caption);}',
  '.rl-detail__updated{margin-top:auto;padding-top:8px;}',
  '.rl-detail__questions{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;}',
  '.rl-detail__question{font-size:12px;line-height:1.5;padding:6px 8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);}',
  '.rl-detail__source{border-top:1px solid var(--dsw-alias-border-l1);padding-top:12px;display:flex;flex-direction:column;gap:8px;}',
  '.rl-detail__source-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
  '.rl-detail__source-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin:0;}',
  '.rl-detail__source-meta{font-size:11px;color:var(--dsw-alias-label-caption);}',
  '.rl-detail__chunk{font-size:14px;line-height:1.7;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;padding:8px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);max-height:240px;overflow:auto;}',
  '.rl-detail__chunk--flash{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-markdown-citation);box-shadow:inset 0 0 0 2px var(--dsw-alias-brand-primary);}',
  '.rl-detail__flash-note{font-size:11px;color:var(--dsw-alias-brand-primary);}',
  '.rl-detail__toolbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);}',
  '.rl-detail__btn{display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer;}',
  '.rl-detail__btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}',
  '.rl-detail__btn--primary{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-border-l2);}',
  '.rl-detail__grow{flex:1 1 auto;}',
  '.rl-detail__copied{font-size:11px;color:var(--dsw-alias-state-success-primary);min-height:16px;}',
  '@media (max-width:720px){.rl-detail.rl-detail--card{top:8px;right:8px;bottom:8px;left:8px;width:auto;}}',
  '@media (prefers-reduced-motion:reduce){.rl-detail__chunk--flash{transition:none;}}',
]

function detailPad(value) {
  return value < 10 ? '0' + value : String(value)
}

/** 稳定的本地时间格式：`YYYY-MM-DD HH:mm`（无 Intl 依赖，测试可断言）。 */
function detailFormatTime(value) {
  if (!value) return ''
  var date = new Date(value)
  if (!date || isNaN(date.getTime())) return ''
  return (
    date.getFullYear() +
    '-' +
    detailPad(date.getMonth() + 1) +
    '-' +
    detailPad(date.getDate()) +
    ' ' +
    detailPad(date.getHours()) +
    ':' +
    detailPad(date.getMinutes())
  )
}

function detailKindLabel(kind) {
  var map = {
    book: 'detail.kind.book',
    chapter: 'detail.kind.chapter',
    section: 'detail.kind.section',
    point: 'detail.kind.point',
  }
  return t(map[kind] || 'detail.kind.point')
}

function detailSnippet(text, limit) {
  if (typeof text !== 'string') return ''
  var max = typeof limit === 'number' ? limit : 90
  var clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max).replace(/\s+$/, '') + '…' : clean
}

function detailChapterLabel(chunk) {
  if (!chunk) return ''
  if (Array.isArray(chunk.chapterPath) && chunk.chapterPath.length > 0) return chunk.chapterPath.join(' / ')
  return chunk.chapterTitle || ''
}

function detailPageLabel(chunk) {
  if (!chunk || !Number.isFinite(chunk.page) || chunk.page === null) return ''
  return t('detail.source.page', { page: chunk.page })
}

/** 面包屑：祖先标题 → 当前标题；根节点只显示书名。 */
function detailPathOf(doc, nodeId) {
  if (!doc) return []
  var index = SVG.indexMap(doc)
  var chain = SVG.ancestorsOf(index, nodeId)
  var titles = []
  for (var i = chain.length - 1; i >= 0; i -= 1) {
    var ancestor = index.nodes[chain[i]]
    if (ancestor) titles.push(ancestor.title)
  }
  var self = index.nodes[nodeId]
  if (self) titles.push(self.title)
  return titles
}

function detailBookOf(state) {
  var books = state && Array.isArray(state.books) ? state.books : []
  for (var i = 0; i < books.length; i += 1) {
    if (books[i] && books[i].id === state.selectedBookId) return books[i]
  }
  return null
}

/** 批量取块：一次请求解析全部引用；`missing` 即失效引用（FR-09/M3-15）。 */
function detailLoadCitations(bookId, citations) {
  var ids = []
  var list = Array.isArray(citations) ? citations : []
  list.forEach(function (citation) {
    if (citation && typeof citation.chunkId === 'string' && ids.indexOf(citation.chunkId) < 0) {
      ids.push(citation.chunkId)
    }
  })
  if (ids.length === 0) return Promise.resolve({ status: 'ready', items: [] })
  return request('/books/' + encodeURIComponent(bookId) + '/chunks?ids=' + ids.map(encodeURIComponent).join(','))
    .then(function (data) {
      var chunks = data && Array.isArray(data.chunks) ? data.chunks : []
      var missing = data && Array.isArray(data.missing) ? data.missing : []
      var byId = {}
      chunks.forEach(function (chunk) {
        byId[chunk.id] = chunk
      })
      var items = list.map(function (citation) {
        var chunk = byId[citation.chunkId] || null
        var invalid = !chunk || missing.indexOf(citation.chunkId) >= 0
        return { chunkId: citation.chunkId, quote: citation.quote || '', chunk: chunk, invalid: invalid }
      })
      return { status: 'ready', items: items }
    })
    .catch(function () {
      // chunks.json 缺失/损坏：详情仍可打开，全部引用标注失效（FR-09 验收）。
      return {
        status: 'error',
        items: list.map(function (citation) {
          return { chunkId: citation.chunkId, quote: citation.quote || '', chunk: null, invalid: true }
        }),
      }
    })
}

VIEWS.DetailCard = function DetailCard(props) {
  var node = props.node
  var book = props.book || {}
  var doc = props.doc || {}
  var citations = Array.isArray(props.citations) ? props.citations : []
  var citationsStatus = props.citationsStatus || 'ready'
  var activeCitation = props.activeCitation || null
  var flash = Boolean(props.flash)
  var copied = props.copied || ''
  var path = Array.isArray(props.path) ? props.path : []
  var breadcrumb = path.length > 1 ? path.slice(0, -1).join(' / ') : t('detail.kind.' + (node.kind || 'point'))
  var depth = Math.max(0, path.length - 1)
  var dotToken = SVG.DEPTH_TOKENS[Math.min(depth, SVG.DEPTH_TOKENS.length - 1)]
  var valid = citations.filter(function (item) {
    return !item.invalid
  })
  var invalid = citations.filter(function (item) {
    return item.invalid
  })
  var active = null
  for (var i = 0; i < valid.length; i += 1) {
    if (valid[i].chunkId === activeCitation) active = valid[i]
  }
  var time = detailFormatTime(doc.generatedAt || book.mapUpdatedAt || book.updatedAt)
  var summary = typeof node.summary === 'string' ? node.summary : ''

  // 焦点契约（QA-17-01）：侧卡打开即聚焦容器，Esc 才有关闭语义。
  var rootRef = React.useRef(null)
  React.useEffect(function () {
    focusElement(rootRef.current)
  }, [])

  var citeList = valid.map(function (item) {
    var chapter = detailChapterLabel(item.chunk)
    var page = detailPageLabel(item.chunk)
    var meta = [chapter, page].filter(Boolean).join(' · ')
    return h(
      'li',
      { key: item.chunkId },
      h(
        'button',
        {
          type: 'button',
          className: 'rl-detail__cite',
          'data-citation': item.chunkId,
          'aria-pressed': activeCitation === item.chunkId ? 'true' : 'false',
          onClick: function () {
            if (typeof props.onCite === 'function') props.onCite(item.chunkId)
          },
        },
        h(
          'span',
          { className: 'rl-detail__cite-top' },
          h('span', { className: 'rl-detail__cite-id' }, item.chunkId),
          h('span', { className: 'rl-detail__cite-meta' }, meta || t('detail.citation.local')),
        ),
        h(
          'span',
          { className: 'rl-detail__cite-text' },
          detailSnippet(item.chunk && item.chunk.text, 88) || item.quote || t('detail.citation.empty'),
        ),
      ),
    )
  })

  var questionList = (Array.isArray(node.questions) ? node.questions : []).map(function (question, index) {
    return h('li', { key: 'q' + index, className: 'rl-detail__question' }, question)
  })

  var source = null
  if (active) {
    source = h(
      'section',
      { className: 'rl-detail__source', role: 'region', 'aria-label': t('detail.source.title') },
      h(
        'div',
        { className: 'rl-detail__source-head' },
        h('p', { className: 'rl-detail__source-title' }, t('detail.source.title')),
        h('span', { className: 'rl-detail__cite-id' }, active.chunkId),
        h('span', { className: 'rl-detail__source-meta' }, [detailChapterLabel(active.chunk), detailPageLabel(active.chunk)].filter(Boolean).join(' · ')),
        active.chunk && Number.isFinite(active.chunk.chars)
          ? h('span', { className: 'rl-detail__source-meta' }, t('detail.source.chars', { count: active.chunk.chars }))
          : null,
        h('span', { className: 'rl-detail__grow' }),
        h(
          'button',
          {
            type: 'button',
            className: 'rl-detail__btn',
            'aria-label': t('detail.source.copy'),
            onClick: function () {
              if (typeof props.onCopy === 'function') props.onCopy(active.chunk ? active.chunk.text : '', 'source')
            },
          },
          t('detail.source.copy'),
        ),
      ),
      h(
        'div',
        {
          id: 'rl-detail-chunk-' + active.chunkId,
          className: 'rl-detail__chunk' + (flash ? ' rl-detail__chunk--flash' : ''),
        },
        active.chunk && active.chunk.text ? active.chunk.text : t('detail.citation.empty'),
      ),
      flash ? h('div', { className: 'rl-detail__flash-note' }, t('detail.source.highlight')) : null,
    )
  }

  return h(
    'aside',
    {
      className: 'rl-detail rl-detail--card',
      role: 'complementary',
      'aria-label': t('detail.panel.label'),
      'data-node-id': node.id,
      tabIndex: -1,
      ref: function (element) {
        rootRef.current = element
      },
      onKeyDown: function (event) {
        if (event && event.key === 'Escape' && typeof props.onClose === 'function') {
          event.stopPropagation()
          props.onClose()
        }
      },
    },
    h('style', { dangerouslySetInnerHTML: { __html: DETAIL_STYLES.join('\n') } }),
    h(
      'div',
      { className: 'rl-detail__head' },
      h(
        'div',
        { className: 'rl-detail__heading' },
        h(
          'div',
          { className: 'rl-detail__crumb' },
          h('span', { className: 'rl-detail__dot', style: { background: 'var(' + dotToken + ')' } }),
          h('span', null, breadcrumb),
        ),
        h('h2', { className: 'rl-detail__title', title: node.title }, node.title),
      ),
      h(
        'button',
        { type: 'button', className: 'rl-detail__close', 'aria-label': t('detail.close'), onClick: props.onClose },
        h(
          'svg',
          { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
          h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
        ),
      ),
    ),
    h(
      'div',
      { className: 'rl-detail__body' },
      h('p', { className: 'rl-detail__summary' }, summary || t('detail.summary.empty')),
      h(
        'section',
        { className: 'rl-detail__section', 'aria-label': t('detail.citations.title') },
        h(
          'h3',
          { className: 'rl-detail__section-title' },
          t('detail.citations.title'),
          h('span', { className: 'rl-detail__count' }, t('detail.citations.count', { count: valid.length })),
        ),
        citationsStatus === 'loading'
          ? h('div', { className: 'rl-detail__muted' }, t('detail.citations.loading'))
          : null,
        citationsStatus === 'error'
          ? h('div', { className: 'rl-detail__invalid' }, t('detail.citations.error'))
          : null,
        citeList.length > 0 ? h('ul', { className: 'rl-detail__cites' }, citeList) : null,
        citationsStatus === 'ready' && valid.length === 0
          ? h('div', { className: 'rl-detail__muted' }, t('detail.citations.empty'))
          : null,
        invalid.map(function (item) {
          return h(
            'div',
            { key: 'bad-' + item.chunkId, className: 'rl-detail__invalid', 'data-invalid-citation': item.chunkId },
            t('detail.citation.invalid') + ' · ' + item.chunkId,
          )
        }),
      ),
      questionList.length > 0
        ? h(
            'section',
            { className: 'rl-detail__section', 'aria-label': t('detail.questions.title') },
            h('h3', { className: 'rl-detail__section-title' }, t('detail.questions.title')),
            h('ul', { className: 'rl-detail__questions' }, questionList),
          )
        : null,
      source,
      time ? h('div', { className: 'rl-detail__muted rl-detail__updated' }, t('detail.updated', { time: time })) : null,
    ),
    h(
      'div',
      { className: 'rl-detail__toolbar' },
      h(
        'button',
        {
          type: 'button',
          className: 'rl-detail__btn',
          onClick: function () {
            if (typeof props.onCopy === 'function') props.onCopy(summary, 'body')
          },
        },
        t('detail.toolbar.copy'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-detail__btn',
          onClick: function () {
            var refs = citations
              .map(function (item) {
                var text = item.chunk && item.chunk.text ? item.chunk.text : item.quote || ''
                return '[' + item.chunkId + '] ' + text
              })
              .join('\n')
            if (typeof props.onCopy === 'function') props.onCopy(refs, 'refs')
          },
        },
        t('detail.toolbar.copyRefs'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-detail__btn rl-detail__btn--primary',
          onClick: props.onAsk,
          disabled: typeof props.onAsk !== 'function',
        },
        t('detail.toolbar.ask'),
      ),
      h('span', { className: 'rl-detail__grow' }),
      copied ? h('span', { className: 'rl-detail__copied', role: 'status' }, t('detail.copied')) : null,
      h(
        'button',
        { type: 'button', className: 'rl-detail__btn', onClick: props.onClose },
        t('detail.close'),
      ),
    ),
    props.children,
  )
}

VIEWS.Detail = function Detail(props) {
  var state = props.state || {}
  var actions = props.actions || {}
  var book = detailBookOf(state)
  var nodeId = state.selectedNodeId || null
  var mapPair = React.useState({ status: 'idle', doc: null, node: null, bookId: null })
  var mapState = mapPair[0]
  var setMapState = mapPair[1]
  var citePair = React.useState({ status: 'ready', items: [], nodeId: null })
  var citeState = citePair[0]
  var setCiteState = citePair[1]
  var activePair = React.useState(null)
  var activeCitation = activePair[0]
  var setActiveCitation = activePair[1]
  var flashPair = React.useState(false)
  var flash = flashPair[0]
  var setFlash = flashPair[1]
  var copyPair = React.useState('')
  var copied = copyPair[0]
  var setCopied = copyPair[1]

  React.useEffect(
    function () {
      if (!book || !nodeId) {
        setMapState({ status: 'idle', doc: null, node: null, bookId: null })
        return
      }
      var cancelled = false
      setMapState({ status: 'loading', doc: null, node: null, bookId: book.id })
      loadCanvasMap(book).then(function (result) {
        if (cancelled) return
        var node = null
        if (result.status === 'ready' && result.doc) {
          var index = SVG.indexMap(result.doc)
          node = index.nodes[nodeId] || null
        }
        setMapState({
          status: result.status === 'ready' && node ? 'ready' : result.status === 'ready' ? 'missing-node' : result.status,
          doc: result.doc || null,
          node: node,
          bookId: book.id,
          error: result.error || null,
        })
      })
      return function () {
        cancelled = true
      }
    },
    [book ? book.id : '', nodeId],
  )

  React.useEffect(
    function () {
      if (mapState.status !== 'ready' || !mapState.node || !book) return
      var cancelled = false
      setCiteState({ status: 'loading', items: [], nodeId: mapState.node.id })
      detailLoadCitations(book.id, mapState.node.citations).then(function (result) {
        if (cancelled) return
        setCiteState({ status: result.status, items: result.items, nodeId: mapState.node.id })
      })
      return function () {
        cancelled = true
      }
    },
    [mapState.status, mapState.node, book ? book.id : ''],
  )

  React.useEffect(
    function () {
      setActiveCitation(null)
      setFlash(false)
    },
    [nodeId],
  )

  React.useEffect(
    function () {
      if (!activeCitation) {
        setFlash(false)
        return
      }
      setFlash(true)
      var timer = setTimeout(function () {
        setFlash(false)
      }, DETAIL_FLASH_MS)
      if (typeof document !== 'undefined' && document.getElementById) {
        var element = document.getElementById('rl-detail-chunk-' + activeCitation)
        if (element && typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
      }
      return function () {
        clearTimeout(timer)
      }
    },
    [activeCitation],
  )

  function close() {
    if (typeof actions.openDetail === 'function') actions.openDetail(null)
  }

  function copy(text, kind) {
    if (!text) return
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(function () {
          setCopied(kind)
        })
      } else {
        setCopied(kind)
      }
    } catch (error) {
      setCopied('')
    }
    setTimeout(function () {
      setCopied('')
    }, 1500)
  }

  if (!nodeId) {
    return h(
      'aside',
      { className: 'rl-detail rl-detail--card rl-detail--empty', 'aria-label': t('detail.panel.label') },
      h('style', { dangerouslySetInnerHTML: { __html: DETAIL_STYLES.join('\n') } }),
      h(
        'div',
        { className: 'rl-empty' },
        h('div', { className: 'rl-empty__title' }, t('detail.empty.title')),
        h('div', { className: 'rl-empty__hint' }, t('detail.empty.hint')),
      ),
    )
  }

  if (mapState.status === 'loading' || mapState.status === 'idle') {
    return h(
      'aside',
      { className: 'rl-detail rl-detail--card', 'aria-busy': 'true', 'aria-label': t('detail.panel.label') },
      h('style', { dangerouslySetInnerHTML: { __html: DETAIL_STYLES.join('\n') } }),
      h(
        'div',
        { className: 'rl-empty' },
        h('div', { className: 'rl-empty__title' }, t('detail.loading.title')),
        h('div', { className: 'rl-empty__hint' }, t('detail.loading.hint')),
      ),
    )
  }

  if (mapState.status !== 'ready' || !mapState.node) {
    return h(
      'aside',
      { className: 'rl-detail rl-detail--card', 'aria-label': t('detail.panel.label') },
      h('style', { dangerouslySetInnerHTML: { __html: DETAIL_STYLES.join('\n') } }),
      h(
        'div',
        { className: 'rl-empty' },
        h('div', { className: 'rl-empty__title' }, t('detail.error.title')),
        h('div', { className: 'rl-empty__hint' }, t('detail.error.hint')),
        h('button', { type: 'button', className: 'rl-btn', onClick: close }, t('detail.close')),
      ),
    )
  }

  var path = detailPathOf(mapState.doc, mapState.node.id)
  return h(VIEWS.DetailCard, {
    node: mapState.node,
    book: book,
    doc: mapState.doc,
    path: path,
    citations: citeState.nodeId === mapState.node.id ? citeState.items : [],
    citationsStatus:
      citeState.nodeId === mapState.node.id ? citeState.status : 'loading',
    activeCitation: activeCitation,
    flash: flash,
    copied: copied,
    onCite: function (chunkId) {
      setActiveCitation(function (current) {
        return current === chunkId ? null : chunkId
      })
    },
    onCopy: copy,
    onAsk:
      typeof actions.toggleAsk === 'function'
        ? function () {
            actions.toggleAsk()
          }
        : undefined,
    onClose: close,
  })
}