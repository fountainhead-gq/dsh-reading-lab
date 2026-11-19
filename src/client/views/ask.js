/* 询问 AI 浮层（owner: ask-ui，03 §4.1 宽 min(420px, 40%)，契约 03 §8 / 04 §4.2 #17-26）。
 *
 * 结构：标题（书 · 节点）→ 快捷指令 → 线程消息 → 追问建议 → 输入区。
 * 数据：GET /threads 拿线程；POST /ask 只入队（202），回答由 SSE `thread` 事件触发重载。
 * 失败可见：消息 status='failed' + error 码、线程回到 idle、浮层顶部报可读原因。
 */

var ASK_QUICK = [
  { id: 'deep', label: 'ask.quick.deep', question: 'ask.quick.deep.prompt' },
  { id: 'explain', label: 'ask.quick.explain', question: 'ask.quick.explain.prompt' },
  { id: 'simplify', label: 'ask.quick.simplify', question: 'ask.quick.simplify.prompt' },
  { id: 'example', label: 'ask.quick.example', question: 'ask.quick.example.prompt' },
  { id: 'tutor', label: 'ask.quick.tutor', question: 'ask.quick.tutor.prompt' },
]

function askTime(value) {
  if (!value) return ''
  var date = new Date(value)
  if (isNaN(date.getTime())) return ''
  var pad = function (n) {
    return n < 10 ? '0' + n : String(n)
  }
  return pad(date.getHours()) + ':' + pad(date.getMinutes())
}

/** 线程里属于某个节点的最新一条；没有节点时取整书线程。 */
function askThreadFor(file, nodeId) {
  if (!file || !Array.isArray(file.threads)) return null
  var wantNode = nodeId || null
  var matched = file.threads.filter(function (thread) {
    var scope = thread.scope || {}
    if (wantNode) return scope.kind === 'node' && scope.nodeId === wantNode
    return scope.kind === 'book'
  })
  return matched.length > 0 ? matched[matched.length - 1] : null
}

function askStatusLabel(message) {
  if (!message) return ''
  if (message.status === 'failed') return t('ask.status.failed')
  if (message.status === 'stopped') return t('ask.status.stopped')
  if (message.status === 'pending' || message.status === 'streaming') return t('ask.status.pending')
  return ''
}

function askCitations(message) {
  var list = message && Array.isArray(message.citations) ? message.citations : []
  return list
    .map(function (cite) {
      return cite && typeof cite.chunkId === 'string' ? cite.chunkId : null
    })
    .filter(function (id) {
      return id !== null
    })
}

function askParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .filter(function (part) {
      return part.trim().length > 0
    })
}

VIEWS.Ask = function Ask(props) {
  var state = props.state
  var actions = props.actions
  var bookId = state.selectedBookId || null
  var nodeId = state.selectedNodeId || null

  var threadsPair = React.useState({ status: 'idle', file: null, error: null })
  var mapPair = React.useState({ status: 'idle', doc: null })
  var agentsPair = React.useState({ status: 'idle', agents: [] })
  var draftPair = React.useState('')
  var sendingPair = React.useState(false)
  var errorPair = React.useState('')
  var tickPair = React.useState(0)
  var busyPair = React.useState('')

  var threads = threadsPair[0]
  var setThreads = threadsPair[1]
  var map = mapPair[0]
  var setMap = mapPair[1]
  var agents = agentsPair[0]
  var setAgents = agentsPair[1]
  var draft = draftPair[0]
  var setDraft = draftPair[1]
  var sending = sendingPair[0]
  var setSending = sendingPair[1]
  var error = errorPair[0]
  var setError = errorPair[1]
  var tick = tickPair[0]
  var bump = tickPair[1]
  var busy = busyPair[0]
  var setBusy = busyPair[1]

  var revision = state.threadRevision || 0

  React.useEffect(
    function () {
      if (!bookId) {
        setThreads({ status: 'idle', file: null, error: null })
        return function () {}
      }
      var alive = true
      setThreads(function (prev) {
        return { status: prev.file ? 'ready' : 'loading', file: prev.file, error: null }
      })
      api
        .listThreads(bookId)
        .then(function (file) {
          if (alive) setThreads({ status: 'ready', file: file, error: null })
        })
        .catch(function (cause) {
          if (alive) setThreads({ status: 'error', file: null, error: cause })
        })
      return function () {
        alive = false
      }
    },
    [bookId, revision, tick],
  )

  React.useEffect(
    function () {
      if (!bookId) return function () {}
      var alive = true
      api
        .listAgents()
        .then(function (data) {
          if (alive) setAgents({ status: 'ready', agents: (data && data.agents) || [] })
        })
        .catch(function () {
          if (alive) setAgents({ status: 'error', agents: [] })
        })
      return function () {
        alive = false
      }
    },
    [bookId, tick],
  )

  React.useEffect(
    function () {
      if (!bookId) {
        setMap({ status: 'idle', doc: null })
        return function () {}
      }
      var alive = true
      var book = { id: bookId, mapUpdatedAt: null, updatedAt: null }
      var cached = null
      for (var i = 0; i < (state.books || []).length; i += 1) {
        if (state.books[i] && state.books[i].id === bookId) cached = state.books[i]
      }
      if (cached) book = cached
      Promise.resolve(loadCanvasMap(book))
        .then(function (result) {
          if (!alive) return
          setMap({ status: result.status, doc: result.doc || null })
        })
        .catch(function () {
          if (alive) setMap({ status: 'error', doc: null })
        })
      return function () {
        alive = false
      }
    },
    [bookId, tick],
  )

  var index = map.doc ? SVG.indexMap(map.doc) : null
  // indexMap 返回 {nodes:{id:node}}（svg.js），不是 byId；用错会在有图的书上直接抛错。
  var node = index && nodeId ? index.nodes[nodeId] || null : null
  var questions = node && Array.isArray(node.questions) ? node.questions : []
  var thread = askThreadFor(threads.file, nodeId)
  var running = Boolean(thread && thread.state === 'running') || sending
  var hasAgent = agents.agents.length > 0
  var canSend = Boolean(bookId) && hasAgent && !running

  function reload() {
    bump(function (value) {
      return value + 1
    })
  }

  function send(question) {
    var text = String(question == null ? draft : question).trim()
    if (!text || !bookId || running) return
    setSending(true)
    setError('')
    var targetThread = thread
    var prepare =
      targetThread !== null
        ? Promise.resolve(targetThread)
        : api.createThread(bookId, nodeId ? { kind: 'node', nodeId: nodeId } : { kind: 'book' })
    prepare
      .then(function (created) {
        return api.ask(bookId, {
          question: text,
          threadId: created.id,
          nodeId: nodeId,
          idempotencyKey: 'rl-' + created.id + '-' + Date.now().toString(36),
        })
      })
      .then(function () {
        setDraft('')
        reload()
      })
      .catch(function (cause) {
        setError(cause && cause.message ? cause.message : t('ask.error.send'))
      })
      .then(function () {
        setSending(false)
      })
  }

  function stop() {
    if (!bookId || !thread) return
    setBusy(thread.id)
    api
      .stopThread(bookId, thread.id)
      .then(function () {
        reload()
      })
      .catch(function (cause) {
        setError(cause && cause.message ? cause.message : t('ask.error.stop'))
      })
      .then(function () {
        setBusy('')
      })
  }

  function feedback(messageId, value) {
    if (!bookId || !thread || !messageId) return
    setBusy(messageId)
    api
      .sendFeedback(bookId, thread.id, messageId, value)
      .then(function () {
        reload()
      })
      .catch(function (cause) {
        setError(cause && cause.message ? cause.message : t('ask.error.feedback'))
      })
      .then(function () {
        setBusy('')
      })
  }

  var messages = thread && Array.isArray(thread.messages) ? thread.messages : []

  var head = h(
    'div',
    { className: 'rl-ask__head' },
    h('span', { className: 'rl-header__title' }, t('ask.title')),
    bookId
      ? h(
          'span',
          { className: 'rl-ask__scope', title: node ? node.title : t('ask.scope.book') },
          node ? node.title : t('ask.scope.book'),
        )
      : null,
    h('span', { className: 'rl-header__spacer' }),
    h(
      'button',
      { type: 'button', className: 'rl-btn rl-btn--ghost', onClick: actions.closeAsk, 'aria-label': t('action.close') },
      t('action.close'),
    ),
  )

  if (!bookId) {
    return h(
      'aside',
      { className: 'rl-ask', role: 'dialog', 'aria-modal': 'false', 'aria-label': t('ask.title') },
      head,
      h(
        'div',
        { className: 'rl-ask__body' },
        h('div', { className: 'rl-empty__title' }, t('ask.disabled')),
        h('div', { className: 'rl-empty__hint' }, t('ask.disabled.hint')),
      ),
    )
  }

  var quick = h(
    'div',
    { className: 'rl-ask__quick', role: 'group', 'aria-label': t('ask.quick.title') },
    ASK_QUICK.map(function (item) {
      return h(
        'button',
        {
          key: item.id,
          type: 'button',
          className: 'rl-chip rl-ask__quick-btn',
          disabled: !canSend,
          'data-quick': item.id,
          onClick: function () {
            send(t(item.question))
          },
        },
        t(item.label),
      )
    }),
  )

  var bodyChildren = []
  if (error) {
    bodyChildren.push(
      h(
        'div',
        { className: 'rl-ask__error', role: 'alert' },
        error,
      ),
    )
  }
  if (!hasAgent && agents.status === 'ready') {
    bodyChildren.push(h('div', { className: 'rl-ask__notice' }, t('ask.noAgent')))
  }
  if (threads.status === 'loading' && messages.length === 0) {
    bodyChildren.push(h('div', { className: 'rl-ask__hint' }, t('state.loading')))
  }
  if (messages.length === 0 && threads.status !== 'loading') {
    bodyChildren.push(
      h(
        'div',
        { className: 'rl-empty' },
        h('div', { className: 'rl-empty__title' }, t('ask.empty')),
        h('div', { className: 'rl-empty__hint' }, t('ask.empty.hint')),
      ),
    )
  }

  messages.forEach(function (message) {
    var isUser = message.role === 'user'
    var cites = askCitations(message)
    var status = askStatusLabel(message)
    bodyChildren.push(
      h(
        'article',
        {
          key: message.id,
          className: 'rl-ask__msg' + (isUser ? ' rl-ask__msg--user' : ' rl-ask__msg--assistant'),
          'data-role': message.role,
          'data-status': message.status || 'done',
        },
        h(
          'div',
          { className: 'rl-ask__msg-head' },
          h('span', { className: 'rl-ask__msg-role' }, isUser ? t('ask.role.user') : t('ask.role.assistant')),
          h('span', { className: 'rl-ask__msg-time' }, askTime(message.createdAt)),
          status ? h('span', { className: 'rl-ask__msg-status' }, status) : null,
        ),
        askParagraphs(message.text).map(function (paragraph, i) {
          return h('p', { key: 'p-' + i, className: 'rl-ask__msg-text' }, paragraph)
        }),
        cites.length > 0
          ? h(
              'div',
              { className: 'rl-ask__cites' },
              cites.map(function (chunkId) {
                return h(
                  'span',
                  { key: chunkId, className: 'rl-cite', title: t('ask.cite.title') },
                  '[' + chunkId + ']',
                )
              }),
            )
          : null,
        message.error
          ? h('div', { className: 'rl-ask__msg-error' }, t('error.' + message.error))
          : null,
        !isUser && message.status === 'done' && message.id
          ? h(
              'div',
              { className: 'rl-ask__feedback' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'rl-icon-btn',
                  'aria-pressed': message.feedback === 'up' ? 'true' : 'false',
                  'aria-label': t('ask.feedback.up'),
                  disabled: busy === message.id,
                  'data-feedback': 'up',
                  onClick: function () {
                    feedback(message.id, message.feedback === 'up' ? null : 'up')
                  },
                },
                '👍',
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'rl-icon-btn',
                  'aria-pressed': message.feedback === 'down' ? 'true' : 'false',
                  'aria-label': t('ask.feedback.down'),
                  disabled: busy === message.id,
                  'data-feedback': 'down',
                  onClick: function () {
                    feedback(message.id, message.feedback === 'down' ? null : 'down')
                  },
                },
                '👎',
              ),
            )
          : null,
      ),
    )
  })

  if (questions.length > 0 && messages.length > 0) {
    bodyChildren.push(
      h(
        'div',
        { className: 'rl-ask__followups' },
        h('div', { className: 'rl-ask__followups-title' }, t('ask.followups')),
        questions.slice(0, 3).map(function (question, i) {
          return h(
            'button',
            {
              key: 'q-' + i,
              type: 'button',
              className: 'rl-chip rl-ask__followup',
              disabled: !canSend,
              onClick: function () {
                send(question)
              },
            },
            question,
          )
        }),
      ),
    )
  }

  var foot = h(
    'div',
    { className: 'rl-ask__foot' },
    h('input', {
      className: 'rl-input',
      type: 'text',
      value: draft,
      placeholder: t('ask.placeholder'),
      'aria-label': t('ask.placeholder'),
      maxlength: 2000,
      disabled: !hasAgent,
      onInput: function (event) {
        setDraft(event.target.value)
      },
      onKeyDown: function (event) {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          send()
        }
      },
    }),
    running
      ? h(
          'button',
          {
            type: 'button',
            className: 'rl-btn',
            disabled: Boolean(busy),
            onClick: stop,
            'aria-label': t('ask.stop'),
          },
          busy ? t('state.loading') : t('ask.stop'),
        )
      : h(
          'button',
          {
            type: 'button',
            className: 'rl-btn rl-btn--primary',
            disabled: !canSend || draft.trim().length === 0,
            onClick: function () {
              send()
            },
          },
          t('ask.send'),
        ),
  )

  return h(
    'aside',
    { className: 'rl-ask', role: 'dialog', 'aria-modal': 'false', 'aria-label': t('ask.title') },
    head,
    quick,
    h('div', { className: 'rl-ask__body' }, bodyChildren),
    foot,
  )
}