/**
 * 硬限制与常量（docs/04-api.md §2.2、docs/03-design.md §6.6）。
 *
 * 这里是**唯一**的默认值来源：`config.js` 的默认值从这里读，测试也从这里读，
 * 文档里的数字必须与本文件一致（`test/unit/limits.test.js` 会比对）。
 */

export const LIMITS = Object.freeze({
  /** 单次上传上限：100 MB。 */
  maxUploadBytes: 104_857_600,
  /** PDF 页数上限。 */
  maxPdfPages: 2_000,
  /** EPUB 抽取字符上限（50 M）。 */
  maxEpubChars: 50_000_000,
  /** 单本分块上限。 */
  maxChunks: 20_000,
  /** 分块目标区间（字符）：800–1500。 */
  chunkTargetMin: 800,
  chunkTargetMax: 1_500,
  /** 分块硬上限：超过必须切。 */
  chunkHardMax: 2_000,
  /** 分块下限：小于此值的尾块并入上一块。 */
  chunkMinChars: 100,
  /** 提问等待上限：5 min。 */
  askTimeoutMs: 300_000,
  /** SSE 心跳间隔。 */
  ssePingMs: 15_000,
  /** SSE 无写断开阈值。 */
  sseIdleTimeoutMs: 60_000,
  /** 单连接待写队列上限，超过丢 progress。 */
  sseQueueLimit: 100,
  /** 事件节流窗口（同一 type + bookId）。 */
  eventThrottleMs: 200,
  /** hello 快照里最多带多少本书。 */
  helloBooksLimit: 200,
})

/** 支持导入的格式（M2 起真正解析）。 */
export const SUPPORTED_FORMATS = Object.freeze(['epub', 'pdf'])

/** 导出格式（`exportFormats` 配置项的取值域）。 */
export const EXPORT_FORMATS = Object.freeze(['md', 'opml', 'json', 'html'])

/** 默认导出格式（html/png 属 v0.3，默认关闭）。 */
export const DEFAULT_EXPORT_FORMATS = Object.freeze(['md', 'opml', 'json'])

/** 包名与面板标识（Client 与 Host 必须一致）。 */
export const PACKAGE_NAME = 'dsh-reading-lab'
export const PANEL_ID = 'reading-lab'

/** API 版本与基路径（04 §1.1）。 */
export const API_VERSION = 1
export const API_BASE = '/dsh-reading-lab/api/v1'

/** 工作区内的数据根目录（03 §5.1）。 */
export const READING_DIR = 'reading'