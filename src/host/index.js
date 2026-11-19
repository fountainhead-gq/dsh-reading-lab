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
import { AskService } from './ask.js'
import { AGENT_EVENTS, GenerationTracker } from './generation.js'
import { API_BASE, PACKAGE_NAME } from './limits.js'
import { MapService } from './map.js'
import { notesContext, readNotes, writeNotes } from './notes.js'
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
  // 导图：校验/布局/落盘 + 生成状态机；路由与工具共用同一实例。
  const generation = new GenerationTracker({
    publish: (event) => {
      try {
        hub.publish(event)
      } catch {
        // 节流器已关闭（卸载中）
      }
    },
    log: ctx?.logger ?? null,
    timeoutMs: limits.mapGenerationTimeoutMs,
  })
  const map = new MapService({ books, hub, limits, generation })
  // 研究笔记：markdown 是唯一事实来源，读写都过一遍校验（03 §5.5）。
  // 服务面只暴露三个动作，路由与工具都走它，避免两边各写一套校验。
  const notes = {
    read: (bookId) => readNotes(books, bookId),
    write: (bookId, markdown) => writeNotes(books, bookId, markdown),
    context: (bookId) => notesContext(books, bookId),
  }
  // 询问 AI：线程落盘 + 注入 + 回答回写（03 §8）。面板与 reading_ask 工具共用。
  const ask = new AskService({
    ctx,
    books,
    hub,
    map,
    limits,
    logger: ctx?.logger ?? null,
    timeoutMs: limits.askTimeoutMs,
  })
  const services = {
    ctx,
    books,
    hub,
    map,
    notes,
    ask,
    generation,
    limits,
    storage,
    root,
    rootName: path.basename(root),
    toolNames: expectedToolNames(),
    onNotesChanged: (bookId) => {
      try {
        hub.publish({ type: 'notes', bookId, updatedAt: new Date().toISOString() })
      } catch {
        // 节流器已关闭（卸载中）
      }
    },
  }

  // 1) agent 事件 → 生成状态机（t29 / QA-11-07）。
  //
  // `agent.followup()` 是 fire-and-forget：调用成功不代表回合会跑、更不代表模型
  // 会调用 reading_map。真实宿主上 preStep 失败（无 provider/model）只会发
  // `agent/error`，driver 自己把异常吞掉。这里订阅 DSH 的 agent 事件，把
  // 「消息被认领 / 被丢弃 / 回合报错 / 回合结束 / agent 关闭」映射到
  // pending→running→failed 的状态机，失败原因同时进日志、SSE 与状态查询。
  if (typeof ctx?.on === 'function') {
    disposers.push(
      ctx.effect(
        () => {
          const offs = []
          for (const eventName of AGENT_EVENTS) {
            const off = ctx.on(eventName, (payload) => {
              try {
                generation.handle(eventName, payload)
              } catch (error) {
                ctx?.logger?.warn?.(`[${PACKAGE_NAME}] generation event ${eventName} failed: ${error instanceof Error ? error.message : String(error)}`)
              }
            })
            if (typeof off === 'function') offs.push(off)
          }
          return () => {
            for (const off of offs) {
              try {
                off()
              } catch {
                // 宿主已经回收
              }
            }
          }
        },
        `${PACKAGE_NAME}: agent-events`,
      ),
    )
  } else {
    ctx?.logger?.warn?.(`[${PACKAGE_NAME}] ctx.on unavailable; generate-map failures only surface via watchdog`)
  }

  // 1b) 回答回写：会话里的 assistant 消息 → threads.json（03 §8.3）。
  //
  // `session/event` 是 Cordis 事件，payload 形状随 DSH 版本略有差异，这里只依赖
  // `{type:'assistant/message', data.message.content/ id}`；不认识的形状直接忽略，
  // 由 5 分钟看门狗兜底（AskService.failPending）。
  if (typeof ctx?.on === 'function') {
    disposers.push(
      ctx.effect(
        () => {
          const off = ctx.on('session/event', (session, event) => {
            Promise.resolve(ask.handleSessionEvent(session, event)).catch((error) => {
              ctx?.logger?.warn?.(
                `[${PACKAGE_NAME}] ask writeback event failed: ${error instanceof Error ? error.message : String(error)}`,
              )
            })
          })
          return () => {
            try {
              if (typeof off === 'function') off()
            } catch {
              // 宿主已经回收
            }
          }
        },
        `${PACKAGE_NAME}: ask-writeback`,
      ),
    )
  } else {
    ctx?.logger?.warn?.(`[${PACKAGE_NAME}] ctx.on unavailable; ask answers only arrive via reading_ask record`)
  }

  // 2) HTTP 路由：一个 prefix 注册覆盖 04 §4.1 的全部路由。
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

  // 3) Agent 工具：六个 reading_* 名称（M3 起 reading_map 为真实实现，其余仍是桩）。
  disposers.push(
    ctx.effect(
      () => registerTools(ctx, services),
      `${PACKAGE_NAME}: tools`,
    ),
  )

  // 4) 系统提示段：告诉模型什么时候用 reading_* 与引用格式。
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
    // 未完成的生成请求标记为 failed，避免重启后永远 409（状态只在内存里）。
    ask.close()
    generation.close()
    hub.close()
  }
}