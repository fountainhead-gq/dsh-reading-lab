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
    var types = ['hello', 'book', 'progress', 'map', 'notes', 'thread', 'export']
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