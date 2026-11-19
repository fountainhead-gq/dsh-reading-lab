/**
 * HTTP 集成测试骨架。
 *
 * 现在 src/host/routes.js 尚不存在（M1 之后才装配），用例以 skip 登记；
 * 该文件出现后自动导入并校验 makeRoutes 契约，再逐步补齐 docs/06 §6 的 IT-* 用例。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const routesPath = join(ROOT, 'src', 'host', 'routes.js')
const hasRoutes = existsSync(routesPath)
const skipReason = hasRoutes ? false : 'M1 未实现 src/host/routes.js'

test('IT-BOOT-01 makeRoutes 可加载且导出函数', { skip: skipReason }, async () => {
  const mod = await import(pathToFileURL(routesPath).href)
  assert.equal(typeof mod.makeRoutes, 'function', 'routes.js 必须导出 makeRoutes(services)')
})

test.todo('IT-C01 /health 存储不可用 → 503 且保留 capabilities')
test.todo('IT-C02 上传 100 MB+1 → 413 且无 .part 残留')
test.todo('IT-C03 重复导入 → duplicate:true 且 bookId 稳定')
test.todo('IT-C04 chunks?ids= 含未知 id → 200 + missing')
test.todo('IT-C05 map commit 未知 chunkId → ok:false、map.json 哈希不变')
test.todo('IT-C06 同 Idempotency-Key 两次 → 同一 messageId（C-06）')
test.todo('IT-C07 SSE 首帧 hello，ping ≤15 s（C-07）')
test.todo('IT-C08 /exports/..%2fmeta.json → 400 E_PATH')
test.todo('IT-C09 六个工具 parameters 通过 defineTool 校验（C-09）')
test.todo('IT-C10 threads.json 无 qa-threads.json 别名（C-10）')
test.todo('IT-C11 删除书 → GET 404 + SSE book{deleted:true}')
test.todo('IT-C12 reading_export 通过 export-v1.schema.json（C-12）')