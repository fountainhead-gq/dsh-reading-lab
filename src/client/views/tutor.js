/* 引导式学习浮层（04 §5.7，v0.3 t20）：按导图逐卡推进，记录掌握与进度。 */

var TUTOR_GOALS = ['explain', 'quiz', 'socratic']
var TUTOR_MARK_LABELS = {
  mastered: 'tutor.mark.mastered',
  skipped: 'tutor.mark.skipped',
}

function tutorStepIndex(data, override) {
  var steps = data && Array.isArray(data.steps) ? data.steps : []
  if (steps.length === 0) return 0
  var raw = typeof override === 'number' ? override : (data.cursor || 0)
  return Math.max(0, Math.min(raw, steps.length - 1))
}

function tutorMessages(threads, step) {
  if (!step || !step.threadId || !threads) return []
  var found = (threads.threads || []).filter(function (thread) {
    return thread.id === step.threadId
  })[0]
  return found && Array.isArray(found.messages) ? found.messages : []
}

function tutorParagraphs(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map(function (chunk) {
      return chunk.trim()
    })
    .filter(function (chunk) {
      return chunk.length > 0
    })
}

VIEWS.Tutor = function Tutor(props) {
  var state = props.state
  var actions = props.actions
  var bookId = state.selectedBookId
  var revision = state.tutorRevision || 0

  var fileState = React.useState(null)
  var file = fileState[0]
  var setFile = fileState[1]
  var threadsState = React.useState(null)
  var threads = threadsState[0]
  var setThreads = threadsState[1]
  var agentsState = React.useState([])
  var agents = agentsState[0]
  var setAgents = agentsState[1]
  var indexState = React.useState(null)
  var indexOverride = indexState[0]
  var setIndex = indexState[1]
  var draftState = React.useState('')
  var draft = draftState[0]
  var setDraft = draftState[1]
  var busyState = React.useState(false)
  var busy = busyState[0]
  var setBusy = busyState[1]
  var errorState = React.useState(null)
  var error = errorState[0]
  var setError = errorState[1]
  var tickState = React.useState(0)
  var tick = tickState[0]
  var setTick = tickState[1]

  React.useEffect(
    function () {
      if (!bookId) {
        setFile(null)
        return
      }
      var cancelled = false
      api.getTutor(bookId).then(
        function (data) {
          if (cancelled) return
          setFile({ status: 'ready', data: data })
          setError(null)
        },
        function (cause) {
          if (cancelled) return
          if (cause && (cause.code === 'E_NOT_FOUND' || cause.status === 404)) {
            setFile({ status: 'missing', error: cause })
          } else {
            setFile({ status: 'error', error: cause })
            setError(cause && cause.code ? cause.code : 'E_UNKNOWN')
          }
        },
      )
      api.listThreads(bookId).then(
        function (data) {
          if (!cancelled) setThreads(data)
        },
        function () {
          if (!cancelled) setThreads(null)
        },
      )
      api.listAgents().then(
        function (data) {
          if (!cancelled) setAgents((data && data.agents) || [])
        },
        function () {
          if (!cancelled) setAgents([])
        },
      )
      return function () {
        cancelled = true
      }
    },
    [bookId, revision, tick],
  )

  function bump() {
    setTick(function (value) {
      return value + 1
    })
    actions.bumpTutor && actions.bumpTutor()
  }

  function mark(step, next) {
    if (!step || busy) return
    setBusy(true)
    setError(null)
    api.markTutorStep(bookId, step.id, next).then(
      function (result) {
        setBusy(false)
        setFile({ status: 'ready', data: result })
        setIndex(result.cursor || 0)
        bump()
      },
      function (cause) {
        setBusy(false)
        setError(cause && cause.code ? cause.code : 'E_UNKNOWN')
      },
    )
  }

  function restart(goal) {
    if (busy) return
    setBusy(true)
    setError(null)
    api.createTutorPath(bookId, goal).then(
      function (result) {
        setBusy(false)
        setFile({ status: 'ready', data: result })
        setIndex(0)
        bump()
      },
      function (cause) {
        setBusy(false)
        setError(cause && cause.code ? cause.code : 'E_UNKNOWN')
      },
    )
  }

  function send() {
    var question = draft.trim()
    if (!question || busy || agents.length === 0 || !step) return
    setBusy(true)
    setError(null)
    api
      .answerTutorStep(bookId, step.id, {
        question: question,
        agentId: agents[0] && agents[0].id ? agents[0].id : null,
        idempotencyKey: 'rl-tutor-' + step.id + '-' + Date.now().toString(36),
      })
      .then(
        function () {
          setBusy(false)
          setDraft('')
          bump()
        },
        function (cause) {
          setBusy(false)
          setError(cause && cause.code ? cause.code : 'E_UNKNOWN')
        },
      )
  }

  var data = file && file.status === 'ready' ? file.data : null
  var steps = data && Array.isArray(data.steps) ? data.steps : []
  var index = tutorStepIndex(data, indexOverride)
  var step = steps[index] || null
  var progress = (data && data.progress) || { total: 0, done: 0, percent: 0 }
  var messages = tutorMessages(threads, step)
  var canAnswer = Boolean(step) && agents.length > 0 && !busy

  var header = h(
    'header',
    { className: 'rl-tutor__head' },
    h('h2', { className: 'rl-tutor__title' }, t('tutor.title')),
    data && data.pathId
      ? h('span', { className: 'rl-tutor__path', 'data-path-id': data.pathId }, t('tutor.path', { id: data.pathId }))
      : null,
    h(
      'button',
      {
        type: 'button',
        className: 'rl-btn rl-btn--ghost rl-tutor__close',
        onClick: actions.closeTutor,
        'aria-label': t('tutor.close'),
      },
      t('tutor.close'),
    ),
  )

  var progressBar = h(
    'div',
    { className: 'rl-tutor__progress', role: 'group', 'aria-label': t('tutor.progress.label') },
    h(
      'div',
      { className: 'rl-tutor__bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(progress.percent || 0) },
      h('span', { className: 'rl-tutor__bar-fill', style: { width: (progress.percent || 0) + '%' } }),
    ),
    h(
      'span',
      { className: 'rl-tutor__progress-text' },
      t('tutor.progress', {
        done: progress.done || 0,
        total: progress.total || 0,
        percent: progress.percent || 0,
      }),
    ),
  )

  var body
  if (!bookId) {
    body = h('div', { className: 'rl-tutor__empty' }, t('tutor.disabled'))
  } else if (!file) {
    body = h('div', { className: 'rl-tutor__empty', role: 'status' }, t('state.loading'))
  } else if (file.status === 'missing') {
    body = h('div', { className: 'rl-tutor__empty', role: 'status' }, t('tutor.empty.noMap'))
  } else if (file.status === 'error') {
    body = h(
      'div',
      { className: 'rl-tutor__empty rl-tutor__empty--error', role: 'alert' },
      t('error.' + ((file.error && file.error.code) || 'E_UNKNOWN')),
    )
  } else if (steps.length === 0) {
    body = h('div', { className: 'rl-tutor__empty', role: 'status' }, t('tutor.empty.noSteps'))
  } else {
    body = h(
      'div',
      { className: 'rl-tutor__body' },
      h(
        'section',
        { className: 'rl-tutor__step', 'data-step-id': step.id, 'data-step-state': step.state },
        h('span', { className: 'rl-tutor__step-index' }, t('tutor.step.label', { index: index + 1, total: steps.length })),
        h('h3', { className: 'rl-tutor__step-title' }, step.title),
        h('p', { className: 'rl-tutor__step-summary' }, step.summary),
        h('p', { className: 'rl-tutor__question' }, t('tutor.step.question') + ' ' + step.question),
        step.hint ? h('p', { className: 'rl-tutor__hint' }, t('tutor.step.hint') + ' ' + step.hint) : null,
        h(
          'p',
          { className: 'rl-tutor__cites' },
          (step.citations || []).map(function (chunkId) {
            return h('span', { key: chunkId, className: 'rl-cite rl-cite--static' }, '[' + chunkId + ']')
          }),
        ),
        step.state !== 'pending'
          ? h('p', { className: 'rl-tutor__state' }, t('tutor.step.state.' + step.state))
          : null,
      ),
      messages.length > 0
        ? h(
            'ul',
            { className: 'rl-tutor__answers' },
            messages.map(function (message) {
              return h(
                'li',
                { key: message.id, className: 'rl-tutor__answer', 'data-role': message.role },
                h(
                  'span',
                  { className: 'rl-tutor__answer-meta' },
                  t('ask.role.' + message.role) + ' · ' + (message.status || 'done'),
                ),
                tutorParagraphs(message.text).map(function (paragraph, paraIndex) {
                  return h('p', { key: paraIndex, className: 'rl-tutor__answer-text' }, paragraph)
                }),
              )
            }),
          )
        : null,
      h(
        'div',
        { className: 'rl-tutor__actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'rl-btn rl-btn--ghost',
            'data-tutor-prev': '',
            disabled: index === 0 || busy,
            onClick: function () {
              setIndex(Math.max(0, index - 1))
            },
          },
          t('tutor.prev'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'rl-btn rl-btn--primary',
            'data-tutor-mark': 'mastered',
            disabled: busy,
            onClick: function () {
              mark(step, 'mastered')
            },
          },
          t('tutor.mark.mastered'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'rl-btn rl-btn--ghost',
            'data-tutor-mark': 'skipped',
            disabled: busy,
            onClick: function () {
              mark(step, 'skipped')
            },
          },
          t('tutor.mark.skipped'),
        ),
        h(
          'button',
          {
            type: 'button',
            className: 'rl-btn rl-btn--ghost',
            'data-tutor-next': '',
            disabled: index >= steps.length - 1,
            onClick: function () {
              setIndex(Math.min(steps.length - 1, index + 1))
            },
          },
          t('tutor.next'),
        ),
      ),
    )
  }

  var restartRow = data
    ? h(
        'div',
        { className: 'rl-tutor__restart' },
        h('span', { className: 'rl-tutor__restart-label' }, t('tutor.restart.label')),
        TUTOR_GOALS.map(function (goal) {
          return h(
            'button',
            {
              key: goal,
              type: 'button',
              className: 'rl-chip' + (data.goal === goal ? ' rl-chip--active' : ''),
              'data-tutor-goal': goal,
              disabled: busy,
              onClick: function () {
                restart(goal)
              },
            },
            t('tutor.goal.' + goal),
          )
        }),
      )
    : null

  var footer = h(
    'footer',
    { className: 'rl-tutor__foot' },
    h('input', {
      className: 'rl-input',
      type: 'text',
      value: draft,
      maxlength: 2000,
      placeholder: t('tutor.answer.placeholder'),
      disabled: !canAnswer,
      onInput: function (event) {
        setDraft(event.target.value)
      },
      onKeyDown: function (event) {
        if (event.key === 'Enter') {
          event.preventDefault()
          send()
        }
      },
    }),
    h(
      'button',
      {
        type: 'button',
        className: 'rl-btn rl-btn--primary',
        'data-tutor-send': '',
        disabled: !canAnswer || draft.trim().length === 0,
        onClick: send,
      },
      busy ? t('tutor.answer.busy') : t('tutor.answer.send'),
    ),
    agents.length === 0 ? h('span', { className: 'rl-tutor__notice' }, t('ask.noAgent')) : null,
    error ? h('span', { className: 'rl-tutor__error', role: 'alert' }, t('error.' + error)) : null,
  )

  return h(
    'aside',
    {
      className: 'rl-tutor',
      role: 'dialog',
      'aria-modal': 'true',
      tabIndex: -1,
      onKeyDown: function (event) {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          actions.closeTutor()
        } else if (event.key === 'Tab') {
          trapTabKey(event)
        }
      },
    },
    header,
    progressBar,
    body,
    restartRow,
    footer,
  )
}