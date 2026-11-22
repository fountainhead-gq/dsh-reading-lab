/* 统一反馈（owner: library，docs/13-ui-rework-backlog.md R3）。
 *
 * 规则：只在面板内出现，禁止 alert/confirm；成功 3.2s 自动消失，错误 5s。
 * 每条 toast 自己管自己的定时器，卸载/手动关闭都会清掉，避免连点后堆一堆 setTimeout。
 */

var TOAST_TTL_OK = 3200
var TOAST_TTL_ERROR = 5000

function ToastItem(props) {
  var toast = props.toast
  var onDismiss = props.onDismiss
  var ttl = toast.kind === 'error' ? TOAST_TTL_ERROR : TOAST_TTL_OK

  React.useEffect(
    function () {
      if (toast.sticky) return function () {}
      var timer = setTimeout(function () {
        onDismiss(toast.id)
      }, ttl)
      return function () {
        clearTimeout(timer)
      }
    },
    [toast.id, toast.sticky, ttl, onDismiss],
  )

  return h(
    'div',
    {
      className: 'rl-toast rl-toast--' + toast.kind,
      role: toast.kind === 'error' ? 'alert' : 'status',
      'data-toast': toast.key,
    },
    h('span', { className: 'rl-toast__dot', 'aria-hidden': 'true' }),
    h('span', { className: 'rl-toast__text' }, t(toast.key, toast.params || undefined)),
    h(
      'button',
      {
        type: 'button',
        className: 'rl-toast__close',
        'aria-label': t('toast.dismiss'),
        onClick: function () {
          onDismiss(toast.id)
        },
      },
      h(
        'svg',
        { className: 'rl-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
      ),
    ),
  )
}

VIEWS.Toasts = function Toasts(props) {
  var state = props.state || {}
  var actions = props.actions || {}
  var toasts = Array.isArray(state.toasts) ? state.toasts : []
  if (toasts.length === 0) return null
  return h(
    'div',
    { className: 'rl-toasts', 'aria-live': 'polite' },
    toasts.map(function (toast) {
      return h(ToastItem, { key: toast.id, toast: toast, onDismiss: actions.dismissToast })
    }),
  )
}