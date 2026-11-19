/**
 * 占位用例：产品模块尚未实现（骨架阶段）。
 * 每个 todo 对应 docs/06-test.md 矩阵中的一组真正用例；实现模块时把 todo 换成断言，
 * 不要在实现 PR 里跳过或删除本文件中的条目（由 qa 在 M2–M5 清理）。
 */
import { test } from 'node:test'

test.todo('UT-EPUB-01..06 parse/epub.js：nav/NCX/缺 TOC/缺章/净化/恶意 zip')
test.todo('UT-PDF-01..06 parse/pdf.js：2 页文本/中文/扫描/加密/损坏/outline')
test.todo('UT-TEXT-01..04 parse/text.js：CJK 拼接/连字符/页眉页脚/实体与控制字符')
test.todo('UT-CHUNK-01..05 chunk.js：上下限/长段/章节不跨/码点计数/20000 上限')
test.todo('UT-PATH-01..04 paths.js：..、绝对路径、symlink、Windows 保留名与 UNC')
test.todo('UT-MAP-01..06 map.js：未知 chunkId/空引用/超长摘要/深度/重复标题/原子写')
test.todo('UT-LAYOUT-01..04 layout.js：10/50/300 节点快照、左右分配、无重叠、确定性')
test.todo('UT-NOTES-01..04 notes.js：五节/固定文案/引用校验/元数据行')
test.todo('UT-THREAD-01..03 threads.js：引用抽取去重/running→idle/幂等键')
test.todo('UT-ASK-01..03 ask.js：上下文裁剪/无 agent/并发门')
test.todo('UT-EXP-01..05 export/*：md 转义/OPML 层级/JSON schema/命名去重/失败清理')
test.todo('UT-SVG-01..03 svg.js：坐标变换/fitView/贝塞尔控制点')
test.todo('UT-ERR-01 errors.js + locale：E_* → 中英文案全覆盖')
test.todo('IT-BOOK-01..04 routes/books.js：列表/重命名/删除/重新生成')
test.todo('IT-IMP-01..06 导入全链路：EPUB/PDF/重复/格式/超限/SSE 进度')
test.todo('IT-CONTENT-01..03 chunks/map/notes 读取与 404/409')
test.todo('IT-ASK-01..03 提问/停止/幂等（C-06）')
test.todo('IT-EXP-01..03 导出/列表/下载与路径逃逸（C-08/C-12）')
test.todo('IT-SSE-01..02 hello 首帧与断线重连（C-07）')
test.todo('SMK-02 DSH 安装：bundle 行生效、/health 200、工具清单出现 reading_*')
test.todo('SMK-03 面板：侧栏图标打开主面板、同 id 联动、无重复实例')
test.todo('MAN-01..15 AC-01..AC-10 手工走查（见 06 §8）')
test.todo('V03-EDIT-01..03 节点编辑/单节点重生成/写回与备份')
test.todo('V03-REVIEW-01..02 节点级 diff、接受与回滚')
test.todo('V03-EXPORT-01..02 HTML 单文件与 PNG/SVG 快照')
test.todo('V03-STUDY-01..02 reading_tutor 学习路径与检查点')
test.todo('V03-SEARCH-01..02 单本书内搜索、小地图与 1000 节点性能')