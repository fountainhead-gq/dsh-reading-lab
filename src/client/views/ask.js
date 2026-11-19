/* 询问 AI 浮层（owner: ask-ui，03 §4.1 宽 min(420px, 40%)）。M4 之前只渲染空态与禁用输入。 */

VIEWS.Ask = function Ask(props) {
  var state = props.state
  var actions = props.actions
  var disabled = !state.selectedBookId
  return h(
    'aside',
    { className: 'rl-ask', role: 'dialog', 'aria-modal': 'false', 'aria-label': t('ask.title') },
    h(
      'div',
      { className: 'rl-ask__head' },
      h('span', { className: 'rl-header__title' }, t('ask.title')),
      h('span', { className: 'rl-header__spacer' }),
      h(
        'button',
        { type: 'button', className: 'rl-btn rl-btn--ghost', onClick: actions.closeAsk, 'aria-label': t('action.close') },
        t('action.close'),
      ),
    ),
    h(
      'div',
      { className: 'rl-ask__body' },
      h('div', { className: 'rl-empty__title' }, disabled ? t('ask.disabled') : t('ask.empty')),
      h('div', { className: 'rl-empty__hint' }, t('state.stub')),
    ),
    h(
      'div',
      { className: 'rl-ask__foot' },
      h('input', {
        className: 'rl-input',
        type: 'text',
        placeholder: t('ask.placeholder'),
        'aria-label': t('ask.placeholder'),
        disabled: true,
      }),
      h(
        'button',
        { type: 'button', className: 'rl-btn rl-btn--primary', disabled: true, title: t('state.stub') },
        t('ask.send'),
      ),
    ),
  )
}