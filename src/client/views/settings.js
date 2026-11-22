/* 设置抽屉（owner: library，docs/13-ui-rework-backlog.md R1 / R2）。
 *
 * 为什么收进抽屉：v0.2.1 的面板把「存储位置」摆在书架底部、把「刷新」摆在顶栏、
 * 把「导出」挂在顶栏下拉，三处入口各说各话。R1 要求所有设置类操作只有一个入口，
 * 顶栏只留内容导航与高频动作。
 *
 * 与询问 AI / 详情共用同一列（右侧），但优先级更低：设置打开时其它浮层先收起。
 * 这里不弹 alert/confirm，成功与失败统一走 toast（R3）。
 */

var SETTINGS_STYLES = [
  '.rl-settings__field{display:flex;flex-direction:column;gap:6px;}',
  '.rl-settings__label{font-size:var(--rl-font-sm);font-weight:var(--rl-weight-medium);color:var(--dsw-alias-label-secondary);}',
  '.rl-settings__mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--rl-font-xs);}',
  '.rl-settings__divider{height:1px;background:var(--dsw-alias-border-l1);}',
].join('\n')

VIEWS.Settings = function Settings(props) {
  var state = props.state || {}
  var actions = props.actions || {}
  var settings = state.settings
  var books = Array.isArray(state.books) ? state.books : []
  var feedback = state.settingsFeedback
  var feedbackText = ''
  if (feedback && feedback.code) {
    feedbackText = feedback.code.indexOf('settings.') === 0 ? t(feedback.code) : t('error.' + feedback.code)
  }

  return h(
    'aside',
    {
      className: 'rl-settings',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-label': t('settings.title'),
      onKeyDown: function (event) {
        if (event && event.key === 'Escape' && typeof actions.closeSettings === 'function') {
          event.stopPropagation()
          actions.closeSettings()
        }
      },
    },
    h('style', { dangerouslySetInnerHTML: { __html: SETTINGS_STYLES } }),
    h(
      'div',
      { className: 'rl-settings__head' },
      h('h2', { className: 'rl-settings__title' }, t('settings.title')),
      h(
        'button',
        {
          type: 'button',
          className: 'rl-icon-btn',
          'aria-label': t('settings.close'),
          title: t('settings.close'),
          onClick: actions.closeSettings,
        },
        h(
          'svg',
          { className: 'rl-icon', viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false' },
          h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: '1.6', strokeLinecap: 'round' }),
        ),
      ),
    ),
    h(
      'div',
      { className: 'rl-settings__body' },

      // ---- 存储位置 -------------------------------------------------------
      h(
        'section',
        { className: 'rl-settings__section', 'data-section': 'storage' },
        h('h3', { className: 'rl-settings__section-title' }, t('settings.storage.title')),
        h('p', { className: 'rl-settings__hint' }, t('settings.storage.hint')),
        settings
          ? h(
              'div',
              { className: 'rl-settings__path', title: settings.resolvedRoot || '' },
              settings.resolvedRoot || t('settings.path.unknown'),
            )
          : h('div', { className: 'rl-settings__path' }, t('settings.loading')),
        settings && settings.isFallback
          ? h('div', { className: 'rl-settings__warn', role: 'status' }, t('settings.fallback'))
          : null,
        settings && settings.settingsError
          ? h(
              'div',
              { className: 'rl-settings__warn', role: 'alert', 'data-settings-error': settings.settingsError },
              settings.settingsError === 'settings-corrupted'
                ? t('settings.corrupted')
                : t('settings.invalid', { reason: settings.settingsError }),
            )
          : null,
        h('input', {
          className: 'rl-input',
          type: 'text',
          value: state.settingsDraft || '',
          placeholder: t('settings.path.placeholder'),
          'aria-label': t('settings.path.placeholder'),
          onChange: actions.setStorageDraft,
        }),
        h(
          'label',
          { className: 'rl-settings__check' },
          h('input', {
            type: 'checkbox',
            checked: Boolean(state.settingsMoveExisting),
            onChange: actions.toggleStorageMove,
          }),
          t('settings.move'),
        ),
        h(
          'div',
          { className: 'rl-settings__row' },
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
                className: 'rl-settings__feedback' + (feedback.kind === 'ok' ? '' : ' rl-settings__feedback--error'),
                role: 'status',
              },
              feedbackText,
            )
          : null,
      ),

      // ---- 导出 -----------------------------------------------------------
      h(
        'section',
        { className: 'rl-settings__section', 'data-section': 'export' },
        h('h3', { className: 'rl-settings__section-title' }, t('settings.export.title')),
        h('p', { className: 'rl-settings__hint' }, t('settings.export.hint')),
        h(
          'div',
          { className: 'rl-settings__path rl-settings__mono' },
          settings && settings.resolvedRoot
            ? settings.resolvedRoot.replace(/[\\/]+$/, '') + '\\exports'
            : t('settings.export.unknown'),
        ),
      ),

      h('div', { className: 'rl-settings__divider' }),

      // ---- 诊断 -----------------------------------------------------------
      h(
        'section',
        { className: 'rl-settings__section', 'data-section': 'about' },
        h('h3', { className: 'rl-settings__section-title' }, t('settings.about.title')),
        h(
          'div',
          { className: 'rl-settings__kv' },
          h('span', null, t('settings.about.version')),
          h('span', null, state.pluginVersion || '—'),
        ),
        h(
          'div',
          { className: 'rl-settings__kv' },
          h('span', null, t('settings.about.dsh')),
          h('span', null, state.dshVersion || '—'),
        ),
        h('div', { className: 'rl-settings__kv' }, h('span', null, t('settings.about.books')), h('span', null, String(books.length))),
        h(
          'div',
          { className: 'rl-settings__kv' },
          h('span', null, t('settings.about.storage')),
          h('span', null, state.storage === 'unavailable' ? t('settings.about.storage.bad') : t('settings.about.storage.ok')),
        ),
        h(
          'div',
          { className: 'rl-settings__row' },
          h(
            'button',
            {
              type: 'button',
              className: 'rl-btn rl-btn--ghost rl-btn--sm',
              onClick: actions.refresh,
            },
            t('settings.refresh'),
          ),
        ),
      ),
    ),
  )
}