/**
 * 集成测试的网络小工具（不参与 `node --test "test/**\/*.test.js"` 收集）。
 *
 * `listen(0)` 会从系统临时端口里随机拿一个，而 undici（fetch）按 fetch 规范拒绝连接
 * 一批「bad port」。单跑时几乎抽不到，满载并发（8 份 verify 同时跑）时概率累积，
 * 表现为 `[TypeError: fetch failed] { cause: Error: bad port }`——不是产品缺陷，
 * 是测试基础设施抖动。这里统一处理，避免各文件复制同一段循环。
 *
 * 为什么既查表又探测：Windows 的动态端口范围因机器而异（常见 49152–65535，也可能
 * 配置成 1024–65535），只列 5060/6000/6665-6669 这类端口会漏掉 554、993、4045 等。
 * 因此 listen 成功后真发一次请求，确认 undici 愿意连；不愿连就换端口重开。
 */

export const BLOCKED_PORTS = new Set([5060, 5061, 6000, 6665, 6666, 6667, 6668, 6669, 6679, 6697])

const MAX_LISTEN_ATTEMPTS = 20

const isBadPort = (error) => /bad port/i.test(String(error?.cause?.message ?? error?.message ?? ''))

/**
 * 在 127.0.0.1 的随机端口上 listening；端口被 undici 拒绝就关掉重开。
 * @param {import('node:http').Server} server
 * @returns {Promise<{ server: import('node:http').Server, port: number }>}
 */
export function listenSafe(server) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const listen = () => {
      attempts += 1
      if (attempts > MAX_LISTEN_ATTEMPTS) {
        reject(new Error('listenSafe: 连续抽到 undici 拒绝的端口，放弃'))
        return
      }
      server.once('error', reject)
      server.listen(0, '127.0.0.1', async () => {
        server.removeListener('error', reject)
        const port = server.address().port
        if (BLOCKED_PORTS.has(port)) {
          server.close(() => listen())
          return
        }
        try {
          // 探测一次：404/501 都算「连得上」，只有 bad port 才需要换端口。
          await fetch(`http://127.0.0.1:${port}/`, { method: 'GET' })
          resolve({ server, port })
        } catch (error) {
          if (!isBadPort(error)) {
            reject(error)
            return
          }
          server.close(() => listen())
        }
      })
    }
    listen()
  })
}