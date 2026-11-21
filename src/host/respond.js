/**
 * 响应信封（04 §1.1）。
 *
 * 单独成模块是为了避免 `routes.js` ↔ `routes/*.js` 的循环依赖：处理器只依赖
 * 这里，分发器依赖处理器。
 */

import { createRequire } from 'node:module'

import { httpStatusOf, toWireError } from './errors.js'
import { PACKAGE_NAME } from './limits.js'

const require = createRequire(import.meta.url)
/** 由 package.json 决定，避免版本号两处维护。 */
export const PLUGIN_VERSION = (() => {
  try {
    const pkg = require('../../package.json')
    return typeof pkg?.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

export const SERVER_HEADER = `${PACKAGE_NAME}/${PLUGIN_VERSION}`

const NO_STORE = Object.freeze({ 'Cache-Control': 'no-store' })

/**
 * @param {any} res
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
export function sendJson(res, status, body, headers) {
  if (res.writableEnded) return
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(payload.length),
    'Cache-Control': 'no-store',
    'X-DSH-Plugin': SERVER_HEADER,
    ...headers,
  })
  res.end(payload)
}

/** @param {any} res @param {unknown} data @param {number} [status] */
export function sendOk(res, data, status = 200, headers) {
  sendJson(res, status, { ok: true, data }, headers ?? NO_STORE)
}

/**
 * @param {any} res
 * @param {unknown} error
 * @param {{ requestId?: string, lang?: 'zh' | 'en', headers?: Record<string, string> }} [context]
 */
export function sendError(res, error, context) {
  const body = toWireError(error, context)
  const status = httpStatusOf(body.error.code)
  sendJson(res, status, body, context?.headers)
  return status
}