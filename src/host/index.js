/**
 * Host 入口（owner: host-shell，docs/03-design.md §2.2）。
 *
 * 这里只做装配，不写业务：
 *   resolveLimits → resolveWorkspaceRoot → BookService → EventHub
 *   → webServer 路由（04 §4）→ agent 工具（04 §5）→ 系统提示段（04 §5.7）
 *
 * 约定：
 * - 一切注册都包在 `ctx.effect` 里，返回的函数负责释放；重复 apply 不会残留。
 * - apply 阶段除了 `reading/` 三个目录的 mkdir 之外不做 I/O；目录建不出来
 *   只让 `/health` 报 `storage: 'unavailable'`，路由仍然注册（Client 才能显示原因）。
 */
import * as path from 'node:path'

import { BookService } from './books.js'
import { ensureLayout, resolveLimits, resolveWorkspaceRoot } from './config.js'
import { API_BASE, PACKAGE_NAME } from './limits.js'
import { MapService } from './map.js'
import { promptSection } from './prompt.js'
import { makeRoutes } from './routes.js'
import { EventHub } from './sse.js'
import { expectedToolNames, registerTools } from './tools.js'

/** 与 package.json 的 name 一致；DSH 用它定位这个 bundle。 */
export const name = PACKAGE_NAME

/** 依赖的 Host 服务（04 §2.1）。 */
export const inject = ['webServer', 'tools', 'systemPrompt', 'agents']

/**
 * @param {any} ctx Cordis 上下文
 * @param {Record<string, unknown>} [config]
 * @returns {() => void} 释放函数（Cordis 卸载时调用）
 */
export function apply(ctx, config) {
  const limits = resolveLimits(config)
  const disposers = []

  let root = process.cwd()
  const storage = { available: true, reason: null }
  try {
    root = resolveWorkspaceRoot(ctx, config)
  } catch (error) {
    storage.available = false
    storage.reason = 'workspace'
    ctx?.logger?.warn?.(`[${PACKAGE_NAME}] workspace root unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (storage.available && !ensureLayout(root)) {
    storage.available = false
    storage.reason = 'layout'
    ctx?.logger?.warn?.(`[${PACKAGE_NAME}] cannot create reading/ under ${root}; serving read-only health`)
  }

  const books = new BookService({ root, limits, storage })
  const hub = new EventHub({ throttleMs: limits.eventThrottleMs })
  // 书库在导入/重命名/删除时推事件；EventHub 只做节流与广播，不懂书籍语义。
  books.hub = hub
  // 导图：校验/布局/落盘 + 生成占位；路由与工具共用同一实例。
  const map = new MapService({ books, hub, limits })
  const services = {
    ctx,
    books,
    hub,
    map,
    limits,
    storage,
    root,
    rootName: path.basename(root),
    toolNames: expectedToolNames(),
  }

  // 1) HTTP 路由：一个 prefix 注册覆盖 04 §4.1 的全部 25 条。
  if (ctx?.webServer && typeof ctx.webServer.register === 'function') {
    const routes = makeRoutes(services)
    disposers.push(
      ctx.effect(
        () => {
          const unregister = routes.map((route) => ctx.webServer.register(route))
          return () => {
            for (const dispose of unregister) {
              try {
                dispose()
              } catch {
                // 宿主已经回收
              }
            }
          }
        },
        `${PACKAGE_NAME}: routes`,
      ),
    )
  } else {
    ctx?.logger?.warn?.(`[${PACKAGE_NAME}] webServer service missing; HTTP routes not registered`)
  }

  // 2) Agent 工具：六个 reading_* 名称（M3 起 reading_map 为真实实现，其余仍是桩）。
  disposers.push(
    ctx.effect(
      () => registerTools(ctx, services),
      `${PACKAGE_NAME}: tools`,
    ),
  )

  // 3) 系统提示段：告诉模型什么时候用 reading_* 与引用格式。
  if (ctx?.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
    disposers.push(
      ctx.effect(
        () => {
          try {
            const dispose = ctx.systemPrompt.section(promptSection(limits))
            return typeof dispose === 'function' ? dispose : () => {}
          } catch (error) {
            ctx?.logger?.warn?.(`[${PACKAGE_NAME}] prompt section not registered: ${error instanceof Error ? error.message : String(error)}`)
            return () => {}
          }
        },
        `${PACKAGE_NAME}: prompt`,
      ),
    )
  }

  ctx?.logger?.info?.(
    `[${PACKAGE_NAME}] ready: api=${API_BASE} storage=${storage.available ? 'ok' : 'unavailable'} root=${services.rootName}`,
  )

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try {
        dispose()
      } catch {
        // 卸载期间的异常不再向上抛
      }
    }
    hub.close()
  }
}