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
