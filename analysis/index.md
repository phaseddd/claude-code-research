# analysis 索引（公开知识库）

> 每行一个知识页：相对路径 · 一句话说明 · 标签 · 成熟度。检索从这里进；不在索引里 = 检索不到 = 等于没入库。

| 页面 | 说明 | 标签 | status |
|---|---|---|---|
| [PriorKnowledge/acorn-and-js-ast-parsers.md](PriorKnowledge/acorn-and-js-ast-parsers.md) | acorn 与 JS AST 解析工具：AST/CST/Pratt 概念、acorn 本体（首发 2012-09-24；latest 见 CHANGELOG）、ESTree、生态位与同类对比、本项目 23 个补丁一律用 acorn 改写 cli.js（含定位策略示例） | `topic:ast` · `topic:acorn` · `topic:claude-code` · `form:concept` | active |
| [mechanisms/claude-code-insights-slash-command.md](mechanisms/claude-code-insights-slash-command.md) | `/insights` 端到端：用户等待→报告引擎（双缓存/内部模型）→主会话分享句+file://；2.1.209 | `topic:claude-code` · `topic:slash-command` · `topic:insights` · `form:mechanism` | active |
| [concepts/claude-code-insights-prompts.md](concepts/claude-code-insights-prompts.md) | `/insights` 内嵌提示词：12 组任务书（用途/中文/英文/解读）与请求拼装；2.1.209 | `topic:claude-code` · `topic:slash-command` · `topic:insights` · `form:concept` | active |
| [investigations/deepseek-compat-advisor-400.md](investigations/deepseek-compat-advisor-400.md) | 调查：DS 兼容端点对 tools[].type 严格枚举白名单（仅 web_search_20250305/20260209），开 advisor 注入 advisor_20260301 → 全请求 400；9 组实测+真实会话复现，位置在端点反序列化层（非 cometix/非模型） | `topic:claude-code` · `topic:deepseek` · `form:investigation` | active |
| [mechanisms/claude-code-advisor-tool.md](mechanisms/claude-code-advisor-tool.md) | Claude Code advisor 服务端工具全链路：四层门控→advisorModel 配置→工具/说明书注入→流式调用（判别联合+加密输出）→多轮回填清理→错误处理；含 YQu 说明书全文与中文译文；2.1.219 符号定位+官方文档 | `topic:claude-code` · `form:mechanism` | active |
| [PriorKnowledge/cometix-restore-pipeline.md](PriorKnowledge/cometix-restore-pipeline.md) | Cometix 用 `fetchAndProcess` 把某一版官方 Claude Code 还原成 Node npm 包：读 CDN 清单 → 按八个平台键下载 Bun SEA → 抽出并定位 cli.js → 兼容闸门 → 打补丁 → 组九个平台包加主包 | `topic:claude-code` · `topic:bun-sea` · `topic:npm` · `form:concept` | draft |
| [PriorKnowledge/claude-code-bun-sea-shipping.md](PriorKnowledge/claude-code-bun-sea-shipping.md) | 官方自 v2.1.113 起按平台 optionalDependencies 交付 Bun SEA 原生二进制；Cometix 按 CDN 清单八个平台键下载抽出，官方主包 JS 只贡献 sdk-tools.d.ts / LICENSE.md / README.md，不当运行入口 | `topic:claude-code` · `topic:bun-sea` · `topic:npm` · `form:concept` | draft |
| [PriorKnowledge/bun-sea-extract.md](PriorKnowledge/bun-sea-extract.md) | `extractBunSEA` 按 Mach-O/PE/ELF 取出 Bun 节、剥 BunFS 与随后的 `root/` 前缀写到 extractDir；`existsSync` 在 `src/entrypoints/cli.js` 与根上 `cli.js` 之间选定 `cliSrc` | `topic:claude-code` · `topic:bun-sea` · `form:mechanism` | draft |
| [PriorKnowledge/verify-node-compat-gate.md](PriorKnowledge/verify-node-compat-gate.md) | `patchFile` 之前 `verifyNodeCompat` 三项 fatal（`// @bun`+CJS 外壳、`require(`≥100、VERSION 字面量）；`compatible` 即 fatal 为零，失败则 `process.exit(1)`，不读 dual-runtime/bun-only | `topic:claude-code` · `topic:bun-sea` · `form:mechanism` | draft |
| [PriorKnowledge/node-compat-patches.md](PriorKnowledge/node-compat-patches.md) | `patchFile` 剥 Bun CJS 外壳后用 acorn 改 AST（P1–P3、P5、P7–P10），P9 替换包名，`typeof Bun` 少于 10 次则注入 P6 polyfill，最后补 node shebang | `topic:claude-code` · `topic:bun-sea` · `form:mechanism` | draft |
| [PriorKnowledge/cometix-npm-reassembly.md](PriorKnowledge/cometix-npm-reassembly.md) | 组九个 `@cometix/claude-code-<平台>`（含 android-arm64 别名）与主包；postinstall 把平台包 cli.js 与 vendor 拷进主包；`release.yml` 校验、打 tarball、带 provenance 发布 | `topic:claude-code` · `topic:npm` · `topic:bun-sea` · `form:mechanism` | draft |
