/**
 * 安装冒烟（不启动 DSH 的部分）：
 * 校验 npm 发布清单、入口语法、bundle patch、locale 与图标——即“可交付的安装材料”。
 * 真正安装到 DSH 后的检查见 test/manual/README.md 与 docs/06-test.md §3.3。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

function npmCli() {
  const candidates = [
    join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(dirname(process.execPath), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  return candidates.find((p) => existsSync(p))
}

function packJson() {
  const cli = npmCli()
  assert.ok(cli, '找不到 npm-cli.js，无法执行 npm pack --dry-run')
  const stdout = execFileSync(process.execPath, [cli, 'pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return JSON.parse(stdout)[0]
}

test('SMK-01 发布包清单完整且不含测试/脚本', () => {
  const result = packJson()
  const files = result.files.map((f) => f.path)
  for (const required of [
    'package.json',
    'cordis.patch.yml',
    'icon.svg',
    'README.md',
    'LICENSE',
    'src/host/index.js',
    'src/client/index.js',
    'locale/en.json',
    'locale/zh.json',
    'docs/06-test.md',
  ]) {
    assert.ok(files.includes(required), `发布包缺少 ${required}`)
  }
  assert.ok(!files.some((f) => f.startsWith('test/')), '发布包不应含 test/')
  assert.ok(!files.some((f) => f.startsWith('scripts/')), '发布包不应含 scripts/')
  assert.ok(!files.some((f) => f.endsWith('.tgz')), '发布包不应含 tgz')
  assert.ok(result.unpackedSize > 0 && result.unpackedSize < 2 * 1024 * 1024, `包体积异常：${result.unpackedSize}`)
})

test('SMK-02 入口通过 node --check', () => {
  for (const entry of ['src/host/index.js', 'src/client/index.js', 'scripts/gen-fixtures.mjs']) {
    const output = execFileSync(process.execPath, ['--check', join(ROOT, entry)], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 30000,
    })
    assert.equal(output.trim(), '', `${entry} --check 有输出`)
  }
})

test('SMK-03 bundle patch 可被 YAML 结构解析（最小校验）', () => {
  const lines = readFileSync(join(ROOT, pkg.dsh.bundle.patch), 'utf8').split(/\r?\n/).filter(Boolean)
  assert.equal(lines[0].trim(), '- insert:')
  assert.ok(lines.some((l) => /^\s+- id: reading-lab$/.test(l)))
  assert.ok(lines.some((l) => /^\s+name: dsh-reading-lab$/.test(l)))
})

test('SMK-04 入口与 locale 在 Node 侧可加载', async () => {
  const host = await import(new URL('../../src/host/index.js', import.meta.url).href)
  assert.equal(typeof host.apply, 'function')
  for (const lang of ['en', 'zh']) {
    const locale = JSON.parse(readFileSync(join(ROOT, 'locale', `${lang}.json`), 'utf8'))
    assert.ok(locale.meta?.title)
  }
})