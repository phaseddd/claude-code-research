# schema.md — 知识库结构规则

本文件规定：知识页怎么写、怎么命名、怎么归置、怎么标状态。这是规则源头，`intake.md` 的每一步都以它为准。

## 1. 知识页统一放公开根 analysis/（frontmatter 不写 visibility）

知识页（结论页，以及 `index.md` / `log.md` / `glossary.md`）统一放在 `analysis/`，随仓库公开上 GitHub。「是知识页」即「进 `analysis/`」即「公开」——这层由路径本身承载，所以 frontmatter 里**不设 `visibility` 字段**，省掉「路径 + 字段」两处维护。

`private/` **不是**与 `analysis/` 平行的「私有知识库根」，而是本地、被 gitignore 的**非公开材料区**（补丁脚本、研究时的一次性草稿等）：不纳入知识库索引、不走本流程。研究产出的原始草稿可以先落在这里，核心结论一旦提炼成知识页就进 `analysis/`，草稿按需清理。

## 2. frontmatter（每个知识页开头必填）

```yaml
---
title: 页面标题
kind: concept | mechanism | case | decision | investigation
status: draft | active | stale | superseded
updated: 2026-07-06
applies_to: 适用的版本或上下文（如 claude-code 2.1.201；无版本绑定写 general）
tags:
  - topic:xxx
  - form:xxx
---
```

- 六个字段一个都不能少（缺任一 = 入库失败）。
- **不含 `visibility`**（见第 1 节，知识页统一在公开根 `analysis/`）。
- 不许占位符：`tags` 写 `TODO`、`applies_to` 留空，都算没填。

## 3. kind（页面类型，先 5 种）

- `concept` —— 解释一个名词 / 概念是什么。
- `mechanism` —— 讲清楚一个流程 / 系统怎么运作。
- `case` —— 分析一个具体项目或对象。
- `decision` —— 记录本项目为什么这么选。
- `investigation` —— 调查 / 验证过程记录：一次调查怎么做的、验证了什么、试过哪些路径（含失败或排除的）、还有哪些没确认。适合「过程本身就是产物」或「结论还没定」的情况。**生命周期**：一旦凝成可复用的明确结论，必须另写 `concept` / `mechanism` / `case` / `decision` 之一，把验证细节内联或链进那页的证据章节，并在调查页「后续动作」链到新页；禁止把最终结论只留在 investigation 页里当长期真理。

`evidence`（证据）默认不独立成页——它是各结论页里「证据与复核」章节的内容；只有证据量大到要独立、或要被多个页面共同引用时，才升成独立页。其它类型不够用时再加，别一上来铺一堆用不上的。

## 4. status（成熟度，四态）

- `draft` —— 流程已记录，但仍有未确认点、证据不足、或等待人工判断。
- `active` —— 结论可复用，证据与适用边界清楚，冲突复检已通过。
- `stale` —— 曾经有效，但依据版本 / 工具行为 / 外部事实已过时，需复核。
- `superseded` —— 已被新页面或新结论取代（在 frontmatter 加一行 `note:` 指向新页）。

**关键：六步流程跑完 ≠ 自动 `active`。** 跑完只说明「流程合格」，还要再判一次「依据够不够、边界清不清、可不可复核」；够格才 `active`，否则保留 `draft` 或标 `stale`。

## 5. tag（受控前缀）

标签用前缀自我约束，先只用两类起步：

- `topic:xxx` —— 主题（如 `topic:claude-code`、`topic:npm`、`topic:bun-sea`）。
- `form:xxx` —— 形态（如 `form:mechanism`、`form:concept`）。

新词先加进 `analysis/glossary.md`，再用。目的：避免同一个东西出现两种叫法（同义词漂移）。

## 6. 目录布局

知识库根 `analysis/` 的内部结构：

```text
analysis/
  index.md        # 索引：每行一个页面（相对路径 + 一句话 + 标签）
  log.md          # 日志：只追加，记录知识库怎么演化
  glossary.md     # 术语表：受控词与解释
  concepts/  mechanisms/  cases/  decisions/   # 按 kind 分目录存放页面
```

`index.md` / `log.md` / `glossary.md` 是**知识库内容 / 状态**，随 `analysis/` 走，不进 `workflow/`。

## 7. 命名

- 文件名用语义短名（如 `bun-sea.md`、`npm-global-install-layout.md`），不用纯编号。
- 需要保留时间顺序的（`decision` / 日志型）可加日期前缀（如 `2026-07-06-xxx.md`）。
- 旧的 `00-10` 编号文档**原地不动**，不强制改名；等实际要用某主题时再提炼成语义命名的页面。
