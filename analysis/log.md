# analysis 日志（公开知识库）

> 只追加，不回改历史。记录知识库怎么演化。
> 格式：`[日期] kind | 一句话结论 | 推翻旧结论？（无 / superseded: 旧页名）`

[2026-07-09] concept | acorn = 小而快 / 零依赖 / 输出 ESTree 的 JS 解析器，前端工具链事实默认；本项目补丁一律用 acorn 改写 cli.js（非 Babel、非正则） | 无（冲突复检 WARNING：与 private 旧「AST 深度指南」互补，旧文待人工标 stale；本页留 draft）
[2026-07-09] concept | acorn 页 3 项 WARNING 经维护者拍板（旧文不标 stale / 首发月份不追 / 证据边界接受）→ 升 active | 无
[2026-07-09] case | CometixSpace-claude-code = 从官方 Bun SEA 二进制提取 cli.js、acorn 补丁（8 个，缺 P4）、重组成 @cometix/claude-code 的自动化恢复流水线；标志案例 P5「2.1.117 搜索瘫痪→2.1.118 复活」 | 无（与 acorn 页互相印证；冲突复检 OK、6 项事实抽查全 ✓，已订正 trailer 16 字节）
[2026-07-15] case | Cometix 页按原结构就地更新至 master@213da58 / v2.1.209：polyfill 面、vendor rg via Bun.which、rg 15.1.0、CI bundled npm provenance；去掉 changelog 式叠加段 | 无（同页修订）
[2026-07-15] mechanism | /insights = builtin prompt 命令：本地扫 projects → session-meta/facets 与漏斗 LLM → usage-data HTML(0600) → 主模型 verbatim 吐 file://；证据 2.1.209 cli.js + 全局 acorn 静态，未跑命令 | 无
[2026-07-15] concept | /insights 内嵌提示词契约页：P-chunk-sum/P-facet/schema/P-section-*/P-at-a-glance/P-user-reply 英文原文 + 中文对照 | 无
[2026-07-15] concept | /insights 提示词契约页经维护者确认 → 升 active | 无
[2026-07-15] mechanism | /insights 机制页扩写：L0–L6 全链路、双缓存/漏斗分步、mermaid+plaintext 图、multi-clauding 30min 窗口等；仍 draft | 无（同页修订）
[2026-07-15] mechanism | /insights 机制页就地订正：数据边界、Gm_ 投影、warmup 双输入、th_ 50/20/15、collectRemote 死参、平台边界与证据方法；仍 draft | 无（同页修订）
[2026-07-15] concept | /insights 提示词契约页：P-chunk-sum 改为 Gm_ 投影后再分块，与机制页对齐 | 无（同页修订）
[2026-07-16] concept | /insights 提示词契约页就地补齐 Isp/DATA/th_ 公共输入与 50/20/15、glance 走 Isp、facet/warmup 口径、两处中文误译；仍 active | 无（同页修订）
[2026-07-16] mechanism | /insights 机制页就地订正后升 active：数据边界、Gm_、warmup 双输入、50/20/15、mermaid 用 br 换行；与提示词契约页对齐 | 无
[2026-07-19] mechanism | /insights 机制页：补嵌套/Zxs·shouldQuery、挂载点写入 L2/L4.2(5)(6)/L5；契约页标题改为 p-*（Obsidian 锚点）+ 相对路径链到 P-id | 无（同页修订）
[2026-07-19] concept | /insights 提示词契约页：索引/请求拼装/各 P-id 节标题改为 p-index、p-request-assembly、p-chunk-sum 等稳定锚点 | 无（同页修订）
[2026-07-19] mechanism | /insights 正文改为中文职责叙述，minify 退到附录；路径表/漏斗/挂载点去掉 Osp/pn 墙 | 无（同页修订）
[2026-07-20] mechanism | /insights 机制页：总览后加本页名词（命令外壳 8 + 数据流水线 8）、结论双坐标预热、L4.0 改为路径索引、L4.2 开篇回指；订正 L2 长等待时序 | 无（同页修订）
[2026-07-20] mechanism | /insights 机制页入库收尾：本页名词补 mtime 独立行、Obsidian 短锚点（本页名词/L2/附录-A|B）、glossary 同步；冲突复检 OK | 无（同页修订）
[2026-07-21] mechanism | /insights Claude 叙事化机制稿直接修订：保留用户等待→报告引擎→主会话故事线，校准调用点/请求次数、模型后端、缓存孤儿、采样输入与设计推断边界；保留 draft | 无（与 active 机制页冲突复检 OK）
[2026-07-21] concept | /insights Claude 叙事化提示词稿直接修订：保留用途→译文→原文→解读结构，订正 likely_satisfied/JSON 契约，补字段与数量歧义、真实 minify 占位符及数据边界；保留 draft | 无（与 active 契约页冲突复检 OK）
[2026-07-21] mechanism | /insights 机制页：叙事化终稿就地取代正式路径，升 active；删临时 rewrite/旧稿旁路 | 无（同页取代，index 不新增行）
[2026-07-21] concept | /insights 提示词页：叙事化终稿就地取代正式路径，升 active；删临时 rewrite/旧稿旁路 | 无（同页取代，index 不新增行）
[2026-07-31] case | why.zero.university 交互机制解剖：叙事型 3D 落地页机制层（MasterTimeline 时间轴/滚动接管/TAP HOLD/画圆判定/XP 计量）+ 质感层（情绪节拍/贯穿隐喻/数据即物体）；2026-07-31 快照；demos/insights-pipeline 参考素材 | 无（冲突复检 OK）
[2026-07-31] maintenance | 边界更正：零大学解剖属前端 showcase 参考，不入知识库（workflow/README「demos 不进 analysis 索引」纪律）→ 页面迁移至 demos/insights-pipeline/docs/，index/glossary 回滚 | 无
[2026-08-02] investigation | DeepSeek Anthropic 兼容端点（api.deepseek.com/anthropic）对 tools[].type 做严格枚举白名单（仅 web_search_20250305/20260209），Claude Code 开启 advisor 注入 advisor_20260301 → 全请求 400；9 组 curl 对照 + 真实会话复现，位置在端点反序列化层（非 cometix 恢复版、非模型端）；serde/axum 归因为高置信度推断（非官方确认）；「改 type 欺骗」列为开放问题（未尝试）；新建 investigations/ 目录归置 | 无（冲突复检 OK）
[2026-08-02] mechanism | Claude Code advisor 服务端工具全链路：四层门控（H7）→ advisorModel 三入口 → 工具 + YQu 说明书（全文 + 中文译文）注入 → 流式调用（server_tool_use / advisor_tool_result 判别联合、加密输出、error_code 六枚举）→ 多轮回填与 P6s 清理 → 错误处理；kn() 与 base URL 分离机制；符号表 + 检索字符串；服务端执行环节为文档级证据 | 无（冲突复检 OK）
[2026-08-02] maintenance | 库级收尾：investigations/ 目录新建；glossary 新增 topic:deepseek；事实修正 cli.js 非「单行 bundle」（实测 50209 行、最长行约 538KB），两页源码定位描述同步订正 | 无
