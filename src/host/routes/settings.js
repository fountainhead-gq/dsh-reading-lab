/**
 * 设置路由（owner: api，docs/04-api.md §4.2 #31 / #32，t33）。
 *
 * 两件事：
 * - `GET /settings`：报当前书库根与是否回退，面板据此显示警告；
 * - `PUT /settings/library-root`：换根（可选整体迁移），成功后立刻生效。
 *
 * 换根是一个「迁移 + 落设置 + 切目录」的事务：迁移成功但设置写失败时要把目录搬回去，
 * 否则用户会看到「设置没变但书已经跑去别处」的半迁移状态。
 */

import * as path from 'node:path'

import { ReadingError } from '../errors.js'
import { API_BASE, READING_DIR } from '../limits.js'
import { sendOk } from '../respond.js'
import {
  directoryExists,
  migrateLibrary,
  resolveLibraryRoot,
  validateLibraryRoot,
  writeSettings,
} from '../settings.js'
import { readJsonBody } from './books.js'

function settingsOf(services) {
  return services?.settings ?? { libraryRoot: null }
}

/** 当前视图（GET 与 PUT 共用，保证字段一致）。 */
export function settingsView(services) {
  const resolvedRoot = services?.books?.readingDir ?? services?.rootPath ?? ''
  const value = settingsOf(services)
  return {
    libraryRoot: typeof value.libraryRoot === 'string' ? value.libraryRoot : null,
    resolvedRoot,
    isFallback: Boolean(services?.isFallback),
    workspaceRoot: typeof services?.workspaceRoot === 'string' ? services.workspaceRoot : null,
    exists: resolvedRoot !== '' && directoryExists(resolvedRoot),
  }
}

export async function getSettingsRoute(context) {
  sendOk(context.res, settingsView(context.services))
}

/**
 * 换根。body：`{ path: string | null, moveExisting?: boolean }`。
 * `null` = 回到默认（工作区）。
 */
export async function putLibraryRootRoute(context) {
  const { services } = context
  const body = await readJsonBody(context.req)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ReadingError('E_BAD_REQUEST', { field: 'body' })
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'path')) {
    throw new ReadingError('E_BAD_REQUEST', { field: 'path', reason: 'missing' })
  }
  if (body.path !== null && typeof body.path !== 'string') {
    throw new ReadingError('E_BAD_REQUEST', { field: 'path', reason: 'invalid-type' })
  }

  const moveExisting = body.moveExisting !== false
  const currentRoot = services.books.readingDir
  const previous = { libraryRoot: settingsOf(services).libraryRoot ?? null, root: currentRoot }
  let nextLayout

  if (body.path === null) {
    // 回到默认：重新按「工作区」解析，不允许沿用旧设置。
    nextLayout = resolveLibraryRoot({
      ctx: services.ctx,
      config: services.config,
      settings: { libraryRoot: null },
      cwd: process.cwd(),
    })
  } else {
    const validated = validateLibraryRoot(body.path, { current: currentRoot })
    nextLayout = { root: validated, workspaceRoot: services.workspaceRoot ?? null, isFallback: false, source: 'settings', reason: null, settingsError: null }
  }

  if (path.resolve(nextLayout.root) === path.resolve(currentRoot)) {
    throw new ReadingError('E_PATH', { field: 'path', reason: 'same-as-current' })
  }

  let migrated = null
  if (moveExisting && directoryExists(currentRoot)) {
    migrated = await migrateLibrary(currentRoot, nextLayout.root)
  }

  try {
    await writeSettings({ libraryRoot: body.path === null ? null : nextLayout.root }, services.settings.file)
  } catch (error) {
    if (migrated && migrated.moved.length > 0) {
      // 设置没落盘就回滚迁移，绝不留下半迁移布局。
      try {
        await migrateLibrary(nextLayout.root, currentRoot)
      } catch (rollbackError) {
        throw new ReadingError(
          'E_IO',
          { op: 'settings', rollbackFailed: [{ entry: '*', message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError) }] },
          { cause: error },
        )
      }
    }
    throw error
  }

  // 立即生效：切目录 + 建好三个子目录（迁移后目标里可能还没有 inbox/ 等）。
  services.books.setReadingDir(nextLayout.root)
  services.rootPath = nextLayout.root
  services.isFallback = nextLayout.isFallback
  services.rootSource = nextLayout.source
  services.workspaceRoot = nextLayout.workspaceRoot
  if (services.settings) services.settings.libraryRoot = body.path === null ? null : nextLayout.root
  try {
    await services.books.ensureLayout()
  } catch {
    // 目录建不出来不影响设置本身；第一次写入会再报 E_IO。
  }

  sendOk(context.res, {
    ...settingsView(services),
    previousRoot: previous.root,
    moved: migrated ? migrated.moved.map((item) => item.entry) : [],
    skipped: migrated ? migrated.skipped : [],
  })
}

/** 供测试：默认布局的推算式（避免测试复制 `READING_DIR` 拼接）。 */
export function defaultReadingDir(workspaceRoot) {
  return path.join(workspaceRoot, READING_DIR)
}

/** 供测试与诊断：当前 API 基路径下的设置路由路径。 */
export const SETTINGS_ROUTES = [`${API_BASE}/settings`, `${API_BASE}/settings/library-root`]