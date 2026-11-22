/* Host API 客户端（03 §2.3：views 禁止直接 fetch，只经由这里）。 */

function ApiError(code, message, details, status) {
  var error = new Error(message || code)
  error.name = 'ApiError'
  error.code = code || 'E_UNKNOWN'
  error.details = details
  error.status = status || 0
  return error
}

function readJsonSafe(response) {
  return response
    .json()
    .catch(function () {
      return null
    })
}

function envelopeData(body, response) {
  if (body && body.ok === true) return body.data
  var wire = body && body.error ? body.error : null
  var code = wire && typeof wire.code === 'string' ? wire.code : response.status === 401 ? 'E_BAD_REQUEST' : 'E_UNKNOWN'
  var message = wire && typeof wire.message === 'string' ? wire.message : t('error.' + code)
  throw ApiError(code, message, wire ? wire.details : undefined, response.status)
}

async function request(path, options) {
  var init = Object.assign(
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    },
    options || {},
  )
  var response
  try {
    response = await fetch(API_BASE + path, init)
  } catch (cause) {
    throw ApiError('E_UNKNOWN', t('state.unavailable'), undefined, 0)
  }
  var body = await readJsonSafe(response)
  return envelopeData(body, response)
}

var api = {
  /** /health 在存储不可用时返回 503，但 body 里仍带 data，所以要单独处理。 */
  health: async function () {
    var response = await fetch(API_BASE + '/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    })
    var body = await readJsonSafe(response)
    if (body && body.data) return body.data
    if (body && body.error) {
      throw ApiError(body.error.code, body.error.message, body.error.details, response.status)
    }
    throw ApiError('E_UNKNOWN', t('state.unavailable'), undefined, response.status)
  },

  listBooks: function () {
    return request('/books')
  },

  // ---------------------------------------------------------------------
  // 存储位置（t33）：设置与书库根解耦，改完立即生效，不需要重启。
  // ---------------------------------------------------------------------

  getSettings: function () {
    return request('/settings')
  },

  /**
   * @param {{ path: string|null, moveExisting?: boolean }} input
   */
  setLibraryRoot: function (input) {
    return request('/settings/library-root', {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  },

  /**
   * R2：自选导出目录。`{ path: string|null }`，null 表示回到 `<书库>/exports`。
   * @param {{ path: string|null }} input
   */
  setExportRoot: function (input) {
    return request('/settings/export-root', {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  },

  /**
   * GUI 上传（04 §4.3）：raw body + `?name=`，不解析 multipart。
   * 返回 `{ duplicate, book }`；导入失败由 Host 给出可读错误码。
   * @param {{ name?: string, type?: string }} file
   */
  importBook: function (file) {
    var name = file && typeof file.name === 'string' ? file.name : 'upload.epub'
    return request('/books/import?name=' + encodeURIComponent(name), {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream' },
      body: file,
    })
  },

  /**
   * 研究笔记（只读）：无笔记时后端返回 `{updatedAt:null,sections:[]}`，不是 404。
   * @param {string} bookId
   */
  getNotes: function (bookId) {
    return request('/books/' + encodeURIComponent(bookId) + '/notes')
  },

  // ---------------------------------------------------------------------
  // 询问 AI（03 §8 / 04 §4.2 #17-21，#26 反馈）
  // ---------------------------------------------------------------------

  /** @param {string} bookId */
  listThreads: function (bookId) {
    return request('/books/' + encodeURIComponent(bookId) + '/threads')
  },

  /**
   * @param {string} bookId
   * @param {{ kind: 'node', nodeId: string } | { kind: 'book' }} scope
   */
  createThread: function (bookId, scope) {
    return request('/books/' + encodeURIComponent(bookId) + '/threads', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: scope }),
    })
  },

  /** @param {string} bookId @param {string} threadId */
  deleteThread: function (bookId, threadId) {
    return request(
      '/books/' + encodeURIComponent(bookId) + '/threads/' + encodeURIComponent(threadId),
      { method: 'DELETE' },
    )
  },

  /**
   * 提问：202 只表示入队，回答经 SSE `thread` 事件到达（03 §8.2）。
   * @param {string} bookId
   * @param {{ question: string, threadId?: string|null, nodeId?: string|null, agentId?: string|null, idempotencyKey?: string|null }} input
   */
  ask: function (bookId, input) {
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (input && input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey
    return request('/books/' + encodeURIComponent(bookId) + '/ask', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        question: input.question,
        threadId: input.threadId || undefined,
        nodeId: input.nodeId || undefined,
        agentId: input.agentId || undefined,
      }),
    })
  },

  /** @param {string} bookId @param {string} threadId */
  stopThread: function (bookId, threadId) {
    return request(
      '/books/' + encodeURIComponent(bookId) +
        '/threads/' + encodeURIComponent(threadId) +
        '/stop',
      { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' },
    )
  },

  /**
   * 👍/👎：`null` 表示取消（再点一次）。
   * @param {string} bookId @param {string} threadId @param {string} messageId
   * @param {'up'|'down'|null} feedback
   */
  sendFeedback: function (bookId, threadId, messageId, feedback) {
    return request(
      '/books/' + encodeURIComponent(bookId) +
        '/threads/' + encodeURIComponent(threadId) +
        '/messages/' + encodeURIComponent(messageId) +
        '/feedback',
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedback }),
      },
    )
  },

  /**
   * 生成导出文件（04 §4.2 #22）：md / opml / json，写 reading/exports/。
   * @param {string} bookId
   * @param {{ format?: 'md'|'opml'|'json', includeThreads?: boolean }} [options]
   */
  exportBook: function (bookId, options) {
    var input = options || {}
    return request('/books/' + encodeURIComponent(bookId) + '/export', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: input.format || 'md',
        includeThreads: Boolean(input.includeThreads),
      }),
    })
  },

  /** @param {string} bookId */
  listAgents: function () {
    return request('/agents')
  },

  // ---------------------------------------------------------------------
  // 引导式学习（04 §5.7 / §4.2 #27-30，v0.3 t20）
  // ---------------------------------------------------------------------

  /** 读学习路径；首次打开后端会自动建路径，无导图时 404 E_NOT_FOUND{reason:'no-map'}。 */
  getTutor: function (bookId) {
    return request('/books/' + encodeURIComponent(bookId) + '/tutor')
  },

  /**
   * 重新开始一条路径（可换问法）。
   * @param {string} bookId
   * @param {'explain'|'quiz'|'socratic'} [goal]
   */
  createTutorPath: function (bookId, goal) {
    return request('/books/' + encodeURIComponent(bookId) + '/tutor', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(goal ? { goal: goal } : {}),
    })
  },

  /**
   * 标记一步：已掌握 / 跳过 / 回到未完成。
   * @param {string} bookId @param {string} stepId
   * @param {'pending'|'answered'|'mastered'|'skipped'} state
   */
  markTutorStep: function (bookId, stepId, state) {
    return request(
      '/books/' + encodeURIComponent(bookId) + '/tutor/steps/' + encodeURIComponent(stepId),
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: state }),
      },
    )
  },

  /**
   * 就某一步提问：202 入队，回答经 SSE `thread` 事件回写（复用该节点的线程）。
   * @param {string} bookId @param {string} stepId
   * @param {{ question: string, agentId?: string|null, idempotencyKey?: string|null }} input
   */
  answerTutorStep: function (bookId, stepId, input) {
    var headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (input && input.idempotencyKey) headers['Idempotency-Key'] = input.idempotencyKey
    return request(
      '/books/' + encodeURIComponent(bookId) + '/tutor/steps/' + encodeURIComponent(stepId) + '/answer',
      {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          question: input.question,
          agentId: input.agentId || undefined,
        }),
      },
    )
  },

  /**
   * SSE：首帧 hello 带全量书库，之后按事件类型回调。
   * @param {{ onHello?: Function, onEvent?: Function, onError?: Function }} handlers
   * @returns {() => void} 关闭
   */
  subscribeEvents: function (handlers) {
    if (typeof EventSource !== 'function') return function () {}
    var source
    try {
      source = new EventSource(API_BASE + '/events', { withCredentials: true })
    } catch (error) {
      return function () {}
    }
    function close() {
      try {
        source.close()
      } catch (error) {
        /* already closed */
      }
    }
    var types = ['hello', 'book', 'progress', 'map', 'notes', 'thread', 'export', 'tutor']
    types.forEach(function (type) {
      source.addEventListener(type, function (event) {
        var payload = null
        try {
          payload = JSON.parse(event.data)
        } catch (error) {
          payload = null
        }
        try {
          if (type === 'hello' && handlers && handlers.onHello) handlers.onHello(payload)
          else if (handlers && handlers.onEvent) handlers.onEvent(type, payload)
        } catch (error) {
          console.warn('[reading-lab] event handler failed', error)
        }
      })
    })
    source.onerror = function () {
      try {
        if (handlers && handlers.onError) handlers.onError()
      } catch (error) {
        /* ignore */
      }
    }
    return close
  },
}