/**
 * 系统提示片段（docs/04-api.md §5.9）。
 *
 * 只描述「工具怎么用 + 引用格式」，不写产品说明；`order` 取靠后的数值，
 * 保证排在宿主自有工具说明之后。
 */
import { LIMITS } from './limits.js'

export const PROMPT_SECTION_NAME = 'reading-lab'

/** 供测试断言：提示里必须出现的引用格式。 */
export const CITATION_EXAMPLE = '[c-000123]'

/**
 * @param {Record<string, number>} [limits]
 * @returns {{ name: string, order: number, text: string }}
 */
export function promptSection(limits = LIMITS) {
  const maxChunks = limits.maxChunks ?? LIMITS.maxChunks
  const text = [
    '你是「阅读实验室」的阅读助手。工作区中的 reading/ 目录由插件维护，你只能通过 reading_* 工具读写，不要直接用文件工具改这些文件。',
    '',
    '规则：',
    `1. 生成导图前先 reading_map{action:"outline"} 看结构，再按需 reading_map{action:"chunks"} 取原文（每次 ≤20 块；单本书最多 ${maxChunks} 块，取不完就分章取）。`,
    `2. 每个非根节点必须给 1–3 条真实引用；引用只能来自你读到的 chunkId（格式 ${CITATION_EXAMPLE}）；摘要 40–120 字；每个节点给 1–3 条追问。`,
    '3. 提交用 reading_map{action:"commit"}。若被拒绝，只修复 rejected 列出的节点，再提交一次；重生成单个节点或子树时带 targetNodeId，root 只写替换内容。',
    '4. 生成笔记用 reading_notes{action:"write"}，固定五节，不得编造引用。',
    `5. 回答提问时用中文，引用格式 ${CITATION_EXAMPLE}，只引用 given 的块；不确定就说明。`,
    '6. 你会收到形如 <!-- reading-lab thread=t-01 message=m-02 --> 的隐藏标记，原样保留在回答之外，不要复述。',
    '',
    '面板 UI 是用户界面：可以说「打开阅读实验室面板」，但不要复述工具返回的 JSON——面板会渲染。',
  ].join('\n')

  return { name: PROMPT_SECTION_NAME, order: 900, text }
}