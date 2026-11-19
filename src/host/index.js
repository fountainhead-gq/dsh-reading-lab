/**
 * 阅读实验室 / Reading Lab — Host half.
 *
 * 骨架阶段只保留插件入口。后续任务在此注册：
 *   - 书库与存储服务（storageDomain + workspace reading/ 目录）
 *   - 导入 / 解析 / 分块管道（EPUB、PDF）
 *   - agent 工具：reading.import / reading.map / reading.notes / reading.ask / reading.export
 *
 * 约定：所有注册都放在 apply 内，用 ctx.effect / ctx.on 声明并返回清理函数，
 * 以便插件卸载与 profile patch 变更时自动回收。
 */
export function apply() {}