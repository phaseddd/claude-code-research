# workflow/ — 知识库维护流程框架

这个目录是本仓库知识库的**流程框架**（不是知识内容本身）。它规定：研究收尾怎么入库，以及隔一段时间怎么扫库防腐烂。

面向两类读者：

- **人**（维护者）：想知道知识库怎么维护、页面怎么写。
- **AI**（Claude Code / Codex）：每次会话经由根目录 `CLAUDE.md` / `AGENTS.md` 里的指针被引导到这里；入库走 `intake.md`，定期体检走 `maintenance.md`。

## 内容

- `intake.md` —— 入库流程本体（每次研究收尾必走的六步，带卡点；含冲突复检与 `STALE_SUGGESTION`）。
- `maintenance.md` —— 定期维护清单（staleness / orphan·死链 / tag↔glossary；与入库分工见该文件）。
- `schema.md` —— 知识库结构规则（frontmatter 字段、kind、status、tag、命名、可见性）。
- `templates/` —— 五种页面的空模板（concept / mechanism / case / decision / investigation）。

## 框架 vs 内容（重要纪律）

- 本目录只放**框架**：规则、流程、空模板。可公开、随仓库走。
- **知识内容**（结论页，以及 `index.md` / `log.md` / `glossary.md`）放在公开知识库根 `analysis/`，**不进这里**。`private/` 是本地非公开材料区（脚本、一次性草稿），既不是框架也不是知识库根。

## 怎么用

- **研究收尾入库**：直接读并执行 `intake.md`（选类型 → 填元信息 → 冲突复检/`STALE_SUGGESTION` → 更新索引 → 写日志 → 判定状态）。规则细节在 `schema.md`。
- **定期扫库**：读并执行 `maintenance.md`（何时跑、三项清单、明确不做的事）。

## 设计依据

本框架的结构提案与工作流 harness 设计（含三家框架调研）源自研究阶段的两份草稿，结论已内化进本目录的 `schema.md` / `intake.md` / 模板；原始草稿属一次性材料，落地后已清理，不再单独留存。
