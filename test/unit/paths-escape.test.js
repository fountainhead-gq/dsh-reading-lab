import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { resolveInReading } from '../../src/host/paths.js'

/**
 * `resolveInReading()` 的逃逸路径（M1-09）。
 * 纯字符串校验在 core.test.js 里；这里造真目录与真链接，验证 realpath 那一层。
 */

describe('resolveInReading 的真实路径校验', () => {
  let workspace
  let outside

  before(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'rl-paths-'))
    outside = await mkdtemp(path.join(tmpdir(), 'rl-outside-'))
    await mkdir(path.join(workspace, 'reading'), { recursive: true })
    await mkdir(path.join(workspace, 'reading', 'books'), { recursive: true })
    await writeFile(path.join(outside, 'secret.txt'), 'nope', 'utf8')
  })

  after(async () => {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('工作区内的普通路径可解析', async () => {
    const resolved = await resolveInReading(workspace, 'books/b0123456789ab/meta.json')
    assert.equal(resolved, path.join(workspace, 'reading', 'books', 'b0123456789ab', 'meta.json'))
  })

  it('沿链接逃到工作区外时抛 E_PATH', async (t) => {
    const link = path.join(workspace, 'reading', 'inbox', 'escape')
    try {
      await mkdir(path.dirname(link), { recursive: true })
      // Windows 上目录链接用 junction，不需要管理员权限。
      await symlink(outside, link, 'junction')
    } catch (error) {
      t.skip(`无法创建目录链接：${error.code ?? error.message}`)
      return
    }

    await assert.rejects(
      () => resolveInReading(workspace, 'inbox/escape/secret.txt'),
      (error) => {
        assert.equal(error.code, 'E_PATH')
        assert.equal(error.details.reason, 'symlink-escape')
        return true
      },
    )
  })
})