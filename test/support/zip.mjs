/**
 * 最小 ZIP 读取器（仅用于测试夹具校验，零依赖）。
 * 支持 store(0) 与 deflate(8)，足以覆盖 scripts/gen-fixtures.mjs 的输出。
 */
import { inflateRawSync } from 'node:zlib'

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new Error('ZIP: 找不到 EOCD')
}

export function readZipEntries(buf) {
  const eocd = findEocd(buf)
  const count = buf.readUInt16LE(eocd + 10)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  const entries = []
  let p = cdOffset

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`ZIP: 中央目录项 ${i} 签名错误`)
    const method = buf.readUInt16LE(p + 10)
    const compressedSize = buf.readUInt32LE(p + 20)
    const uncompressedSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP: 本地头签名错误 ${name}`)
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compressedSize)

    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      read() {
        if (method === 0) return Buffer.from(raw)
        if (method === 8) return inflateRawSync(raw)
        throw new Error(`ZIP: 不支持的压缩方法 ${method}（${name}）`)
      },
    })

    p += 46 + nameLen + extraLen + commentLen
  }

  return entries
}

export function findEntry(entries, name) {
  const entry = entries.find((e) => e.name === name)
  if (!entry) throw new Error(`ZIP: 缺少条目 ${name}`)
  return entry
}