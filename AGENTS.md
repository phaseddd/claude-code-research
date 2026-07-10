# AGENTS.md

> 本文件是 Codex（及其它读 AGENTS.md 的 agent）每次会话自动读取的项目指令。目前只放知识库维护规则，其它项目说明可后续补充。

## 知识库维护规则

本仓库用 `workflow/` 下的流程框架维护知识库。

**任何一次研究 / 分析 / 逆向 / 实验收尾、且产生了值得留存的结论时，必须打开并执行 `workflow/intake.md` 定义的入库流程**，把结论沉淀成知识页，别只停在对话里。

- 流程本体：`workflow/intake.md`
- 结构规则：`workflow/schema.md`
- 页面模板：`workflow/templates/`
- 知识库根：`analysis/`（唯一，公开上 GitHub）。`private/` 不是知识库根，是本地非公开材料区（脚本、一次性草稿，被 gitignore），不走入库流程。
