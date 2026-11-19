/**
 * 阅读实验室 / Reading Lab — Client half.
 *
 * 浏览器侧的模块加载入口，id 必须等于包名。骨架阶段只导出空的 apply；
 * 后续任务在此通过 ctx.slots.inject / ctx.slots.register 注册：
 *   - sidebar.panellist 侧栏图标
 *   - main 面板 key="reading"（书库 + 导图画布）
 *   - 询问 AI 浮层
 *
 * 工厂函数保持无副作用：槽位、样式、监听器全部在 apply 内注册并返回清理函数。
 * React 从浏览器模块表获取（require('react')），不要自行安装第二份。
 */
window.__ModuleLoader__.load({
  id: 'dsh-reading-lab',
  factory() {
    return {
      apply() {},
    }
  },
})