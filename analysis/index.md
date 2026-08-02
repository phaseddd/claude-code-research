# analysis 索引（公开知识库）

> 每行一个知识页：相对路径 · 一句话说明 · 标签 · 成熟度。检索从这里进；不在索引里 = 检索不到 = 等于没入库。

| 页面 | 说明 | 标签 | status |
|---|---|---|---|
| [PriorKnowledge/acorn-and-js-ast-parsers.md](PriorKnowledge/acorn-and-js-ast-parsers.md) | acorn 与 JS AST 解析工具：AST/CST/Pratt 概念、acorn 本体（8.17.0）、ESTree、生态位与同类对比、本项目一律用 acorn 改写 cli.js | `topic:ast` · `topic:acorn` · `form:concept` | active |
| [PriorKnowledge/cometix-claude-code-restore.md](PriorKnowledge/cometix-claude-code-restore.md) | CometixSpace-claude-code：把官方 Claude Code 的 Bun SEA 二进制恢复成 Node.js npm 包的自动化流水线（提取 cli.js → acorn 打 8 个补丁 → 9 平台分包 → CI 发布）；基线 master@213da58 / v2.1.209；含 P5 搜索复活与 vendor rg / polyfill 运行时要点 | `topic:claude-code` · `topic:bun-sea` · `topic:npm` · `form:case` | active |
| [mechanisms/claude-code-insights-slash-command.md](mechanisms/claude-code-insights-slash-command.md) | `/insights` 端到端：用户等待→报告引擎（双缓存/内部模型）→主会话分享句+file://；2.1.209 | `topic:claude-code` · `topic:slash-command` · `topic:insights` · `form:mechanism` | active |
| [concepts/claude-code-insights-prompts.md](concepts/claude-code-insights-prompts.md) | `/insights` 内嵌提示词：12 组任务书（用途/中文/英文/解读）与请求拼装；2.1.209 | `topic:claude-code` · `topic:slash-command` · `topic:insights` · `form:concept` | active |
| [investigations/deepseek-compat-advisor-400.md](investigations/deepseek-compat-advisor-400.md) | 调查：DS 兼容端点对 tools[].type 严格枚举白名单（仅 web_search_20250305/20260209），开 advisor 注入 advisor_20260301 → 全请求 400；9 组实测+真实会话复现，位置在端点反序列化层（非 cometix/非模型） | `topic:claude-code` · `topic:deepseek` · `form:investigation` | active |
| [mechanisms/claude-code-advisor-tool.md](mechanisms/claude-code-advisor-tool.md) | Claude Code advisor 服务端工具全链路：四层门控→advisorModel 配置→工具/说明书注入→流式调用（判别联合+加密输出）→多轮回填清理→错误处理；含 YQu 说明书全文与中文译文；2.1.219 符号定位+官方文档 | `topic:claude-code` · `form:mechanism` | active |
