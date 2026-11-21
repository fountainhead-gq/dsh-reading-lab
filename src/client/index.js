/**
 * Client 入口（owner: client-shell）。
 *
 * 这个文件是**模板**：`scripts/build-client.mjs` 把 `src/client/*.js` 与
 * `src/client/views/*.js` 里的片段按固定顺序拼进来，生成仓库根目录的 `client.js`
 * （package.json 的 `exports["./client"]` 指向它）。原因见 docs/05-dev.md §4：
 * DSH 浏览器端只有 `<script>` + 模块表，`require` 不解析相对路径。
 *
 * 约束：片段是普通脚本语句（不能有 import/export/顶层 require），共享
 * `React` / `h` / `DICTS` / `VIEWS` / `store` / `api` / `t`。
 */
window.__ModuleLoader__.load({
  id: 'dsh-reading-lab',
  factory(require) {
    'use strict'

    const React = require('react')
    const NS = 'dsh-reading-lab'
    const PANEL_ID = 'reading-lab'
    const API_BASE = '/dsh-reading-lab/api/v1'
    const h = React.createElement

    /* @build:dicts */

    const VIEWS = {}

    /**
     * 焦点契约（t31 / QA-17-01）：浮层与侧卡共用。
     *
     * - 打开时把焦点送进面板（首个可交互元素或容器本身）；
     * - Tab / Shift+Tab 在面板内循环，不跑到背景；
     * - 关闭时把焦点还给触发元素（`captureFocus` / `restoreFocus` 配对）。
     * 背景的 `inert` + `aria-hidden` 由 `VIEWS.Shell` 负责。
     */
    const FOCUSABLE_SELECTOR =
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const FOCUS_RETURN = { ask: null, detail: null, notes: null }

    function focusElement(element) {
      if (!element || typeof element.focus !== 'function') return false
      try {
        element.focus()
        return true
      } catch (error) {
        return false
      }
    }

    function focusablesWithin(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return []
      const found = root.querySelectorAll(FOCUSABLE_SELECTOR)
      return found ? Array.prototype.slice.call(found) : []
    }

    /** 在 `event.currentTarget` 内环绕 Tab；返回 true 表示已接管这次按键。 */
    function trapTabKey(event) {
      if (!event || event.key !== 'Tab') return false
      const items = focusablesWithin(event.currentTarget)
      if (items.length === 0) return false
      const active = typeof document !== 'undefined' ? document.activeElement : null
      const index = items.indexOf(active)
      const last = items.length - 1
      let next = null
      if (event.shiftKey) next = index <= 0 ? items[last] : items[index - 1]
      else next = index === -1 || index === last ? items[0] : items[index + 1]
      if (!next) return false
      if (typeof event.preventDefault === 'function') event.preventDefault()
      focusElement(next)
      return true
    }

    function captureFocus(key) {
      if (typeof document === 'undefined') return
      FOCUS_RETURN[key] = document.activeElement || null
    }

    function restoreFocus(key) {
      const target = FOCUS_RETURN[key]
      FOCUS_RETURN[key] = null
      if (target) focusElement(target)
    }

    /* @build:parts */

    /** 宿主 locale 服务 → `t(key, params)`；没注册成功时 i18n.js 会退回内联字典。 */
    function makeLocaleBinder(ctx) {
      try {
        const locale = ctx && ctx.locale
        if (!locale) return null
        const bound = typeof locale.bind === 'function' ? locale.bind(NS) : null
        const current =
          typeof locale.current === 'string'
            ? locale.current
            : typeof locale.lang === 'string'
              ? locale.lang
              : null
        if (typeof bound === 'function') return { t: bound, current }
        if (typeof locale.t === 'function') return { t: bound ? bound : (key, params) => locale.t(NS, key, params), current }
      } catch (error) {
        console.warn(`[${NS}] locale unavailable, using bundled dictionaries`, error)
      }
      return null
    }

    function PanelSeat() {
      return h(VIEWS.Panel)
    }

    return {
      inject: ['slots'],

      apply(ctx) {
        const disposers = []

        const register = (label, fn) => {
          try {
            const run = () => fn()
            const dispose = typeof ctx.effect === 'function' ? ctx.effect(run, `${NS}: ${label}`) : run()
            if (typeof dispose === 'function') disposers.push(dispose)
          } catch (error) {
            console.warn(`[${NS}] ${label} registration failed`, error)
          }
        }

        register('dictionaries', () => ctx.locale.register(NS, { zh: DICTS.zh, en: DICTS.en }))
        bindLocale(makeLocaleBinder(ctx))

        // 侧栏图标：点击后由 DSH 把 main 切到 key=reading-lab 的面板（03 §3.1）。
        register('sidebar.panellist', () =>
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              {
                name: 'sidebar.panellist',
                id: PANEL_ID,
                order: 26,
                locale: NS,
                label: () => t('entry.label'),
              },
              VIEWS.PanelIcon,
            ),
          ),
        )

        register('main', () =>
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PanelSeat),
          ),
        )

        return () => {
          for (const dispose of disposers.splice(0).reverse()) {
            try {
              dispose()
            } catch (error) {
              console.warn(`[${NS}] dispose failed`, error)
            }
          }
        }
      },
    }
  },
})