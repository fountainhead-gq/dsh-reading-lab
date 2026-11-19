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