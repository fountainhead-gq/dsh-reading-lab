import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

const readText = (rel) => readFile(join(ROOT, rel), 'utf8')

test('CT-PKG-01 包身份与模块类型', () => {
  assert.equal(pkg.name, 'dsh-reading-lab')
  assert.match(pkg.version, /^0\.\d+\.\d+$/)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.author, 'fountainhead-gq')
})

test('CT-PKG-02 DSH bundle 元数据完整', () => {
  assert.match(pkg.dsh.engines.dsh, />=0\.2\.2-rc\.1/)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.icon, 'icon.svg')
  assert.ok(existsSync(join(ROOT, pkg.dsh.bundle.patch)))
})

test('CT-PKG-03 exports 目标全部存在且可解析', async () => {
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    assert.ok(target.startsWith('./'), `${subpath} 应使用相对路径`)
    if (target.includes('*')) continue
    assert.ok(existsSync(join(ROOT, target)), `${subpath} → ${target} 不存在`)
  }

  const host = await import(pathToFileURL(join(ROOT, pkg.exports['.'])).href)
  assert.equal(typeof host.apply, 'function', 'Host 入口必须导出 apply')

  const client = await readText(pkg.exports['./client'])
  assert.match(client, /__ModuleLoader__\.load/)
  assert.match(client, /id:\s*'dsh-reading-lab'/)
})

test('CT-PKG-04 locale 文件可解析且 key 对齐', async () => {
  const en = JSON.parse(await readText('locale/en.json'))
  const zh = JSON.parse(await readText('locale/zh.json'))
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
  for (const key of ['title', 'description']) {
    assert.ok(en.meta[key]?.length > 0, `en.meta.${key} 为空`)
    assert.ok(zh.meta[key]?.length > 0, `zh.meta.${key} 为空`)
  }
})

test('CT-PKG-05 cordis.patch.yml 行 id 与包名一致', async () => {
  const patch = await readText(pkg.dsh.bundle.patch)
  assert.match(patch, /id:\s*reading-lab/)
  assert.match(patch, /name:\s*dsh-reading-lab/)
})

test('CT-PKG-06 图标为 SVG 且非空', async () => {
  const svg = await readText('icon.svg')
  assert.match(svg.trimStart(), /^<svg[\s>]/)
  assert.match(svg, /<\/svg>\s*$/)
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
})

test('CT-PKG-07 发布清单包含运行所需文件且不含测试夹具', () => {
  const files = pkg.files ?? []
  for (const required of ['src', 'locale/*.json', 'cordis.patch.yml', 'icon.svg', 'docs', 'README.md', 'LICENSE']) {
    assert.ok(files.includes(required), `files 缺少 ${required}`)
  }
  assert.ok(!files.some((f) => f.startsWith('test')), 'test/ 不应进入发布包')
  assert.ok(!files.some((f) => f.startsWith('scripts')), 'scripts/ 不应进入发布包')
})

test('CT-PKG-08 当前无运行时依赖（骨架阶段约束）', () => {
  const deps = Object.keys(pkg.dependencies ?? {})
  assert.deepEqual(deps, [], 'M2 引入解析依赖时必须同步更新 06 测试与许可证清单')
})

test('CT-PKG-09 npm scripts 提供测试入口', () => {
  for (const name of ['check', 'test', 'test:unit', 'test:integration', 'test:smoke', 'fixtures', 'fixtures:check', 'verify']) {
    assert.ok(pkg.scripts?.[name], `缺少 npm script: ${name}`)
  }
  assert.match(pkg.scripts.test, /node --test/)
  assert.match(pkg.scripts.verify, /npm run check/)
})